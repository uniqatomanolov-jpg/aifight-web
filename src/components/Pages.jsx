import { useMemo, useState } from "react";
import { useArena } from "../hooks/useArena";
import { Link, useRouter, normalise } from "./Shell.jsx";
import { fighter, fighterVars, streakOf } from "../lib/fighters.js";
import { HallSection, HallActivity } from "./hall/HallExtras.jsx";
import { AWARDS, contendersFor } from "./hall/awards.js";
import {
  SORT_KEYS,
  sortStandings,
  money,
  signedMoney,
  percent,
  ratio,
  MODELS,
  STARTING_BANKROLL,
} from "../lib/engine";

/* ===========================================================================
   Shared pieces
   =========================================================================== */

export function Skeleton({ className = "" }) {
  return <div className={`fx-skeleton ${className}`} />;
}

export function PageShell({ title, subtitle, children, loading, error }) {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </header>
      {error && (
        <p className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </p>
      )}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        children
      )}
    </main>
  );
}

function Sparkline({ points = [], color = "#94a3b8", width = 96, height = 28 }) {
  if (points.length < 2) return <span className="font-mono text-[10px] text-slate-700">—</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StreakBadge({ bets }) {
  const streak = streakOf([...bets].reverse());
  if (streak.state === "neutral") return null;
  const hot = streak.state === "hot";
  return (
    <span
      title={`${streak.run} in a row, ${streak.sample} settled bets in sample`}
      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
        hot ? "bg-amber-400/15 text-amber-300" : "bg-sky-400/15 text-sky-300"
      }`}
    >
      {hot ? "🔥" : "❄️"} {streak.run} · n={streak.sample}
    </span>
  );
}

/* ===========================================================================
   Standings + Hall of Fame  (/hall)
   =========================================================================== */

export function StandingsPage() {
  const { fighters, loading, error } = useArena();
  const [sortBy, setSortBy] = useState("bankroll");

  const rows = useMemo(() => sortStandings(fighters ?? [], sortBy), [fighters, sortBy]);

  // Which awards actually have a holder, using the same rules the Hall reads.
  const held = useMemo(() => {
    const out = {};
    for (const award of AWARDS) {
      const ranked = contendersFor(award, fighters ?? []);
      // Needs a contest and a clear winner -- ties leave the award vacant.
      if (ranked.length >= 2 && ranked[0].value !== ranked[1].value) {
        out[award.key] = { model: ranked[0].model, value: ranked[0].value };
      }
    }
    return out;
  }, [fighters]);

  return (
    <PageShell
      title="Standings"
      subtitle="Ranked on the metric you choose. Awards need a minimum sample and a genuine contest before they are handed out."
      loading={loading}
      error={error}
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Object.entries(SORT_KEYS).map(([key, def]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSortBy(key)}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition ${
              sortBy === key
                ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                : "border-white/10 text-slate-500 hover:text-slate-300"
            }`}
          >
            {def.label}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {rows.map((row, index) => {
          const meta = fighter(row.model);
          const up = (row.profit ?? 0) >= 0;
          return (
            <Link
              key={row.model}
              to={`/fighter/${row.model.toLowerCase()}`}
              style={fighterVars(row.model)}
              className="fx-card fx-card--muted fx-press flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap"
            >
              <span className="font-mono text-sm tabular-nums text-slate-600">{index + 1}</span>
              <span className="fx-chip h-10 w-10 font-mono text-xs">{meta.code}</span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold text-slate-50">{row.model}</span>
                  <StreakBadge bets={row.bets ?? []} />
                  {row.liquidated && (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-rose-300">
                      Liquidated
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-slate-500">
                  {row.settledCount} settled · {row.pendingCount} open
                </span>
              </span>

              <span className="hidden sm:block">
                <Sparkline points={row.equity ?? []} color={meta.accent} />
              </span>

              <span className="text-right">
                <span className="block font-mono text-lg font-bold tabular-nums text-slate-50">
                  {money(row.bankroll)}
                </span>
                <span
                  className={`block font-mono text-xs tabular-nums ${
                    up ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {signedMoney(row.profit)}
                </span>
              </span>

              <span className="w-full border-t border-white/[0.06] pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-600 sm:w-auto sm:border-0 sm:pt-0">
                <span className="mr-3">yield {percent(row.yield)}</span>
                <span className="mr-3">
                  clv {row.clv?.reliable ? percent(row.clv.average) : "—"}
                </span>
                <span className="mr-3">sharpe {ratio(row.sharpe)}</span>
                <span>brier {row.brier == null ? "—" : row.brier.toFixed(3)}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <HallSection kind="hall" held={held} rows={fighters ?? []} />
      <HallSection kind="shambles" held={held} rows={fighters ?? []} />
      <HallActivity rows={fighters ?? []} />
    </PageShell>
  );
}

/* ===========================================================================
   Head to head  (/head-to-head)
   =========================================================================== */

export function HeadToHeadPage() {
  const { fighters, bets, loading, error } = useArena();
  const [left, setLeft] = useState(MODELS[0]);
  const [right, setRight] = useState(MODELS[1]);

  const a = (fighters ?? []).find((f) => f.model === left);
  const b = (fighters ?? []).find((f) => f.model === right);

  // Fixtures both models took a position on -- the only place they truly met.
  const clashes = useMemo(() => {
    const byEvent = new Map();
    for (const bet of bets ?? []) {
      if (bet.model !== left && bet.model !== right) continue;
      if (!byEvent.has(bet.event_id)) byEvent.set(bet.event_id, {});
      byEvent.get(bet.event_id)[bet.model] = bet;
    }
    return [...byEvent.entries()]
      .filter(([, pair]) => pair[left] && pair[right])
      .map(([eventId, pair]) => ({ eventId, left: pair[left], right: pair[right] }))
      .slice(0, 12);
  }, [bets, left, right]);

  const ROWS = [
    ["Bankroll", (r) => money(r?.bankroll), "high"],
    ["Profit", (r) => signedMoney(r?.profit), "high"],
    ["Yield", (r) => percent(r?.yield), "high"],
    ["CLV", (r) => (r?.clv?.reliable ? percent(r.clv.average) : "—"), "high"],
    ["Sharpe", (r) => ratio(r?.sharpe), "high"],
    ["Brier", (r) => (r?.brier == null ? "—" : r.brier.toFixed(3)), "low"],
    ["Settled", (r) => String(r?.settledCount ?? 0), "high"],
  ];

  return (
    <PageShell
      title="Head to head"
      subtitle="Two fighters, the same board. Only fixtures where both took a position count as a meeting."
      loading={loading}
      error={error}
    >
      <div className="mb-6 grid grid-cols-2 gap-3">
        {[
          [left, setLeft],
          [right, setRight],
        ].map(([value, set], i) => (
          <select
            key={i}
            value={value}
            onChange={(e) => set(e.target.value)}
            className="h-12 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-base font-semibold text-slate-100 outline-none"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
        <div className="grid grid-cols-3 gap-2 border-b border-white/[0.08] bg-white/[0.03] p-4">
          <span style={fighterVars(left)} className="fx-text text-lg font-bold">
            {left}
          </span>
          <span className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
            metric
          </span>
          <span style={fighterVars(right)} className="fx-text text-right text-lg font-bold">
            {right}
          </span>
        </div>

        {ROWS.map(([label, get, better]) => {
          const av = get(a);
          const bv = get(b);
          const numeric = (r) => {
            const raw = String(get(r)).replace(/[^0-9.-]/g, "");
            return raw === "" ? null : Number(raw);
          };
          const an = numeric(a);
          const bn = numeric(b);
          let leader = null;
          if (an != null && bn != null && an !== bn) {
            leader = better === "high" ? (an > bn ? "l" : "r") : an < bn ? "l" : "r";
          }
          return (
            <div key={label} className="grid grid-cols-3 items-center gap-2 border-b border-white/[0.05] p-4 last:border-0">
              <span
                className={`font-mono text-base tabular-nums ${
                  leader === "l" ? "font-bold text-emerald-300" : "text-slate-400"
                }`}
              >
                {av}
              </span>
              <span className="text-center font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600">
                {label}
              </span>
              <span
                className={`text-right font-mono text-base tabular-nums ${
                  leader === "r" ? "font-bold text-emerald-300" : "text-slate-400"
                }`}
              >
                {bv}
              </span>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 mt-8 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
        Shared fixtures ({clashes.length})
      </h2>
      {clashes.length === 0 ? (
        <p className="rounded-xl border border-white/[0.08] p-5 text-sm text-slate-500">
          These two have not taken a position on the same fixture yet.
        </p>
      ) : (
        <div className="space-y-2">
          {clashes.map(({ eventId, left: lb, right: rb }) => (
            <div key={eventId} className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.08] p-4">
              <BetCell bet={lb} model={left} />
              <BetCell bet={rb} model={right} align="right" />
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

function BetCell({ bet, model, align = "left" }) {
  const result = bet.result;
  const colour =
    result === "win" ? "text-emerald-300" : result === "loss" ? "text-rose-300" : "text-slate-400";
  return (
    <div style={fighterVars(model)} className={align === "right" ? "text-right" : ""}>
      <p className="text-sm font-semibold text-slate-200">{bet.pick}</p>
      <p className="font-mono text-xs tabular-nums text-slate-500">
        @ {Number(bet.odds).toFixed(2)} · {money(bet.stake)}
      </p>
      <p className={`font-mono text-[10px] uppercase tracking-[0.16em] ${colour}`}>
        {result ?? "open"}
      </p>
    </div>
  );
}

/* ===========================================================================
   Fighters index  (/fighters)  and profile  (/fighter/:name)
   =========================================================================== */

export function FightersPage() {
  const { fighters, loading, error } = useArena();
  return (
    <PageShell
      title="The fighters"
      subtitle="Five models, €1,000 each, €100 a day. Same board, same prices, different theses."
      loading={loading}
      error={error}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(fighters ?? []).map((row) => {
          const meta = fighter(row.model);
          return (
            <Link
              key={row.model}
              to={`/fighter/${row.model.toLowerCase()}`}
              style={fighterVars(row.model)}
              className="fx-card fx-card--muted fx-press block p-5"
            >
              <div className="flex items-center gap-3">
                <span className="fx-chip h-11 w-11 font-mono text-sm">{meta.code}</span>
                <div>
                  <p className="text-lg font-bold text-slate-50">{row.model}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600">
                    {meta.vendor}
                  </p>
                </div>
                <span className="ml-auto text-right">
                  <span className="block font-mono text-lg font-bold tabular-nums text-slate-50">
                    {money(row.bankroll)}
                  </span>
                  <span
                    className={`block font-mono text-xs tabular-nums ${
                      (row.profit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {signedMoney(row.profit)}
                  </span>
                </span>
              </div>
              <div className="mt-4">
                <Sparkline points={row.equity ?? []} color={meta.accent} width={240} height={40} />
              </div>
              <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-slate-600">
                <span>{row.settledCount} settled</span>
                <StreakBadge bets={row.bets ?? []} />
              </div>
            </Link>
          );
        })}
      </div>
    </PageShell>
  );
}

export function FighterProfilePage() {
  const { path } = useRouter();
  const { fighters, loading, error } = useArena();

  const slug = normalise(path).split("/").pop();
  const model = MODELS.find((m) => m.toLowerCase() === slug);
  const row = (fighters ?? []).find((f) => f.model === model);
  const meta = fighter(model);

  if (!model) {
    return (
      <PageShell title="Unknown fighter" subtitle="That model is not in the challenge.">
        <Link to="/fighters" className="fx-press inline-block rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-300">
          Back to fighters
        </Link>
      </PageShell>
    );
  }

  const recent = (row?.bets ?? []).slice(-15).reverse();

  return (
    <PageShell
      title={model}
      subtitle={`${meta.vendor} · started on ${money(STARTING_BANKROLL)}`}
      loading={loading}
      error={error}
    >
      <div style={fighterVars(model)} className="fx-card fx-glow-sm p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="fx-chip h-14 w-14 font-mono text-base">{meta.code}</span>
          <div>
            <p className="font-mono text-3xl font-bold tabular-nums text-slate-50">
              {money(row?.bankroll ?? STARTING_BANKROLL)}
            </p>
            <p
              className={`font-mono text-sm tabular-nums ${
                (row?.profit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {signedMoney(row?.profit ?? 0)}
            </p>
          </div>
          <div className="ml-auto">
            <Sparkline points={row?.equity ?? []} color={meta.accent} width={200} height={48} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Yield", percent(row?.yield)],
            ["CLV", row?.clv?.reliable ? percent(row.clv.average) : "—"],
            ["Sharpe", ratio(row?.sharpe)],
            ["Brier", row?.brier == null ? "—" : row.brier.toFixed(3)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/[0.07] bg-black/30 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600">
                {label}
              </p>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <h2 className="mb-3 mt-8 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
        Recent positions
      </h2>
      <div className="space-y-2">
        {recent.length === 0 && (
          <p className="rounded-xl border border-white/[0.08] p-5 text-sm text-slate-500">
            No positions logged yet.
          </p>
        )}
        {recent.map((bet) => (
          <article key={bet.id} className="rounded-xl border border-white/[0.08] p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-base font-semibold text-slate-100">{bet.pick}</span>
              <span className="font-mono text-sm font-bold tabular-nums text-slate-400">
                @ {Number(bet.odds).toFixed(2)}
              </span>
              <span className="font-mono text-sm tabular-nums text-slate-500">
                {money(bet.stake)}
              </span>
              <span
                className={`ml-auto rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                  bet.result === "win"
                    ? "bg-emerald-400/15 text-emerald-300"
                    : bet.result === "loss"
                      ? "bg-rose-400/15 text-rose-300"
                      : "bg-white/[0.06] text-slate-400"
                }`}
              >
                {bet.result ?? "open"}
              </span>
            </div>
            {bet.reasoning && (
              <p className="mt-2 border-l-2 border-white/10 pl-3 text-sm leading-relaxed text-slate-400">
                {bet.reasoning}
              </p>
            )}
          </article>
        ))}
      </div>
    </PageShell>
  );
}
