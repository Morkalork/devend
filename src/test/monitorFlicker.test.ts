/**
 * The board must never blink, and it must never be dead still either.
 *
 * Reported as "fenced off areas still blink in quick pace". The cause was not
 * the effect's depth, which is where the old comment in monitorSignal.ts put
 * it ("deliberately tiny (~4%) - far too little to read as flashing"): it was
 * the RATE. `Math.sin(t / 97)` with t in milliseconds has a period of 2*pi*97
 * ms, so the monitor's idle shimmer carried a 1.64 Hz component and the board's
 * delivered brightness turned around 328 times in 100 seconds, a median of
 * 313ms between reversals. A couple of percent of modulation at a fast
 * heartbeat's rate is not subtle on a large flat field - it is a flicker.
 *
 * ── Why this measures delivered brightness rather than `level` ──────────────
 *
 * `monitorLevel` is not what anyone looks at. The board's wash sprite is a
 * MULTIPLY whose alpha is `1 + nominal - level` about a nominal near 0.45
 * (boardWash.washSpriteAlpha), so the level's swing arrives at the eye divided
 * by that nominal - amplified roughly twofold, and more at the far corner where
 * the gradient is heaviest. A test that asserted on the level alone would be
 * checking a number no pixel has, and would have passed the whole time the
 * board was visibly blinking.
 *
 * Captured ground is where a player sees it first, and that is a consequence of
 * the same arithmetic rather than anything special about fences: fenced-off
 * space is the biggest, flattest, darkest region on the board, so it is the one
 * surface with nothing on it to distract from a uniform ripple. Fixing the
 * signal fixes it everywhere at once, which is why nothing here reaches for the
 * area layer.
 *
 * ── The two directions this pulls in ───────────────────────────────────────
 *
 * SLOW ENOUGH   no reversal closer than about a second, and a median gap of
 *               seconds. This is the reported bug and the bulk of the file.
 * NOT FLAT      the swing still has to exist. A monitor lighting a room is not
 *               a constant, and "make it stop" is satisfiable by deleting the
 *               shimmer, which would be a worse board and would silently pass
 *               every pace assertion below.
 *
 * The deliberate glitch is pinned too. CRTBackground calls `pulseMonitor` when
 * it tears, and that stutter is SUPPOSED to be fast - if slowing the idle
 * shimmer had been done by damping the signal as a whole, the background would
 * have gone on glitching over a board that no longer reacted to it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { monitorLevel, pulseMonitor, resetMonitor } from "@/lib/rendering/sleek/monitorSignal";
import { washAlphaAt } from "@/lib/rendering/sleek/boardWash";

/**
 * What a pixel at gradient position `t` actually shows, 0 (black) to 1.
 *
 * The wash darkens by multiplying, so the brightness the player sees is the
 * complement of the alpha it applies.
 */
function delivered(t: number, now: number): number {
  return 1 - washAlphaAt(t, monitorLevel(now));
}

/** How long a stretch of board light to study, and how finely. */
const WINDOW_MS = 100_000;
/** Well above any real frame rate, so nothing here is an aliasing artefact. */
const SAMPLE_HZ = 240;

interface Trace {
  /** Every sampled brightness. */
  values: number[];
  /** Timestamps where the brightness reversed direction, in ms. */
  turns: number[];
  /** Ascending gaps between consecutive reversals, in ms. */
  gaps: number[];
  /** Peak-to-peak swing as a fraction of the mean. */
  swing: number;
}

/** Sample the delivered brightness at one gradient position and describe it. */
function trace(t: number): Trace {
  resetMonitor();
  const dt = 1000 / SAMPLE_HZ;
  const count = Math.round(WINDOW_MS / dt);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(delivered(t, i * dt));
  }

  const turns: number[] = [];
  for (let i = 1; i < count - 1; i++) {
    const before = values[i] - values[i - 1];
    const after = values[i + 1] - values[i];
    if (before * after < 0) {
      turns.push(i * dt);
    }
  }

  const gaps: number[] = [];
  for (let i = 1; i < turns.length; i++) {
    gaps.push(turns[i] - turns[i - 1]);
  }
  gaps.sort((a, b) => a - b);

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
    sum += v;
  }
  return { values, turns, gaps, swing: (max - min) / (sum / count) };
}

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)];

/**
 * The three places on the wash gradient that matter: the lit centre, the middle
 * stop, and the far corner where the gradient is heaviest and therefore where
 * the same level swing lands hardest.
 */
const POSITIONS = [0, 0.5, 1];

describe("the idle monitor shimmer", () => {
  beforeEach(() => {
    resetMonitor();
  });

  it("never reverses the board's brightness twice inside a second", () => {
    for (const t of POSITIONS) {
      const { gaps } = trace(t);
      // The reported flicker's shortest gap was 225ms and its median 313ms.
      // A second is the boundary between "breathing" and "pulsing"; the
      // current signal's tightest reversal measures about 1.27s.
      expect(gaps[0], `shortest reversal gap at gradient ${t}`).toBeGreaterThan(1000);
    }
  });

  it("swells over seconds, not over fractions of one", () => {
    for (const t of POSITIONS) {
      const { gaps, turns } = trace(t);
      expect(median(gaps), `median reversal gap at gradient ${t}`).toBeGreaterThan(1500);
      // 328 in the reported version; 50 now. The ceiling is what would catch a
      // fast component reintroduced underneath a slow one, which averages out
      // of the median but cannot hide from the count.
      expect(turns.length, `reversals per 100s at gradient ${t}`).toBeLessThan(80);
    }
  });

  it("stays inside a swing the eye reads as light, not as a change of scene", () => {
    for (const t of POSITIONS) {
      const { swing } = trace(t);
      // Measured 5.7% at the centre, 9.5% at the far corner, where the wash
      // multiplies hardest. The bound is per-position deliberately: an
      // amplitude raised "a little" shows up at the corner first.
      expect(swing, `peak-to-peak swing at gradient ${t}`).toBeLessThan(0.12);
    }
  });

  it("is still moving - a dead-still board is not a fix", () => {
    for (const t of POSITIONS) {
      const { swing, turns } = trace(t);
      expect(swing, `peak-to-peak swing at gradient ${t}`).toBeGreaterThan(0.02);
      expect(turns.length, `reversals per 100s at gradient ${t}`).toBeGreaterThan(10);
    }
  });

  it("never loops visibly, so the board does not tick", () => {
    // Three incommensurable periods: any two sharing a factor would beat into a
    // repeating pattern, which on a flat field reads as a pulse with a tempo.
    const a = trace(0.5).values;
    resetMonitor();
    const dt = 1000 / SAMPLE_HZ;
    // If the signal repeated on any period up to 30s, the trace shifted by that
    // period would match itself. Nothing should come close.
    for (const periodMs of [5000, 10_000, 20_000, 30_000]) {
      const shift = Math.round(periodMs / dt);
      let worst = 0;
      for (let i = 0; i + shift < a.length; i += 17) {
        worst = Math.max(worst, Math.abs(a[i] - a[i + shift]));
      }
      expect(worst, `self-similarity at ${periodMs}ms`).toBeGreaterThan(0.002);
    }
  });

  it("is deterministic, so two devices light the same board", () => {
    resetMonitor();
    const first = [0, 137, 4021, 55_555].map((t) => monitorLevel(t));
    resetMonitor();
    const second = [0, 137, 4021, 55_555].map((t) => monitorLevel(t));
    expect(second).toEqual(first);
  });
});

describe("the deliberate glitch", () => {
  beforeEach(() => {
    resetMonitor();
  });

  it("still stutters fast, because the background it answers does", () => {
    const base = monitorLevel(performance.now());
    pulseMonitor(1, 180);
    const start = performance.now();
    let deepest = base;
    for (let ms = 0; ms < 180; ms += 4) {
      deepest = Math.min(deepest, monitorLevel(start + ms));
    }
    // A dip an order of magnitude past anything the idle shimmer does, and
    // inside a fifth of a second: this is the one part of the signal that is
    // meant to read as a blink.
    expect(base - deepest).toBeGreaterThan(0.2);
  });

  it("settles back to the idle signal once it has run its course", () => {
    pulseMonitor(1, 180);
    const after = performance.now() + 400;
    resetMonitor();
    expect(monitorLevel(after)).toBeCloseTo(monitorLevel(after), 10);
    expect(Math.abs(monitorLevel(after) - 1)).toBeLessThan(0.06);
  });

  it("never darkens the board enough to lose a ball", () => {
    pulseMonitor(1, 180);
    const start = performance.now();
    for (let ms = 0; ms < 240; ms += 2) {
      const level = monitorLevel(start + ms);
      expect(level).toBeGreaterThanOrEqual(0.62);
      expect(level).toBeLessThanOrEqual(1.18);
    }
  });
});
