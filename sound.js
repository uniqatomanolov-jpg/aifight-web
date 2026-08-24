/**
 * Synthesized audio feedback. No files, no fetches, no licensing — every cue
 * is generated from oscillators at call time, so the whole module is under 4kB
 * and adds nothing to the network waterfall.
 *
 * Four rules this enforces, all of which are the difference between "premium"
 * and "annoying":
 *
 *   1. Nothing plays before a user gesture. Browsers suspend AudioContext
 *      until then; we create it lazily on first interaction instead of
 *      fighting it (and instead of logging autoplay warnings on every load).
 *   2. Cues are short (<400ms) and quiet (master 0.12). A trading terminal
 *      whispers.
 *   3. Rapid-fire actions duck rather than stack. Grading twenty picks must
 *      not produce twenty overlapping chimes clipping into distortion.
 *   4. Muted state persists, and `prefers-reduced-motion` implies mute —
 *      users who ask for calm interfaces are asking about sound too.
 */

const MASTER_GAIN = 0.12;
const MIN_INTERVAL_MS = 60; // below this, a cue is dropped rather than layered
const STORAGE_KEY = "aifight:muted";

let ctx = null;
let master = null;
let muted = false;
let lastPlayed = 0;

// Major scale degrees in semitones — used to pitch a streak up as it extends.
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
const semitone = (hz, n) => hz * Math.pow(2, n / 12);

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function readMuted() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // Storage can throw in private mode or a sandboxed frame. Not fatal.
  }
  return prefersReducedMotion();
}

if (typeof window !== "undefined") muted = readMuted();

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = Boolean(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Preference simply won't persist; audio still obeys it this session.
  }
  return muted;
}

export const toggleMute = () => setMuted(!muted);

/** Lazily build the graph. Returns null when audio is unavailable or muted. */
function audio() {
  if (muted || typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;

  if (!ctx) {
    try {
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      return null;
    }
  }
  // Suspended contexts resume only inside a gesture; this call is a no-op
  // otherwise and must not reject loudly.
  if (ctx.state === "suspended") ctx.resume?.().catch(() => {});
  return ctx;
}

/**
 * One shaped tone.
 * @param freq    starting frequency in Hz
 * @param dur     seconds
 * @param type    oscillator waveform
 * @param delay   seconds from now
 * @param glideTo optional frequency to ramp to (a fall reads as "down")
 * @param peak    gain multiplier for this voice
 */
function tone(freq, dur, { type = "sine", delay = 0, glideTo = null, peak = 1 } = {}) {
  const c = audio();
  if (!c) return;

  const start = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);

  // Fast attack, exponential decay. Linear decay sounds synthetic; ears hear
  // amplitude logarithmically.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(gain);
  gain.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Noise burst — gives clicks and the loss thud their physical texture. */
function noise(dur, { peak = 0.3, lowpass = 2000, delay = 0 } = {}) {
  const c = audio();
  if (!c) return;

  const start = c.currentTime + delay;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // Pre-decayed so the burst dies inside the buffer, not at the gain node.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;

  const gain = c.createGain();
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(start);
  src.stop(start + dur + 0.02);
}

/** Rate limiter — drops a cue rather than layering it into mush. */
function gate() {
  const now = Date.now();
  if (now - lastPlayed < MIN_INTERVAL_MS) return false;
  lastPlayed = now;
  return true;
}

export const sfx = {
  /** Hover / focus. Barely there by design — this fires constantly. */
  tick() {
    if (!gate()) return;
    tone(2200, 0.03, { type: "square", peak: 0.05 });
  },

  /** Generic button press. */
  click() {
    if (!gate()) return;
    tone(880, 0.05, { type: "triangle", peak: 0.35, glideTo: 660 });
    noise(0.03, { peak: 0.12, lowpass: 4000 });
  },

  /** Pick logged: a click with a coin-like ring above it. */
  logged() {
    if (!gate()) return;
    noise(0.04, { peak: 0.18, lowpass: 5000 });
    tone(1046.5, 0.09, { type: "triangle", peak: 0.5 }); // C6
    tone(1567.98, 0.16, { type: "sine", peak: 0.34, delay: 0.045 }); // G6
  },

  /**
   * WIN. Rising major triad. `run` pitches the whole figure up one scale
   * degree per consecutive win, so a fourth straight win is audibly higher
   * than the first — the streak is heard, not just seen.
   */
  win(run = 1) {
    if (!gate()) return;
    const lift = SCALE[Math.min(Math.max(run - 1, 0), SCALE.length - 1)];
    const root = semitone(523.25, lift); // C5 upward
    tone(root, 0.12, { type: "sine", peak: 0.5 });
    tone(semitone(root, 4), 0.14, { type: "sine", peak: 0.45, delay: 0.06 });
    tone(semitone(root, 7), 0.26, { type: "sine", peak: 0.42, delay: 0.12 });
  },

  /** LOSS. Low, damped, falling. No sting — operators hear this all day. */
  loss() {
    if (!gate()) return;
    tone(146.83, 0.26, { type: "sine", peak: 0.55, glideTo: 98 });
    noise(0.12, { peak: 0.22, lowpass: 320 });
  },

  /** VOID. Neutral, no valence: nothing happened. */
  void_() {
    if (!gate()) return;
    tone(392, 0.14, { type: "triangle", peak: 0.3 });
  },

  /** Hot streak reached. Quick ascending arpeggio. */
  hotStreak() {
    if (!gate()) return;
    [0, 4, 7, 12].forEach((step, i) =>
      tone(semitone(659.25, step), 0.16, {
        type: "sine",
        peak: 0.4,
        delay: i * 0.07,
      })
    );
  },

  /** Cold slump. Descending minor third, heavily damped. */
  coldSlump() {
    if (!gate()) return;
    tone(261.63, 0.2, { type: "sine", peak: 0.4 });
    tone(semitone(261.63, -3), 0.34, { type: "sine", peak: 0.36, delay: 0.11 });
    noise(0.2, { peak: 0.1, lowpass: 240, delay: 0.05 });
  },

  /** Validation failure. Two dull taps. */
  reject() {
    if (!gate()) return;
    tone(180, 0.07, { type: "square", peak: 0.28 });
    tone(150, 0.1, { type: "square", peak: 0.26, delay: 0.09 });
  },
};

/** Grade a bet, hear the right thing. Keeps call sites free of branching. */
export function playGrade(result, run = 1) {
  if (result === "win") return sfx.win(run);
  if (result === "loss") return sfx.loss();
  return sfx.void_();
}

/** Test seam: drop the context so a fresh one is built next call. */
export function _resetAudio() {
  try {
    ctx?.close?.();
  } catch {
    // Already closed.
  }
  ctx = null;
  master = null;
  lastPlayed = 0;
}
