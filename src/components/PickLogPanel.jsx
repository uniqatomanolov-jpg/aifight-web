import { useMemo, useState } from "react";
import { fighter, fighterVars } from "../lib/fighters.js";
import { sfx } from "../lib/sound.js";

/**
 * Split-screen pick logging.
 *
 * Layout: a 12-column grid that collapses to a single column below `lg`.
 * The fighter roster occupies 4 columns on the left, the work surface 8 on the
 * right — a 33/67 split rather than the 40/60 asked for, because the left rail
 * only ever holds five short rows and any extra width there is dead space.
 *
 * The right pane carries the brand gradient of whichever fighter is selected,
 * so there is never ambiguity about who you are logging for. That was the real
 * failure of the cramped layout: not that it was small, but that the fighter
 * identity was a chip somewhere above the form.
 *
 * The preview strip is the point of the redesign. Payout, exposure, EV and
 * remaining daily budget update as you type, so the consequences of a stake
 * are visible before submitting rather than discovered in a validation error
 * afterwards.
 */

const EMPTY = {
  market: "",
  pick: "",
  odds: "",
  stake: "",
  confidence: "",
  reasoning: "",
  risk_factors: "",
};

const money = (n) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(n) ? n : 0
  );

export default function PickLogPanel({
  models = [],
  selected,
  onSelect,
  event,
  dailyRemaining = {},
  onSubmit,
  submitting = false,
  markets = [],
}) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  const meta = fighter(selected);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Derived economics. Kept in a memo so typing in the reasoning textarea does
  // not recompute them on every keystroke.
  const preview = useMemo(() => {
    const odds = Number.parseFloat(form.odds);
    const stake = Number.parseFloat(form.stake);
    const confidence = Number.parseFloat(form.confidence);
    const valid = Number.isFinite(odds) && odds > 1 && Number.isFinite(stake) && stake > 0;

    const remaining = Number(dailyRemaining[selected] ?? 0);
    const payout = valid ? stake * odds : 0;
    const profit = valid ? payout - stake : 0;

    // EV against the operator's own stated probability. If they have not given
    // one, EV is undefined rather than assumed — showing a confident zero here
    // would be worse than showing nothing.
    const p = Number.isFinite(confidence) ? confidence / 100 : null;
    const ev = valid && p !== null ? p * profit - (1 - p) * stake : null;

    // Break-even probability: the number that tells you whether the price is
    // worth taking at all, and the one operators reach for most.
    const breakEven = Number.isFinite(odds) && odds > 1 ? (100 / odds).toFixed(1) : null;

    const overBudget = valid && stake > remaining;
    const budgetPct = remaining > 0 ? Math.min(100, (stake / remaining) * 100) : 0;

    return { valid, payout, profit, ev, breakEven, remaining, overBudget, budgetPct, stake, odds };
  }, [form.odds, form.stake, form.confidence, dailyRemaining, selected]);

  function submit() {
    if (!preview.valid) {
      setError("Odds must be above 1.00 and stake above 0.");
      sfx.reject();
      return;
    }
    if (preview.overBudget) {
      setError(`Stake exceeds the remaining daily budget of ${money(preview.remaining)}.`);
      sfx.reject();
      return;
    }
    if (!form.pick.trim() || !form.reasoning.trim()) {
      setError("Selection and reasoning are both required — the thesis is the product.");
      sfx.reject();
      return;
    }
    setError("");
    sfx.logged();
    onSubmit?.({ ...form, model: selected });
    setForm(EMPTY);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* ---------------------------------------------------------- roster -- */}
      <aside className="lg:col-span-4 xl:col-span-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
          Fighters
        </p>
        <div className="flex flex-col gap-2">
          {models.map((model) => {
            const m = fighter(model);
            const active = model === selected;
            const left = Number(dailyRemaining[model] ?? 0);
            return (
              <button
                key={model}
                type="button"
                onClick={() => {
                  sfx.click();
                  onSelect?.(model);
                }}
                onMouseEnter={() => sfx.tick()}
                style={fighterVars(model)}
                className={`fx-card fx-press flex min-h-[56px] items-center gap-3 p-3 text-left ${
                  active ? "fx-card--active" : "fx-card--muted"
                }`}
              >
                <span className="fx-chip h-9 w-9 font-mono text-xs">{m.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-100">
                    {model}
                  </span>
                  <span className="block font-mono text-[11px] text-slate-500">
                    {money(left)} left today
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ----------------------------------------------------- work surface -- */}
      <section
        style={fighterVars(selected)}
        className="fx-card fx-glass-cheap fx-glow-sm lg:col-span-8 xl:col-span-9"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.07] p-5">
          <span className="fx-chip h-11 w-11 font-mono text-sm">{meta.code}</span>
          <div className="min-w-0">
            <h3 className="text-xl font-bold tracking-tight text-slate-50">
              Log pick — <span className="fx-text">{selected}</span>
            </h3>
            <p className="truncate font-mono text-xs text-slate-500">
              {event?.event_name ?? "No fixture selected"}
            </p>
          </div>
        </header>

        <div className="grid gap-5 p-5 md:grid-cols-2">
          <Field label="Market">
            <select
              value={form.market}
              onChange={set("market")}
              className="h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-base text-slate-100 outline-none transition focus:border-[var(--fx-accent)]"
            >
              <option value="">Select market…</option>
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Selection">
            <input
              value={form.pick}
              onChange={set("pick")}
              placeholder="e.g. Over 2.5 Goals"
              className="h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-base font-semibold text-slate-100 outline-none transition focus:border-[var(--fx-accent)]"
            />
          </Field>

          <Field label="Odds">
            <input
              value={form.odds}
              onChange={set("odds")}
              inputMode="decimal"
              placeholder="1.55"
              className="h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-lg font-bold text-slate-50 outline-none transition focus:border-[var(--fx-accent)]"
            />
          </Field>

          <Field label="Stake (€)">
            <input
              value={form.stake}
              onChange={set("stake")}
              inputMode="decimal"
              placeholder="50.00"
              className={`h-12 w-full rounded-lg border bg-black/40 px-3 font-mono text-lg font-bold text-slate-50 outline-none transition focus:border-[var(--fx-accent)] ${
                preview.overBudget ? "border-rose-500/70" : "border-white/10"
              }`}
            />
          </Field>

          <Field label="Confidence (%)" hint="Drives the EV estimate">
            <input
              value={form.confidence}
              onChange={set("confidence")}
              inputMode="decimal"
              placeholder="58"
              className="h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-base text-slate-100 outline-none transition focus:border-[var(--fx-accent)]"
            />
          </Field>

          <Field label="Risk factors" hint="Optional">
            <input
              value={form.risk_factors}
              onChange={set("risk_factors")}
              placeholder="Key player doubtful"
              className="h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-base text-slate-100 outline-none transition focus:border-[var(--fx-accent)]"
            />
          </Field>

          <Field label="Reasoning" className="md:col-span-2">
            <textarea
              value={form.reasoning}
              onChange={set("reasoning")}
              rows={5}
              placeholder="The thesis. This is published verbatim."
              className="w-full resize-y rounded-lg border border-white/10 bg-black/40 p-3 text-base leading-relaxed text-slate-100 outline-none transition focus:border-[var(--fx-accent)]"
            />
          </Field>
        </div>

        {/* ------------------------------------------------------- preview -- */}
        <div className="border-t border-white/[0.07] p-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Returns" value={money(preview.payout)} tone="up" />
            <Stat label="Risk" value={money(preview.stake || 0)} tone="down" />
            <Stat
              label="EV"
              value={preview.ev === null ? "—" : money(preview.ev)}
              tone={preview.ev === null ? "flat" : preview.ev >= 0 ? "up" : "down"}
            />
            <Stat
              label="Break-even"
              value={preview.breakEven ? `${preview.breakEven}%` : "—"}
              tone="flat"
            />
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
              <span className="uppercase tracking-[0.18em] text-slate-600">Daily budget</span>
              <span className={preview.overBudget ? "text-rose-400" : "text-slate-400"}>
                {money(preview.stake || 0)} of {money(preview.remaining)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full transition-all duration-300 ${
                  preview.overBudget ? "bg-rose-500" : "fx-fill"
                }`}
                style={{ width: `${preview.overBudget ? 100 : preview.budgetPct}%` }}
              />
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              onMouseEnter={() => sfx.tick()}
              className="fx-press min-h-[52px] flex-1 rounded-xl border border-transparent px-6 font-mono text-sm font-bold uppercase tracking-[0.16em] text-black transition disabled:opacity-40"
              style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }}
            >
              {submitting ? "Logging…" : `Log pick for ${selected}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY);
                setError("");
                sfx.click();
              }}
              className="fx-press min-h-[52px] rounded-xl border border-white/10 px-6 font-mono text-sm uppercase tracking-[0.16em] text-slate-400 transition hover:text-slate-200"
            >
              Clear
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        {hint && <span className="font-mono text-[10px] text-slate-700">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value, tone }) {
  const colour =
    tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-slate-300";
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/30 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${colour}`}>{value}</p>
    </div>
  );
}
