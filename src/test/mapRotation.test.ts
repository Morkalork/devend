import { describe, it, expect, afterEach } from "vitest";
import {
  rotatePoint,
  rotateEntity,
  rotateEntities,
  pickMapRotation,
  ROTATION_MIN_LEVEL,
  MapRotation,
} from "@/lib/mapRotation";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelMoverEntity, WallRectEntity } from "@/types/level";

const C = 450; // board centre (900 / 2)

afterEach(() => setRunSeedText(null));

describe("rotatePoint", () => {
  it("keeps the board centre fixed for every rotation", () => {
    for (const r of [0, 1, 2, 3] as MapRotation[]) {
      const p = rotatePoint(C, C, r);
      expect(p.x).toBeCloseTo(C);
      expect(p.y).toBeCloseTo(C);
    }
  });

  it("maps top-centre to the correct edge per rotation", () => {
    expect(rotatePoint(450, 0, 0)).toEqual({ x: 450, y: 0 });     // standard
    expect(rotatePoint(450, 0, 1)).toEqual({ x: 0, y: 450 });     // left  → left-centre
    expect(rotatePoint(450, 0, 2)).toEqual({ x: 450, y: 900 });   // 180   → bottom-centre
    expect(rotatePoint(450, 0, 3)).toEqual({ x: 900, y: 450 });   // right → right-centre
  });

  it("180° is its own inverse", () => {
    const back = rotatePoint(rotatePoint(123, 456, 2).x, rotatePoint(123, 456, 2).y, 2);
    expect(back).toEqual({ x: 123, y: 456 });
  });

  it("left then right returns to the original (inverse turns)", () => {
    const l = rotatePoint(200, 100, 1);
    const backAgain = rotatePoint(l.x, l.y, 3);
    expect(backAgain.x).toBeCloseTo(200);
    expect(backAgain.y).toBeCloseTo(100);
  });
});

describe("rotateEntity", () => {
  const rect: WallRectEntity = {
    id: "w1", kind: "wall", shape: "rect", x: 100, y: 0, width: 200, height: 40,
  };

  it("swaps width/height on a 90° turn, keeps them on 180°", () => {
    const left = rotateEntity(rect, 1) as WallRectEntity;
    expect(left.width).toBeCloseTo(40);
    expect(left.height).toBeCloseTo(200);

    const flipped = rotateEntity(rect, 2) as WallRectEntity;
    expect(flipped.width).toBeCloseTo(200);
    expect(flipped.height).toBeCloseTo(40);
  });

  it("preserves ids and non-spatial flags", () => {
    const breakable: WallRectEntity = { ...rect, breakable: true, hitsToBreak: 5 };
    const out = rotateEntity(breakable, 3) as WallRectEntity;
    expect(out.id).toBe("w1");
    expect(out.breakable).toBe(true);
    expect(out.hitsToBreak).toBe(5);
  });

  const hMover: LevelMoverEntity = {
    id: "m1", kind: "mover", shape: "rect", x: 100, y: 100, width: 120, height: 30,
    axis: "horizontal", range: 200, speed: 60, phase: 0.2,
  };

  it("swaps mover axis and flips phase correctly per rotation", () => {
    // CCW: horizontal → vertical, phase reversed.
    const l = rotateEntity(hMover, 1) as LevelMoverEntity;
    expect(l.axis).toBe("vertical");
    expect(l.phase).toBeCloseTo(0.8);

    // 180°: axis unchanged, phase reversed.
    const f = rotateEntity(hMover, 2) as LevelMoverEntity;
    expect(f.axis).toBe("horizontal");
    expect(f.phase).toBeCloseTo(0.8);

    // CW: horizontal → vertical, phase kept.
    const rr = rotateEntity(hMover, 3) as LevelMoverEntity;
    expect(rr.axis).toBe("vertical");
    expect(rr.phase).toBeCloseTo(0.2);
  });

  it("is a no-op at rotation 0 (same array reference)", () => {
    const arr = [rect];
    expect(rotateEntities(arr, 0)).toBe(arr);
  });
});

describe("pickMapRotation", () => {
  it("keeps the tutorial band (below ROTATION_MIN_LEVEL) standard", () => {
    setRunSeedText("daily:2026-07-26");
    for (let lvl = 1; lvl < ROTATION_MIN_LEVEL; lvl++) {
      expect(pickMapRotation(`L${lvl}`, lvl)).toBe(0);
    }
  });

  it("returns a valid rotation for rotatable levels", () => {
    setRunSeedText("daily:2026-07-26");
    const r = pickMapRotation("L7", 7);
    expect([0, 1, 2, 3]).toContain(r);
  });

  it("is deterministic under a run seed (same seed → same rotation)", () => {
    setRunSeedText("seed-abc");
    const a = pickMapRotation("L12", 12);
    setRunSeedText("seed-abc");
    const b = pickMapRotation("L12", 12);
    expect(a).toBe(b);
  });
});
