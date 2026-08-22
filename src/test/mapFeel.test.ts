/**
 * Three reactions that make the board feel like a physical thing: movers that
 * turn rather than snap, a fence with a visible head as it grows, and a flash
 * on the ground a cut just took.
 *
 * The mover one carries a promise that is easy to make and easy to break, so
 * most of this file is about holding it: eleven shipped maps time their necks
 * against these patrols, and a speed curve chosen for feel would silently
 * re-time every one of them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { moverSpeedAt, MOVER_EASE_COMPENSATION } from "@/lib/physics/moverEase";

const HALF = 150;

/** Integrate the eased motion across a full traverse, in fixed steps. */
function traverse(steps = 20000) {
  const speed = 100;
  const dt = 1 / 240;
  let offset = -HALF;
  let t = 0;
  const times: { u: number; t: number }[] = [];
  let nextMark = 0;
  for (let i = 0; i < steps && offset < HALF; i++) {
    offset += speed * moverSpeedAt(offset, HALF) * dt;
    t += dt;
    const u = (offset + HALF) / (2 * HALF);
    while (nextMark <= 1 && u >= nextMark) {
      times.push({ u: nextMark, t });
      nextMark += 0.05;
    }
  }
  return { total: t, times };
}

/** The same traverse at a constant speed: what the maps were tuned against. */
const LINEAR_TOTAL = (2 * HALF) / 100;

describe("a mover eases into its turn", () => {
  it("runs slower at the ends than in the middle", () => {
    expect(moverSpeedAt(HALF, HALF)).toBeLessThan(moverSpeedAt(0, HALF));
    expect(moverSpeedAt(-HALF, HALF)).toBeLessThan(moverSpeedAt(0, HALF));
  });

  it("halves its speed into the turn, which is what makes it readable", () => {
    const end = moverSpeedAt(HALF, HALF) / moverSpeedAt(0, HALF);
    expect(end).toBeLessThan(0.6);
    expect(end, "slower than this and it visibly loiters").toBeGreaterThan(0.35);
  });

  it("is symmetric: the two ends behave identically", () => {
    for (const u of [0.5, 0.8, 0.95, 1]) {
      expect(moverSpeedAt(u * HALF, HALF)).toBeCloseTo(moverSpeedAt(-u * HALF, HALF), 9);
    }
  });

  it("is flat across the middle, so most of the travel is unchanged in shape", () => {
    const mid = moverSpeedAt(0, HALF);
    for (const u of [0.2, 0.5, 0.8]) {
      expect(moverSpeedAt(u * HALF, HALF)).toBeCloseTo(mid, 9);
    }
  });
});

/**
 * The promise. A traverse must take the time it always did, or every neck on
 * every map with a patrol has quietly moved.
 */
describe("the timing the maps were tuned against", () => {
  it("takes the same time end to end as constant speed", () => {
    const { total } = traverse();
    expect(total).toBeCloseTo(LINEAR_TOTAL, 2);
  });

  /**
   * The bound I committed to out loud. An earlier pass at a wider, deeper taper
   * looked better and drifted the midpoint by 6.6 frames, which is not "timing
   * preserved" by any honest reading of the phrase.
   */
  it("never drifts more than a few frames from where it used to be", () => {
    const { times } = traverse();
    const FRAME = 1 / 60;
    let worst = 0;
    for (const { u, t } of times) {
      worst = Math.max(worst, Math.abs(t - u * LINEAR_TOTAL));
    }
    expect(worst / FRAME, `worst drift ${(worst * 1000).toFixed(0)}ms`).toBeLessThan(4);
  });

  it("compensates rather than simply running slower", () => {
    // Without the normalisation the taper would just make every mover late,
    // and the lateness would compound every single traverse.
    expect(MOVER_EASE_COMPENSATION).toBeGreaterThan(1);
    expect(MOVER_EASE_COMPENSATION, "a large correction means a large re-timing")
      .toBeLessThan(1.05);
  });

  it("is derived from the constants, not written down beside them", () => {
    const SRC = readFileSync(
      resolve(__dirname, "../lib/physics/moverEase.ts"), "utf8",
    );
    // A hard-coded compensation goes stale the moment someone tunes the taper,
    // and the symptom is every mover on the board drifting out of time.
    expect(SRC).toMatch(/MOVER_EASE_COMPENSATION = \(\(\) =>/);
  });

  it("never returns a nonsense multiplier", () => {
    for (const half of [0, -10, 150]) {
      for (const off of [-999, -75, 0, 75, 999]) {
        const v = moverSpeedAt(off, half);
        expect(Number.isFinite(v), `off ${off} half ${half}`).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });
});

describe("a growing fence has a head", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/wallLayer.ts"), "utf8",
  );

  it("draws a tip at each advancing end", () => {
    expect(SRC).toMatch(/drawGrowTip\(/);
    const calls = SRC.match(/this\.drawGrowTip\(/g) ?? [];
    expect(calls.length, "both ends of a cut grow").toBe(2);
  });

  it("draws nothing before the cut has actually moved", () => {
    // A head placed on a zero-length tip puts a bright dot on the board the
    // instant a cut is armed, before anything has been built.
    expect(SRC).toMatch(/if \(len < 1\) return;/);
  });
});

describe("claiming ground gets a beat", () => {
  const CUT = readFileSync(
    resolve(__dirname, "../lib/physics/applyCut.ts"), "utf8",
  );
  const FX = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/fxLayer.ts"), "utf8",
  );

  it("records what the cut took, by diffing the grid across the capture", () => {
    expect(CUT).toMatch(/recordClaimFlash\(game, preCaptureCells\)/);
    expect(CUT).toMatch(/if \(cells\[i\] !== before\[i\]\) claimed\.add\(i\)/);
  });

  it("stays quiet for slivers", () => {
    // Every cut shaves a few cells off somewhere; flashing those turns the
    // punctuation into a stutter.
    // Asserting the constant merely EXISTS passes with the guard bypassed,
    // which is how the first version of this test survived that mutation.
    expect(CUT).toMatch(/claimed\.size < CLAIM_MIN_CELLS/);
    const min = CUT.match(/CLAIM_MIN_CELLS = (\d+)/);
    expect(min, "the threshold must be a real number of cells").toBeTruthy();
    expect(Number(min![1])).toBeGreaterThan(1);
  });

  it("traces the claim the same way a lock traces its pocket", () => {
    // One visual language: the lock flash fills smoothed contours, not cells.
    expect(CUT).toMatch(/snapContoursToWalls\(/);
    expect(CUT).toMatch(/traceContours\(/);
  });

  it("is drawn, and culled once it has played", () => {
    expect(FX).toMatch(/drawClaimFlashes\(/);
    expect(FX).toMatch(/game\.claimFlashes = list\.filter/);
  });

  it("sits under the lock flash, which is the bigger moment", () => {
    expect(FX.indexOf("this.drawClaimFlashes("))
      .toBeLessThan(FX.indexOf("this.drawLockFlashes("));
  });

  it("agrees with applyCut on how long it lasts", () => {
    const a = CUT.match(/CLAIM_FLASH_MS = (\d+)/);
    const b = FX.match(/CLAIM_FLASH_MS = (\d+)/);
    expect(a && b).toBeTruthy();
    expect(a![1], "a flash culled on one clock and drawn on another either " +
      "vanishes early or lingers as a stuck wash").toBe(b![1]);
  });
});
