/**
 * Pick prompts: card out, picks back.
 *
 * The operator's slowest step is not typing odds, it is the round trip to five
 * chat windows and back. This module does both ends of that trip:
 *
 *   buildPickPrompt(event, markets)  -> text to paste into a model
 *   parsePickReply(text, event)      -> rows to merge into the admin form
 *
 * Both are pure. No React, no Supabase, no network, so they are testable with
 * `node --test` alongside engine.js.
 *
 * ON TRUSTING THE REPLY
 * ---------------------
 * A model's reply is untrusted input. It is a text file that arrived from
 * outside the system, and it may be malformed, truncated, wrapped in prose,
 * fenced in markdown, or simply wrong. Every field it returns is therefore
 * either coerced to a known-safe type, clamped to a legal range, or rejected.
 *
 * The model decides WHAT to back and HOW MUCH to commit. Both are judgements,
 * and on a site whose premise is "no human picks" both have to be its own.
 * `stake` is therefore taken from the reply -- clamped to uncommitted funds,
 * because a fighter cannot stake money it does not have.
 *
 * `odds` is NOT taken from the reply, and this is not the same kind of field.
 * A price is not a judgement, it is a fact about what the book is offering.
 * A model asserting 2.60 when Betano shows 2.47 is not betting bravely, it is
 * mis-transcribing, and every EV, CLV and profit figure downstream would
 * inherit the error. Prices come off the screen; the model reasons against
 * them.
 */

import {
  MODELS,
  CHALLENGE_TARGET,
  STARTING_BANKROLL,
  elapsedLabel,
  round2,
  normaliseProbability,
} from "./engine.js";

/* -------------------------------------------------------------------- */
/* Prompt construction                                                  */
/* -------------------------------------------------------------------- */

/**
 * @typedef {Object} PromptMarket
 * @property {string} market      market key, e.g. "1x2", "totals", "btts"
 * @property {string} label       human label shown to the model
 * @property {string} [line]      the handicap or goal line, if the market has one
 * @property {Array<{pick: string, odds: number}>} selections
 */

const RULES = [
  "Analyse the fixture yourself. Nobody will fill these fields in for you.",
  "Return ONE line per selection you want, and nothing else. No preamble, no summary.",
  "Use the exact JSON schema below. One JSON object per line (JSONL), not an array.",
  "Every field is required. Do not leave a field blank, null, or set to a placeholder.",
  "`pick` must be copied verbatim from the SELECTIONS list. Do not invent a selection.",
  "`prob` is YOUR fair probability for that selection as a decimal between 0 and 1.",
  "`stake` is how much you commit in EUR. You choose the number. Whole euros.",
  "There is no daily cap. Your only hard limit is AVAILABLE TO STAKE above.",
  "Size the stake to your edge and your bankroll. Hit zero and you are eliminated.",
  "If you return several picks, their stakes must sum to no more than AVAILABLE TO STAKE.",
  "Only include a selection if your `prob` implies value against the price shown.",
  "`reasoning` must state the assumption most likely to be wrong. One or two sentences.",
  "`risk` names the single thing most likely to beat this bet.",
  "You may return zero picks. Reply with the single word NONE if nothing is worth a stake.",
];

const SCHEMA = `{"market":"<market key>","pick":"<verbatim selection>","prob":0.00,"stake":0,"confidence":0,"reasoning":"...","risk":"..."}`;

/**
 * Build the text to paste into a model.
 *
 * The prices are shown so the model can judge value, but the schema has no
 * `odds` field, so there is nothing for it to return that could overwrite the
 * operator's transcription of the board.
 */
export function buildPickPrompt(event, markets = [], options = {}) {
  const {
    model = null,
    bankroll = null,
    dailyRemaining = null,
    standings: table = null,
  } = options;

  const lines = [];

  const target = `EUR ${Number(CHALLENGE_TARGET).toLocaleString("en-GB")}`;
  const seed = `EUR ${Number(STARTING_BANKROLL).toLocaleString("en-GB")}`;

  lines.push(`THE ${target} CHALLENGE`);
  lines.push(
    `Claude, Grok, ChatGPT, Kimi and Gemini each opened with ${seed} and stake freely --`
  );
  lines.push(
    "there is no cap on a bet. The field is now at " + elapsedLabel(options.now) + "."
  );
  lines.push(
    "Every pick is published with its reasoning BEFORE the result is known, and the"
  );
  lines.push(
    "standings are public. No human chooses anything. Reach zero and you are eliminated."
  );
  lines.push("");

  if (model) lines.push(`YOU ARE: ${model}`);
  if (bankroll != null) lines.push(`YOUR BANKROLL: EUR ${Number(bankroll).toFixed(2)}`);
  if (dailyRemaining != null) {
    // Named for what it is rather than for a cap that no longer exists: the
    // figure is uncommitted funds, so a model reading "remaining today" would
    // size its stake against a ceiling that is not there.
    lines.push(`AVAILABLE TO STAKE: EUR ${Number(dailyRemaining).toFixed(2)}`);
  }
  if (model || bankroll != null) lines.push("");

  // The field. A model trailing badly should be able to see that it is
  // trailing -- that is the whole difference between a bet and a race.
  if (Array.isArray(table) && table.length > 0) {
    lines.push("STANDINGS");
    for (const row of table) {
      const flag = row.model === model ? "  <- you" : "";
      const state = row.liquidated ? " ELIMINATED" : "";
      lines.push(
        `  ${row.rank ?? "-"}. ${row.model} EUR ${Number(row.bankroll).toFixed(2)}${state}${flag}`
      );
    }
    lines.push("");
  }

  lines.push("EVENT");
  lines.push(`  ${event?.event_name ?? "(unnamed)"}`);
  if (event?.sport) lines.push(`  Sport: ${event.sport}`);
  if (event?.competition) lines.push(`  Competition: ${event.competition}`);
  if (event?.round != null) lines.push(`  Round: ${event.round}`);
  if (event?.starts_at) lines.push(`  Kick-off: ${event.starts_at}`);
  lines.push("");

  lines.push("SELECTIONS AND PRICES (decimal odds)");
  for (const m of markets) {
    if (!m || !Array.isArray(m.selections) || m.selections.length === 0) continue;
    const header = m.line != null && m.line !== "" ? `${m.label} (line ${m.line})` : m.label;
    lines.push(`  [${m.market}] ${header}`);
    for (const s of m.selections) {
      if (!s || !s.pick) continue;
      const price = Number(s.odds);
      lines.push(
        `      ${s.pick}${Number.isFinite(price) && price > 0 ? ` @ ${price.toFixed(2)}` : " @ --"}`
      );
    }
  }
  lines.push("");

  lines.push("RULES");
  for (const rule of RULES) lines.push(`  - ${rule}`);
  lines.push("");

  lines.push("SCHEMA (one object per line)");
  lines.push(`  ${SCHEMA}`);
  lines.push("");
  lines.push("Reply with JSONL only, or the single word NONE.");

  return lines.join("\n");
}

/* -------------------------------------------------------------------- */
/* Reply parsing                                                        */
/* -------------------------------------------------------------------- */

/** Strip markdown fences, which models add regardless of instructions. */
function stripFences(text) {
  return String(text ?? "")
    .replace(/```(?:json|jsonl)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * Probability arrives as 0.62, ".62", "62%" or "62" depending on the model and
 * the day. Anything that cannot be read as a probability in [0,1] is dropped
 * rather than guessed -- a fair_prob of 62 instead of 0.62 turns every EV
 * calculation on the page into nonsense.
 */
// Re-exported from engine.js so prompts, the form and the database all agree
// on what a probability is. Defining a second one here is how they drift.
export { normaliseProbability };

/**
 * A stake the model chose, made safe.
 *
 * Rounded to whole euros and floored at 1. Not clamped to the budget here --
 * that happens once per reply in parsePickReply, because the limit applies to
 * the SUM of a multi-pick reply, not to each line independently.
 */
export function normaliseStake(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n));
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanText(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Parse a model reply into rows.
 *
 * @param text     raw reply, pasted by the operator
 * @param context  { markets } -- the same market list given to buildPickPrompt,
 *                 used to validate that a returned pick actually exists and to
 *                 recover the operator's own price for it
 * @returns {{ rows: Array, warnings: string[] }}
 */
export function parsePickReply(text, context = {}) {
  const { markets = [], available = null } = context;
  const warnings = [];
  const body = stripFences(text);

  if (!body || /^none$/i.test(body)) return { rows: [], warnings };

  // An index of every legitimate selection, so a hallucinated pick is caught
  // rather than written to the database.
  const known = new Map();
  for (const m of markets) {
    for (const s of m?.selections ?? []) {
      if (!s?.pick) continue;
      known.set(`${m.market}::${String(s.pick).toLowerCase()}`, {
        market: m.market,
        pick: s.pick,
        odds: Number(s.odds),
      });
    }
  }

  const rows = [];
  const seen = new Set();

  for (const line of body.split("\n")) {
    const trimmed = line.trim().replace(/,$/, "");
    if (!trimmed || !trimmed.startsWith("{")) continue;

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      warnings.push(`Unparseable line ignored: ${trimmed.slice(0, 60)}`);
      continue;
    }

    const marketKey = cleanText(obj.market, 40);
    const pickText = cleanText(obj.pick, 120);
    if (!marketKey || !pickText) {
      warnings.push("Line missing market or pick, ignored.");
      continue;
    }

    const match = known.get(`${marketKey}::${pickText.toLowerCase()}`);
    if (!match) {
      warnings.push(`"${pickText}" is not a selection offered in ${marketKey}. Ignored.`);
      continue;
    }

    const dedupe = `${match.market}::${match.pick}`;
    if (seen.has(dedupe)) {
      warnings.push(`Duplicate pick "${match.pick}" ignored.`);
      continue;
    }
    seen.add(dedupe);

    const prob = normaliseProbability(obj.prob ?? obj.probability ?? obj.fair_prob);
    if (prob === null) {
      warnings.push(`"${match.pick}" returned no usable probability. Left blank for you to fill.`);
    }

    rows.push({
      market: match.market,
      // Canonical casing from the card, not whatever the model typed.
      pick: match.pick,
      // The operator's price, never the model's. See the note at the top.
      odds: Number.isFinite(match.odds) && match.odds > 0 ? match.odds : "",
      stake: normaliseStake(obj.stake) ?? "",
      fair_prob: prob ?? "",
      confidence: clampConfidence(obj.confidence) ?? "",
      reasoning: cleanText(obj.reasoning ?? obj.thesis, 1200),
      risk_factors: cleanText(obj.risk ?? obj.risk_factors, 400),
    });
  }

  for (const r of rows) {
    if (r.stake === "") {
      warnings.push(`"${r.pick}" returned no stake. Set one before logging.`);
    }
  }

  // The budget applies to the whole reply. Three picks of 400 against 500
  // uncommitted is not three legal bets, and validatePick would reject the
  // third only after the operator had already logged the first two.
  if (available != null && Number.isFinite(Number(available))) {
    const budget = Number(available);
    const total = round2(rows.reduce((sum, r) => sum + (Number(r.stake) || 0), 0));
    if (total > budget) {
      warnings.push(
        `Stakes total €${total.toFixed(2)} against €${budget.toFixed(2)} uncommitted. ` +
          `Scaled down proportionally -- adjust before logging.`
      );
      const factor = budget / total;
      for (const r of rows) {
        if (r.stake === "") continue;
        r.stake = Math.max(1, Math.floor(Number(r.stake) * factor));
      }
    }
  }

  if (rows.length === 0 && warnings.length === 0) {
    warnings.push("Nothing in that reply looked like a pick. Expected one JSON object per line.");
  }

  return { rows, warnings };
}

/** Convenience: is this a model we actually run? */
export const isKnownModel = (name) => MODELS.includes(name);

/* -------------------------------------------------------------------- */
/* Adapter                                                              */
/* -------------------------------------------------------------------- */

/**
 * Turn a stored event into the market list the prompt builder wants.
 *
 * Events carry their prices as `event.odds`, keyed by market:
 *
 *   { "1x2": { line: null, prices: { "Malaga CF": 2.37, "Draw": 3.00 } } }
 *
 * The same matrix drives the admin's market and selection dropdowns, so a
 * prompt built from it can only ever offer selections that already exist on
 * the published card -- which is what makes the parser's rejection of unknown
 * picks meaningful rather than theatrical.
 *
 * Prices at or below 1.00 are dropped. A blank box in the odds matrix means
 * "not offered", and offering a model a selection at 0.00 invites a pick that
 * `validatePick` will then refuse.
 */
export function marketsFromEvent(event, labelFor = (_sport, key) => key) {
  const matrix = event?.odds ?? {};

  return Object.entries(matrix)
    .map(([market, draft]) => {
      const selections = Object.entries(draft?.prices ?? {})
        .map(([pick, price]) => ({ pick, odds: Number(price) }))
        .filter((s) => Number.isFinite(s.odds) && s.odds > 1);

      return {
        market,
        label: labelFor(event?.sport, market),
        line: draft?.line ?? null,
        selections,
      };
    })
    .filter((m) => m.selections.length > 0);
}
