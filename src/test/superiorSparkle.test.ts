/**
 * The twinkle inside a superior lock.
 *
 * Asked for as "a star that blinks by quickly and then fades inside superior
 * locks. Think Nintendo." Four claims in one sentence, and each is a thing
 * that can quietly stop being true under a later tuning pass:
 *
 *   A STAR         four points with a pinched waist, not a badge and not a
 *                  blob. The pinch is what makes it read as light.
 *   BLINKS         on almost instantly. An eased attack would read as a lamp
 *                  coming up, which is the opposite of a glint.
 *   BY             it travels. A twinkle that sat still and dimmed is a fading
 *                  dot, and the word in the request is "by".
 *   THEN FADES     and most of its life IS the fade.
 *
 * Plus the two properties the rest of this renderer would demand of anything
 * new on the board: it is rare enough not to be clutter, and it is a pure
 * function of the clock so a lockstep pair cannot disagree about it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  superiorSparkles, sparklePoints, resetSparkleCache,
  SPARKLE_MS, SPARKLE_PERIOD_MS, SPARKLE_RADIUS, INNER_RATIO,
} from "@/lib/rendering/sleek/superiorSparkle";
import { CellState, type SpaceGrid } from "@/lib/spaceGrid";

/** A grid with `superior` cells marked superior, in a block from the origin. */
function grid(superior: number, width = 20): SpaceGrid {
  const n = width * width;
  const flags = new Uint8Array(n);
  for (let i = 0; i < Math.min(superior, n); i++) flags[i] = 1;
  return {
    cellSize: 15, width, height: width, originX: 0, originY: 0,
    cells: new Uint8Array(n).fill(CellState.ACTIVE),
    initialActiveCount: n, activeCount: n, cellRegionIds: [],
    superiorCaptured: flags,
  } as unknown as SpaceGrid;
}

/** Every sparkle seen across one full cycle, sampled finely. */
function overOneCycle(g: SpaceGrid, count = 1, step = 8) {
  const seen: { t: number; s: ReturnType<typeof superiorSparkles>[number] }[] = [];
  for (let t = 0; t < SPARKLE_PERIOD_MS; t += step) {
    for (const s of superiorSparkles(g, count, t)) seen.push({ t, s });
  }
  return seen;
}

beforeEach(() => {
  resetSparkleCache();
});

describe("where it appears", () => {
  it("says nothing on a board with no superior ground", () => {
    expect(superiorSparkles(grid(0), 0, 1000)).toEqual([]);
  });

  it("says nothing without a grid at all", () => {
    expect(superiorSparkles(null, 0, 1000)).toEqual([]);
    expect(superiorSparkles(undefined, 0, 1000)).toEqual([]);
  });

  it("only ever sits on superior cells", () => {
    // Twenty cells marked, on a 20-wide grid: the top row and one more. A
    // sparkle anywhere else would be a badge on ground that did not earn it.
    const g = grid(20);
    for (const { s } of overOneCycle(g, 1)) {
      const col = Math.floor(s.x / 15);
      const row = Math.floor(s.y / 15);
      const cell = row * 20 + col;
      // The drift can carry it up to DRIFT world units past its cell, so the
      // test allows the neighbouring cell it can reach, not the whole board.
      expect(cell, `sparkle at (${s.x}, ${s.y}) left the pocket`).toBeLessThan(20 + 20);
      expect(s.x).toBeGreaterThanOrEqual(-10);
      expect(s.y).toBeGreaterThanOrEqual(-10);
    }
  });

  it("does not stamp them on the hatch's own lattice", () => {
    // Dead-centre placement would put every sparkle on the same grid the gold
    // hatch is drawn on, and the pocket would read as a pattern rather than as
    // a catch of light.
    const g = grid(60);
    const offsets = overOneCycle(g, 2).map(({ s }) => s.x % 15);
    expect(new Set(offsets.map(o => Math.round(o))).size).toBeGreaterThan(2);
  });
});

describe("how it moves", () => {
  it("blinks ON, rather than easing up", () => {
    const g = grid(20);
    const at = (t: number) => superiorSparkles(g, 1, t)[0];
    // A twentieth of its life in, it is essentially fully up.
    const early = at(SPARKLE_MS * 0.05);
    expect(early, "nothing was alive at the start of a cycle").toBeDefined();
    expect(early.alpha).toBeGreaterThan(0.9);
    // And that is a small fraction of the whole: attack under 40ms at this
    // duration, which is a frame or two.
    expect(SPARKLE_MS * 0.05).toBeLessThan(40);
  });

  it("spends most of its life fading", () => {
    const g = grid(20);
    const alphas = [0.2, 0.4, 0.6, 0.8, 0.95].map(f => superiorSparkles(g, 1, SPARKLE_MS * f)[0]?.alpha ?? 0);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i], `alpha rose again at sample ${i}`).toBeLessThan(alphas[i - 1]);
    }
    expect(alphas[alphas.length - 1]).toBeLessThan(0.1);
  });

  it("is gone before its cycle is", () => {
    const g = grid(20);
    expect(superiorSparkles(g, 1, SPARKLE_MS + 1)).toEqual([]);
    expect(superiorSparkles(g, 1, SPARKLE_PERIOD_MS - 1)).toEqual([]);
  });

  it("travels, rather than sitting still and dimming", () => {
    const g = grid(20);
    const a = superiorSparkles(g, 1, 1)[0];
    const b = superiorSparkles(g, 1, SPARKLE_MS * 0.9)[0];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    expect(moved, "the sparkle never went anywhere").toBeGreaterThan(4);
  });

  it("turns, but nowhere near enough to read as spinning", () => {
    const g = grid(20);
    const a = superiorSparkles(g, 1, 1)[0];
    // Late, but not so late the fade has already culled it: alpha is
    // (1 - f) squared, so the last twentieth is below the cull threshold.
    const b = superiorSparkles(g, 1, SPARKLE_MS * 0.8)[0];
    expect(b, "nothing was alive late in the sparkle's life").toBeDefined();
    const turned = Math.abs(b.rotation - a.rotation);
    expect(turned).toBeGreaterThan(0.05);
    expect(turned, "it is spinning like a pinwheel").toBeLessThan(Math.PI / 2);
  });
});

describe("how often", () => {
  it("keeps the board sparse: one or two, never a shower", () => {
    for (const cells of [1, 20, 80, 400]) {
      const g = grid(cells);
      resetSparkleCache();
      let most = 0;
      for (let t = 0; t < SPARKLE_PERIOD_MS * 2; t += 10) {
        most = Math.max(most, superiorSparkles(g, cells, t).length);
      }
      expect(most, `${cells} superior cells put ${most} sparkles up at once`).toBeLessThanOrEqual(2);
    }
  });

  it("leaves long gaps with nothing at all", () => {
    // The pocket is mostly dark. A twinkle that was up more than it was down
    // would be a light fixture, and this board has been told once already
    // what a permanent marker competing for attention reads as.
    const g = grid(400);
    let lit = 0;
    let frames = 0;
    for (let t = 0; t < SPARKLE_PERIOD_MS * 3; t += 10) {
      frames++;
      if (superiorSparkles(g, 400, t).length > 0) lit++;
    }
    expect(lit / frames, "the pocket is lit more often than not").toBeLessThan(0.45);
  });

  it("puts two sparkles out of phase rather than together", () => {
    const g = grid(400);
    let both = 0;
    let either = 0;
    for (let t = 0; t < SPARKLE_PERIOD_MS * 2; t += 10) {
      const n = superiorSparkles(g, 400, t).length;
      if (n > 0) either++;
      if (n === 2) both++;
    }
    expect(either).toBeGreaterThan(0);
    expect(both / either, "the pair fire together instead of alternating").toBeLessThan(0.2);
  });
});

describe("the shape", () => {
  it("is a four-pointed star, not a badge or a blob", () => {
    const pts = sparklePoints(0, 0, 10, 0);
    expect(pts.length, "a four-point star is eight vertices").toBe(16);
    const radii: number[] = [];
    for (let i = 0; i < pts.length; i += 2) radii.push(Math.hypot(pts[i], pts[i + 1]));
    const outer = radii.filter((_, i) => i % 2 === 0);
    const inner = radii.filter((_, i) => i % 2 === 1);
    for (const r of outer) expect(r).toBeCloseTo(10, 5);
    for (const r of inner) expect(r).toBeCloseTo(10 * INNER_RATIO, 5);
  });

  it("is pinched hard enough to read as light rather than as a polygon", () => {
    // The one number that decides whether this looks like the reference. At
    // half the radius it is a chunky pinwheel.
    expect(INNER_RATIO).toBeLessThan(0.3);
  });

  it("turns with its rotation", () => {
    const a = sparklePoints(0, 0, 10, 0);
    const b = sparklePoints(0, 0, 10, Math.PI / 4);
    expect(b[0]).not.toBeCloseTo(a[0], 3);
  });

  it("is drawn where the pocket can be seen, at a size that reads", () => {
    // Smaller than a ball (18) so it decorates the pocket rather than
    // competing with the thing the player is tracking.
    expect(SPARKLE_RADIUS).toBeLessThan(18);
    expect(SPARKLE_RADIUS).toBeGreaterThan(6);
  });
});

describe("determinism", () => {
  it("gives the same answer twice for the same clock", () => {
    const g = grid(80);
    const a = superiorSparkles(g, 80, 4321);
    resetSparkleCache();
    const b = superiorSparkles(grid(80), 80, 4321);
    expect(b).toEqual(a);
  });

  it("moves continuously, rather than teleporting frame to frame", () => {
    // The cell is chosen once per CYCLE. Re-rolling it per frame would put
    // each frame's sparkle somewhere else in the pocket, which draws as a
    // flicker across the whole area rather than as one travelling twinkle -
    // and would still pass every "it moved" test. So the thing to pin is the
    // size of each step, not the total distance.
    const g = grid(400);
    let biggestStep = 0;
    let previous: { x: number; y: number } | null = null;
    for (let t = 1; t < SPARKLE_MS * 0.7; t += 5) {
      const s = superiorSparkles(g, 400, t)[0];
      if (!s) { previous = null; continue; }
      if (previous) biggestStep = Math.max(biggestStep, Math.hypot(s.x - previous.x, s.y - previous.y));
      previous = { x: s.x, y: s.y };
    }
    expect(biggestStep, "the sparkle jumped across the pocket between frames").toBeLessThan(1);
    expect(biggestStep, "it did not move at all").toBeGreaterThan(0);
  });

  it("picks a different spot next time round", () => {
    const g = grid(400);
    const first = superiorSparkles(g, 400, 1)[0];
    const second = superiorSparkles(g, 400, SPARKLE_PERIOD_MS + 1)[0];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(
      Math.hypot(second.x - first.x, second.y - first.y),
      "every cycle twinkles in the same place",
    ).toBeGreaterThan(1);
  });

  it("rebuilds its cell list when another superior lock lands", () => {
    // The list is cached on the lock COUNT, because superior cells are only
    // ever added and only by a lock. A cache that never noticed would leave a
    // new pocket dark for the rest of the map.
    const small = grid(4);
    superiorSparkles(small, 1, 0);
    const bigger = small;
    bigger.superiorCaptured!.fill(1);
    const after = superiorSparkles(bigger, 2, 1);
    expect(after.length).toBeGreaterThan(0);
  });
});
