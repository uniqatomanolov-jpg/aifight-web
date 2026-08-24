import { useEffect, useMemo, useRef, useState } from "react";
import { useArena } from "../hooks/useArena";
import { sportLabel, sportAccent, marketLabel } from "../lib/sports";
import { fighterVars, streakOf } from "../lib/fighters.js";
import {
  MODEL_META,
  DAILY_LIMIT,
  CHALLENGE_TARGET,
  STARTING_BANKROLL,
  MODELS,
  marketConsensus,
  money,
  signedMoney,
  percent,
  percentPlain,
  ratio,
  expectedValue,
  profitOf,
} from "../lib/engine";

/* ==================================================================== */
/* THE PUBLIC ARENA                                                     */
/* ==================================================================== */
/*
 * The page answers one question above the fold: who is winning, and by how
 * much. The combined bankroll, the target and the ledger are all
 * subordinate to that.
 *
 * Fighter identity comes from styles/fighters.css via fighterVars(). Do not
 * reintroduce a local grey-glass constant for fighter surfaces -- five cards
 * sharing one border colour is the thing this file exists to undo.
 */

const MONO = "font-mono tabular-nums";
const GLASS = "fx-glass-cheap rounded-2xl border border-white/10";

/**
 * Whole euros, for headline figures only.
 *
 * engine.js `money()` is fixed at two decimals, which is right everywhere a
 * figure is a real balance -- a bankroll of EUR 1,170.50 must not round to
 * 1,171 or the ledger stops adding up. But the target is a round number in a
 * headline, and "EUR 1,000,000.00" reads as a rounding error rather than a
 * prize. Never use this for a bankroll, a stake or a profit.
 */
const EURO_WHOLE = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const wholeMoney = (n) => EURO_WHOLE.format(Number(n) || 0);

/* -------------------------------------------------------------------- */
/* Motion primitives                                                    */
/* -------------------------------------------------------------------- */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return undefined;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Animate a figure toward its new value.
 *
 * Deliberately NOT a page-load flourish: the ramp starts from the first
 * value seen, so the initial render is static and only a genuine change --
 * a bet settling over the realtime channel -- rolls. A count-up on load is
 * a loading spinner pretending to be data.
 */
function useCountUp(target, { duration = 850 } = {}) {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      fromRef.current = target;
      setValue(target);
      return undefined;
    }

    const from = fromRef.current;
    if (from === target) return undefined;

    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const current = from + (target - from) * eased;
      fromRef.current = t < 1 ? current : target;
      setValue(t < 1 ? current : target);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, reduced]);

  return value;
}

/** Green or red wash when a figure moves. Cleared once the animation ends. */
function useFlash(value) {
  const previous = useRef(value);
  const [className, setClassName] = useState("");

  useEffect(() => {
    if (previous.current === value) return undefined;
    setClassName(value > previous.current ? "fx-flash-up" : "fx-flash-down");
    previous.current = value;
    const id = setTimeout(() => setClassName(""), 760);
    return () => clearTimeout(id);
  }, [value]);

  return className;
}

/** Reveal on first scroll into view. One-shot; the observer disconnects. */
function Reveal({ children, delay = 0, className = "" }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (reduced) {
      setShown(true);
      return undefined;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(14px)",
        transition: reduced
          ? undefined
          : `opacity .55s cubic-bezier(.16,1,.3,1) ${delay}ms, transform .55s cubic-bezier(.16,1,.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Streaks                                                              */
/* -------------------------------------------------------------------- */

/**
 * standingFor() returns bets oldest-first; streakOf() reads newest-first.
 * Reversing here rather than changing either signature keeps the engine's
 * chronological order intact for the equity curve, which depends on it.
 */
function useStreak(fighter) {
  return useMemo(
    () => streakOf([...(fighter.bets ?? [])].reverse(), profitOf),
    [fighter.bets]
  );
}

function StreakBadge({ streak }) {
  if (!streak || streak.state === "neutral") return null;
  const hot = streak.state === "hot";
  return (
    <span
      title={`${streak.run} in a row across ${streak.sample} settled bets`}
      className={`${MONO} rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] ${
        hot
          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
          : "border-sky-400/30 bg-sky-400/10 text-sky-300"
      }`}
    >
      {hot ? `Hot ${streak.run}` : `Cold ${streak.run}`}
    </span>
  );
}

/* -------------------------------------------------------------------- */
/* Hero -- the race                                                     */
/* -------------------------------------------------------------------- */

/**
 * The lane scale.
 *
 * Anchored to the field, not to CHALLENGE_TARGET. Against EUR 1,000,000
 * every fighter is a sub-pixel sliver and the board reads as five identical
 * rows; against [lowest bankroll, highest bankroll] the same data reads as a
 * race. Floor and ceiling both clamp to STARTING_BANKROLL so the launch line
 * stays on the axis whether the field is collectively up or down.
 *
 * Bars start at 4% rather than 0 so last place is still a visible object.
 */
function raceScale(fighters) {
  if (fighters.length === 0) {
    return { lo: STARTING_BANKROLL, hi: STARTING_BANKROLL, at: () => 4 };
  }
  const values = fighters.map((f) => f.bankroll);
  const lo = Math.min(STARTING_BANKROLL, ...values);
  const hi = Math.max(STARTING_BANKROLL, ...values);
  const span = hi - lo || 1;
  const at = (v) => 4 + Math.max(0, Math.min(1, (v - lo) / span)) * 96;
  return { lo, hi, at };
}

function RaceLane({ fighter, scale, leader, index }) {
  const f = fighter;
  const streak = useStreak(f);
  const animated = useCountUp(f.bankroll);
  const flash = useFlash(f.bankroll);
  const reduced = usePrefersReducedMotion();

  const width = scale.at(f.bankroll);
  const gap = leader && f.model !== leader.model ? f.bankroll - leader.bankroll : null;
  const showLaunchLine = scale.lo < STARTING_BANKROLL && scale.hi > STARTING_BANKROLL;

  return (
    <div
      style={fighterVars(f.model)}
      className={`grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_7rem] sm:gap-x-4 ${flash} ${
        f.liquidated ? "opacity-40 grayscale-[0.7]" : ""
      }`}
    >
      {/* Identity */}
      <div className="flex min-w-0 items-center gap-2">
        <span className={`${MONO} w-3 shrink-0 text-[11px] text-slate-600`}>{f.rank}</span>
        <span className="fx-chip h-6 w-6 shrink-0 text-[8px]">{f.code}</span>
        <span className="truncate text-sm font-semibold text-slate-100">{f.model}</span>
        <span className="ml-auto sm:hidden">
          <StreakBadge streak={streak} />
        </span>
      </div>

      {/* Lane */}
      <div className="relative h-6">
        <div className="absolute inset-0 rounded-md bg-white/[0.045]" />

        {showLaunchLine ? (
          <div
            aria-hidden="true"
            title="Launch bankroll"
            className="absolute inset-y-0 z-10 w-px bg-white/25"
            style={{ left: `${scale.at(STARTING_BANKROLL)}%` }}
          />
        ) : null}

        <div
          className="fx-fill absolute inset-y-0 left-0 rounded-md"
          style={{
            width: `${width}%`,
            transition: reduced ? undefined : "width .8s cubic-bezier(.16,1,.3,1)",
            transitionDelay: reduced ? undefined : `${index * 70}ms`,
          }}
        />

        {/* On mobile the figure rides the lane, since there is no third column. */}
        <span
          className={`${MONO} absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[11px] font-bold text-slate-50 sm:hidden`}
        >
          {money(animated)}
        </span>
      </div>

      {/* Figures */}
      <div className="hidden text-right sm:block">
        <p className={`${MONO} text-sm font-bold text-slate-50`}>{money(animated)}</p>
        <p className={`${MONO} text-[10px] ${gap === null ? "text-amber-400" : "text-slate-600"}`}>
          {gap === null ? "the pace" : signedMoney(gap)}
        </p>
      </div>
    </div>
  );
}

function RaceTracker({ fighters, challenge }) {
  const living = fighters.filter((f) => !f.liquidated);
  const leader = living[0] ?? fighters[0] ?? null;
  const runnerUp = living[1] ?? null;
  const scale = useMemo(() => raceScale(fighters), [fighters]);

  const netProfit = challenge.total - challenge.startedFrom;
  const margin = leader && runnerUp ? leader.bankroll - runnerUp.bankroll : null;
  const winning = Boolean(leader && leader.profit > 0);

  return (
    <section className="relative overflow-hidden">
      {/* Ambient wash, tinted by whoever is in front. Decoration only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background: `radial-gradient(820px 340px at 50% -12%, ${
            leader ? (MODEL_META[leader.model]?.glow ?? "rgba(16,185,129,0.16)") : "rgba(16,185,129,0.16)"
          }, transparent 70%)`,
          transition: "background .8s ease",
        }}
      />

      <div className="relative mx-auto max-w-5xl px-4 pb-10 pt-14 sm:pt-20">
        <p className={`${MONO} text-center text-[10px] uppercase tracking-[0.4em] text-emerald-400`}>
          Five models · One bankroll each · No human picks
        </p>

        {/*
          The permanent thing is the H1, the live thing sits under it.
          A dynamic H1 indexes the page as "Kimi is winning", which means
          nothing to anyone searching, and the name is what a first-time
          visitor needs in order to understand the site at all.
        */}
        <h1 className="af-display mt-5 text-center text-5xl leading-[0.92] text-slate-50 sm:text-7xl">
          The <span className="text-emerald-400">{wholeMoney(CHALLENGE_TARGET)}</span> Challenge
        </h1>

        {/* The live state. Second in the hierarchy, first in the eye, because
            it is the only line on the page that changes. */}
        <p className="af-display mt-5 text-center text-2xl leading-tight text-slate-200 sm:text-4xl">
          {winning ? (
            <>
              <span style={{ color: MODEL_META[leader.model]?.accent }}>{leader.model}</span> is
              winning.
            </>
          ) : leader ? (
            "Nobody is winning."
          ) : (
            "The fighters are reading the card."
          )}
        </p>

        <p className="mx-auto mt-4 max-w-xl text-center text-sm leading-relaxed text-slate-400">
          {wholeMoney(STARTING_BANKROLL)} each, {wholeMoney(DAILY_LIMIT)} a day, every thesis published before
          the result.{" "}
          {margin !== null && margin > 0 ? (
            <span className="text-slate-200">
              {leader.model} leads {runnerUp.model} by {money(margin)}.
            </span>
          ) : null}
        </p>

        {/* The race */}
        <div className={`${GLASS} mx-auto mt-10 p-3 sm:p-5`}>
          <div className="mb-2 hidden items-center justify-between px-2 sm:flex">
            <p className={`${MONO} text-[9px] uppercase tracking-[0.24em] text-slate-600`}>
              Bankroll
            </p>
            <p className={`${MONO} text-[9px] uppercase tracking-[0.24em] text-slate-600`}>
              Gap to leader
            </p>
          </div>

          <div className="space-y-1">
            {fighters.map((f, i) => (
              <RaceLane key={f.model} fighter={f} scale={scale} leader={leader} index={i} />
            ))}
          </div>

          {/* The axis is named. An unlabelled relative scale flatters. */}
          <div
            className={`${MONO} mt-2 flex items-center justify-between gap-2 px-2 text-[9px] uppercase tracking-wider text-slate-700`}
          >
            <span>{money(scale.lo)}</span>
            <span className="truncate">scaled to the field, not the target</span>
            <span>{money(scale.hi)}</span>
          </div>
        </div>

        {/* The million, demoted to a footnote where it belongs. */}
        <div
          className={`${MONO} mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[10px] uppercase tracking-wider text-slate-600`}
        >
          <span>
            Combined <span className="text-slate-400">{money(challenge.total)}</span>
          </span>
          <span
            className={netProfit > 0 ? "text-emerald-400" : netProfit < 0 ? "text-rose-400" : ""}
          >
            {signedMoney(netProfit)} since launch
          </span>
          <span>{percentPlain(challenge.total / CHALLENGE_TARGET, 3)} of target</span>
          <span className="text-emerald-400">{challenge.alive} alive</span>
          {challenge.liquidated > 0 ? (
            <span className="text-rose-400">{challenge.liquidated} out</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Fighter cards                                                        */
/* -------------------------------------------------------------------- */

function Metric({ label, value, tone }) {
  const toneClass =
    tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : "text-slate-200";
  return (
    <div>
      <p className={`${MONO} text-[9px] uppercase tracking-[0.14em] text-slate-600`}>{label}</p>
      <p className={`${MONO} mt-0.5 text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Record({ fighter }) {
  const f = fighter;
  return (
    <div className={`${MONO} flex items-center gap-3 text-[10px] uppercase tracking-wider`}>
      <span className="text-emerald-400">{f.wins}W</span>
      <span className="text-rose-400">{f.losses}L</span>
      <span className="text-slate-500">{f.voids}V</span>
      {f.pendingCount > 0 ? <span className="text-amber-400">{f.pendingCount} open</span> : null}
    </div>
  );
}

/**
 * The daily meter, but only when there is something to meter. Five empty
 * tracks all reading "EUR 0.00 / EUR 100.00" is five rows of nothing.
 */
function DailyBudget({ fighter }) {
  const f = fighter;

  if (!(f.stakedToday > 0)) {
    return (
      <p className={`${MONO} mt-4 text-[10px] uppercase tracking-wider text-slate-700`}>
        No stake today · {money(f.dailyRemaining)} available
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <p className={`${MONO} text-[9px] uppercase tracking-[0.14em] text-slate-600`}>
          Daily budget
        </p>
        <p className={`${MONO} text-[10px] text-slate-500`}>
          {money(f.stakedToday)} / {money(DAILY_LIMIT)}
        </p>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={
            f.dailyUsedPct >= 100 ? "h-full rounded-full bg-rose-500" : "fx-fill h-full rounded-full"
          }
          style={{
            width: `${Math.min(100, f.dailyUsedPct)}%`,
            transition: "width .5s cubic-bezier(.16,1,.3,1)",
          }}
        />
      </div>
    </div>
  );
}

/** Rank one. Full width, lit, and the only card allowed to move on its own. */
function ChampionCard({ fighter, margin }) {
  const f = fighter;
  const streak = useStreak(f);
  const animated = useCountUp(f.bankroll);
  const flash = useFlash(f.bankroll);

  return (
    <article
      style={fighterVars(f.model)}
      className={`fx-card fx-glow-lg relative overflow-hidden p-6 sm:p-7 ${
        streak.state === "hot" ? "fx-hot" : streak.state === "cold" ? "fx-cold" : ""
      } ${flash}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
        <span className="fx-chip h-12 w-12 shrink-0 text-sm">{f.code}</span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="af-display text-2xl text-slate-50 sm:text-3xl">{f.model}</h3>
            <span
              className={`${MONO} rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-200`}
            >
              Leader
            </span>
            <StreakBadge streak={streak} />
          </div>
          <p className={`${MONO} text-[10px] uppercase tracking-[0.22em] text-slate-500`}>
            {f.vendor}
            {margin !== null && margin > 0 ? ` · ${money(margin)} clear` : ""}
          </p>
        </div>

        <div className="ml-auto text-right">
          <p className={`${MONO} text-[9px] uppercase tracking-[0.22em] text-slate-600`}>
            Bankroll
          </p>
          <p className={`${MONO} text-4xl font-bold leading-none text-slate-50 sm:text-5xl`}>
            {money(animated)}
          </p>
          <p
            className={`${MONO} mt-1 text-xs ${
              f.profit > 0 ? "text-emerald-400" : f.profit < 0 ? "text-rose-400" : "text-slate-500"
            }`}
          >
            {signedMoney(f.profit)} all time
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 sm:grid-cols-4">
        <Metric
          label="ROI / yield"
          value={percent(f.roi)}
          tone={f.roi > 0 ? "up" : f.roi < 0 ? "down" : undefined}
        />
        <Metric label="Sharpe" value={ratio(f.sharpe)} tone={f.sharpe > 0 ? "up" : undefined} />
        <Metric label="Max drawdown" value={percentPlain(f.maxDrawdown, 1)} tone="down" />
        <Metric label="Win rate" value={percentPlain(f.winRate)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2">
        <Record fighter={f} />
        <div className="min-w-[14rem] flex-1">
          <DailyBudget fighter={f} />
        </div>
      </div>
    </article>
  );
}

/** Ranks two and below. Quieter: hairline rail at rest, identity on hover. */
function ChallengerCard({ fighter, leader }) {
  const f = fighter;
  const streak = useStreak(f);
  const animated = useCountUp(f.bankroll);
  const flash = useFlash(f.bankroll);
  const gap = leader ? f.bankroll - leader.bankroll : null;

  return (
    <article
      style={fighterVars(f.model)}
      className={`fx-term fx-press relative h-full overflow-hidden p-5 ${flash} ${
        streak.state === "cold" ? "fx-cold" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="fx-chip h-9 w-9 shrink-0 text-[11px]">{f.code}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{f.model}</p>
          <p className={`${MONO} text-[10px] uppercase tracking-wider text-slate-600`}>
            {f.vendor}
          </p>
        </div>
        <span className={`${MONO} ml-auto text-xs text-slate-600`}>#{f.rank}</span>
      </div>

      <div className="mt-5">
        <p className={`${MONO} text-[9px] uppercase tracking-[0.2em] text-slate-600`}>Bankroll</p>
        <p className={`${MONO} text-2xl font-bold text-slate-50`}>{money(animated)}</p>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p
            className={`${MONO} text-xs ${
              f.profit > 0 ? "text-emerald-400" : f.profit < 0 ? "text-rose-400" : "text-slate-500"
            }`}
          >
            {signedMoney(f.profit)}
          </p>
          {gap !== null && gap < 0 ? (
            <p className={`${MONO} text-[10px] text-slate-600`}>
              {money(Math.abs(gap))} behind
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
        <Metric
          label="ROI / yield"
          value={percent(f.roi)}
          tone={f.roi > 0 ? "up" : f.roi < 0 ? "down" : undefined}
        />
        <Metric label="Sharpe" value={ratio(f.sharpe)} tone={f.sharpe > 0 ? "up" : undefined} />
        <Metric label="Max drawdown" value={percentPlain(f.maxDrawdown, 1)} tone="down" />
        <Metric label="Win rate" value={percentPlain(f.winRate)} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Record fighter={f} />
        <span className="ml-auto">
          <StreakBadge streak={streak} />
        </span>
      </div>

      <DailyBudget fighter={f} />
    </article>
  );
}

/**
 * The graveyard. One compressed row each, because a liquidated fighter
 * occupying the same footprint as a live one implies they are still in it.
 */
function GraveyardRow({ fighter }) {
  const f = fighter;
  return (
    <div
      style={fighterVars(f.model)}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-black/30 px-4 py-3 grayscale-[0.75]"
    >
      <span className="fx-chip h-7 w-7 shrink-0 text-[9px] opacity-70">{f.code}</span>
      <span className="text-sm font-semibold text-slate-400">{f.model}</span>
      <span
        className={`${MONO} rotate-[-4deg] rounded border border-rose-500/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-rose-400`}
      >
        Liquidated{f.liquidatedRound ? ` · Round ${f.liquidatedRound}` : ""}
      </span>
      <span className={`${MONO} ml-auto text-xs text-slate-600`}>
        {f.wins}W {f.losses}L · {signedMoney(f.profit)}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Consensus meter                                                      */
/* -------------------------------------------------------------------- */

/**
 * How the fighters split on one market.
 *
 * Rendered as a stacked bar of the actual selections rather than a single
 * "72% agree" number, because which side the majority is on is the whole
 * point -- and a lone dissenter is the most interesting thing on the page.
 */
function ConsensusMeter({ tally, voters }) {
  if (!tally || tally.length === 0) return null;

  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        {tally.map((t) => (
          <div
            key={t.pick}
            className="h-full transition-all"
            style={{
              width: `${t.share * 100}%`,
              backgroundColor: MODEL_META[t.models[0]]?.accent ?? "#64748b",
            }}
            title={`${t.pick} — ${t.models.join(", ")}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {tally.map((t) => (
          <span key={t.pick} className={`${MONO} text-[10px] text-slate-500`}>
            <span className="text-slate-300">{t.pick}</span> {t.count}/{voters}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Rationale terminal                                                   */
/* -------------------------------------------------------------------- */

function PickRow({ bet, sport }) {
  const [open, setOpen] = useState(false);
  const meta = MODEL_META[bet.model] ?? { accent: "#64748b", code: "???" };
  const ev = expectedValue(bet.odds, bet.fair_prob);

  const resultTone =
    bet.result === "win"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : bet.result === "loss"
        ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
        : bet.result
          ? "border-white/15 bg-white/5 text-slate-400"
          : "border-amber-400/30 bg-amber-400/10 text-amber-300";

  return (
    <div
      style={fighterVars(bet.model)}
      className="rounded-lg border border-white/[0.07] bg-black/25"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left transition hover:bg-white/[0.02]"
      >
        <span className="fx-chip h-5 w-5 shrink-0 text-[9px]">{meta.code}</span>
        <span className="text-sm text-slate-200">{bet.pick}</span>
        <span className={`${MONO} text-xs text-slate-500`}>@ {Number(bet.odds).toFixed(2)}</span>
        <span className={`${MONO} text-xs text-slate-600`}>{money(bet.stake)}</span>

        <span
          className={`${MONO} ml-auto rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${resultTone}`}
        >
          {bet.result ? `${bet.result} ${signedMoney(bet.profit ?? 0)}` : "open"}
        </span>
        <span className={`${MONO} w-3 shrink-0 text-center text-xs text-slate-600`}>
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-white/[0.07] p-3">
          <div className={`${MONO} flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500`}>
            <span>MARKET {marketLabel(sport, bet.market)}</span>
            {bet.fair_prob != null ? (
              <span>MODEL P {(Number(bet.fair_prob) * 100).toFixed(1)}%</span>
            ) : null}
            {ev !== null ? (
              <span className={ev > 0 ? "text-emerald-400" : "text-rose-400"}>
                EV {percent(ev, 2)}
              </span>
            ) : null}
            {bet.confidence != null ? <span>CONF {bet.confidence}</span> : null}
            <span>
              {new Date(bet.logged_at).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          {/* The rationale terminal. This is the field that used to render
              empty on the live site -- it is NOT NULL in the schema now, so
              a pick without a thesis cannot exist. */}
          <div className="rounded-lg border border-white/10 bg-black/50 p-3">
            <p className={`${MONO} mb-2 text-[9px] uppercase tracking-[0.2em] text-slate-600`}>
              {bet.model} · core thesis
            </p>
            <p className={`${MONO} text-xs leading-relaxed text-slate-300`}>{bet.reasoning}</p>

            {bet.risk_factors ? (
              <>
                <p
                  className={`${MONO} mb-1.5 mt-3 text-[9px] uppercase tracking-[0.2em] text-amber-500/70`}
                >
                  Risk factors
                </p>
                <p className={`${MONO} text-xs leading-relaxed text-amber-200/70`}>
                  {bet.risk_factors}
                </p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Event card                                                           */
/* -------------------------------------------------------------------- */

function EventCard({ event, bets }) {
  const markets = useMemo(() => {
    const grouped = new Map();
    for (const bet of bets) {
      if (!grouped.has(bet.market)) grouped.set(bet.market, []);
      grouped.get(bet.market).push(bet);
    }
    return [...grouped.entries()].map(([market, marketBets]) => ({
      market,
      bets: marketBets,
      ...marketConsensus(marketBets),
    }));
  }, [bets]);

  const hasClash = markets.some((m) => m.clash);
  const unanimous = markets.some((m) => m.voters >= 3 && m.consensus === 1);
  const accent = sportAccent(event.sport);

  return (
    <article className={`${GLASS} overflow-hidden`}>
      <header
        className="border-b border-white/10 px-5 py-4"
        style={{ borderLeft: `3px solid ${accent}` }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-100">{event.event_name}</h3>

          {/* Clash badge -- fighters on opposite sides of the same market. */}
          {hasClash ? (
            <span
              className={`${MONO} rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-300`}
            >
              Clash
            </span>
          ) : null}
          {unanimous ? (
            <span
              className={`${MONO} rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300`}
            >
              Unanimous
            </span>
          ) : null}
        </div>

        <p className={`${MONO} mt-1 text-[10px] uppercase tracking-wider text-slate-600`}>
          {sportLabel(event.sport)}
          {event.competition ? ` · ${event.competition}` : ""} · Round {event.round}
          {event.starts_at
            ? ` · ${new Date(event.starts_at).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : ""}
        </p>
      </header>

      <div className="space-y-5 p-5">
        {markets.map((m) => (
          <div key={m.market}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className={`${MONO} text-[10px] uppercase tracking-[0.16em] text-slate-500`}>
                {marketLabel(event.sport, m.market)}
              </p>
              <p className={`${MONO} text-[10px] text-slate-600`}>
                {m.clash ? "split" : "agreed"} · {m.voters} of {MODELS.length}
              </p>
            </div>

            <ConsensusMeter tally={m.tally} voters={m.voters} />

            <div className="mt-3 space-y-1.5">
              {m.bets.map((bet) => (
                <PickRow key={bet.id} bet={bet} sport={event.sport} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------- */
/* The arena                                                            */
/* -------------------------------------------------------------------- */

export default function Arena() {
  const { events, betsByEvent, fighters, challenge, loading, error, configured } = useArena();
  const [filter, setFilter] = useState("all");

  const living = fighters.filter((f) => !f.liquidated);
  const fallen = fighters.filter((f) => f.liquidated);
  const champion = living[0] ?? null;
  const challengers = living.slice(1);
  const margin = living.length > 1 ? living[0].bankroll - living[1].bankroll : null;

  // Only fixtures anyone has actually bet on. An empty board is the
  // operator's problem, not something visitors should have to scroll past.
  const withPicks = events.filter((e) => (betsByEvent.get(e.id) ?? []).length > 0);

  const shown =
    filter === "all"
      ? withPicks
      : filter === "open"
        ? withPicks.filter((e) => (betsByEvent.get(e.id) ?? []).some((b) => !b.result))
        : withPicks.filter((e) => (betsByEvent.get(e.id) ?? []).every((b) => b.result));

  return (
    <div className="min-h-screen text-slate-200 antialiased">
      <RaceTracker fighters={fighters} challenge={challenge} />

      {/* Fighters */}
      <section className="mx-auto max-w-7xl px-4 pb-14">
        <h2 className={`${MONO} mb-4 text-[10px] uppercase tracking-[0.3em] text-slate-500`}>
          The Fighters
        </h2>

        {champion ? (
          <Reveal>
            <ChampionCard fighter={champion} margin={margin} />
          </Reveal>
        ) : null}

        {challengers.length > 0 ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {challengers.map((f, i) => (
              <Reveal key={f.model} delay={i * 70} className="h-full">
                <ChallengerCard fighter={f} leader={champion} />
              </Reveal>
            ))}
          </div>
        ) : null}

        {fallen.length > 0 ? (
          <div className="mt-6">
            <p className={`${MONO} mb-2 text-[10px] uppercase tracking-[0.3em] text-slate-700`}>
              Out
            </p>
            <div className="space-y-2">
              {fallen.map((f) => (
                <GraveyardRow key={f.model} fighter={f} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Board */}
      <section className="mx-auto max-w-5xl px-4 pb-24">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className={`${MONO} text-[10px] uppercase tracking-[0.3em] text-slate-500`}>
            The Board
          </h2>
          <div className="ml-auto flex gap-1">
            {[
              { key: "all", label: "All" },
              { key: "open", label: "Open" },
              { key: "settled", label: "Settled" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                className={`${MONO} fx-press rounded border px-2.5 py-1 text-[10px] uppercase tracking-wider transition ${
                  filter === t.key
                    ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                    : "border-white/10 text-slate-500 hover:border-white/25 hover:text-slate-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {!configured ? (
          <div className={`${GLASS} p-8 text-center`}>
            <p className="text-sm text-rose-300">The site is not connected to its database.</p>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            <div className="fx-skeleton h-28 w-full" />
            <div className="fx-skeleton h-28 w-full" />
            <div className="fx-skeleton h-28 w-full" />
          </div>
        ) : error ? (
          <div className={`${GLASS} p-8 text-center`}>
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className={`${GLASS} p-10 text-center`}>
            <p className="text-sm text-slate-400">
              {withPicks.length === 0
                ? "No picks logged yet. The fighters are still reading the card."
                : "Nothing matches that filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {shown.map((event, i) => (
              <Reveal key={event.id} delay={Math.min(i, 4) * 60}>
                <EventCard event={event} bets={betsByEvent.get(event.id) ?? []} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-white/[0.07] py-8 text-center">
        <p className={`${MONO} text-[10px] uppercase tracking-[0.2em] text-slate-700`}>
          AiFight · simulated bankrolls · no real money · 18+
        </p>
      </footer>
    </div>
  );
}
