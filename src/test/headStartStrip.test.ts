/**
 * A starting capture is drawn as captured ground (lib/headStartStrip.ts).
 *
 * Onboarding promised "8% of the board already captured" and initGame
 * delivered it by shrinking the play area evenly inside the arena. The
 * renderer framed and clipped the SHRUNK board, so the trimmed strip fell
 * outside the frame and nothing on screen looked captured. Reported from play
 * as "what 8% has been removed?".
 *
 * Now the frame and the clip follow the untrimmed arena, the strip inside it
 * takes the captured fill, and the trimmed edge is drawn as a fence. Physics
 * is untouched: balls still bounce off the shrunk board.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { polygonBounds } from "@/lib/polygon";
import { ARENA_MARGIN } from "@/lib/gameConstants";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { WALL_THICKNESS } from "@/lib/wallGeometry";
import {
  hasHeadStartStrip, visibleOutline, headStartFenceSegments, outwardEdges,
} from "@/lib/headStartStrip";
import type { LevelConfig } from "@/types/level";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const LEVEL: LevelConfig = {
  id: "head-start-probe", level: 1, sizeThreshold: 60, expectedCuts: 6,
  points: 5, variety: 0, randomShapes: 0, maxBalls: 1,
};

const deal = (startingCapturePercent: number) =>
  createInitialGameData(LEVEL, 1, { ...DEFAULT_MODIFIERS, startingCapturePercent });

const MARGIN = Math.min(BOARD_WIDTH, BOARD_HEIGHT) * ARENA_MARGIN;

describe("what initGame hands the renderer", () => {
  it("keeps the full arena beside the trimmed board when there is a head start", () => {
    const data = deal(8);
    expect(data.arenaPolygon, "no arena to frame, so the strip cannot show").toBeDefined();
    const arena = polygonBounds(data.arenaPolygon!);
    expect(arena).toMatchObject({
      minX: MARGIN, minY: MARGIN, maxX: BOARD_WIDTH - MARGIN, maxY: BOARD_HEIGHT - MARGIN,
    });
    // The board itself is still the smaller one: this is drawing only.
    const board = polygonBounds(data.boardPolygon);
    expect(board.minX).toBeGreaterThan(arena.minX);
    expect(board.maxX).toBeLessThan(arena.maxX);
  });

  it("sizes the strip to the head start: the ground outside the board is the 8%", () => {
    const data = deal(8);
    const a = polygonBounds(data.arenaPolygon!), b = polygonBounds(data.boardPolygon);
    const outside = 1 - ((b.maxX - b.minX) * (b.maxY - b.minY)) / ((a.maxX - a.minX) * (a.maxY - a.minY));
    expect(outside).toBeCloseTo(0.08, 5);
  });

  it("has no strip, and changes nothing, without a head start", () => {
    const data = deal(0);
    expect(data.arenaPolygon).toBeUndefined();
    const game = { boardPolygon: data.boardPolygon, arenaPolygon: null };
    expect(hasHeadStartStrip(game)).toBe(false);
    expect(visibleOutline(game)).toBe(data.boardPolygon);
    expect(headStartFenceSegments(game, WALL_THICKNESS)).toEqual([]);
  });
});

describe("where the strip is drawn", () => {
  const data = deal(8);
  const game = { boardPolygon: data.boardPolygon, arenaPolygon: data.arenaPolygon };

  it("frames and clips to the arena, so the strip is inside the board", () => {
    expect(visibleOutline(game)).toBe(data.arenaPolygon);
  });

  it("draws the trimmed edge as a fence lying in the strip, not over live ground", () => {
    const segs = headStartFenceSegments(game, WALL_THICKNESS);
    expect(segs).toHaveLength(4);
    const b = polygonBounds(data.boardPolygon);
    const half = WALL_THICKNESS / 2;
    // Each fence's CENTRE line sits half a thickness outside the board edge,
    // so its inner face is exactly where a ball bounces.
    for (const s of segs) {
      const horizontal = Math.abs(s.start.y - s.end.y) < 1e-6;
      if (horizontal) {
        const y = s.start.y;
        expect([b.minY - half, b.maxY + half].some(v => Math.abs(v - y) < 1e-6), `fence at y=${y}`).toBe(true);
      } else {
        const x = s.start.x;
        expect([b.minX - half, b.maxX + half].some(v => Math.abs(v - x) < 1e-6), `fence at x=${x}`).toBe(true);
      }
    }
  });

  it("mitres the corners: every edge runs half a thickness past both of its ends", () => {
    const square = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const top = outwardEdges(square, 3).find(s => Math.abs(s.start.y - s.end.y) < 1e-6 && s.start.y < 50)!;
    expect(top.start.y).toBeCloseTo(-3);
    expect(Math.min(top.start.x, top.end.x)).toBeCloseTo(-3);
    expect(Math.max(top.start.x, top.end.x)).toBeCloseTo(103);
  });
});

describe("the wiring", () => {
  it("clips the board to the visible outline", () => {
    const src = read("src/lib/rendering/sleek/SleekRenderer.ts");
    const mask = src.slice(src.indexOf("private syncMask("));
    expect(mask.slice(0, 600)).toMatch(/visibleOutline\(game\)/);
  });

  it("frames the visible outline and draws the trimmed edge as a fence", () => {
    const src = read("src/lib/rendering/sleek/wallLayer.ts");
    const outer = src.slice(src.indexOf("private drawOuterWall("));
    expect(outer.slice(0, 1800)).toMatch(/visibleOutline\(game\)/);
    expect(outer.slice(0, 1800)).toMatch(/headStartFenceSegments\(game, WALL_THICKNESS\)/);
  });

  it("copies the arena onto the running game, and outlines the loading placeholder with it", () => {
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src).toMatch(/game\.arenaPolygon\s*= data\.arenaPolygon \?\? null;/);
    expect(src).toMatch(/frameInCss\(game\.boardRect, visibleOutline\(game\), dpr\)/);
  });
});
