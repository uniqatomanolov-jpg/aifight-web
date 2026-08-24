/**
 * Fighter design tokens — the single source of truth for model identity.
 *
 * `accent` is the one colour that stays legible as text and as a hairline on
 * the near-black background; `from`/`to` are the real gradient stops. Two of
 * the specified gradients are unusable as flat colour here and are handled
 * explicitly rather than silently:
 *
 *   ChatGPT  #11998e fails contrast as body text on #050508, so `accent`
 *            takes the light stop while the gradient keeps both.
 *   Gemini   #8A2387 is nearly invisible at 1px, so `accent` sits between the
 *            stops. Its second stop (#E94057) is deliberately NOT the accent:
 *            red-pink would collide with both Kimi's magenta and the semantic
 *            loss colour.
 *
 * Semantic colours (profit/loss green and red) are intentionally absent. They
 * are not brand colours and must never be overridden per fighter, or a losing
 * bet on Kimi becomes indistinguishable from a winning one.
 */

export const FIGHTERS = {
  Claude: {
    code: "CLA",
    vendor: "Anthropic",
    accent: "#00F2FE",
    from: "#00F2FE",
    to: "#4FACFE",
    glow: "rgba(0, 242, 254, 0.55)",
  },
  Grok: {
    code: "GRK",
    vendor: "xAI",
    accent: "#F5AF19",
    from: "#F5AF19",
    to: "#F12711",
    glow: "rgba(245, 175, 25, 0.55)",
  },
  ChatGPT: {
    code: "GPT",
    vendor: "OpenAI",
    accent: "#38EF7D",
    from: "#38EF7D",
    to: "#11998E",
    glow: "rgba(56, 239, 125, 0.5)",
  },
  Gemini: {
    code: "GEM",
    vendor: "Google",
    accent: "#B02FC9",
    from: "#8A2387",
    to: "#E94057",
    glow: "rgba(176, 47, 201, 0.55)",
  },
  Kimi: {
    code: "KMI",
    vendor: "Moonshot",
    accent: "#FF007F",
    from: "#FF007F",
    to: "#FF4FA3",
    glow: "rgba(255, 0, 127, 0.5)",
  },
};

export const MODELS = Object.keys(FIGHTERS);

const FALLBACK = {
  code: "???",
  vendor: "Unknown",
  accent: "#64748b",
  from: "#64748b",
  to: "#94a3b8",
  glow: "rgba(100, 116, 139, 0.4)",
};

export const fighter = (model) => FIGHTERS[model] ?? FALLBACK;

/**
 * Inline style object carrying a fighter's identity as CSS custom properties.
 * Spread it onto any element; the classes in fighters.css read from these, so
 * one spread themes the border, glow, rail and bar fill together.
 *
 *   <article className="fx-card fx-rail" style={fighterVars("Claude")}>
 */
export function fighterVars(model) {
  const f = fighter(model);
  return {
    "--fx-from": f.from,
    "--fx-to": f.to,
    "--fx-accent": f.accent,
    "--fx-glow": f.glow,
  };
}

export const fighterGradient = (model, angle = 135) => {
  const f = fighter(model);
  return `linear-gradient(${angle}deg, ${f.from}, ${f.to})`;
};

// ---------------------------------------------------------------- streaks --
//
// Deliberately conservative. A run of three wins at even money happens by
// chance often enough that badging it as skill would be misinformation on a
// site whose entire subject is calibration. A streak therefore requires a run
// AND a profitable recent window AND a minimum sample, and the caller is given
// `sample` so the UI can show how thin the evidence is.

export const STREAK_MIN_SAMPLE = 5;
export const STREAK_MIN_RUN = 3;
export const STREAK_WINDOW = 10;

/**
 * @param bets    this fighter's bets, newest first
 * @param profitOf  (bet) => number, settled profit for one bet
 * @returns {state: "hot"|"cold"|"neutral", run, sample, windowProfit}
 */
export function streakOf(bets = [], profitOf = (b) => Number(b.profit) || 0) {
  const settled = bets.filter((b) => b.result === "win" || b.result === "loss");
  const sample = settled.length;
  const neutral = { state: "neutral", run: 0, sample, windowProfit: 0 };
  if (sample < STREAK_MIN_SAMPLE) return neutral;

  // Length of the current run, and which way it is going.
  const first = settled[0].result;
  let run = 0;
  for (const bet of settled) {
    if (bet.result !== first) break;
    run += 1;
  }

  const window = settled.slice(0, STREAK_WINDOW);
  const windowProfit = window.reduce((sum, b) => sum + profitOf(b), 0);

  if (run < STREAK_MIN_RUN) return { ...neutral, run, windowProfit };

  // The run and the window must agree. Three wins that don't cover the
  // preceding losses are not a hot streak, they are a partial recovery.
  if (first === "win" && windowProfit > 0) {
    return { state: "hot", run, sample, windowProfit };
  }
  if (first === "loss" && windowProfit < 0) {
    return { state: "cold", run, sample, windowProfit };
  }
  return { ...neutral, run, windowProfit };
}
