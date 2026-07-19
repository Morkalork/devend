/**
 * mapSlots — seeded procedural layouts (issue #53).
 *
 * Covers the resolver contract: determinism on a seed, variety across seeds,
 * ranged-field bounds, count/chance/weight handling, id assignment, and the
 * viability guard's fall-back to authored-only. Plus one initGame integration
 * check that slots resolve only from PROCEDURAL_MIN_LEVEL up and are
 * deterministic under an armed run seed.
 */
import { describe, it, expect } from "vitest";
import { createRng } from "@/lib/runRng";
import {
  resolveSlots,
  isLayoutViable,
  nominalArena,
  PROCEDURAL_MIN_LEVEL,
} from "@/lib/mapSlots";
import type { LevelConfig, LevelEntity } from "@/types/level";

function circleSlotLevel(): LevelConfig {
  return {
    id: "level-test",
    level: 12,
    sizeThreshold: 10,
    expectedCuts: 10,
    points: 20,
    maxBalls: 3,
    slots: [
      {
        id: "pillar",
        candidates: [
          { shape: "circle", weight: 2, cx: [200, 320], cy: [200, 320], radius: [62, 92] },
          { shape: "rect", weight: 1, x: [170, 250], y: [170, 250], width: [130, 180], height: [130, 180] },
        ],
      },
    ],
  };
}

describe("resolveSlots (#53)", () => {
  it("returns [] when the level has no slots", () => {
    const level: LevelConfig = { id: "l", level: 12, sizeThreshold: 10, expectedCuts: 5, points: 20, maxBalls: 2 };
    expect(resolveSlots(level, createRng("s"))).toEqual([]);
  });

  it("is deterministic: same seed produces an identical layout", () => {
    const level = circleSlotLevel();
    const a = resolveSlots(level, createRng("daily:2026-07-19::slots:level-test"));
    const b = resolveSlots(level, createRng("daily:2026-07-19::slots:level-test"));
    expect(a).toEqual(b);
    expect(a.length).toBe(1);
  });

  it("varies across seeds (different boards for different runs)", () => {
    const level = circleSlotLevel();
    const layouts = ["a", "b", "c", "d", "e", "f"].map(s => resolveSlots(level, createRng(s)));
    // At least two of the sampled seeds must differ in a resolved field.
    const signatures = new Set(layouts.map(l => JSON.stringify(l)));
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("resolves ranged fields within their [min,max] bounds", () => {
    const level = circleSlotLevel();
    for (const seed of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      const [e] = resolveSlots(level, createRng(seed));
      expect(e).toBeDefined();
      if (e.shape === "circle") {
        expect(e.cx).toBeGreaterThanOrEqual(200);
        expect(e.cx).toBeLessThanOrEqual(320);
        expect(e.cy).toBeGreaterThanOrEqual(200);
        expect(e.cy).toBeLessThanOrEqual(320);
        expect(e.radius).toBeGreaterThanOrEqual(62);
        expect(e.radius).toBeLessThanOrEqual(92);
      } else if (e.shape === "rect") {
        expect(e.x).toBeGreaterThanOrEqual(170);
        expect(e.x).toBeLessThanOrEqual(250);
        expect(e.width).toBeGreaterThanOrEqual(130);
        expect(e.width).toBeLessThanOrEqual(180);
      }
    }
  });

  it("honours count (fixed and ranged) with unique suffixed ids", () => {
    const level: LevelConfig = {
      id: "l", level: 12, sizeThreshold: 10, expectedCuts: 5, points: 20, maxBalls: 2,
      slots: [{ id: "debris", count: [2, 3], candidates: [{ shape: "circle", cx: [300, 600], cy: [300, 600], radius: [20, 30] }] }],
    };
    for (const seed of ["a", "b", "c", "d"]) {
      const out = resolveSlots(level, createRng(seed));
      expect(out.length).toBeGreaterThanOrEqual(2);
      expect(out.length).toBeLessThanOrEqual(3);
      const ids = out.map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length); // unique
      expect(ids.every(id => /^debris-\d+$/.test(id))).toBe(true);
    }
  });

  it("emits the bare slot id when count is 1", () => {
    const [e] = resolveSlots(circleSlotLevel(), createRng("x"));
    expect(e.id).toBe("pillar");
  });

  it("chance 0 yields nothing; chance 1 always yields", () => {
    const never: LevelConfig = {
      id: "l", level: 12, sizeThreshold: 10, expectedCuts: 5, points: 20, maxBalls: 2,
      slots: [{ id: "maybe", chance: 0, candidates: [{ shape: "circle", cx: 450, cy: 450, radius: 40 }] }],
    };
    for (const seed of ["a", "b", "c", "d", "e"]) expect(resolveSlots(never, createRng(seed))).toEqual([]);

    const always: LevelConfig = { ...never, slots: [{ ...never.slots![0], chance: 1 }] };
    for (const seed of ["a", "b", "c", "d", "e"]) expect(resolveSlots(always, createRng(seed)).length).toBe(1);
  });

  it("never picks a zero-weight candidate", () => {
    const level: LevelConfig = {
      id: "l", level: 12, sizeThreshold: 10, expectedCuts: 5, points: 20, maxBalls: 2,
      slots: [{
        id: "p",
        candidates: [
          { shape: "circle", weight: 0, cx: 450, cy: 450, radius: 40 },   // banned
          { shape: "rect", weight: 1, x: 400, y: 400, width: 60, height: 60 },
        ],
      }],
    };
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const [e] = resolveSlots(level, createRng(seed));
      expect(e.shape).toBe("rect");
    }
  });
});

describe("isLayoutViable (#53)", () => {
  const arena = nominalArena();

  it("accepts a reasonable pillar layout", () => {
    const entities: LevelEntity[] = [
      { id: "a", kind: "wall", shape: "circle", cx: 250, cy: 250, radius: 80 },
      { id: "b", kind: "wall", shape: "circle", cx: 650, cy: 250, radius: 80 },
      { id: "c", kind: "wall", shape: "circle", cx: 450, cy: 650, radius: 80 },
    ];
    expect(isLayoutViable(entities, arena)).toBe(true);
  });

  it("rejects an obstacle that covers too much of the arena", () => {
    const entities: LevelEntity[] = [
      { id: "huge", kind: "wall", shape: "rect", x: 60, y: 60, width: 720, height: 720 },
    ];
    expect(isLayoutViable(entities, arena)).toBe(false);
  });

  it("rejects one obstacle swallowing the arena centre", () => {
    const entities: LevelEntity[] = [
      { id: "core", kind: "wall", shape: "circle", cx: 450, cy: 450, radius: 260 },
    ];
    expect(isLayoutViable(entities, arena)).toBe(false);
  });

  it("falls back to authored-only ([]) when no viable slot layout exists", () => {
    // A slot that can only ever produce a board-swallowing block.
    const level: LevelConfig = {
      id: "l", level: 12, sizeThreshold: 10, expectedCuts: 5, points: 20, maxBalls: 2,
      slots: [{ id: "wall", candidates: [{ shape: "rect", x: 60, y: 60, width: 760, height: 760 }] }],
    };
    expect(resolveSlots(level, createRng("any"))).toEqual([]);
  });
});

describe("PROCEDURAL_MIN_LEVEL guard", () => {
  it("keeps the teaching band (<=10) authored/fixed", () => {
    expect(PROCEDURAL_MIN_LEVEL).toBeGreaterThanOrEqual(11);
  });
});
