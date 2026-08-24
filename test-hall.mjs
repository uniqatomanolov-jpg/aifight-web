/**
 * Tests the qualification logic against the rules read out of the live bundle.
 * The interesting cases are the ones where bet count alone gives the wrong
 * answer: enough bets but an uncomputable metric, or enough bets with nobody
 * to compete against.
 */
import {
  AWARDS,
  HALL_AWARDS,
  SHAMBLES_AWARDS,
  ENTRY_THRESHOLD,
  qualificationFor,
  contendersFor,
  hallActivity,
} from "./components/hall/awards.js";

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? " -- " + detail : ""}`);
  if (!ok) failures.push(label);
};

const row = (model, over = {}) => ({
  model,
  settledCount: 0,
  yield: null,
  brier: null,
  sharpe: null,
  clv: { average: null, reliable: false, sample: 0 },
  ...over,
});

const award = (key) => AWARDS.find((a) => a.key === key);

// --- table matches the deployed rules ---
check("seven awards defined", AWARDS.length === 7);
check("four hall awards", HALL_AWARDS.length === 4);
check("three shambles awards", SHAMBLES_AWARDS.length === 3);
check("entry threshold is 8", ENTRY_THRESHOLD === 8);
check(
  "thresholds match the live rules",
  award("sharp").minSample === 8 &&
    award("printer").minSample === 10 &&
    award("oracle").minSample === 12 &&
    award("ironside").minSample === 10 &&
    award("donkey").minSample === 8 &&
    award("arsonist").minSample === 10 &&
    award("blowhard").minSample === 12
);
check("brier is scored low-is-better", award("oracle").better === "low");
check("blowhard is the inverse of oracle", award("blowhard").better === "high");

// --- state 1: not enough bets ---
const rookie = row("Kimi", { settledCount: 3, yield: 0.1 });
const q1 = qualificationFor(rookie, award("printer"), [rookie]);
check("short sample reports state 'sample'", q1.state === "sample");
check("progress is fractional", Math.abs(q1.progress - 0.3) < 1e-9, String(q1.progress));
check("reason counts the shortfall", q1.reason.includes("7 more"), q1.reason);

// --- state 2: enough bets, metric not computable ---
const noClv = row("Grok", { settledCount: 20, clv: { average: null, reliable: false } });
const q2 = qualificationFor(noClv, award("sharp"), [noClv]);
check("uncomputable metric reports state 'metric'", q2.state === "metric");
check("bar is full despite being blocked", q2.progress === 1);
check("reason names the missing input", q2.reason.includes("closing odds"), q2.reason);

// --- state 3: qualified but unopposed ---
const lone = row("Claude", { settledCount: 15, yield: 0.2 });
const q3 = qualificationFor(lone, award("printer"), [lone]);
check("single qualifier reports state 'contested'", q3.state === "contested");
check("reason explains the missing opponent", q3.reason.includes("second qualified"), q3.reason);

// --- state 4: genuinely eligible ---
const a = row("Claude", { settledCount: 15, yield: 0.2 });
const b = row("Gemini", { settledCount: 12, yield: 0.05 });
check("two qualifiers are eligible", qualificationFor(a, award("printer"), [a, b]).state === "eligible");

// --- ranking ---
const ranked = contendersFor(award("printer"), [a, b]);
check("leader ranks first", ranked[0].model === "Claude" && ranked[0].leading === true);
check("gap is measured from the leader", Math.abs(ranked[1].gap - 0.15) < 1e-9, String(ranked[1].gap));

const brierRanked = contendersFor(award("oracle"), [
  row("Claude", { settledCount: 14, brier: 0.28 }),
  row("Grok", { settledCount: 14, brier: 0.19 }),
]);
check("low-is-better ranks the smaller score first", brierRanked[0].model === "Grok");

check(
  "ineligible models are excluded from ranking",
  contendersFor(award("printer"), [a, b, rookie]).length === 2
);

// --- activity feed ---
const feed = hallActivity([
  row("Claude", { settledCount: 15, yield: 0.2 }),
  row("Gemini", { settledCount: 12, yield: 0.18 }),
  row("Kimi", { settledCount: 9, yield: 0.04 }),
]);
check("feed produces events", feed.length > 0, `got ${feed.length}`);
check("feed surfaces a race", feed.some((e) => e.kind === "race"));
check(
  "feed surfaces a near miss within two bets",
  feed.some((e) => e.kind === "near" && e.text.includes("Kimi"))
);
check("tightest items sort first", feed[0].priority <= feed[feed.length - 1].priority);
check("feed respects its limit", hallActivity([a, b], { limit: 2 }).length <= 2);

// --- degenerate input ---
check("empty rows do not throw", hallActivity([]).length === 0);
check(
  "missing metrics do not throw",
  qualificationFor(row("X"), award("oracle"), []).state === "sample"
);

console.log("");
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILED: ${failures.join(", ")}`);
process.exit(failures.length ? 1 : 0);
