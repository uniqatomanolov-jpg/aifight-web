import { useState } from "react";
import { fighter, fighterVars } from "../../lib/fighters.js";
import { sfx } from "../../lib/sound.js";
import {
  AWARDS,
  HALL_AWARDS,
  SHAMBLES_AWARDS,
  qualificationFor,
  contendersFor,
  hallActivity,
} from "./awards.js";

/* ===========================================================================
   Icons. Inline SVG rather than an icon package: three marks do not justify a
   dependency, and these need to inherit currentColor to pick up award tones.
   =========================================================================== */

export function LaurelIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 4c-2.5 2-3.5 4.5-3.5 7S9.5 16 12 18c2.5-2 3.5-4.5 3.5-7S14.5 6 12 4z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8.5 7C6 7.8 4.5 9.8 4.5 12.5c0 2.4 1.3 4.3 3.4 5.3M15.5 7c2.5.8 4 2.8 4 5.5 0 2.4-1.3 4.3-3.4 5.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M9 20h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function HazardIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.8 21 19.5H3L12 3.8z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="0.95" fill="currentColor" />
    </svg>
  );
}

/* ===========================================================================
   Tone map. Kept as full class strings, never interpolated — Tailwind scans
   source text, so `border-${tone}-400/30` produces no CSS at all.
   =========================================================================== */

const TONES = {
  gold: { ring: "border-amber-400/30", text: "text-amber-300", glow: "rgba(251,191,36,0.28)" },
  emerald: { ring: "border-emerald-400/30", text: "text-emerald-300", glow: "rgba(52,211,153,0.28)" },
  violet: { ring: "border-violet-400/30", text: "text-violet-300", glow: "rgba(167,139,250,0.28)" },
  sky: { ring: "border-sky-400/30", text: "text-sky-300", glow: "rgba(56,189,248,0.28)" },
  rose: { ring: "border-rose-400/30", text: "text-rose-300", glow: "rgba(251,113,133,0.26)" },
  orange: { ring: "border-orange-400/30", text: "text-orange-300", glow: "rgba(251,146,60,0.26)" },
  amber: { ring: "border-amber-400/30", text: "text-amber-300", glow: "rgba(251,191,36,0.26)" },
};
const tone = (key) => TONES[key] ?? TONES.sky;

/* ===========================================================================
   Tooltip. Click, not hover: the rules text is long, and on touch devices a
   hover-only tooltip is unreachable.
   =========================================================================== */

export function InfoTip({ label = "How awards work", children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          sfx.tick();
          setOpen((v) => !v);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/15 font-mono text-[10px] text-slate-400 transition hover:border-white/35 hover:text-slate-200"
      >
        ?
      </button>
      {open && (
        <>
          <span
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <span
            role="tooltip"
            className="absolute left-1/2 top-7 z-20 w-72 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b0c12] p-3.5 text-left text-xs leading-relaxed text-slate-300 shadow-2xl sm:w-80"
          >
            {children}
          </span>
        </>
      )}
    </span>
  );
}

export function AwardRulesTip() {
  return (
    <InfoTip>
      <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
        Qualification rules
      </span>
      An award is only handed out when all three hold:
      <span className="mt-2 block">
        <b className="text-slate-100">1. Sample.</b> The model has at least the award's minimum
        settled bets — 8 for CLV awards, 10 for yield and Sharpe, 12 for calibration.
      </span>
      <span className="mt-1.5 block">
        <b className="text-slate-100">2. Measurable.</b> The metric can be computed. CLV needs
        closing odds on the bets; calibration needs stated confidence.
      </span>
      <span className="mt-1.5 block">
        <b className="text-slate-100">3. Contested.</b> At least two models qualify and their
        scores differ. Best-of-one is not a ranking, so the award stays vacant.
      </span>
      <span className="mt-2 block text-slate-500">
        Thresholds exist so a lucky three-bet run cannot buy a badge.
      </span>
    </InfoTip>
  );
}

/* ===========================================================================
   Sample progress. The bar tracks bets, but the caption reports the BINDING
   constraint -- a model can be at 100% of its sample and still blocked on a
   missing metric or a missing opponent.
   =========================================================================== */

export function QualificationPills({ rows = [], award }) {
  // Compact by design. The old full-width bar per model turned a vacant award
  // into the tallest thing on the page, which inverted the hierarchy: the
  // awards nobody has won were shouting louder than the ones somebody had.
  // Same information, one line each.
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((row) => {
        const q = qualificationFor(row, award, rows);
        const meta = fighter(row.model);
        const blocked = q.state === "metric" || q.state === "contested";
        return (
          <span
            key={row.model}
            title={q.reason}
            style={fighterVars(row.model)}
            className="fx-pill font-mono uppercase text-slate-400"
          >
            <span className="fx-text font-bold">{meta.code}</span>
            {q.state === "eligible" ? (
              <span className="text-emerald-300">in</span>
            ) : blocked ? (
              <span className="text-slate-600" aria-label={q.reason}>
                held
              </span>
            ) : (
              <>
                <span className="fx-pill-track">
                  <span className="fx-pill-fill" style={{ width: `${Math.round(q.progress * 100)}%` }} />
                </span>
                <span className="tabular text-slate-500">
                  {q.settled}/{q.minSample}
                </span>
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ===========================================================================
   Award card. Handles both the won and the vacant state; the vacant one is
   the interesting case and now carries the tone ring, a soft glow and the
   progress list instead of reading as an empty grey box.
   =========================================================================== */

export function AwardCard({ award, winner, rows = [] }) {
  const t = tone(award.tone);
  const held = Boolean(winner);
  const contenders = contendersFor(award, rows);

  return (
    <article
      className={`fx-term relative overflow-hidden p-5 ${held ? t.ring : ""}`}
      style={{ boxShadow: held ? `0 0 42px -18px ${t.glow}` : `0 0 30px -22px ${t.glow}` }}
    >
      {/* Tone wash, strongest at the top edge. Keeps vacant cards from
          disappearing into the background without shouting. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-60"
        style={{ background: `radial-gradient(120% 100% at 50% 0%, ${t.glow}, transparent 70%)` }}
      />

      <header className="relative flex items-start gap-3">
        <span className={`mt-0.5 ${t.text}`}>
          {award.hall ? <LaurelIcon className="h-5 w-5" /> : <HazardIcon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={`text-base font-bold tracking-tight ${t.text}`}>{award.label}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{award.blurb}</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">
          min {award.minSample}
        </span>
      </header>

      {held ? (
        <div className="relative mt-4 flex items-center gap-3" style={fighterVars(winner.model)}>
          <span className="fx-chip h-10 w-10 font-mono text-xs">
            {fighter(winner.model).code}
          </span>
          <div>
            <p className="text-lg font-bold text-slate-50">{winner.model}</p>
            <p className="font-mono text-xs tabular-nums text-slate-500">
              {award.metricLabel} {formatValue(award, winner.value)}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative mt-4">
          <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
            Vacant
          </p>
          <QualificationPills rows={rows} award={award} />
        </div>
      )}

      {held && contenders.length > 1 && (
        <p className="relative mt-3 border-t border-white/[0.06] pt-3 font-mono text-[11px] text-slate-600">
          {contenders[1].model} trails by {formatValue(award, contenders[1].gap, true)}
        </p>
      )}
    </article>
  );
}

function formatValue(award, value, bare = false) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (award.metricLabel === "Brier") return value.toFixed(3);
  if (award.metricLabel === "Sharpe") return value.toFixed(2);
  const pct = `${(value * 100).toFixed(1)}${bare ? "pp" : "%"}`;
  return bare || value < 0 ? pct : `+${pct}`;
}

/* ===========================================================================
   Activity feed. Derived entirely from current standings, so it needs no event
   log and cannot fall out of sync with the awards above it.
   =========================================================================== */

export function HallActivity({ rows = [] }) {
  const events = hallActivity(rows, { limit: 6 });
  if (events.length === 0) return null;

  return (
    <section className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <header className="mb-4 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-400">
          Recent hall activity
        </h3>
      </header>

      <ul className="space-y-2.5">
        {events.map((event) => {
          const t = tone(event.award.tone);
          return (
            <li
              key={event.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-2 pl-3 text-sm"
              style={{ borderColor: t.glow }}
            >
              <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${t.text}`}>
                {event.kind === "race" ? "Race" : "Near miss"}
              </span>
              <span className="text-slate-300">{event.text}</span>
              <span className="font-mono text-[11px] tabular-nums text-slate-600">
                {event.detail}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ===========================================================================
   Section headers, with the icon and the rules tooltip attached.
   =========================================================================== */

export function HallSection({ kind = "hall", awards, held = {}, rows = [] }) {
  const isHall = kind === "hall";
  const list = awards ?? (isHall ? HALL_AWARDS : SHAMBLES_AWARDS);

  return (
    <section className="mt-10">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <span className={isHall ? "text-amber-300" : "text-rose-300"}>
          {isHall ? <LaurelIcon className="h-6 w-6" /> : <HazardIcon className="h-6 w-6" />}
        </span>
        <h2 className="text-xl font-bold tracking-tight text-slate-50">
          {isHall ? "Hall of Fame" : "The Shambles"}
        </h2>
        <AwardRulesTip />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
          {Object.keys(held).length}/{AWARDS.length} awarded
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {list.map((award) => (
          <AwardCard key={award.key} award={award} winner={held[award.key]} rows={rows} />
        ))}
      </div>
    </section>
  );
}
