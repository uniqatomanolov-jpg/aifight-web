import { useMemo, useState } from "react";
import { marketLabel } from "../lib/sports.js";
import { buildPickPrompt, marketsFromEvent, parsePickReply } from "../lib/pickPrompt.js";

/**
 * The round trip to a model, as one panel.
 *
 * Copy a prompt built from this event's own priced matrix, paste the reply
 * back, and the parsed pick fills the row below. The operator still presses
 * Log; nothing here writes to the database.
 *
 * WHAT THIS PANEL DELIBERATELY WILL NOT DO
 * ----------------------------------------
 * It never fills `stake`, and it never overwrites `odds` with anything the
 * model said. Stake is bounded by a daily ceiling the model cannot see, and
 * the price is whatever the book is actually offering -- both are the
 * operator's call. A model that returns "odds": 9.99 gets that value dropped
 * by the parser, not written to the form. See src/lib/pickPrompt.js.
 */

const BTN =
  "rounded border border-white/12 px-2.5 py-1.5 font-mono text-[11px] uppercase " +
  "tracking-[0.12em] text-slate-400 transition hover:border-white/30 hover:text-slate-100 " +
  "disabled:opacity-40 disabled:hover:border-white/12";

export default function PickPromptPanel({ model, event, standing, disabled, onApply }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [parsed, setParsed] = useState([]);
  const [copied, setCopied] = useState(false);

  const markets = useMemo(() => marketsFromEvent(event, marketLabel), [event]);

  const prompt = useMemo(
    () =>
      buildPickPrompt(event, markets, {
        model,
        bankroll: standing?.bankroll ?? null,
        dailyRemaining: standing?.dailyRemaining ?? null,
      }),
    [event, markets, model, standing?.bankroll, standing?.dailyRemaining]
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked on insecure origins and in some in-app browsers.
      // Falling back to a selectable textarea beats a button that does nothing.
      setOpen(true);
      setWarnings(["Clipboard blocked. Select the prompt below and copy manually."]);
    }
  }

  function read() {
    const result = parsePickReply(reply, { markets });
    setParsed(result.rows);
    setWarnings(result.warnings);
    if (result.rows.length === 1) {
      onApply(result.rows[0]);
      setWarnings((w) => ["Row filled. Set the stake, then Log.", ...w]);
    }
  }

  if (markets.length === 0) {
    return (
      <p className="rounded border border-white/[0.07] px-2.5 py-2 font-mono text-[11px] text-slate-600">
        Price at least one market to generate a prompt.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/25">
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <button type="button" className={BTN} onClick={copy} disabled={disabled}>
          {copied ? "Copied" : "Copy prompt"}
        </button>
        <button type="button" className={BTN} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Paste reply"}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">
          {markets.length} market{markets.length === 1 ? "" : "s"} priced
        </span>
      </div>

      {open ? (
        <div className="space-y-2 border-t border-white/[0.07] p-2.5">
          <textarea
            className="min-h-[84px] w-full rounded-lg border border-white/10 bg-[#0a0a10] px-3 py-2 font-mono text-[13px] text-slate-100 outline-none transition focus:border-emerald-400/60"
            placeholder={`Paste ${model}'s reply here (JSONL, or NONE)`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} onClick={read} disabled={!reply.trim()}>
              Read reply
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => {
                setReply("");
                setParsed([]);
                setWarnings([]);
              }}
            >
              Clear
            </button>
          </div>

          {/* More than one pick came back: the operator chooses, because a row
              holds exactly one bet and silently taking the first would discard
              the rest without saying so. */}
          {parsed.length > 1 ? (
            <div className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                {parsed.length} picks returned &mdash; choose one
              </p>
              {parsed.map((r, i) => (
                <button
                  key={`${r.market}-${r.pick}-${i}`}
                  type="button"
                  onClick={() => onApply(r)}
                  className="flex w-full items-center gap-2 rounded border border-white/10 px-2.5 py-1.5 text-left text-[13px] text-slate-200 transition hover:border-emerald-400/40"
                >
                  <span>{r.pick}</span>
                  <span className="font-mono text-[11px] text-slate-500">@ {r.odds}</span>
                  {r.fair_prob !== "" ? (
                    <span className="ml-auto font-mono text-[11px] text-slate-500">
                      p {r.fair_prob}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="font-mono text-[11px] leading-relaxed text-amber-300/80">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}

          <details>
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">
              Show prompt
            </summary>
            <textarea
              readOnly
              onFocus={(e) => e.target.select()}
              value={prompt}
              className="mt-1.5 min-h-[160px] w-full rounded-lg border border-white/10 bg-[#0a0a10] px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400 outline-none"
            />
          </details>
        </div>
      ) : null}
    </div>
  );
}
