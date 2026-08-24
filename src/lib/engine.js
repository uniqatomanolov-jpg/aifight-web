/**
 * THE BANKROLL ENGINE
 * ===================
 * Every number the arena shows -- bankroll, ROI, Sharpe, max drawdown,
 * today's remaining budget, the LIQUIDATED stamp -- is computed here, from
 * the bet ledger, on demand.
 *
 * THE ONE ARCHITECTURAL DECISION THAT MATTERS
 * -------------------------------------------
 * Bankrolls are DERIVED, never stored.
 *
 * The obvious design is a `fighters.bankroll` column that settlement adds to
 * and subtracts from. It is also the design that guarantees this project a
 * slow, unfixable data-corruption bug, because it makes the displayed
 * bankroll a *second* source of truth that has to be kept in lockstep with
 * the bets. Every double-click, every retried request, every re-grade of a
 * bet that was settled wrong, every row deleted by hand in the Supabase
 * table editor -- each one silently desynchronises the two, and nothing in
 * the system can tell you which is right afterwards.
 *
 * Deriving costs one pass over an array of a few thousand rows -- under a
 * millisecond -- and buys three things outright:
 *
 *   1. Grading is freely correctable. Marking a bet WIN, then LOSS, then
 *      VOID, then WIN again lands on exactly the number as if it had been
 *      graded WIN the first time. There is no accumulated error to undo,
 *      because nothing accumulated.
 *   2. The books cannot drift. `bankroll` is a pure function of `bets`, so
 *      "the bankroll is wrong" becomes impossible to express -- there is
 *      only "a bet is wrong", which you can see and fix.
 *   3. History is reconstructible. Any past state is the same function over
 *      a filtered slice of the same ledger.
 *
 * Supabase still exposes the aggregates: `schema.sql` defines a
 * `fighter_standings` VIEW computing the same figures in SQL, so anything
 * that wants the numbers server-side gets them without a sync job. A view
 * cannot drift from its source table either -- that is the whole point.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

// NOTE: imported, not re-exported directly -- `export { X } from` creates no
// local binding, and both names are used inside this module.
import { FIGHTERS, MODELS as FIGHTER_MODELS } from "./fighters.js";

export const MODELS = FIGHTER_MODELS;

/**
 * Display metadata. Re-exported from lib/fighters.js so the palette has
 * exactly one definition in the repo: that module also carries the gradient
 * stops and glow colours, which this object predates. Every existing
 * `MODEL_META[model].accent` call site keeps working unchanged.
 */
export const MODEL_META = FIGHTERS;

export const STARTING_BANKROLL = 1000;
/**
 * The per-fighter daily stake ceiling, or `null` for no ceiling.
 *
 * Set to null: models stake freely, bounded only by what they actually have.
 * The cap was never an event limit -- it capped money per day, not fixtures --
 * and with a ten-event card across several sports it was forcing every stake
 * into a ~10 euro box.
 *
 * WHAT STILL BINDS. `available` (bankroll minus stake already committed to
 * open bets) is a hard floor and is NOT part of this switch. Removing it would
 * let a fighter stake money it does not have, and every bankroll on the site
 * would stop reconciling.
 *
 * Restoring a cap is one line: set this to a number. Every consumer reads
 * `hasDailyLimit` rather than testing the constant itself, so nothing else
 * needs to change.
 */
export const DAILY_LIMIT = null;

export const hasDailyLimit = Number.isFinite(DAILY_LIMIT) && DAILY_LIMIT > 0;
export const CHALLENGE_TARGET = 1_000_000;

/** The arena's operating timezone. Defines where one betting day ends. */
export const TIME_ZONE = "Europe/Sofia";

export const RESULTS = ["win", "loss", "void"];

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/**
 * Round to cents.
 *
 * `Number(x.toFixed(2))` rather than `Math.round(x * 100) / 100`: the latter
 * gets 1.005 wrong in binary floating point, and stake x odds lands on
 * values like that constantly.
 */
export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(2));
}

export function toNumber(value, fallback = 0) {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * What a bet returns under a given result.
 *
 * This is the entire settlement rulebook, and it is deliberately three lines
 * long. It takes an explicit `result` argument rather than reading
 * `bet.result` so the UI can preview all three outcomes side by side before
 * the operator commits to one.
 *
 *   WIN   payout = stake x odds        profit = stake x (odds - 1)
 *   LOSS  payout = 0                   profit = -stake
 *   VOID  payout = stake               profit = 0        (a full refund)
 *
 * Note that `payout` includes the returned stake and `profit` does not.
 * Conflating those two is the classic bankroll bug: bankroll moves by
 * PROFIT, never by payout.
 */
export function payoutFor(bet, result) {
  const stake = round2(toNumber(bet?.stake));
  const odds = toNumber(bet?.odds);

  if (result === "win") {
    const payout = round2(stake * odds);
    return { payout, profit: round2(payout - stake), settled: true };
  }
  if (result === "loss") {
    return { payout: 0, profit: round2(-stake), settled: true };
  }
  if (result === "void" || result === "push") {
    return { payout: stake, profit: 0, settled: true };
  }
  // Ungraded. Not zero profit -- unknown profit. The distinction matters
  // because a pending bet must not count toward ROI or Sharpe.
  return { payout: null, profit: 0, settled: false };
}

/**
 * The exact column patch to write when grading a bet.
 *
 * Passing `result: null` un-grades it -- grading is a correction, not a
 * commitment, so every path through this function is reversible.
 */
export function settlementPatch(bet, result, now = new Date()) {
  if (result === null || result === undefined || result === "pending") {
    return { result: null, payout: null, profit: null, settled_at: null };
  }
  const { payout, profit } = payoutFor(bet, result);
  return {
    result,
    payout,
    profit,
    settled_at: now.toISOString(),
  };
}

/**
 * Profit as stored, or recomputed if the stored value is missing.
 *
 * Rows written before `profit` existed, or edited by hand in the Supabase
 * table editor, will not have it. Recomputing from stake and odds means such
 * a row still lands in the right place instead of quietly counting as zero.
 */
export function profitOf(bet) {
  if (!bet?.result) return 0;
  if (bet.profit !== null && bet.profit !== undefined && Number.isFinite(Number(bet.profit))) {
    return round2(Number(bet.profit));
  }
  return payoutFor(bet, bet.result).profit;
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/**
 * The calendar day a timestamp falls on, in the arena's timezone.
 *
 * `en-CA` because it formats as YYYY-MM-DD, which sorts lexicographically.
 * Doing this with `toISOString().slice(0, 10)` would silently use UTC and
 * roll the daily budget over at the wrong hour for two months of the year.
 */
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return DAY_FORMAT.format(d);
}

/* ------------------------------------------------------------------ */
/* Risk metrics                                                        */
/* ------------------------------------------------------------------ */

/**
 * Sharpe ratio over per-bet returns.
 *
 * The unit of return is profit / stake, so a bet is compared against its own
 * risk rather than against the bankroll -- otherwise a fighter would appear
 * to get "safer" purely by having grown.
 *
 * Two deliberate refusals:
 *   - No risk-free rate. Over a bet settling in ninety minutes it is noise.
 *   - No annualisation. Betting returns are not IID daily observations, and
 *     multiplying by sqrt(365) would inflate a small sample into a headline
 *     number that means nothing.
 *
 * Returns null below `minSamples`. A Sharpe over three bets is not a
 * measurement, and showing one invites reading it as a ranking. The UI
 * renders those as "--".
 */
export function sharpeRatio(bets, { minSamples = 5 } = {}) {
  const returns = bets
    .filter((b) => b.result && toNumber(b.stake) > 0)
    .map((b) => profitOf(b) / toNumber(b.stake));

  if (returns.length < minSamples) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  // Sample variance (n - 1): these are a sample of a strategy, not the
  // entire population of bets it will ever place.
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);

  // Every bet returned the same multiple. Real for a one-price sample, but
  // dividing by zero is not a ratio.
  if (!Number.isFinite(sd) || sd === 0) return null;

  return mean / sd;
}

/* ------------------------------------------------------------------ */
/* Closing line value and calibration                                  */
/* ------------------------------------------------------------------ */

/**
 * Closing line value for one bet: how much better the taken price was than
 * the price the market settled on.
 *
 *     clv = odds_taken / odds_closing - 1
 *
 * Positive means the price shortened after the bet was placed -- the market
 * moved toward the position. This is the metric that separates skill from
 * variance in small samples: results are noisy over 20 bets, but consistently
 * beating the close is not, because it measures the decision at the moment it
 * was made rather than the outcome that followed.
 *
 * Returns null when either price is missing or <= 1. A missing closing price
 * is not a zero CLV, and treating it as one would silently drag every average
 * toward the middle.
 */
export function closingLineValue(bet) {
  const taken = toNumber(bet?.odds, 0);
  const closing = toNumber(bet?.closing_odds, 0);
  if (taken <= 1 || closing <= 1) return null;
  return taken / closing - 1;
}

/**
 * Aggregate CLV across bets.
 *
 * `reliable` is the gate the Hall of Fame reads: below `minSamples` priced
 * bets the average exists but should not be ranked on, and the UI dims it.
 * `beatRate` is reported alongside the mean because one enormous overlay can
 * carry an average that a run of small losses would otherwise contradict.
 */
export function clvSummary(bets, { minSamples = 5 } = {}) {
  const values = bets.map(closingLineValue).filter((v) => v !== null);
  if (values.length === 0) {
    return { average: null, beatRate: null, sample: 0, reliable: false };
  }
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const beat = values.filter((v) => v > 0).length;
  return {
    average,
    beatRate: beat / values.length,
    sample: values.length,
    reliable: values.length >= minSamples,
  };
}

/**
 * Brier score over settled bets carrying a stated probability. Lower is
 * better; 0 is perfect, 0.25 is what you get by always saying 50%.
 *
 *     mean( (stated_probability - outcome)^2 )
 *
 * Voids are excluded along with everything else that has no win/loss outcome:
 * a refunded bet never resolved, so there is nothing to score the forecast
 * against. Returns null rather than 0 on an empty set, because a model that
 * has never stated a probability is unmeasured, not perfectly calibrated.
 */
export function brierScore(bets) {
  const scored = bets.filter(
    (b) => (b.result === "win" || b.result === "loss") && b.fair_prob != null
  );
  if (scored.length === 0) return null;
  return (
    scored.reduce((acc, bet) => {
      const stated = toNumber(bet.fair_prob, 0);
      const outcome = bet.result === "win" ? 1 : 0;
      return acc + (stated - outcome) ** 2;
    }, 0) / scored.length
  );
}

/**
 * Calibration buckets for a reliability diagram: predicted probability against
 * observed frequency, in `buckets` equal bands.
 *
 * A well-calibrated model tracks the diagonal -- of the bets it called 70%,
 * about 70% won. Buckets with no samples report null rather than 0, so the
 * chart can leave a gap instead of drawing a point at the floor and implying
 * the model was catastrophically overconfident in a band it never used.
 */
export function calibrationBuckets(bets, { buckets = 10 } = {}) {
  const scored = bets.filter(
    (b) => (b.result === "win" || b.result === "loss") && b.fair_prob != null
  );

  const bands = Array.from({ length: buckets }, (_, index) => ({
    index,
    from: index / buckets,
    to: (index + 1) / buckets,
    midpoint: (index + 0.5) / buckets,
    sample: 0,
    predicted: null,
    actual: null,
    _probSum: 0,
    _wins: 0,
  }));

  for (const bet of scored) {
    const prob = toNumber(bet.fair_prob, 0);
    if (!(prob > 0 && prob < 1)) continue;
    // A stated 1.0 would index past the last band; clamp instead of dropping.
    const slot = Math.min(buckets - 1, Math.floor(prob * buckets));
    bands[slot].sample += 1;
    bands[slot]._probSum += prob;
    if (bet.result === "win") bands[slot]._wins += 1;
  }

  for (const band of bands) {
    if (band.sample > 0) {
      band.predicted = band._probSum / band.sample;
      band.actual = band._wins / band.sample;
    }
    delete band._probSum;
    delete band._wins;
  }

  return bands;
}

/**
 * Largest peak-to-trough fall of the equity curve, as a fraction of the peak.
 *
 * Measured against the running peak rather than the starting bankroll, so a
 * fighter who reaches 3000 and falls to 1500 shows a 50% drawdown -- which
 * is what it cost them -- not a 0% one on the grounds that they are still
 * above where they started.
 */
export function maxDrawdown(equityCurve) {
  let peak = -Infinity;
  let worst = 0;
  for (const point of equityCurve) {
    if (point > peak) peak = point;
    if (peak > 0) {
      const dd = (peak - point) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

/** Oldest first. Ordering defines the equity curve, so it is not optional. */
function chronological(bets) {
  return [...bets].sort((a, b) => {
    const ta = new Date(a.logged_at ?? 0).getTime();
    const tb = new Date(b.logged_at ?? 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Everything about one fighter, derived from their bets.
 *
 * `pendingStake` is money committed but not yet resolved. It is subtracted
 * from `available` and not from `bankroll`, because an open bet has not lost
 * yet -- but it also cannot be staked twice.
 */
export function standingFor(model, allBets, { today = dayKey() } = {}) {
  const bets = chronological(allBets.filter((b) => b.model === model));
  const settled = bets.filter((b) => b.result);
  const pending = bets.filter((b) => !b.result);

  const turnover = round2(settled.reduce((a, b) => a + toNumber(b.stake), 0));
  const profit = round2(settled.reduce((a, b) => a + profitOf(b), 0));
  const bankroll = round2(STARTING_BANKROLL + profit);
  const pendingStake = round2(pending.reduce((a, b) => a + toNumber(b.stake), 0));

  const wins = settled.filter((b) => b.result === "win").length;
  const losses = settled.filter((b) => b.result === "loss").length;
  const voids = settled.filter((b) => b.result === "void" || b.result === "push").length;

  // Voids are excluded from win rate: a refunded bet was not a contest.
  const decided = wins + losses;

  // The equity curve, one point per settled bet, used for drawdown.
  const equity = [STARTING_BANKROLL];
  let running = STARTING_BANKROLL;
  let liquidatedAt = null;
  for (const bet of settled) {
    running = round2(running + profitOf(bet));
    equity.push(running);
    if (running <= 0 && liquidatedAt === null) {
      liquidatedAt = { round: bet.round ?? null, at: bet.settled_at ?? bet.logged_at ?? null };
    }
  }

  const stakedToday = round2(
    bets
      .filter((b) => dayKey(b.logged_at) === today)
      .reduce((a, b) => a + toNumber(b.stake), 0)
  );

  // A liquidated fighter is out. Their remaining budget is zero regardless
  // of what the daily limit says -- otherwise the meter invites a bet they
  // cannot fund.
  const liquidated = bankroll <= 0;
  const available = liquidated ? 0 : Math.max(0, round2(bankroll - pendingStake));
  // What this fighter may stake right now. With a cap in force that is the
  // lesser of the day's remainder and uncommitted funds; without one it is
  // simply uncommitted funds.
  const dailyRemaining = liquidated
    ? 0
    : hasDailyLimit
      ? Math.max(0, round2(Math.min(DAILY_LIMIT - stakedToday, available)))
      : available;

  return {
    model,
    ...MODEL_META[model],
    bankroll,
    profit,
    turnover,
    available,
    pendingStake,
    // ROI on turnover -- the standard betting yield. Undefined, not zero,
    // before the first settled bet.
    roi: turnover > 0 ? profit / turnover : null,
    winRate: decided > 0 ? wins / decided : null,
    // `yield` mirrors `roi` today. Both are kept because the Hall of Fame and
    // the sortable table refer to them by different names, and collapsing them
    // now would mean renaming call sites for no gain.
    yield: turnover > 0 ? profit / turnover : null,
    sharpe: sharpeRatio(settled),
    clv: clvSummary(bets),
    brier: brierScore(settled),
    calibration: calibrationBuckets(settled),
    maxDrawdown: maxDrawdown(equity),
    equity,
    wins,
    losses,
    voids,
    settledCount: settled.length,
    pendingCount: pending.length,
    betCount: bets.length,
    stakedToday,
    dailyRemaining,
    // Null when uncapped: there is no denominator, and rendering 0% would
    // read as "nothing staked" rather than "no limit".
    dailyUsedPct: hasDailyLimit ? Math.min(100, (stakedToday / DAILY_LIMIT) * 100) : null,
    // The risk figure that matters once nothing caps a stake: how much of the
    // bankroll is currently riding on unsettled bets.
    exposure: bankroll > 0 ? pendingStake / bankroll : 0,
    liquidated,
    liquidatedRound: liquidatedAt?.round ?? null,
    // Progress toward the headline narrative.
    challengePct: Math.min(100, (bankroll / CHALLENGE_TARGET) * 100),
    bets,
  };
}

/** All five fighters, ranked. Feeds both the admin strip and the arena. */
export function standings(allBets, options = {}) {
  const today = options.today ?? dayKey();
  const rows = MODELS.map((m) => standingFor(m, allBets, { today }));
  return [...rows].sort((a, b) => {
    // The living outrank the liquidated, then it is simply bankroll.
    if (a.liquidated !== b.liquidated) return a.liquidated ? 1 : -1;
    return b.bankroll - a.bankroll;
  }).map((row, i) => ({ ...row, rank: i + 1 }));
}
/**
 * Sort keys for the standings table. `better` decides direction, so Brier
 * (lower is better) sorts the opposite way to everything else without the
 * table needing to special-case it.
 *
 * Nulls always sink, regardless of direction: an unmeasured model must never
 * top a leaderboard because null happened to compare favourably.
 */
export const SORT_KEYS = {
  bankroll: { label: "Bankroll", get: (r) => r.bankroll, better: "high" },
  yield: { label: "Yield", get: (r) => r.yield, better: "high" },
  roi: { label: "ROI", get: (r) => r.roi, better: "high" },
  clv: { label: "CLV", get: (r) => (r.clv?.reliable ? r.clv.average : null), better: "high" },
  sharpe: { label: "Sharpe", get: (r) => r.sharpe, better: "high" },
  brier: { label: "Brier", get: (r) => r.brier, better: "low" },
};

export function sortStandings(rows, sortBy = "bankroll") {
  const key = SORT_KEYS[sortBy] ?? SORT_KEYS.bankroll;
  return [...rows].sort((a, b) => {
    const av = key.get(a);
    const bv = key.get(b);
    const aNull = av == null || !Number.isFinite(av);
    const bNull = bv == null || !Number.isFinite(bv);
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    return key.better === "high" ? bv - av : av - bv;
  });
}


/** Combined bankroll against the €1,000,000 headline. */
export function challengeProgress(allBets) {
  const rows = standings(allBets);
  const total = round2(rows.reduce((a, r) => a + r.bankroll, 0));
  return {
    total,
    target: CHALLENGE_TARGET,
    pct: Math.min(100, (total / CHALLENGE_TARGET) * 100),
    alive: rows.filter((r) => !r.liquidated).length,
    liquidated: rows.filter((r) => r.liquidated).length,
    startedFrom: STARTING_BANKROLL * MODELS.length,
  };
}

/* ------------------------------------------------------------------ */
/* Cross-fighter analysis                                              */
/* ------------------------------------------------------------------ */

/**
 * How the fighters lined up on one market of one event.
 *
 * `consensus` is the share of participating fighters on the most popular
 * selection; `clash` is true when they split. Both are computed per MARKET,
 * not per event -- "Arsenal" in the 1X2 and "Over 2.5" in the totals are not
 * a disagreement, and treating them as one would make the badge meaningless.
 */
export function marketConsensus(bets) {
  const participating = bets.filter((b) => b.pick);
  if (participating.length === 0) {
    return { consensus: null, clash: false, leader: null, tally: [], voters: 0 };
  }

  const counts = new Map();
  for (const bet of participating) {
    counts.set(bet.pick, (counts.get(bet.pick) ?? 0) + 1);
  }
  const tally = [...counts.entries()]
    .map(([pick, count]) => ({
      pick,
      count,
      share: count / participating.length,
      models: participating.filter((b) => b.pick === pick).map((b) => b.model),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    consensus: tally[0].share,
    // A clash needs two or more fighters actually opposing each other.
    clash: tally.length > 1,
    leader: tally[0].pick,
    tally,
    voters: participating.length,
  };
}

/** Group an event's bets by market, each with its consensus reading. */
export function eventBreakdown(event, allBets) {
  const mine = allBets.filter((b) => b.event_id === event.id);
  const byMarket = new Map();
  for (const bet of mine) {
    if (!byMarket.has(bet.market)) byMarket.set(bet.market, []);
    byMarket.get(bet.market).push(bet);
  }
  return {
    bets: mine,
    markets: [...byMarket.entries()].map(([market, bets]) => ({
      market,
      bets,
      ...marketConsensus(bets),
    })),
    // Event-level flag for the card badge.
    hasClash: [...byMarket.values()].some((bets) => marketConsensus(bets).clash),
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Refuse a pick before it reaches the database.
 *
 * Returns an array of human-readable problems -- empty means valid. Every
 * rule here is one that has actually gone wrong: odds of 0 (silent total
 * loss), a stake over the daily limit, a duplicate of a bet already logged,
 * and an empty thesis (which renders as a blank rationale drawer on the
 * public site, the exact bug that started this rebuild).
 */
export function validatePick(draft, { standing, existingBets = [] } = {}) {
  const problems = [];
  const stake = toNumber(draft.stake);
  const odds = toNumber(draft.odds);
  const prob = draft.fair_prob === "" || draft.fair_prob == null ? null : toNumber(draft.fair_prob);

  if (!draft.model) problems.push("Pick a fighter.");
  if (!draft.event_id) problems.push("Pick a fixture.");
  if (!draft.market) problems.push("Pick a market.");
  if (!draft.pick) problems.push("Pick a selection.");

  if (!(odds > 1)) problems.push("Odds must be greater than 1.00.");
  if (odds > 1000) problems.push("Odds above 1000 are almost certainly a typo.");

  if (!(stake > 0)) problems.push("Stake must be greater than zero.");
  if (hasDailyLimit && stake > DAILY_LIMIT) {
    problems.push(`Stake exceeds the €${DAILY_LIMIT} daily limit.`);
  }

  if (standing) {
    if (standing.liquidated) {
      problems.push(`${draft.model} is liquidated and cannot bet.`);
    } else if (stake > standing.dailyRemaining) {
      problems.push(
        hasDailyLimit
          ? `Only €${standing.dailyRemaining.toFixed(2)} left in ${draft.model}'s budget today.`
          : `${draft.model} has only €${standing.dailyRemaining.toFixed(2)} uncommitted.`
      );
    }
  }

  if (prob !== null) {
    // Accept either a probability or a percentage -- operators type both.
    const p = prob > 1 ? prob / 100 : prob;
    if (!(p > 0 && p < 1)) problems.push("Probability must be between 0 and 1 (or 1-99%).");
  }

  const thesis = String(draft.reasoning ?? "").trim();
  if (thesis.length < 20) {
    problems.push("The thesis is what the public rationale drawer shows. Write at least a sentence.");
  }

  const duplicate = existingBets.some(
    (b) =>
      b.model === draft.model &&
      b.event_id === draft.event_id &&
      b.market === draft.market &&
      b.pick === draft.pick
  );
  if (duplicate) problems.push(`${draft.model} already has this exact bet logged.`);

  return problems;
}

/**
 * Expected value per unit staked, from the fighter's own probability.
 *
 * Recomputed here rather than trusted from the model's own reply: a language
 * model asserting "+EV" is a claim, and the arena should score the claim
 * against arithmetic it controls.
 */
export function expectedValue(odds, fairProb) {
  const o = toNumber(odds);
  let p = toNumber(fairProb, NaN);
  if (!Number.isFinite(p) || !(o > 1)) return null;
  if (p > 1) p = p / 100;
  if (!(p > 0 && p < 1)) return null;
  return p * (o - 1) - (1 - p);
}

/** Odds implied probability, before any margin removal. */
export function impliedProbability(odds) {
  const o = toNumber(odds);
  return o > 1 ? 1 / o : null;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const EURO = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(n) {
  return EURO.format(toNumber(n));
}

/** Signed money, for anything that is a change rather than a level. */
export function signedMoney(n) {
  const v = toNumber(n);
  return `${v > 0 ? "+" : ""}${EURO.format(v)}`;
}

export function percent(fraction, digits = 1) {
  if (fraction === null || fraction === undefined || !Number.isFinite(Number(fraction))) {
    return "--";
  }
  const v = Number(fraction) * 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

/** Unsigned percentage, for levels rather than changes (win rate, budget used). */
export function percentPlain(fraction, digits = 0) {
  if (fraction === null || fraction === undefined || !Number.isFinite(Number(fraction))) {
    return "--";
  }
  return `${(Number(fraction) * 100).toFixed(digits)}%`;
}

export function ratio(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "--";
  return Number(n).toFixed(digits);
}
