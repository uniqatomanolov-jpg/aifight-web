/**
 * Award criteria, extracted so the Hall view, the progress trackers and the
 * activity feed all reason from one table instead of three copies.
 *
 * Mirrors the rules already live on /hall. Three constraints matter, and only
 * the first is a simple bet count:
 *
 *   1. `minSample` settled bets for that specific award.
 *   2. The metric must be computable. CLV needs closing odds captured on the
 *      bets; a model can sit at 20 settled bets and still be ineligible for
 *      The Sharp because nothing recorded a closing price.
 *   3. At least two models must qualify AND the top two must differ. An award
 *      with a single eligible model is not awarded, because "best of one" is
 *      not a ranking.
 *
 * A progress bar that shows only (2) would therefore lie: it would fill to
 * 100% and no badge would appear. `qualificationFor` returns the binding
 * constraint so the UI can say which one is actually holding things up.
 */

export const AWARDS = [
  {
    key: "sharp",
    label: "The Sharp",
    tone: "gold",
    hall: true,
    minSample: 8,
    blurb: "Best closing line value. Beat the market, not just the result.",
    metricLabel: "CLV",
    metric: (row) => (row.clv?.reliable ? row.clv.average : null),
    better: "high",
    needs: "closing odds recorded on settled bets",
  },
  {
    key: "printer",
    label: "The Printer",
    tone: "emerald",
    hall: true,
    minSample: 10,
    blurb: "Highest yield. Most profit per euro staked.",
    metricLabel: "Yield",
    metric: (row) => row.yield,
    better: "high",
  },
  {
    key: "oracle",
    label: "The Oracle",
    tone: "violet",
    hall: true,
    minSample: 12,
    blurb: "Best calibrated. When it says 70%, it means 70%.",
    metricLabel: "Brier",
    metric: (row) => row.brier,
    better: "low",
    needs: "stated confidence on settled bets",
  },
  {
    key: "ironside",
    label: "Ironside",
    tone: "sky",
    hall: true,
    minSample: 10,
    blurb: "Best risk-adjusted return. Profit without the heart attacks.",
    metricLabel: "Sharpe",
    metric: (row) => row.sharpe,
    better: "high",
  },
  {
    key: "donkey",
    label: "The Donkey",
    tone: "rose",
    hall: false,
    minSample: 8,
    blurb: "Worst closing line value. Consistently late to the price.",
    metricLabel: "CLV",
    metric: (row) => (row.clv?.reliable ? row.clv.average : null),
    better: "low",
    needs: "closing odds recorded on settled bets",
  },
  {
    key: "arsonist",
    label: "The Arsonist",
    tone: "orange",
    hall: false,
    minSample: 10,
    blurb: "Worst yield. Turning bankroll into ash at scale.",
    metricLabel: "Yield",
    metric: (row) => row.yield,
    better: "low",
  },
  {
    key: "blowhard",
    label: "The Blowhard",
    tone: "amber",
    hall: false,
    minSample: 12,
    blurb: "Worst calibrated. Loud, confident, and wrong.",
    metricLabel: "Brier",
    metric: (row) => row.brier,
    better: "high",
  },
];

export const HALL_AWARDS = AWARDS.filter((a) => a.hall);
export const SHAMBLES_AWARDS = AWARDS.filter((a) => !a.hall);

/** Lowest bar in the whole system — used for the headline "X / N" figure. */
export const ENTRY_THRESHOLD = Math.min(...AWARDS.map((a) => a.minSample));

const finite = (v) => v != null && Number.isFinite(v);

/**
 * Where one model stands against one award.
 *
 * @returns {{
 *   state: "sample"|"metric"|"contested"|"eligible",
 *   settled: number, minSample: number, progress: number, reason: string
 * }}
 */
export function qualificationFor(row, award, allRows = []) {
  const settled = row?.settledCount ?? 0;
  const progress = Math.min(1, award.minSample ? settled / award.minSample : 0);

  if (settled < award.minSample) {
    const short = award.minSample - settled;
    return {
      state: "sample",
      settled,
      minSample: award.minSample,
      progress,
      reason: `${short} more settled bet${short === 1 ? "" : "s"} needed`,
    };
  }

  if (!finite(award.metric(row))) {
    return {
      state: "metric",
      settled,
      minSample: award.minSample,
      progress: 1,
      reason: award.needs ? `Waiting on ${award.needs}` : "Metric not yet computable",
    };
  }

  // The award needs a contest, not just a qualifier.
  const contenders = allRows.filter(
    (r) => (r.settledCount ?? 0) >= award.minSample && finite(award.metric(r))
  );
  if (contenders.length < 2) {
    return {
      state: "contested",
      settled,
      minSample: award.minSample,
      progress: 1,
      reason: "Needs a second qualified model to compete against",
    };
  }

  return {
    state: "eligible",
    settled,
    minSample: award.minSample,
    progress: 1,
    reason: "In contention",
  };
}

/**
 * Ranked contenders for an award, with the gap to the leader.
 * Feeds the activity ticker: a near-miss is only interesting if you can say
 * how near it was.
 */
export function contendersFor(award, rows = []) {
  const eligible = rows
    .filter((r) => (r.settledCount ?? 0) >= award.minSample && finite(award.metric(r)))
    .map((r) => ({ model: r.model, value: award.metric(r), settled: r.settledCount ?? 0 }));

  eligible.sort((a, b) => (award.better === "high" ? b.value - a.value : a.value - b.value));

  const leader = eligible[0];
  return eligible.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    gap: leader ? Math.abs(entry.value - leader.value) : null,
    leading: index === 0,
  }));
}

/**
 * Narrative events for the activity feed, newest-interest first.
 * Everything here is derived from current standings — no event log required,
 * which is what makes it droppable into the existing page.
 */
export function hallActivity(rows = [], { limit = 6 } = {}) {
  const events = [];

  for (const award of AWARDS) {
    const ranked = contendersFor(award, rows);
    if (ranked.length >= 2) {
      const [first, second] = ranked;
      events.push({
        id: `${award.key}-race`,
        award,
        kind: "race",
        priority: Math.abs(second.value - first.value),
        text: `${second.model} is closing on ${first.model} for ${award.label}`,
        detail: `${award.metricLabel} gap ${formatGap(award, Math.abs(second.value - first.value))}`,
      });
    }

    // Near-misses: one or two bets away from entering a contest.
    for (const row of rows) {
      const q = qualificationFor(row, award, rows);
      if (q.state === "sample" && q.minSample - q.settled <= 2) {
        events.push({
          id: `${award.key}-${row.model}-near`,
          award,
          kind: "near",
          priority: q.minSample - q.settled,
          text: `${row.model} is ${q.minSample - q.settled} bet${
            q.minSample - q.settled === 1 ? "" : "s"
          } from ${award.label} eligibility`,
          detail: `${q.settled} of ${q.minSample} settled`,
        });
      }
    }
  }

  // Tightest races and closest near-misses first; both sort ascending.
  events.sort((a, b) => a.priority - b.priority);
  return events.slice(0, limit);
}

function formatGap(award, gap) {
  if (!finite(gap)) return "—";
  if (award.metricLabel === "Brier") return gap.toFixed(3);
  if (award.metricLabel === "Sharpe") return gap.toFixed(2);
  return `${(gap * 100).toFixed(1)}pp`;
}
