/**
 * A breakable has to look breakable BEFORE you hit it.
 *
 * Reported for the third time, and the third report was the one that named the
 * root: "they are still the same color and design as ordinary walls". They
 * were, literally. An undamaged breakable drew with PALETTE.obstacle and
 * PALETTE.obstacleEdge, the same two colours a plain slab uses, and only began
 * to differ once `damage` rose above zero.
 *
 * That is backwards. You had to hit it to learn it was hittable, on a mechanic
 * whose whole point is deciding whether to spend a ball on smashing something.
 * Everything earlier - the impact bulge, the cracks, the bigger chips - made
 * damage read better and left the resting state exactly as it was.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { carveContour, CARVE_DEPTH, CARVE_SIGMA } from "@/lib/rendering/sleek/objectLayer";
import type { ImpactDent } from "@/types/game";
import type { Pt } from "@/lib/rendering/sleek/pixelGrid";

/** A world-to-screen at 1:1, so world units and screen units are the same. */
const w2s = (x: number, y: number): Pt => ({ x, y });
/** The same at 2x, for the zoom-independence check. */
const w2sZoom = (x: number, y: number): Pt => ({ x: x * 2, y: y * 2 });

/** A square hull, subdivided enough for a bite to have somewhere to land. */
function square(size = 200, step = 20): Pt[] {
  const out: Pt[] = [];
  const push = (x: number, y: number) => out.push({ x, y });
  for (let x = 0; x < size; x += step) push(x, 0);
  for (let y = 0; y < size; y += step) push(size, y);
  for (let x = size; x > 0; x -= step) push(x, size);
  for (let y = size; y > 0; y -= step) push(0, y);
  return out;
}

const area = (pts: Pt[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

/** How far the hull has moved inward nearest a given point. */
const biteAt = (before: Pt[], after: Pt[], at: Pt) => {
  let worst = 0;
  for (let i = 0; i < before.length; i++) {
    if (Math.hypot(before[i].x - at.x, before[i].y - at.y) > CARVE_SIGMA) continue;
    worst = Math.max(worst, Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y));
  }
  return worst;
};

describe("recorded damage is bitten out of the hull", () => {
  const hull = square();
  const dent = (over: Partial<ImpactDent> = {}): ImpactDent =>
    ({ x: 100, y: 0, s: 1, ...over });

  it("leaves an undamaged hull exactly as it was", () => {
    expect(carveContour(hull, w2s, [])).toEqual(hull);
    expect(carveContour(hull, w2s, undefined)).toEqual(hull);
  });

  /** The ask: a half-circle bite where the ball struck, not a mark on top. */
  it("pulls the outline inward at the hit", () => {
    const carved = carveContour(hull, w2s, [dent()]);
    expect(biteAt(hull, carved, { x: 100, y: 0 })).toBeGreaterThan(4);
  });

  it("takes material away rather than adding it", () => {
    // A mark drawn ON the surface leaves the silhouette alone; this must not.
    expect(area(carveContour(hull, w2s, [dent()]))).toBeLessThan(area(hull));
  });

  it("rounds the bite off instead of cutting a notch", () => {
    const carved = carveContour(hull, w2s, [dent()]);
    const at = (x: number) => {
      const i = hull.findIndex(p => p.x === x && p.y === 0);
      return Math.hypot(carved[i].x - hull[i].x, carved[i].y - hull[i].y);
    };
    // Deepest at the hit, shallower either side: a Gaussian, not a step.
    expect(at(100)).toBeGreaterThan(at(80));
    expect(at(80)).toBeGreaterThan(at(40));
  });

  it("bites harder for a harder hit", () => {
    const soft = carveContour(hull, w2s, [dent({ s: 0.3 })]);
    const hard = carveContour(hull, w2s, [dent({ s: 1 })]);
    expect(biteAt(hull, hard, { x: 100, y: 0 }))
      .toBeGreaterThan(biteAt(hull, soft, { x: 100, y: 0 }));
  });

  it("chews further with every hit landed", () => {
    const one = carveContour(hull, w2s, [dent()]);
    const three = carveContour(hull, w2s, [dent(), dent({ x: 120 }), dent({ x: 80 })]);
    expect(area(three)).toBeLessThan(area(one));
  });

  /**
   * A bite deep enough to cross the middle folds the polygon inside out and
   * renders as a bow tie. Driven well past anything the game can produce.
   */
  it("never bites past the centre, however battered", () => {
    const many = Array.from({ length: 12 }, (_, i) => dent({ x: 100, y: 0, s: 4 + i }));
    const carved = carveContour(hull, w2s, many);

    let cx = 0, cy = 0;
    for (const p of hull) { cx += p.x; cy += p.y; }
    cx /= hull.length; cy /= hull.length;

    // Area alone cannot see this: a folded hull still has positive shoelace
    // area, so the first version of this test passed on a bow tie. What matters
    // is that no point OVERSHOT the centre, which is what folding means.
    for (let i = 0; i < hull.length; i++) {
      const beforeX = cx - hull[i].x, beforeY = cy - hull[i].y;
      const afterX = cx - carved[i].x, afterY = cy - carved[i].y;
      expect(beforeX * afterX + beforeY * afterY,
        `point ${i} crossed the centre and folded the hull`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(carved[i].x) && Number.isFinite(carved[i].y)).toBe(true);
    }
  });

  it("is the same physical bite at any zoom", () => {
    const one = carveContour(hull, w2s, [dent()]);
    const two = carveContour(square(200, 20).map(p => ({ x: p.x * 2, y: p.y * 2 })),
      w2sZoom, [dent()]);
    const bite1 = biteAt(hull, one, { x: 100, y: 0 });
    const bite2 = biteAt(square(200, 20).map(p => ({ x: p.x * 2, y: p.y * 2 })), two,
      { x: 200, y: 0 });
    // Twice the zoom, twice the screen bite, same world bite.
    expect(bite2 / bite1).toBeCloseTo(2, 0);
  });

  it("bites deeper than a bounce flexes, so damage outreads a hit", () => {
    // The transient impact give peaks at 12 world units (wallImpactEffects).
    // If damage did not read deeper, permanent would look like temporary.
    expect(CARVE_DEPTH).toBeGreaterThan(12);
    expect(CARVE_SIGMA).toBeGreaterThan(0);
  });
});

/**
 * The resting state, which is what all three reports were actually about.
 */
describe("a breakable is told apart before it is touched", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/objectLayer.ts"), "utf8");
  const draw = SRC.slice(SRC.indexOf("private drawBreakable("), SRC.indexOf("private drawCracks("));

  it("no longer uses the plain obstacle colour untouched", () => {
    expect(draw, "an undamaged breakable was pixel-identical to a wall")
      .toMatch(/mix\(PALETTE\.obstacle, PALETTE\.amber/);
  });

  /** The load-bearing cue: an outline in pieces reads as something that comes
   *  apart, and works at rest, at any damage, at any zoom. */
  it("outlines an ordinary breakable in pieces, not one continuous line", () => {
    expect(draw).toMatch(/this\.brokenRim\(/);
  });

  it("carries fracture seams across the body", () => {
    expect(draw).toMatch(/this\.drawSeams\(/);
  });

  /** A chest is loot, not obstruction, and already reads as a prize. Breaking
   *  its outline would make it look damaged on sight. */
  it("leaves a chest with its solid rim", () => {
    expect(draw).toMatch(/if \(d\.chest\) \{[\s\S]*?this\.rimEdges\(/);
  });

  it("feeds the recorded dents into the hull it draws", () => {
    expect(draw).toMatch(/this\.prep\(poly, w2s, d\.dents\)/);
  });

  it("keeps the seams deterministic, so they do not crawl", () => {
    const seams = SRC.slice(SRC.indexOf("private drawSeams("), SRC.indexOf("private rimEdges("));
    expect(seams, "a per-frame random would read as noise").toMatch(/seed/);
    expect(seams).not.toMatch(/Math\.random/);
  });
});

/**
 * Fragments. The chips and the dents are BOTH gated on an impact point being
 * passed, and one damage path was not passing one.
 */
describe("every hit sheds something", () => {
  const BALL = readFileSync(
    resolve(__dirname, "../lib/physics/updateBall.ts"), "utf8");

  it("gives every registerObjectHit an impact point", () => {
    const calls = BALL.match(/registerObjectHit\([^;]*\)/g) ?? [];
    expect(calls.length, "expected the damage paths to still exist").toBeGreaterThan(1);
    for (const c of calls) {
      expect(c, `a hit with no impact point records no dent and sheds no chips: ${c.slice(0, 60)}`)
        .toMatch(/impactPoint|ball\.position/);
    }
  });

  it("still excludes only the mirror from the impact bulge", () => {
    // Glass that flexes reads as rubber; breakables were once excluded here on
    // the grounds their cracks told the story, and they did not.
    expect(BALL).toMatch(/d\?\.kind !== 'mirror'/);
    expect(BALL).not.toMatch(/d\?\.kind !== 'breakable'/);
  });
});
