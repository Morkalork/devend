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
import { startupPulse, STARTUP_PULSE_SECONDS } from "@/lib/rendering/startupPulse";

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
