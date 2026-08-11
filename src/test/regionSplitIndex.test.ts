/**
 * The spatial index in findSubRegionsGrid is a pure speed change: it must return
 * exactly what the brute-force scan returns.
 *
 * That matters more than the speed does. This split decides which region each
 * ball belongs to, so a wall the index fails to return is not a slow frame - it
 * is samples connecting straight through a fence, two halves of a cut merging
 * back into one region, and balls reassigned to the wrong side.
 *
 * So rather than assert a hand-written expectation, run BOTH paths over the same
 * layouts and require them to agree. The optimisation is only correct if the
 * answer never moves.
 */
import { describe, it, expect } from "vitest";
import { findSubRegionsGrid, SAMPLE_GRID_SIZE } from "@/lib/regionSplit";
import { rebuildWallGrid } from "@/lib/physics/wallGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { Wall } from "@/lib/wallGeometry";
import type { Ball, Region } from "@/types/game";

const board = createRectPolygon(45, 45, 855, 855);

const region = (): Region => ({
  id: "r1", polygon: board, estimatedArea: 810 * 810, samplePoints: [],
} as unknown as Region);

const ball = (x: number, y: number): Ball => ({
  id: `b-${x}-${y}`, state: "active", speed: 200, radius: 18,
  position: { x, y }, velocity: { x: 1, y: 0 }, regionId: "r1",
} as unknown as Ball);

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 6 }) as Wall;

/** Board edges plus whatever fences the scenario adds. */
function withEdges(...fences: Wall[]): Wall[] {
  return [
    wall("board-0", 45, 45, 855, 45),
    wall("board-1", 855, 45, 855, 855),
    wall("board-2", 855, 855, 45, 855),
    wall("board-3", 45, 855, 45, 45),
    ...fences,
  ];
}

/** Compare shape: component sizes and ball-ownership flags, order-independent. */
function shape(subs: { samples: { x: number; y: number }[]; hasBalls: boolean }[]) {
  return subs
    .map(s => `${s.samples.length}:${s.hasBalls}`)
    .sort()
    .join("|");
}

function agree(walls: Wall[], balls: Ball[]): void {
  const plain = findSubRegionsGrid(region(), balls, walls);
  const indexed = findSubRegionsGrid(region(), balls, walls, rebuildWallGrid(null, walls, board));
  expect(shape(indexed)).toBe(shape(plain));
}

describe("indexed region split matches the brute-force scan", () => {
  it("agrees on an empty board", () => {
    agree(withEdges(), [ball(400, 400)]);
  });

  it("agrees on a single fence splitting the board in two", () => {
    agree(withEdges(wall("f1", 450, 45, 450, 855)), [ball(200, 400), ball(700, 400)]);
  });

  it("agrees when one side has no ball (the capture case)", () => {
    agree(withEdges(wall("f1", 450, 45, 450, 855)), [ball(200, 400)]);
  });

  it("agrees on a diagonal fence, where samples straddle the line", () => {
    agree(withEdges(wall("f1", 45, 45, 855, 855)), [ball(200, 600), ball(600, 200)]);
  });

  it("agrees on a busy late-map board with many fences", () => {
    const fences: Wall[] = [];
    for (let i = 1; i <= 8; i++) {
      const p = 45 + (810 * i) / 9;
      fences.push(wall(`v${i}`, p, 45, p, 420));
      fences.push(wall(`h${i}`, 45, p, 420, p));
    }
    agree(withEdges(...fences), [ball(600, 600), ball(120, 700)]);
  });

  // A fence landing between two adjacent samples is the case the index must not
  // miss: the query radius has to cover a full diagonal neighbour step.
  it("agrees when a fence sits between neighbouring samples", () => {
    const mid = 45 + SAMPLE_GRID_SIZE * 20 + SAMPLE_GRID_SIZE / 2;
    agree(withEdges(wall("f1", mid, 45, mid, 855)), [ball(200, 400), ball(700, 400)]);
  });

  it("agrees when a pocket is sealed off entirely", () => {
    agree(
      withEdges(
        wall("f1", 600, 45, 600, 300),
        wall("f2", 600, 300, 855, 300),
      ),
      [ball(200, 400)],
    );
  });
});
