/**
 * Spatial wall index (wallGrid.ts) — the broad-phase for the per-ball wall
 * collision loop. Two things must hold for it to be a safe drop-in:
 *
 *  1. SUPERSET: a query never misses a wall within its radius (a false negative
 *     would let a ball tunnel through a fence). False positives are fine.
 *  2. EQUIVALENCE: feeding updateBall the queried candidates (in ascending
 *     wall order) produces bit-identical physics to scanning every wall — even
 *     in corners where a ball resolves against several walls in one step.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({ playWallHitSound: () => {}, playBossJumpSound: () => {}, playBossLandSound: () => {} }));
vi.mock("@/lib/gameHaptics", () => ({ vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {} }));

import { rebuildWallGrid, queryWallsNear } from "@/lib/physics/wallGrid";
import { updateBall } from "@/lib/physics/updateBall";
import { createBallEffectState } from "@/lib/ballEffects";
import { createRectPolygon } from "@/lib/polygon";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import type { Wall } from "@/lib/wallGeometry";
import type { Ball, Vector2 } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";

// ── helpers ────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seg(id: string, x1: number, y1: number, x2: number, y2: number, thickness = 6): Wall {
  return { id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness } as unknown as Wall;
}

/** Exact distance from a point to a segment (the ground truth for the superset). */
function pointSegDist(px: number, py: number, w: Wall): number {
  const ax = w.start.x, ay = w.start.y, bx = w.end.x, by = w.end.y;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const BOARD = createRectPolygon(0, 0, 600, 400);

/** A box of board edges plus a scattering of interior fences. */
function makeWalls(rng: () => number, count: number): Wall[] {
  const walls: Wall[] = [
    seg("board-0", 0, 0, 600, 0, 0),
    seg("board-1", 600, 0, 600, 400, 0),
    seg("board-2", 600, 400, 0, 400, 0),
    seg("board-3", 0, 400, 0, 0, 0),
  ];
  for (let i = 0; i < count; i++) {
    const x = 40 + rng() * 520, y = 40 + rng() * 320;
    const horizontal = rng() < 0.5;
    const half = 20 + rng() * 80;
    walls.push(
      horizontal
        ? seg(`fence-${i}`, x - half, y, x + half, y)
        : seg(`fence-${i}`, x, y - half, x, y + half),
    );
  }
  return walls;
}

function makeBall(x: number, y: number, vx: number, vy: number, radius = 12): Ball {
  const speed = Math.hypot(vx, vy);
  return {
    id: "b", position: { x, y }, velocity: { x: vx, y: vy }, radius,
    speed, baseSpeed: speed, topSpeed: 600, minimumSpeed: 80,
    color: "#fff", regionId: "r", rotation: 0, flashIntensity: 0,
    effects: createBallEffectState(), state: "active", wonSpinSpeed: 0, wonTime: 0,
    assimScale: 1, assimColorFade: 0, typeId: "red", ability: "none",
    lockMultiplier: 1, spawnTime: 0,
  } as unknown as Ball;
}

function makeGame(walls: Wall[], ball: Ball): CanvasGameState {
  return {
    boardPolygon: BOARD, obstaclePolygons: [], mirrorPolygons: [], walls,
    movers: [], regions: [], creepFactor: 1, balls: [ball],
    pendingWallBreaks: [], pendingDestroys: [], phasingObjects: [],
  } as unknown as CanvasGameState;
}

// ── 1. superset property ─────────────────────────────────────────────────────

describe("queryWallsNear returns a superset (no false negatives)", () => {
  it("includes every wall within the query radius, across many random layouts", () => {
    const rng = mulberry32(1234);
    const out: Wall[] = [];
    for (let trial = 0; trial < 400; trial++) {
      const walls = makeWalls(rng, 30);
      const grid = rebuildWallGrid(null, walls, BOARD);
      const px = rng() * 600, py = rng() * 400;
      const radius = 5 + rng() * 60;
      queryWallsNear(grid, px, py, radius, out);
      const returned = new Set(out.map(w => w.id));
      for (const w of walls) {
        if (pointSegDist(px, py, w) <= radius) {
          expect(returned.has(w.id), `wall ${w.id} within ${radius} of (${px},${py}) must be returned`).toBe(true);
        }
      }
    }
  });

  it("returns each spanning wall exactly once (deduped)", () => {
    // A long wall crossing many cells must not appear multiple times.
    const walls = [seg("long", 10, 200, 590, 200)];
    const grid = rebuildWallGrid(null, walls, BOARD);
    const out: Wall[] = [];
    queryWallsNear(grid, 300, 200, 50, out);
    expect(out.filter(w => w.id === "long").length).toBe(1);
  });

  it("returns candidates in ascending wall-index order", () => {
    const walls = makeWalls(mulberry32(7), 40);
    const grid = rebuildWallGrid(null, walls, BOARD);
    const out: Wall[] = [];
    queryWallsNear(grid, 300, 200, 400, out); // huge radius -> most walls
    const indices = out.map(w => walls.indexOf(w));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it("is empty for a query far outside the populated area", () => {
    const walls = [seg("f", 100, 100, 100, 200)];
    const grid = rebuildWallGrid(null, walls, BOARD);
    const out: Wall[] = [];
    queryWallsNear(grid, 590, 390, 5, out);
    expect(out).toHaveLength(0);
  });

  it("reuses its buffers when rebuilt at the same wall count (the per-frame steady state)", () => {
    const walls = makeWalls(mulberry32(3), 20);
    const g1 = rebuildWallGrid(null, walls, BOARD);
    const g2 = rebuildWallGrid(g1, walls, BOARD); // next frame, walls unchanged
    expect(g2).toBe(g1); // same object -> no per-frame allocation
  });

  it("stays correct after wall churn (a cut adds a fence)", () => {
    const walls = makeWalls(mulberry32(3), 20);
    const g1 = rebuildWallGrid(null, walls, BOARD);
    const grown = [...walls, seg("added", 300, 50, 300, 350)];
    const g2 = rebuildWallGrid(g1, grown, BOARD);
    const out: Wall[] = [];
    queryWallsNear(g2, 300, 200, 10, out);
    expect(out.map(w => w.id)).toContain("added");
  });
});

// ── 2. behavioral equivalence with the brute-force scan ───────────────────────

/** Run N substeps and record the ball's position each step. */
function trajectory(walls: Wall[], ball: Ball, useGrid: boolean, steps: number): Vector2[] {
  const game = makeGame(walls, ball);
  game.wallGrid = useGrid ? rebuildWallGrid(null, walls, BOARD) : null;
  const path: Vector2[] = [];
  for (let i = 0; i < steps; i++) {
    updateBall(ball, PHYSICS_STEP, game);
    path.push({ x: ball.position.x, y: ball.position.y });
  }
  return path;
}

describe("updateBall wall collisions are identical with and without the index", () => {
  it("produces bit-identical trajectories across many random layouts and headings", () => {
    for (let seed = 0; seed < 25; seed++) {
      const rng = mulberry32(1000 + seed);
      const walls = makeWalls(rng, 25);
      const x = 100 + rng() * 400, y = 80 + rng() * 240;
      const ang = rng() * Math.PI * 2, spd = 250 + rng() * 250;
      const vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd;

      const brute = trajectory(walls, makeBall(x, y, vx, vy), false, 500);
      const indexed = trajectory(walls, makeBall(x, y, vx, vy), true, 500);

      for (let i = 0; i < brute.length; i++) {
        expect(indexed[i].x, `seed ${seed} step ${i} x`).toBe(brute[i].x);
        expect(indexed[i].y, `seed ${seed} step ${i} y`).toBe(brute[i].y);
      }
    }
  });

  it("resolves a corner (two walls in one step) identically", () => {
    // An inward corner the ball drives straight into: it must bounce off both
    // the vertical and horizontal fence in the same step. Order matters, so a
    // mis-ordered candidate list would diverge here.
    const walls = [
      seg("board-0", 0, 0, 600, 0, 0), seg("board-1", 600, 0, 600, 400, 0),
      seg("board-2", 600, 400, 0, 400, 0), seg("board-3", 0, 400, 0, 0, 0),
      seg("v", 400, 100, 400, 300), seg("h", 200, 300, 400, 300),
    ];
    const brute = trajectory(walls, makeBall(360, 260, 300, 220), false, 300);
    const indexed = trajectory(walls, makeBall(360, 260, 300, 220), true, 300);
    for (let i = 0; i < brute.length; i++) {
      expect(indexed[i].x).toBe(brute[i].x);
      expect(indexed[i].y).toBe(brute[i].y);
    }
  });
});
