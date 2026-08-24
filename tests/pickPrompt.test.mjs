import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPickPrompt,
  parsePickReply,
  normaliseProbability,
} from "../src/lib/pickPrompt.js";

const EVENT = {
  event_name: "Malaga CF - Deportivo de A Coruna",
  sport: "football",
  competition: "LaLiga 2",
  round: 4,
};

const MARKETS = [
  {
    market: "1x2",
    label: "Match Result",
    selections: [
      { pick: "Malaga CF", odds: 2.37 },
      { pick: "Draw", odds: 3.0 },
      { pick: "Deportivo de A Coruna", odds: 3.35 },
    ],
  },
  {
    market: "totals",
    label: "Total Goals",
    line: "2.5",
    selections: [
      { pick: "Over 2.5", odds: 2.47 },
      { pick: "Under 2.5", odds: 1.55 },
    ],
  },
];

test("prompt contains every selection and its price", () => {
  const p = buildPickPrompt(EVENT, MARKETS);
  assert.match(p, /Malaga CF @ 2\.37/);
  assert.match(p, /Draw @ 3\.00/);
  assert.match(p, /Over 2\.5 @ 2\.47/);
  assert.match(p, /line 2\.5/);
});

test("schema asks for a stake but never for a price", () => {
  const p = buildPickPrompt(EVENT, MARKETS);
  const schemaLine = p.split("\n").find((l) => l.includes('"market"'));
  assert.ok(schemaLine, "schema line present");
  assert.ok(schemaLine.includes('"stake"'), "the model sizes its own bet");
  assert.ok(!schemaLine.includes('"odds"'), "a price is a fact, not a judgement");
});

test("prompt states the competition it belongs to", () => {
  const p = buildPickPrompt(EVENT, MARKETS);
  assert.match(p, /1,000,000 CHALLENGE/);
  assert.match(p, /Claude, Grok, ChatGPT, Kimi and Gemini/);
  assert.match(p, /no cap on a bet/);
});

test("prompt shows the field and marks which fighter is reading it", () => {
  const p = buildPickPrompt(EVENT, MARKETS, {
    model: "Claude",
    standings: [
      { rank: 1, model: "Kimi", bankroll: 1170.5 },
      { rank: 2, model: "Claude", bankroll: 1053.5 },
      { rank: 3, model: "Grok", bankroll: 0, liquidated: true },
    ],
  });
  assert.match(p, /1\. Kimi EUR 1170\.50/);
  assert.match(p, /Claude EUR 1053\.50 {2}<- you/);
  assert.match(p, /Grok EUR 0\.00 ELIMINATED/);
});

test("prompt carries the fighter's own budget when supplied", () => {
  const p = buildPickPrompt(EVENT, MARKETS, {
    model: "Claude",
    bankroll: 1053.5,
    dailyRemaining: 40,
  });
  assert.match(p, /YOU ARE: Claude/);
  assert.match(p, /EUR 1053\.50/);
  assert.match(p, /EUR 40\.00/);
});

test("takes the model's stake but never the model's price", () => {
  const reply = [
    '{"market":"1x2","pick":"Malaga CF","odds":9.99,"stake":120,"prob":0.48,"confidence":70,"reasoning":"Home form.","risk":"Injury."}',
    '{"market":"totals","pick":"Over 2.5","stake":40,"prob":0.55,"confidence":60,"reasoning":"Leaky.","risk":"Rain."}',
  ].join("\n");

  const { rows, warnings } = parsePickReply(reply, { markets: MARKETS });
  assert.equal(rows.length, 2);
  assert.equal(warnings.length, 0);
  // 9.99 was asserted by the model and must be discarded.
  assert.equal(rows[0].odds, 2.37);
  assert.equal(rows[0].stake, 120, "the stake is the model's call");
  assert.equal(rows[0].fair_prob, 0.48);
  assert.equal(rows[1].stake, 40);
});

test("stake is rounded to whole euros and floored at 1", async () => {
  const { normaliseStake } = await import("../src/lib/pickPrompt.js");
  assert.equal(normaliseStake(12.4), 12);
  assert.equal(normaliseStake("EUR 55"), 55);
  assert.equal(normaliseStake(0.2), 1);
  assert.equal(normaliseStake(0), null);
  assert.equal(normaliseStake("lots"), null);
});

test("a reply that overspends the budget is scaled down, not silently accepted", () => {
  const reply = [
    '{"market":"1x2","pick":"Malaga CF","stake":400,"prob":0.5,"reasoning":"a"}',
    '{"market":"totals","pick":"Over 2.5","stake":400,"prob":0.5,"reasoning":"b"}',
  ].join("\n");
  const out = parsePickReply(reply, { markets: MARKETS, available: 500 });
  const total = out.rows.reduce((t, r) => t + r.stake, 0);
  assert.ok(total <= 500, `scaled to ${total}`);
  assert.ok(out.warnings.some((w) => /Scaled down/.test(w)));
});

test("a missing stake is flagged rather than defaulted", () => {
  const out = parsePickReply(
    '{"market":"1x2","pick":"Draw","prob":0.33,"reasoning":"Tight."}',
    { markets: MARKETS }
  );
  assert.equal(out.rows[0].stake, "");
  assert.ok(out.warnings.some((w) => /no stake/.test(w)));
});

test("markdown fences and prose do not defeat the parser", () => {
  const reply =
    "Sure! Here are my picks:\n```json\n" +
    '{"market":"1x2","pick":"Draw","prob":0.33,"reasoning":"Tight game."}\n' +
    "```\nHope that helps.";
  const { rows } = parsePickReply(reply, { markets: MARKETS });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pick, "Draw");
  assert.equal(rows[0].odds, 3.0);
});

test("a hallucinated selection is rejected, not written", () => {
  const reply = '{"market":"1x2","pick":"Real Madrid","prob":0.9,"reasoning":"n/a"}';
  const { rows, warnings } = parsePickReply(reply, { markets: MARKETS });
  assert.equal(rows.length, 0);
  assert.match(warnings[0], /not a selection offered/);
});

test("duplicate picks collapse to one", () => {
  const reply = [
    '{"market":"1x2","pick":"Draw","prob":0.3,"reasoning":"a"}',
    '{"market":"1x2","pick":"Draw","prob":0.4,"reasoning":"b"}',
  ].join("\n");
  const { rows, warnings } = parsePickReply(reply, { markets: MARKETS });
  assert.equal(rows.length, 1);
  assert.match(warnings[0], /Duplicate/);
});

test("NONE yields no rows and no complaints", () => {
  const { rows, warnings } = parsePickReply("NONE", { markets: MARKETS });
  assert.equal(rows.length, 0);
  assert.equal(warnings.length, 0);
});

test("probability accepts every shape a model actually emits", () => {
  assert.equal(normaliseProbability(0.62), 0.62);
  assert.equal(normaliseProbability(".62"), 0.62);
  assert.equal(normaliseProbability("62%"), 0.62);
  assert.equal(normaliseProbability("62"), 0.62);
});

test("certainty is not a price and is rejected", () => {
  // fair_prob is numeric(6,5) with check (fair_prob > 0 and < 1). Anything
  // that rounds to 0 or 1 at five places is refused here rather than by
  // Postgres, where the error names no field.
  assert.equal(normaliseProbability(1), null);
  assert.equal(normaliseProbability(100), null);
  assert.equal(normaliseProbability(0), null);
  assert.equal(normaliseProbability(0.999996), null);
});

test("nonsense probability is dropped rather than guessed", () => {
  assert.equal(normaliseProbability("abc"), null);
  assert.equal(normaliseProbability(-1), null);
  assert.equal(normaliseProbability(140), null);
  const reply = '{"market":"1x2","pick":"Draw","prob":"soon","reasoning":"x"}';
  const { rows, warnings } = parsePickReply(reply, { markets: MARKETS });
  assert.equal(rows[0].fair_prob, "");
  assert.match(warnings[0], /no usable probability/);
});

test("confidence is clamped to 0-100", () => {
  const reply = '{"market":"1x2","pick":"Draw","prob":0.3,"confidence":9000,"reasoning":"x"}';
  const { rows } = parsePickReply(reply, { markets: MARKETS });
  assert.equal(rows[0].confidence, 100);
});

test("garbage input warns instead of throwing", () => {
  const { rows, warnings } = parsePickReply("¯\\_(ツ)_/¯", { markets: MARKETS });
  assert.equal(rows.length, 0);
  assert.equal(warnings.length, 1);
});

/* ---------------------------------------------------------------- adapter -- */

const STORED_EVENT = {
  event_name: "Malaga CF - Deportivo de A Coruna",
  sport: "football",
  odds: {
    "1x2": { line: null, prices: { "Malaga CF": 2.37, Draw: 3.0, "Deportivo de A Coruna": 3.35 } },
    totals: { line: "2.5", prices: { "Over 2.5": 2.47, "Under 2.5": 1.55 } },
    // A market the operator enabled but never priced.
    btts: { line: null, prices: { Yes: 0, No: null } },
  },
};

test("adapter reads the stored odds matrix", async () => {
  const { marketsFromEvent } = await import("../src/lib/pickPrompt.js");
  const m = marketsFromEvent(STORED_EVENT);
  assert.equal(m.length, 2, "the unpriced market is dropped");
  assert.deepEqual(m.map((x) => x.market), ["1x2", "totals"]);
  assert.equal(m[1].line, "2.5");
  assert.equal(m[0].selections[0].odds, 2.37);
});

test("adapter output round-trips through prompt and parser", async () => {
  const { marketsFromEvent } = await import("../src/lib/pickPrompt.js");
  const markets = marketsFromEvent(STORED_EVENT);
  const prompt = buildPickPrompt(STORED_EVENT, markets);
  assert.ok(!prompt.includes("Yes @"), "an unpriced selection is never offered");

  const { rows } = parsePickReply(
    '{"market":"totals","pick":"Under 2.5","prob":0.6,"reasoning":"Low tempo."}',
    { markets }
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].odds, 1.55);
});

test("a pick on an unpriced market is refused", async () => {
  const { marketsFromEvent } = await import("../src/lib/pickPrompt.js");
  const markets = marketsFromEvent(STORED_EVENT);
  const { rows, warnings } = parsePickReply(
    '{"market":"btts","pick":"Yes","prob":0.5,"reasoning":"x"}',
    { markets }
  );
  assert.equal(rows.length, 0);
  assert.match(warnings[0], /not a selection offered/);
});
