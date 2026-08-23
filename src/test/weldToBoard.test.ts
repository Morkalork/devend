/**
 * Obstacles staying attached to the wall they were authored against.
 *
 * Reported once the board got a frame: slabs that clearly meant to meet the
 * outer wall stopped a hair short of it. The cause is not the frame and not the
 * map data - every authored rect either meets the play boundary exactly or is
 * well clear of it. It is variety: applyRectVariation jitters width and height
 * around the CENTRE, so an edge placed deliberately on the wall drifts inward
 * or outward by whatever the run seed draws.
 *
 * Measured on the real level-25 bar at its authored variety: up to 17 world
 * units off the wall, which is nearly three times the wall's own thickness.
 * Small enough to read as a rendering slip and large enough to see.
 */
import { describe, it, expect } from "vitest";
import { weldRectToBoard } from "@/lib/weldToBoard";
import { applyRectVariation, setRunSeed } from "@/lib/varietySystem";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig } from "@/types/level";

const LO = 45, HI = 855;   // the play area: ARENA_MARGIN of a 900 board
const weld = (a: Parameters<typeof weldRectToBoard>[0], v: Parameters<typeof weldRectToBoard>[1]) =>
  weldRectToBoard(a, v, LO, HI);

describe("an edge authored on the wall goes back on the wall", () => {
  it("re-pins the right edge and lets the left absorb the variation", () => {
    const authored = { x: 555, y: 400, width: 300, height: 32 };   // right edge at 855
    const varied = { x: 545, y: 400, width: 290, height: 32 };     // drifted to 835
    const w = weld(authored, varied);
    expect(w.x + w.width, "right edge back on the boundary").toBeCloseTo(HI, 9);
    expect(w.x, "the far edge keeps what variety gave it").toBeCloseTo(545, 9);
  });

  it("re-pins the left edge the same way", () => {
    const authored = { x: 45, y: 400, width: 300, height: 32 };
    const varied = { x: 60, y: 400, width: 280, height: 32 };
    const w = weld(authored, varied);
    expect(w.x).toBeCloseTo(LO, 9);
    expect(w.x + w.width, "far edge untouched").toBeCloseTo(340, 9);
  });

  it("re-pins top and bottom, not just the horizontal", () => {
    const top = weld(
      { x: 300, y: 45, width: 32, height: 300 },
      { x: 300, y: 58, width: 32, height: 280 },
    );
    expect(top.y).toBeCloseTo(LO, 9);
    const bottom = weld(
      { x: 300, y: 555, width: 32, height: 300 },
      { x: 300, y: 545, width: 32, height: 290 },
    );
    expect(bottom.y + bottom.height).toBeCloseTo(HI, 9);
  });

  /** A bar spanning the whole board has nowhere left to put the variation. */
  it("keeps a wall-to-wall bar exactly as authored", () => {
    const authored = { x: 45, y: 400, width: 810, height: 32 };
    const w = weld(authored, { x: 70, y: 400, width: 760, height: 32 });
    expect(w.x).toBeCloseTo(LO, 9);
    expect(w.x + w.width).toBeCloseTo(HI, 9);
  });

  it("pins an edge authored PAST the boundary too", () => {
    // level-12's gate is authored 40..860, deliberately overshooting so it
    // clips flush. Variety must not pull it back inside.
    const authored = { x: 40, y: 400, width: 820, height: 24 };
    const w = weld(authored, { x: 60, y: 400, width: 780, height: 24 });
    expect(w.x).toBeCloseTo(40, 9);
    expect(w.x + w.width).toBeCloseTo(860, 9);
  });
});

describe("an obstacle in open board is left alone", () => {
  it("keeps every bit of its variation", () => {
    const authored = { x: 300, y: 300, width: 120, height: 120 };
    const varied = { x: 290, y: 305, width: 140, height: 110 };
    expect(weld(authored, varied)).toEqual(varied);
  });

  it("is not pinned by merely being near the wall", () => {
    // 12 units clear is a deliberate gap, not a failed join.
    const authored = { x: 57, y: 300, width: 120, height: 120 };
    const varied = { x: 60, y: 300, width: 110, height: 120 };
    expect(weld(authored, varied)).toEqual(varied);
  });
});

describe("degenerate results", () => {
  /**
   * Variation can shrink a side past its pinned edge. Emitting a negative width
   * would be read downstream as an empty shape, so the obstacle would vanish
   * from the board rather than merely look wrong.
   */
  it("falls back to the authored span rather than inverting", () => {
    const authored = { x: 555, y: 400, width: 300, height: 32 };
    const w = weld(authored, { x: 900, y: 400, width: 40, height: 32 });
    expect(w.width).toBeGreaterThan(0);
    expect(w.height).toBeGreaterThan(0);
  });

  it("never emits a non-finite number", () => {
    const authored = { x: 45, y: 45, width: 810, height: 810 };
    for (const v of [
      { x: 45, y: 45, width: 810, height: 810 },
      { x: 0, y: 0, width: 900, height: 900 },
      { x: 400, y: 400, width: 1, height: 1 },
    ]) {
      const w = weld(authored, v);
      for (const n of [w.x, w.y, w.width, w.height]) expect(Number.isFinite(n)).toBe(true);
    }
  });
});

/**
 * The measurement that started this, against the real thing rather than a
 * made-up rect: level-25's right-hand bar at its authored variety of 12.
 */
describe("the bar that was reported", () => {
  const AUTHORED = { x: 555, y: 415, width: 300, height: 32 };

  it("drifted off the wall before, and cannot now", () => {
    let worstBefore = 0, worstAfter = 0;
    for (let seed = 1; seed <= 60; seed++) {
      setRunSeed(seed);
      const v = applyRectVariation(
        AUTHORED.x, AUTHORED.y, AUTHORED.width, AUTHORED.height, 12, "level-25", "bar-right",
      );
      worstBefore = Math.max(worstBefore, Math.abs((v.x + v.width) - HI));
      const w = weld(AUTHORED, v);
      worstAfter = Math.max(worstAfter, Math.abs((w.x + w.width) - HI));
    }
    expect(worstBefore, "the probe must reproduce the drift, or it proves nothing")
      .toBeGreaterThan(5);
    expect(worstAfter).toBeLessThan(1e-9);
  });

  it("still varies where it is free to", () => {
    const widths = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      setRunSeed(seed);
      const v = applyRectVariation(
        AUTHORED.x, AUTHORED.y, AUTHORED.width, AUTHORED.height, 12, "level-25", "bar-right",
      );
      widths.add(Number(weld(AUTHORED, v).width.toFixed(3)));
    }
    // Pinning one edge must not flatten the obstacle into a fixed shape: the
    // whole point of variety is that the board differs between runs.
    expect(widths.size).toBeGreaterThan(3);
  });
});

/**
 * Through the real init, because the pure function passing proves nothing about
 * whether anything calls it. Removing the call site left every unit test above
 * green, which is the exact shape of miss this file exists to catch.
 */
describe("the weld is actually wired into obstacle construction", () => {
  const LEVEL = {
    id: "weld-probe", level: 2, sizeThreshold: 40, expectedCuts: 5, points: 20,
    maxBalls: 1, randomShapes: 0, variety: 30,
    entities: [
      // Flush to the right wall, and to the left wall, at high variety.
      { id: "bar-right", kind: "wall", shape: "rect", x: 555, y: 400, width: 300, height: 32 },
      { id: "bar-left", kind: "wall", shape: "rect", x: 45, y: 600, width: 300, height: 32 },
      // Clear of both: must keep varying.
      { id: "island", kind: "wall", shape: "rect", x: 350, y: 200, width: 120, height: 120 },
    ],
  } as unknown as LevelConfig;

  const boundsOf = (verts: { x: number; y: number }[]) => ({
    minX: Math.min(...verts.map(v => v.x)), maxX: Math.max(...verts.map(v => v.x)),
    minY: Math.min(...verts.map(v => v.y)), maxY: Math.max(...verts.map(v => v.y)),
  });

  it("leaves no sliver between a flush obstacle and the wall", () => {
    for (let seed = 1; seed <= 12; seed++) {
      setRunSeed(seed);
      const data = createInitialGameData(LEVEL, 2, DEFAULT_MODIFIERS);
      const polys = data.obstaclePolygons.map(p => boundsOf(p.vertices));
      const right = polys.find(b => b.maxX > 700);
      const left = polys.find(b => b.minX < 200 && b.maxY > 500);
      expect(right, `seed ${seed}: right bar missing`).toBeTruthy();
      expect(left, `seed ${seed}: left bar missing`).toBeTruthy();
      // Within a unit of the play boundary: the decoration pass can round a
      // vertex, but it cannot leave a visible gap.
      expect(Math.abs(right!.maxX - HI), `seed ${seed}: right gap`).toBeLessThan(1);
      expect(Math.abs(left!.minX - LO), `seed ${seed}: left gap`).toBeLessThan(1);
    }
  });

  it("still varies the obstacle that touches nothing", () => {
    const widths = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      setRunSeed(seed);
      const data = createInitialGameData(LEVEL, 2, DEFAULT_MODIFIERS);
      const island = data.obstaclePolygons
        .map(p => boundsOf(p.vertices))
        .find(b => b.minX > 250 && b.maxX < 600 && b.maxY < 400);
      if (island) widths.add(Number((island.maxX - island.minX).toFixed(2)));
    }
    expect(widths.size, "welding must not freeze the whole board").toBeGreaterThan(2);
  });
});
