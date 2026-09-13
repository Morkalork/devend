/**
 * The liquid splat (liquidSplat.ts): a stuck ball melts around whatever it is
 * stuck to.
 *
 * What the droplet could not do, and what these pin: past the end of a fence
 * the material pours over and curls UNDER the lip; beside a second wall it
 * piles into a fillet; on a fence it never shows through to the far side.
 * And the case that was already signed off, mid-wall, comes out the same.
 *
 * All measured off the rasterized image, which is what the player sees, not
 * off the field: an earlier version of this model had a correct field and a
 * film kernel that soaked straight through a six-unit fence.
 */
import { describe, it, expect } from "vitest";
import { captureSplatScene, type SplatScene } from "@/lib/splatScene";
import {
  createLiquidImage, rasterizeLiquid, liquidBounds, dropletArea, type LiquidImage,
} from "@/lib/rendering/liquidSplat";
import { splatOutline } from "@/lib/rendering/splatShape";

const R = 18;
const UP = { x: 0, y: -1 };
const FULL = { d: 1, v: 1, w: 1, stretch: 0 };
const ROUND = { d: 0, v: 0, w: 0, stretch: 0 };
const RED = 0xff4d5a;

const wall = (x1: number, y1: number, x2: number, y2: number, id = "fence") =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 6 });
const board = { vertices: [{ x: 45, y: 45 }, { x: 855, y: 45 }, { x: 855, y: 855 }, { x: 45, y: 855 }] };

/** A ball resting on the bottom board edge, mid-span. */
const midWall = () => captureSplatScene(
  { walls: [wall(45, 855, 855, 855, "board-edge-2")], obstaclePolygons: [], boardPolygon: board },
  { x: 450, y: 855 }, UP, R,
);
/** On top of a fence whose end is 8 units to the right of the contact (ball rests 2 off the face). */
const fenceEnd = () => captureSplatScene(
  { walls: [wall(100, 500, 458, 500)], obstaclePolygons: [], boardPolygon: board },
  { x: 450, y: 495 }, UP, R,
);
/** On the floor, with a second wall standing R + 2 to the right. */
const concave = () => captureSplatScene(
  { walls: [wall(45, 855, 855, 855, "board-edge-2"), wall(473, 855, 473, 700)], obstaclePolygons: [], boardPolygon: board },
  { x: 450, y: 855 }, UP, R,
);
/** Mid-span on a thin fence with open board below it. */
const midFence = () => captureSplatScene(
  { walls: [wall(100, 500, 800, 500)], obstaclePolygons: [], boardPolygon: board },
  { x: 450, y: 495 }, UP, R,
);

function paint(scene: SplatScene, s = FULL): LiquidImage {
  return rasterizeLiquid(createLiquidImage(R), scene, s, R, RED);
}
/** Is any body or glow texel lit inside the contact-space rectangle? */
function litIn(img: LiquidImage, x1: number, x2: number, y1: number, y2: number): number {
  let n = 0;
  for (let j = 0; j < img.height; j++) {
    const y = img.y0 + (j + 0.5) * img.texel;
    if (y < y1 || y > y2) continue;
    for (let i = 0; i < img.width; i++) {
      const x = img.x0 + (i + 0.5) * img.texel;
      if (x < x1 || x > x2) continue;
      const k = (j * img.width + i) * 4 + 3;
      if (img.body[k] > 0 || img.glow[k] > 0) n++;
    }
  }
  return n;
}
/** Opaque body area, in world units squared. */
function bodyArea(img: LiquidImage): number {
  let n = 0;
  for (let k = 3; k < img.body.length; k += 4) if (img.body[k] >= 128) n++;
  return n * img.texel * img.texel;
}

describe("liquid splat: mid-wall is still the approved droplet", () => {
  it("full splat is about 1.77 diameters wide and 0.48 high", () => {
    const b = liquidBounds(paint(midWall()))!;
    expect((b.maxX - b.minX) / (2 * R)).toBeGreaterThan(1.68);
    expect((b.maxX - b.minX) / (2 * R)).toBeLessThan(1.86);
    expect(-b.minY / (2 * R)).toBeGreaterThan(0.44);
    expect(-b.minY / (2 * R)).toBeLessThan(0.54);
    // Sitting on the wall, not floating above it or sunk into it.
    expect(Math.abs(b.maxY)).toBeLessThan(img_texel() * 1.5);
  });

  it("a round state draws a round ball of the right size, so the handover from the mesh is seamless", () => {
    const b = liquidBounds(paint(midWall(), ROUND))!;
    expect((b.maxX - b.minX) / (2 * R)).toBeCloseTo(1, 1);
    expect(-b.minY / (2 * R)).toBeCloseTo(1, 1);
    expect(Math.abs((b.minX + b.maxX) / 2)).toBeLessThan(img_texel() * 1.5);
  });

  it("holds the droplet's own area, not the round disc's", () => {
    const img = paint(midWall());
    const target = dropletArea(FULL, R);
    expect(target).toBeLessThan(Math.PI * R * R * 0.8); // the droplet is the smaller shape
    expect(bodyArea(img) / target).toBeGreaterThan(0.9);
    expect(bodyArea(img) / target).toBeLessThan(1.12);
  });

  it("dropletArea agrees with the shoelace of the outline", () => {
    const pts = splatOutline(FULL, R);
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    expect(dropletArea(FULL, R)).toBeCloseTo(Math.abs(a) / 2, 6);
  });
});

describe("liquid splat: it melts around what it touches", () => {
  it("never paints inside a solid", () => {
    for (const scene of [midWall(), fenceEnd(), concave(), midFence()]) {
      const img = paint(scene);
      for (let j = 0; j < img.height; j++) {
        for (let i = 0; i < img.width; i++) {
          const k = j * img.width + i;
          if (img.mask[k] !== 1) continue;
          expect(img.body[k * 4 + 3]).toBe(0);
          expect(img.glow[k * 4 + 3]).toBe(0);
        }
      }
    }
  });

  it("pours over the end of a fence and curls under the lip", () => {
    const img = paint(fenceEnd());
    const b = liquidBounds(img)!;
    // The fence face is at y = 2, its underside at y = 8; the end at x = 8.
    // Material below the underside, and past the end, is the wrap.
    expect(b.maxY).toBeGreaterThan(8 + R * 0.2);
    expect(b.maxX).toBeGreaterThan(8 + R * 0.3);
    // Under the lip itself (x < 8, y > 8): film on the underside.
    expect(litIn(img, -R, 8, 9, 8 + R)).toBeGreaterThan(0);
    // And the far half, over the fence, is still the droplet's height.
    expect(-b.minY / (2 * R)).toBeGreaterThan(0.38);
  });

  it("piles into a fillet against a second wall instead of stopping short", () => {
    const img = paint(concave());
    const b = liquidBounds(img)!;
    // Reaches the standing wall's face (x = R + 2 - 3 = 20) ...
    expect(b.maxX).toBeGreaterThan(20 - img.texel);
    // ... and not through it.
    expect(b.maxX).toBeLessThan(20 + img.texel * 1.5);
    // Higher against the wall than mid-wall, because the mass has nowhere else to go.
    const mid = liquidBounds(paint(midWall()))!;
    expect(-b.minY).toBeGreaterThan(-mid.minY);
    // Touching the wall well above the floor: the fillet.
    expect(litIn(img, 20 - 2 * img.texel, 20, -R * 0.9, -R * 0.5)).toBeGreaterThan(0);
  });

  it("shows nothing on the far side of a thin fence", () => {
    const img = paint(midFence());
    // Underside at y = 8. Any lit texel below it would be the ball showing through.
    expect(litIn(img, -3 * R, 3 * R, 8.5, 3 * R)).toBe(0);
  });

  it("does not depend on which solid comes first", () => {
    const a = paint(concave());
    const scene = concave();
    scene.solids.reverse();
    const b = paint({ solids: scene.solids, samples: scene.samples });
    expect(bodyArea(a)).toBeCloseTo(bodyArea(b), 0);
  });
});

describe("liquid splat: the image is reusable", () => {
  it("repainting into the same image with the same inputs is stable", () => {
    const scene = fenceEnd();
    const img = createLiquidImage(R);
    rasterizeLiquid(img, scene, FULL, R, RED);
    const first = Uint8Array.from(img.body);
    rasterizeLiquid(img, scene, { d: 0.5, v: 0.2, w: 0.3, stretch: 0 }, R, RED);
    rasterizeLiquid(img, scene, FULL, R, RED);
    expect(Array.from(img.body)).toEqual(Array.from(first));
  });

  it("caches the solids mask per scene", () => {
    const scene = fenceEnd();
    const img = createLiquidImage(R);
    rasterizeLiquid(img, scene, FULL, R, RED);
    expect(img.maskFor).toBe(scene);
    const other = midWall();
    rasterizeLiquid(img, other, FULL, R, RED);
    expect(img.maskFor).toBe(other);
  });
});

function img_texel(): number {
  return createLiquidImage(R).texel;
}
