/**
 * The fill stops where the obstacle does.
 *
 * Reported from a phone screenshot of level 13: the two round bumpers each sat
 * in a dark rounded SQUARE a good deal wider than the bumper. Two separate
 * faults, one on top of the other.
 *
 *   THE GRID ATE A RING. createSpaceGrid sealed every obstacle edge through the
 *     FENCE rasterizer with `thickness = cellSize`, which removes every cell
 *     whose centre is within a full cell of the line - on both sides. A 46-unit
 *     bumper wore a 68-unit hole. That ring is not territory anyone captured
 *     and not territory anyone can capture, but a ball rolls straight through
 *     it, so it is the one kind of ground the board must never show as taken.
 *   THE OUTLINE NEVER ASKED THE OBSTACLE. The live-space outline snapped to
 *     fences and board edges only, so what was left of the mismatch stayed on
 *     the 15-unit lattice - which is why a CIRCLE came out square.
 *
 * So both ends are pinned here: the seal is the obstacle's own footprint, and
 * the outline drawn around it lands on the obstacle rather than on the lattice.
 */
import { describe, it, expect } from "vitest";
import {
  createSpaceGrid, CellState, obstacleSealReach, sealSegmentToGrid, gridIndexToWorld,
} from "@/lib/spaceGrid";
import { createWallsFromPolygon } from "@/lib/wallGeometry";
import { traceActiveContours, snapOutlineToWalls } from "@/lib/rendering/regionContour";
import { pointToSegmentDistance, type Polygon } from "@/lib/polygon";

const CELL = 15;
const BOARD: Polygon = { vertices: [
  { x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 },
] };

/** Level 13's bumper: radius 46, and the 64-gon initGame builds for a circle. */
const CX = 700, CY = 480, R = 46;
const circle: Polygon = { vertices: Array.from({ length: 64 }, (_, i) => {
  const a = (i / 64) * Math.PI * 2;
  return { x: CX + Math.cos(a) * R, y: CY + Math.sin(a) * R };
}) };

/** Level 13's strut, whose faces land between lattice lines on every side. */
const RECT: Polygon = { vertices: [
  { x: 250, y: 410 }, { x: 276, y: 410 }, { x: 276, y: 560 }, { x: 250, y: 560 },
] };

const boardWalls = createWallsFromPolygon(BOARD, "board");

function outlineAround(obstacles: Polygon[]): { x: number; y: number }[][] {
  const grid = createSpaceGrid(BOARD, obstacles, CELL);
  const walls = [
    ...boardWalls,
    ...obstacles.flatMap((p, i) => createWallsFromPolygon(p, `obstacle-${i}`)),
  ];
  return snapOutlineToWalls(traceActiveContours(grid), walls, CELL);
}

/** Distance from a point to a polygon's boundary, signed only by magnitude. */
function distToOutline(p: { x: number; y: number }, poly: Polygon): number {
  const vs = poly.vertices;
  let best = Infinity;
  for (let i = 0; i < vs.length; i++) {
    const d = pointToSegmentDistance(p, vs[i], vs[(i + 1) % vs.length]);
    if (d < best) best = d;
  }
  return best;
}

/** The loop of `loops` that hugs `poly`, i.e. the hole it left in the fill. */
function holeAround(loops: { x: number; y: number }[][], poly: Polygon) {
  let best: { x: number; y: number }[] | null = null;
  let bestD = Infinity;
  for (const loop of loops) {
    let d = 0;
    for (const p of loop) d += distToOutline(p, poly);
    d /= loop.length;
    if (d < bestD) { bestD = d; best = loop; }
  }
  return best!;
}

describe("the grid seals an obstacle with its own footprint", () => {
  it("leaves the ground beside a bumper playable", () => {
    const grid = createSpaceGrid(BOARD, [circle], CELL);
    // A cell the outline does not touch is playable, however close it stands.
    // The old fence-style band removed everything out to R + 15.
    let nearest = Infinity;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== CellState.ACTIVE) continue;
      const p = gridIndexToWorld(grid, i);
      nearest = Math.min(nearest, Math.hypot(p.x - CX, p.y - CY));
    }
    expect(nearest).toBeLessThan(R + obstacleSealReach(CELL));
  });

  it("never leaves a cell the outline crosses playable", () => {
    const grid = createSpaceGrid(BOARD, [circle], CELL);
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== CellState.ACTIVE) continue;
      const p = gridIndexToWorld(grid, i);
      // An ACTIVE cell's centre is outside the disc and clear of the outline by
      // more than the seal's reach: nothing partly under the bumper survives.
      expect(Math.hypot(p.x - CX, p.y - CY)).toBeGreaterThan(R);
    }
  });

  it("is still a barrier a flood cannot cross, even on the diagonal", () => {
    // The case the seal exists for: a thin diagonal mirror, laid so its faces
    // pass BETWEEN lattice centres. Nothing on it falls inside a cell's centre
    // sample, so without a seal the grid does not know it is there at all and a
    // flood crosses it as if it were open board.
    //
    // Corner to corner and out past both ends, so the only way across is
    // through it: a bar that stops short of the edge can simply be walked round.
    // Cell centres all sit at y - x = a multiple of the cell size; this band
    // occupies y - x in (4, 12), so it contains not one of them.
    const bar: Polygon = { vertices: [
      { x: -50, y: -46 }, { x: 950, y: 954 }, { x: 950, y: 962 }, { x: -50, y: -38 },
    ] };
    const grid = createSpaceGrid(BOARD, [bar], CELL);
    // Flood from the top-right corner; the bottom-left corner is on the far
    // side of the bar and must not be reached.
    const idx = (x: number, y: number) =>
      Math.floor((y - grid.originY) / CELL) * grid.width + Math.floor((x - grid.originX) / CELL);
    const seen = new Uint8Array(grid.cells.length);
    const start = idx(880, 320);
    expect(grid.cells[start]).toBe(CellState.ACTIVE);
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const i = queue.pop()!;
      const col = i % grid.width, row = (i - col) / grid.width;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const c = col + dc, r = row + dr;
        if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) continue;
        const n = r * grid.width + c;
        if (seen[n] || grid.cells[n] !== CellState.ACTIVE) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    expect(seen[idx(320, 600)]).toBe(0);
  });

  it("removes the cells a segment crosses and no others", () => {
    const grid = createSpaceGrid(BOARD, [], CELL);
    const a = { x: 100.5, y: 100.5 }, b = { x: 200.5, y: 160.5 };
    sealSegmentToGrid(grid, a, b);
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== CellState.REMOVED) continue;
      const p = gridIndexToWorld(grid, i);
      if (p.x < 0 || p.x > 900 || p.y < 0 || p.y > 900) continue; // outside the board
      expect(pointToSegmentDistance(p, a, b)).toBeLessThanOrEqual(obstacleSealReach(CELL) + 1e-9);
    }
  });

  it("keeps the count honest when it seals", () => {
    const grid = createSpaceGrid(BOARD, [circle], CELL);
    let active = 0;
    for (const c of grid.cells) if (c === CellState.ACTIVE) active++;
    expect(grid.activeCount).toBe(active);
    expect(grid.initialActiveCount).toBe(active);
  });
});

describe("the fill outline lands on the obstacle, not on the lattice", () => {
  it("draws a round bumper round", () => {
    const hole = holeAround(outlineAround([circle]), circle);
    const radii = hole.map(p => Math.hypot(p.x - CX, p.y - CY));
    // Every point on the circle to within a unit, so the hole IS the bumper.
    expect(Math.min(...radii)).toBeGreaterThan(R - 1.5);
    expect(Math.max(...radii)).toBeLessThan(R + 1.5);
  });

  it("stops flush against a strut's faces", () => {
    const hole = holeAround(outlineAround([RECT]), RECT);
    // Read the faces away from the corners, which Chaikin rounds by design.
    const leftFace = hole.filter(p => p.y > 440 && p.y < 530 && p.x < 263);
    const rightFace = hole.filter(p => p.y > 440 && p.y < 530 && p.x >= 263);
    expect(leftFace.length).toBeGreaterThan(3);
    expect(rightFace.length).toBeGreaterThan(3);
    for (const p of leftFace) expect(Math.abs(p.x - 250)).toBeLessThan(1);
    for (const p of rightFace) expect(Math.abs(p.x - 276)).toBeLessThan(1);
  });

  it("rounds an obstacle's corners by under a cell, and only its corners", () => {
    const hole = holeAround(outlineAround([RECT]), RECT);
    for (const p of hole) expect(distToOutline(p, RECT)).toBeLessThan(CELL);
  });

  it("is a big improvement on the lattice hole it starts from", () => {
    // Same grid, outline snapped to the board edges only - which is what the
    // renderer used to pass, and what left the ring.
    const grid = createSpaceGrid(BOARD, [circle], CELL);
    const raw = snapOutlineToWalls(traceActiveContours(grid), boardWalls, CELL);
    const before = holeAround(raw, circle)
      .reduce((m, p) => Math.max(m, Math.hypot(p.x - CX, p.y - CY)), 0);
    const after = holeAround(outlineAround([circle]), circle)
      .reduce((m, p) => Math.max(m, Math.hypot(p.x - CX, p.y - CY)), 0);
    expect(before - R).toBeGreaterThan(8);
    expect(after - R).toBeLessThan(1.5);
  });
});

describe("the outline snap ranks a wall by the wall, not by its line", () => {
  it("snaps a ring outside a many-sided solid onto the solid", () => {
    // The ranking bug, isolated. A point 8 units outside a 64-gon is nearer to
    // the LINE of a chord a third of the way round the circle than to the chord
    // it is standing on - that far chord won the point and then had its pull
    // cancelled by the overshoot fade, so nothing outside a circle ever snapped.
    const walls = createWallsFromPolygon(circle, "obstacle-0");
    const ring = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return { x: CX + Math.cos(a) * (R + 8), y: CY + Math.sin(a) * (R + 8) };
    });
    const out = snapOutlineToWalls([ring], walls, CELL)[0];
    for (const p of out) {
      expect(Math.abs(Math.hypot(p.x - CX, p.y - CY) - R)).toBeLessThan(1.5);
    }
  });

  it("still leaves the ground past a fence's tip alone", () => {
    // The reason "segment" mode exists: a fence stops in open space, and the
    // live side beyond its tip must not be dragged onto its line.
    const fence = [{ start: { x: 400, y: 100 }, end: { x: 400, y: 400 } }];
    const past = Array.from({ length: 9 }, (_, i) => ({ x: 380 + i * 5, y: 460 }));
    const out = snapOutlineToWalls([[...past, { x: 420, y: 800 }, { x: 380, y: 800 }]], fence, CELL)[0];
    for (let i = 0; i < past.length; i++) {
      expect(Math.abs(out[i].x - past[i].x)).toBeLessThan(0.5);
    }
  });
});
