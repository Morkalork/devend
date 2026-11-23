/**
 * The cover over claimed ground leaves the ball's pocket open.
 *
 * Reported from play on map 2, four times over, as "a pocket with nothing
 * left in it that will not lock": the count stuck short of nine and no brick
 * to be seen. The bricks were there. Once the fences closed all the way round
 * the ball, the claimed ground was one piece with the pocket as a HOLE in it,
 * and the 2D cover drew every outline into one fill. Pixi 8 fills a second
 * poly() instead of punching it, so the pocket was painted over, bricks and
 * all, and the 3D board (whose surfaces sample that cover) showed them as a
 * faint flat picture under the claimed colour.
 *
 * Nothing here can look at pixels, so two halves: the shape handed to the
 * renderers has the pocket as a hole, and the cover draws holes as cuts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { filledGround } from "@/lib/rendering/filledGround";
import { pointInPolygon, type Polygon } from "@/lib/polygon";
import type { LevelConfig } from "@/types/level";
import { LADDER, byLevel } from "./fixtures/maps";

describe("claimed ground closed all the way round the ball", () => {
  it("is one piece with the pocket as a hole, the bricks inside the hole", () => {
    installClock();
    setRunSeedText("cover");
    try {
      const level = { ...(byLevel(LADDER, 2) as LevelConfig), timeLimit: 300 } as LevelConfig;
      const ctx = createBotGame(level, 2, plainModifiers({ spawnFreezeSeconds: 9999 }), { lives: 3 });
      const g = ctx.game;
      for (const b of g.balls) {
        b.position = { x: 396, y: 562 };
      }
      // The three fences of the report: one across above the block, two
      // slanting down to meet under it.
      const cuts: [number, number, number, number][] = [[300, 354, 1, 0], [503, 600, -0.507, 0.862], [200, 513, 0.748, 0.664]];
      for (const [x, y, dx, dy] of cuts) {
        expect(tryCut(ctx, { x, y }, { x: dx, y: dy })).toBe(true);
        for (let n = 0; g.activeWalls.length > 0 && n < 3000; n++) {
          stepBot(ctx);
        }
      }
      const ground = filledGround(g)!;
      const withHoles = ground.shapes.filter(s => s.holes.length > 0);
      expect(withHoles).toHaveLength(1);
      const hole: Polygon = { vertices: withHoles[0].holes[0] } as Polygon;
      const bricks = (g.destructibles ?? []).filter(d => !d.destroyed && !d.buried);
      expect(bricks).toHaveLength(9);
      for (const d of bricks) {
        const vs = d.obstaclePolygon!.vertices;
        const centre = { x: vs.reduce((s, v) => s + v.x, 0) / vs.length, y: vs.reduce((s, v) => s + v.y, 0) / vs.length };
        expect(pointInPolygon(centre, hole), `${d.id} stands in the open pocket`).toBe(true);
      }
    } finally {
      releaseClock();
    }
  });

  it("is drawn piece by piece with its holes CUT, never as loops sharing one fill", () => {
    const src = readFileSync(resolve(__dirname, "../lib/rendering/sleek/boardLayer.ts"), "utf8");
    const cover = src.slice(src.indexOf("private drawCover"));
    // The fill and the lock tints both walk shapes and cut each hole.
    expect(cover).toMatch(/for \(const shape of ground\.shapes\)/);
    expect(cover).toMatch(/this\.coverFill\.poly\(project\(hole\)\);\s*this\.coverFill\.cut\(\);/);
    expect(cover).toMatch(/this\.coverLocked\.poly\(project\(hole\)\);\s*this\.coverLocked\.cut\(\);/);
    // The shape that painted the pocket over: every loop, then one fill.
    expect(cover).not.toMatch(/for \(const loop of loops\) \{\s*this\.coverFill\.poly\(loop\);\s*\}\s*this\.coverFill\.fill/);
  });
});

describe("an outline near a brick", () => {
  it("is never pulled onto the brick's face", async () => {
    const { snapOutlineToWalls } = await import("@/lib/rendering/regionContour");
    // A claimed edge running along y=380, 12 units above a brick whose top is
    // at y=392. Snapped to the brick it would drop onto 392: the tab of
    // claimed colour reported from play on map 2.
    const loop: { x: number; y: number }[] = [];
    for (let x = 300; x <= 420; x += 5) {
      loop.push({ x, y: 380 });
    }
    loop.push({ x: 420, y: 300 }, { x: 300, y: 300 });
    const brickTop = { start: { x: 352, y: 392 }, end: { x: 412, y: 392 }, brittle: true };
    const [snapped] = snapOutlineToWalls([loop], [brickTop], 15);
    expect(snapped.every(p => p.y <= 380)).toBe(true);
    // The same line as a solid wall still snaps, as it always has.
    const [solid] = snapOutlineToWalls([loop], [{ ...brickTop, brittle: false }], 15);
    expect(solid.some(p => p.y > 385)).toBe(true);
  });
});
