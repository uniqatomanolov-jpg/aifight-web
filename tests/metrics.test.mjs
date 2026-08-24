import test from "node:test";
import assert from "node:assert/strict";
import {
  closingLineValue,
  clvSummary,
  brierScore,
  calibrationBuckets,
} from "../src/lib/engine.js";

/**
 * These functions were reconstructed from the deployed 2.8 bundle after the
 * source was lost. The tests below pin the behaviour that matters, so a future
 * rewrite cannot quietly change what the Hall of Fame ranks on.
 */

test("CLV is the taken price over the closing price", () => {
  // Took 2.10, market closed 2.00 -- beat the close by 5%.
  assert.equal(closingLineValue({ odds: 2.1, closing_odds: 2.0 }).toFixed(4), "0.0500");
  // Took 1.90 into a 2.00 close -- late to the price.
  assert.ok(closingLineValue({ odds: 1.9, closing_odds: 2.0 }) < 0);
  assert.equal(closingLineValue({ odds: 2.0, closing_odds: 2.0 }), 0);
});

test("CLV is null when either price is missing or invalid", () => {
  assert.equal(closingLineValue({ odds: 2.0 }), null);
  assert.equal(closingLineValue({ odds: 2.0, closing_odds: 1 }), null);
  assert.equal(closingLineValue({ odds: 1, closing_odds: 2.0 }), null);
  assert.equal(closingLineValue(null), null);
  assert.equal(closingLineValue({ odds: "abc", closing_odds: 2 }), null);
});

test("unpriced bets are excluded, not counted as zero CLV", () => {
  const priced = { odds: 2.1, closing_odds: 2.0 };
  const unpriced = { odds: 2.1 };
  const withGaps = clvSummary([priced, unpriced, unpriced], { minSamples: 1 });
  const withoutGaps = clvSummary([priced], { minSamples: 1 });
  // Averaging a missing price as 0 would drag this toward the middle.
  assert.equal(withGaps.average, withoutGaps.average);
  assert.equal(withGaps.sample, 1);
});

test("CLV summary reports beat rate and reliability separately", () => {
  const bets = [
    { odds: 2.2, closing_odds: 2.0 },
    { odds: 1.95, closing_odds: 2.0 },
    { odds: 2.05, closing_odds: 2.0 },
  ];
  const s = clvSummary(bets, { minSamples: 5 });
  assert.equal(s.sample, 3);
  assert.ok(Math.abs(s.beatRate - 2 / 3) < 1e-9);
  assert.equal(s.reliable, false, "3 priced bets is below the 5 sample gate");
  assert.equal(clvSummary(bets, { minSamples: 3 }).reliable, true);
});

test("empty CLV input is unmeasured, not zero", () => {
  const s = clvSummary([]);
  assert.equal(s.average, null);
  assert.equal(s.beatRate, null);
  assert.equal(s.reliable, false);
});

test("Brier scores a perfect forecaster at 0 and a coin flip at 0.25", () => {
  assert.equal(brierScore([{ result: "win", fair_prob: 1 }, { result: "loss", fair_prob: 0 }]), 0);
  const coin = brierScore([
    { result: "win", fair_prob: 0.5 },
    { result: "loss", fair_prob: 0.5 },
  ]);
  assert.equal(coin, 0.25);
});

test("Brier punishes confident wrongness hardest", () => {
  const confidentWrong = brierScore([{ result: "loss", fair_prob: 0.95 }]);
  const hedgedWrong = brierScore([{ result: "loss", fair_prob: 0.55 }]);
  assert.ok(confidentWrong > hedgedWrong);
});

test("voids and unpriced forecasts are excluded from Brier", () => {
  const bets = [
    { result: "win", fair_prob: 0.6 },
    { result: "void", fair_prob: 0.99 },
    { result: "win" },
    { result: null, fair_prob: 0.5 },
  ];
  assert.equal(brierScore(bets), brierScore([{ result: "win", fair_prob: 0.6 }]));
});

test("a model that never stated a probability is null, not perfect", () => {
  assert.equal(brierScore([{ result: "win" }, { result: "loss" }]), null);
  assert.equal(brierScore([]), null);
});

test("calibration buckets track predicted against observed", () => {
  const bands = calibrationBuckets([
    { result: "win", fair_prob: 0.75 },
    { result: "win", fair_prob: 0.72 },
    { result: "loss", fair_prob: 0.78 },
    { result: "loss", fair_prob: 0.71 },
  ]);
  const band = bands.find((b) => b.index === 7);
  assert.equal(band.sample, 4);
  assert.equal(band.actual, 0.5, "two of four won");
  assert.ok(band.predicted > 0.7 && band.predicted < 0.8);
});

test("empty buckets stay null so the chart can leave a gap", () => {
  const bands = calibrationBuckets([{ result: "win", fair_prob: 0.75 }]);
  const empty = bands.find((b) => b.index === 2);
  assert.equal(empty.sample, 0);
  assert.equal(empty.actual, null, "0 here would imply total overconfidence in an unused band");
  assert.equal(empty.predicted, null);
});

test("probabilities at the boundary do not fall off the end", () => {
  const bands = calibrationBuckets([{ result: "win", fair_prob: 0.9999 }]);
  assert.equal(bands[9].sample, 1);
  assert.equal(bands.reduce((a, b) => a + b.sample, 0), 1);
  // 0 and 1 are not forecasts, they are claims of certainty.
  assert.equal(calibrationBuckets([{ result: "win", fair_prob: 1 }]).reduce((a, b) => a + b.sample, 0), 0);
});

test("bucket count is configurable and always partitions [0,1]", () => {
  const bands = calibrationBuckets([], { buckets: 4 });
  assert.equal(bands.length, 4);
  assert.equal(bands[0].from, 0);
  assert.equal(bands[3].to, 1);
});
