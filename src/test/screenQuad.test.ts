/**
 * Floor markings on a turned board.
 *
 * This exists because of a bug the board tilt shipped with. Coloured areas and
 * gravity wells were drawn by transforming the top-left and bottom-right world
 * corners and calling that a screen rect, which is exact for a translate plus a
 * uniform scale and nonsense the moment the transform rotates. The failure was
 * not subtle-but-wrong, it was total: at 45 degrees the level-12 well measured
 * 35x205 instead of a turned 240x170, and at 90 degrees the width came out
 * NEGATIVE and snapRect clamped it to a 1px sliver, so every marking on the map
 * simply vanished at the exact moment the feature was supposed to be showing
 * off.
 *
 * The properties below are the ones the old code violated. They are stated
 * against the real tilt transform rather than a mock, because the bug lived
 * precisely in the gap between "a rect" and "what this transform does to a
 * rect".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { worldRectQuad, quadLocal, expandQuad, quadPoly, cornersPoly } from "@/lib/rendering/sleek/quad";
import { tiltWorldPoint, BOARD_WIDTH } from "@/lib/boardConstants";

/** The real screen transform, tilt included, at a plain 1:1 scale. */
function w2sAt(angle: number) {
  return (x: number, y: number) => tiltWorldPoint(x, y, angle);
}

/** Level 12's authored well, i.e. a rect that actually ships. */
const WELL = { x: 330, y: 300, width: 240, height: 170 };

const DEG = (d: number) => (d * Math.PI) / 180;

describe("a world rect at rest", () => {
  const q = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(0));

  it("is still an upright screen rect", () => {
    expect(q.axisAligned).toBe(true);
    expect(q.w).toBeCloseTo(240, 6);
    expect(q.h).toBeCloseTo(170, 6);
  });

  it("keeps the basis on the screen axes", () => {
    expect(q.ux).toBeCloseTo(1, 6);
    expect(q.uy).toBeCloseTo(0, 6);
    expect(q.vx).toBeCloseTo(0, 6);
    expect(q.vy).toBeCloseTo(1, 6);
  });

  it("centres where the rect does", () => {
    expect(q.cx).toBeCloseTo(450, 6);
    expect(q.cy).toBeCloseTo(385, 6);
  });
});

describe("a world rect on a turned board", () => {
  /**
   * The regression, stated as the measurement that was wrong. The old code
   * computed width as br.x - tl.x; these are the numbers that came out.
   */
  it("no longer collapses, at any angle", () => {
    for (const deg of [15, 30, 45, 60, 90, 135, 180, 270]) {
      const q = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(DEG(deg)));
      const naiveW = q.br.x - q.tl.x;
      const naiveH = q.br.y - q.tl.y;
      // What the quad actually measures, versus what the two-corner rect did.
      expect(q.w, `${deg}deg width`).toBeGreaterThan(120);
      expect(q.h, `${deg}deg height`).toBeGreaterThan(80);
      // Signed, not absolute: at 180 degrees the two-corner width is -240, which
      // snapRect clamped to 1. A negative extent is the failure, not a sign quirk.
      expect(
        naiveW < q.w - 1 || naiveH < q.h - 1,
        `${deg}deg: the two-corner rect measured ${naiveW.toFixed(1)}x${naiveH.toFixed(1)} `
        + `for a ${q.w.toFixed(1)}x${q.h.toFixed(1)} quad; if they agree this test proves nothing`,
      ).toBe(true);
    }
  });

  it("shrinks both edges by exactly the fit scale, and no more", () => {
    // A quarter turn maps a square board onto itself, so nothing shrinks.
    const q90 = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(DEG(90)));
    expect(q90.w).toBeCloseTo(240, 6);
    expect(q90.h).toBeCloseTo(170, 6);

    // Mid-turn the board's bounding box grows to sqrt(2), so it is scaled to fit.
    const q45 = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(DEG(45)));
    const k = 1 / Math.SQRT2;
    expect(q45.w).toBeCloseTo(240 * k, 4);
    expect(q45.h).toBeCloseTo(170 * k, 4);
  });

  it("reports itself as no longer upright, so callers stop snapping", () => {
    expect(worldRectQuad(0, 0, 10, 10, w2sAt(DEG(45))).axisAligned).toBe(false);
    expect(worldRectQuad(0, 0, 10, 10, w2sAt(DEG(90))).axisAligned).toBe(false);
  });

  it("stays a rectangle: opposite edges equal, corners square", () => {
    const q = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(DEG(37)));
    expect(Math.hypot(q.br.x - q.bl.x, q.br.y - q.bl.y)).toBeCloseTo(q.w, 4);
    expect(Math.hypot(q.br.x - q.tr.x, q.br.y - q.tr.y)).toBeCloseTo(q.h, 4);
    expect(q.ux * q.vx + q.uy * q.vy, "basis must stay perpendicular").toBeCloseTo(0, 6);
  });

  it("centres on the transformed centre, not the average of two corners", () => {
    const angle = DEG(52);
    const q = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(angle));
    const c = tiltWorldPoint(WELL.x + WELL.width / 2, WELL.y + WELL.height / 2, angle);
    expect(q.cx).toBeCloseTo(c.x, 6);
    expect(q.cy).toBeCloseTo(c.y, 6);
  });
});

describe("interior detail in the local frame", () => {
  it("maps the corners back to themselves", () => {
    const q = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(DEG(63)));
    const tl = quadLocal(q, 0, 0);
    const br = quadLocal(q, q.w, q.h);
    expect(tl.x).toBeCloseTo(q.tl.x, 6);
    expect(tl.y).toBeCloseTo(q.tl.y, 6);
    expect(br.x).toBeCloseTo(q.br.x, 6);
    expect(br.y).toBeCloseTo(q.br.y, 6);
  });

  /** The stripes are drawn this way, so a point inside must stay inside. */
  it("keeps interior points inside the quad", () => {
    const angle = DEG(28);
    const q = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(angle));
    for (const [a, b] of [[10, 10], [q.w / 2, q.h / 2], [q.w - 5, q.h - 5]]) {
      const p = quadLocal(q, a, b);
      // Project back through the basis: both components must land in range.
      const dx = p.x - q.tl.x, dy = p.y - q.tl.y;
      expect(dx * q.ux + dy * q.uy).toBeGreaterThanOrEqual(-1e-6);
      expect(dx * q.ux + dy * q.uy).toBeLessThanOrEqual(q.w + 1e-6);
      expect(dx * q.vx + dy * q.vy).toBeGreaterThanOrEqual(-1e-6);
      expect(dx * q.vx + dy * q.vy).toBeLessThanOrEqual(q.h + 1e-6);
    }
  });

  it("grows concentrically rather than shearing off", () => {
    const q = worldRectQuad(WELL.x, WELL.y, WELL.width, WELL.height, w2sAt(DEG(41)));
    const grown = expandQuad(q, 12);
    const cx = grown.reduce((n, p) => n + p.x, 0) / 4;
    const cy = grown.reduce((n, p) => n + p.y, 0) / 4;
    expect(cx).toBeCloseTo(q.cx, 4);
    expect(cy).toBeCloseTo(q.cy, 4);
    // Each edge is 24px longer: 12 on both ends.
    expect(Math.hypot(grown[1].x - grown[0].x, grown[1].y - grown[0].y))
      .toBeCloseTo(q.w + 24, 4);
  });

  it("insets by taking a negative growth", () => {
    const q = worldRectQuad(0, 0, 100, 100, w2sAt(DEG(30)));
    const inset = expandQuad(q, -5);
    expect(Math.hypot(inset[1].x - inset[0].x, inset[1].y - inset[0].y))
      .toBeCloseTo(q.w - 10, 4);
  });
});

describe("degenerate input", () => {
  /** A zero-width rect is authorable by hand and by a bad drag in the builder. */
  it("produces no NaN for a zero-size rect", () => {
    const q = worldRectQuad(100, 100, 0, 0, w2sAt(DEG(45)));
    for (const v of [q.cx, q.cy, q.w, q.h, q.ux, q.uy, q.vx, q.vy]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    const p = quadLocal(q, 5, 5);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe("the flat point lists Pixi is handed", () => {
  it("emit four corners in order", () => {
    const q = worldRectQuad(0, 0, 10, 20, w2sAt(0));
    expect(quadPoly(q)).toEqual([q.tl.x, q.tl.y, q.tr.x, q.tr.y, q.br.x, q.br.y, q.bl.x, q.bl.y]);
    expect(cornersPoly(expandQuad(q, 0))).toHaveLength(8);
  });
});

describe("the board the wells sit on", () => {
  it("is square, which is why a quarter turn costs no size", () => {
    expect(BOARD_WIDTH).toBe(900);
  });
});

/**
 * The other half of the same bug, and the half that would have been harder to
 * spot: AreaLayer is key-gated, so even with the geometry fixed a turning board
 * would leave every marking frozen at the angle it had when the turn began,
 * while the walls and balls swung round without them. Nothing would look
 * broken - the markings would just be in the wrong place.
 */
describe("the layer redraws when the board turns", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/areaLayer.ts"), "utf8",
  );

  it("takes the tilt angle", () => {
    const sig = SRC.slice(SRC.indexOf("  sync("), SRC.indexOf("): void {"));
    expect(sig).toMatch(/tilt/);
  });

  it("puts the tilt in the cache key, or the markings never move", () => {
    const key = SRC.slice(SRC.indexOf("const key ="), SRC.indexOf("if (key === this.key)"));
    expect(key).toMatch(/tilt/);
  });

  it("is handed the angle by the renderer", () => {
    const R = readFileSync(
      resolve(__dirname, "../lib/rendering/sleek/SleekRenderer.ts"), "utf8",
    );
    expect(R).toMatch(/this\.areas\.sync\([^)]*tilt/);
  });
});
