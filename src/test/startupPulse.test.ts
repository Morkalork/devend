/**
 * The "look here" pulse a marked zone gets when a map opens.
 *
 * Colored areas and delivery boxes are painted ON the floor, which is right
 * once you have noticed them and useless before: a floor marking is designed
 * not to compete with the objects standing on it, so on a busy board it is the
 * first thing the eye skips. Reported as simply missing them.
 *
 * The animation itself cannot be tested, but its envelope can, and every way
 * this can go wrong is a property of these three numbers: it has to be loud at
 * the start, it has to actually STOP (a marking still pulsing at second thirty
 * is a rendering fault, not a hint), and it has to beat more than once or it
 * reads as a glitch rather than as a signal.
 */
import { describe, it, expect } from "vitest";
import {
  startupPulse, STARTUP_PULSE_SECONDS, winTargetPulse, winTargetPhase,
} from "@/lib/rendering/startupPulse";

describe("the announcement at map start", () => {
  it("is loudest at the very beginning", () => {
    const first = startupPulse(0);
    expect(first.active).toBe(true);
    expect(first.strength).toBeCloseTo(1, 6);
  });

  it("fades rather than stopping mid-beat", () => {
    // A ring that vanishes at full brightness reads as a fault. Strength has to
    // be decreasing all the way to the end.
    let previous = Infinity;
    for (let t = 0; t < STARTUP_PULSE_SECONDS; t += 0.1) {
      const s = startupPulse(t).strength;
      expect(s, `strength rose at ${t.toFixed(1)}s`).toBeLessThanOrEqual(previous);
      previous = s;
    }
    expect(previous).toBeLessThan(0.05);
  });

  it("finishes, and stays finished", () => {
    // THE thing that must not break. A permanent pulse would undo the reason
    // these are floor markings in the first place.
    expect(startupPulse(STARTUP_PULSE_SECONDS).active).toBe(false);
    expect(startupPulse(STARTUP_PULSE_SECONDS + 0.01).active).toBe(false);
    expect(startupPulse(60).active).toBe(false);
    expect(startupPulse(6000).strength).toBe(0);
  });

  it("beats more than once, so it reads as a signal and not a flicker", () => {
    // Count how often the beat phase wraps across the window.
    let wraps = 0;
    let last = startupPulse(0).beat;
    for (let t = 0.02; t < STARTUP_PULSE_SECONDS; t += 0.02) {
      const b = startupPulse(t).beat;
      if (b < last) wraps++;
      last = b;
    }
    expect(wraps).toBeGreaterThanOrEqual(2);
  });

  it("keeps the beat phase inside 0..1 the whole way", () => {
    for (let t = 0; t < STARTUP_PULSE_SECONDS; t += 0.05) {
      const b = startupPulse(t).beat;
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(1);
    }
  });

  it("is silent for a nonsense clock rather than drawing something odd", () => {
    // activePlaySeconds is a running total and should never be negative or NaN,
    // but a pulse that inverts or NaNs its alpha paints over the board.
    expect(startupPulse(-1).active).toBe(false);
    expect(startupPulse(Number.NaN).active).toBe(false);
    expect(startupPulse(Number.POSITIVE_INFINITY).active).toBe(false);
  });

  it("runs long enough to be seen and short enough not to nag", () => {
    // Bounds rather than a value: the exact length is a taste call, but a pulse
    // under a second is a blink and one over ten seconds is a distraction the
    // player cannot dismiss.
    expect(STARTUP_PULSE_SECONDS).toBeGreaterThan(1.5);
    expect(STARTUP_PULSE_SECONDS).toBeLessThan(10);
  });
});

describe("twelve markers are not one marker twelve times", () => {
  /**
   * Reported as "blinking maps". The breath was designed around level 5's ONE
   * slab, where a shallow sine on a single ring reads as breathing. Act I now
   * asks for half its bricks, so a map can carry twelve markers at once - and
   * twelve rings sharing one clock do not read as twelve things breathing,
   * they read as the board itself pulsing every 1.8 seconds.
   */
  it("still breathes, given no offset", () => {
    // The original behaviour, unchanged, so a map with one marker is untouched.
    expect(winTargetPulse(0).breathe).toBeCloseTo(0, 5);
    expect(winTargetPulse(0.9).breathe).toBeCloseTo(1, 5);
    expect(winTargetPulse(1.8).breathe).toBeCloseTo(0, 5);
  });

  it("puts an offset marker somewhere else in the breath", () => {
    const together = winTargetPulse(0.9).breathe;
    const apart = winTargetPulse(0.9, 0.5).breathe;
    expect(Math.abs(together - apart)).toBeGreaterThan(0.9);
  });

  it("never leaves the 0..1 range, at any offset", () => {
    for (let s = 0; s < 6; s += 0.07) {
      for (const p of [0, 0.13, 0.5, 0.87, 0.999]) {
        const b = winTargetPulse(s, p).breathe;
        expect(b, `s=${s} p=${p}`).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives a marker the same phase for the whole map", () => {
    // Derived from where the slab stands, not from its index in the set: the
    // set shrinks as slabs are smashed or sealed away, and an index would
    // re-phase every survivor each time one left.
    expect(winTargetPhase(140, 300)).toBe(winTargetPhase(140, 300));
    expect(winTargetPhase(140, 300)).toBeGreaterThanOrEqual(0);
    expect(winTargetPhase(140, 300)).toBeLessThan(1);
  });

  it("spreads a column of bricks across the breath", () => {
    // The shape act I actually has: a stack of slabs in one run, 42 apart.
    const phases = Array.from({ length: 12 }, (_, i) => winTargetPhase(300, 400 + i * 42));
    const spread = Math.max(...phases) - Math.min(...phases);
    expect(spread, "a whole brick run still breathes as one thing").toBeGreaterThan(0.4);
  });
});
