/**
 * The padding cue, which is the only thing that says "this one gives" before a
 * ball has touched it.
 *
 * An obstacle that looks exactly like the wall beside it is not a mechanic, it
 * is a bug the player reverse-engineers by losing. entityLayer already says
 * this out loud about pass rules and bumpers; a deformable is the same problem
 * with a quieter symptom, because the thing it does to a ball (3% off) is far
 * too small to notice once and far too large to ignore over a map.
 *
 * The cue is inset contours, and the failure that matters is a WRONG INSET, not
 * a missing one: a contour pulled toward the shape's middle rather than offset
 * from its edges lands within a unit of the long edges of a slab, which is the
 * shape every deformable on the ladder currently is. That failure draws
 * something, so it looks fine in a screenshot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deformPlies, insetOutline, SKIN_MIN_AREA, SKIN_PLIES, SKIN_STEP,
} from "@/lib/rendering/sleek/deformSkin";
import { MAX_DENT } from "@/lib/physics/deformable";
import type { Vector2 } from "@/lib/polygon";

const rect = (x: number, y: number, w: number, h: number): Vector2[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const bounds = (vs: Vector2[]) => ({
  minX: Math.min(...vs.map(v => v.x)), maxX: Math.max(...vs.map(v => v.x)),
  minY: Math.min(...vs.map(v => v.y)), maxY: Math.max(...vs.map(v => v.y)),
});

describe("the inset is a true edge offset", () => {
  it("pulls a square in by the same amount on all four sides", () => {
    const out = insetOutline(rect(0, 0, 100, 100), 10)!;
    const b = bounds(out);
    expect(b.minX).toBeCloseTo(10, 6);
    expect(b.minY).toBeCloseTo(10, 6);
    expect(b.maxX).toBeCloseTo(90, 6);
    expect(b.maxY).toBeCloseTo(90, 6);
  });

  it("pulls a long thin bar in on its LONG sides too", () => {
    // The failure a square cannot see. A 24x300 bar (level 11's spine) offset
    // by pulling each corner toward the middle moves it almost entirely along
    // the bar, leaving the padding within a unit of the long edges - a cue that
    // is drawn, and invisible, on the exact shape the mechanic ships on.
    const out = insetOutline(rect(560, 45, 24, 300), 6)!;
    const b = bounds(out);
    expect(b.minX).toBeCloseTo(566, 6);
    expect(b.maxX).toBeCloseTo(578, 6);
    expect(b.minY).toBeCloseTo(51, 6);
    expect(b.maxY).toBeCloseTo(339, 6);
  });

  it("refuses to draw a contour that would turn inside out", () => {
    // Past the point where opposite edges cross, an offset polygon draws a
    // bow-tie, which reads as a graphical fault rather than as padding.
    expect(insetOutline(rect(0, 0, 20, 20), 40)).toBeNull();
    expect(insetOutline(rect(0, 0, 20, 20), 9.9)).toBeNull(); // under SKIN_MIN_AREA
    expect(insetOutline(rect(0, 0, 20, 20), 1)).not.toBeNull();
  });

  it("refuses a degenerate outline instead of drawing NaN", () => {
    expect(insetOutline([{ x: 0, y: 0 }, { x: 1, y: 1 }], 2)).toBeNull();
    expect(insetOutline(rect(0, 0, 0, 0), 2)).toBeNull();
  });
});

describe("the plies", () => {
  it("nest, outermost first", () => {
    const plies = deformPlies(rect(0, 0, 200, 200));
    expect(plies.length).toBe(SKIN_PLIES);
    const a = bounds(plies[0]), b = bounds(plies[1]);
    expect(b.minX).toBeGreaterThan(a.minX);
    expect(b.maxX).toBeLessThan(a.maxX);
    expect(a.minX).toBeCloseTo(SKIN_STEP, 6);
  });

  it("draws fewer on an object too small to hold them, rather than a bow-tie", () => {
    const plies = deformPlies(rect(0, 0, 22, 22));
    expect(plies.length).toBeLessThan(SKIN_PLIES);
    for (const ply of plies) {
      const b = bounds(ply);
      expect(b.maxX).toBeGreaterThan(b.minX);
      expect(b.maxY).toBeGreaterThan(b.minY);
    }
  });

  it("stays inside the face at every ply, so the cue never leaks onto the board", () => {
    const face = rect(0, 0, 300, 60);
    const fb = bounds(face);
    for (const ply of deformPlies(face)) {
      const b = bounds(ply);
      expect(b.minX).toBeGreaterThanOrEqual(fb.minX);
      expect(b.minY).toBeGreaterThanOrEqual(fb.minY);
      expect(b.maxX).toBeLessThanOrEqual(fb.maxX);
      expect(b.maxY).toBeLessThanOrEqual(fb.maxY);
    }
  });

  it("is set deeper than a full dent, so denting never swallows the padding", () => {
    // A ply inside MAX_DENT of the face would be overtaken by the surface as it
    // sank, and the object would look like it was healing.
    expect(SKIN_STEP).toBeGreaterThan(MAX_DENT);
    expect(SKIN_MIN_AREA).toBeGreaterThan(0);
  });
});

describe("the renderer actually uses it", () => {
  const layer = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/entityLayer.ts"), "utf8");

  it("insets the LIVE outline, so the padding sinks with the face", () => {
    // Drawn from `state.original` the padding would float where the wall used
    // to be, which is the one thing worse than not drawing it.
    expect(layer).toMatch(/deformPlies\(poly\.vertices\)/);
  });

  it("draws the authored outline as a ghost, from the state's own original", () => {
    // The record of what the wall has taken: it coincides with the face while
    // the wall is pristine and opens into a gap as it sinks.
    expect(layer).toMatch(/state\.original\.map/);
  });

  it("paints a deformable in its own colour rather than the furniture one", () => {
    expect(layer).toMatch(/PALETTE\.deformable/);
    expect(layer, "wear never reaches the body colour")
      .toMatch(/deformWear\(deform\)/);
  });
});
