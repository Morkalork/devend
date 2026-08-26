/**
 * Break something and nothing of it may be left behind.
 *
 * Reported from a real session, on level 11: "once I had destroyed the
 * destructible box I still couldn't draw a fence across that space, something
 * was left dormant after I destroyed it."
 *
 * A destroyed obstacle has to disappear from five places at once, and every one
 * of them refuses a cut on its own if it is missed:
 *
 *   - `obstaclePolygons`, or it is still solid to the fence clipper
 *   - its `obstacle-<id>-edge-N` walls, or a cut started nearby is refused by a
 *     wall nobody can see
 *   - the space grid, or the ground stays REMOVED: it renders as captured and
 *     no cut may begin on it
 *   - `cutAnchorsBreakable`, or a cut whose ray happens to ANCHOR there duds
 *     silently, with the refusal landing nowhere near where the player drew
 *   - its `sealedCells`, if it was a gate: those cells are only ever reopened
 *     by the gate breaking, so missing this leaves ground that nothing left on
 *     the board can ever open
 *
 * And it has to happen down BOTH routes an obstacle leaves the board by. A ball
 * spending its hit budget queues it for `processDestroysFn`. Smashing the thing
 * a stack is resting on brings the rest down through `toppleSupportedBy`, which
 * is the route that had the hole: it detached the body and set `destroyed` by
 * hand, so a toppled gate kept its sealed area shut forever and a toppled chest
 * paid nothing. So the sweep runs both ways round.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { processDestroysFn, cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { worldToGridIndex, CellState } from "@/lib/spaceGrid";
import type { LevelData, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { Polygon } from "@/lib/polygon";

const levels = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;

const CB = { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} };

/** Anchor tolerance the input handler uses: fence thickness plus a little. */
const ANCHOR_TOLERANCE = 12;

function seedRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(level: LevelConfig): CanvasGameState {
  const game = createInitialGameData(level, level.level, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
  const g = game as unknown as Record<string, unknown>;
  for (const k of [
    "activeWalls", "pickups", "objectDebris", "debris", "fallingObjects",
    "fallingSlabs", "lockFlashes", "wallImpacts", "ballPops", "abilityFx",
    "pickupLockMarkers", "pickupFeedback", "pendingDestroys", "pendingWallBreaks",
    "pendingBeats", "firedBeats", "warnedBeats", "bossFiredPhases",
  ]) g[k] ??= [];
  g.assimilations = new Map();
  g.activePlaySeconds = 0; g.ballSpeedScale = 1; g.creepFactor = 1;
  g.breakBonus ??= 0; g.breakMultiplier ??= 1; g.objectivesBroken ??= 0;
  return game;
}

function centreOf(poly: Polygon) {
  let x = 0, y = 0;
  for (const v of poly.vertices) { x += v.x; y += v.y; }
  return { x: x / poly.vertices.length, y: y / poly.vertices.length };
}

afterEach(() => { vi.restoreAllMocks(); });

/**
 * Maps are dealt in one of four rotations and sprinkle random obstacles, so one
 * build is one sample. Three seeds per map turns "it worked once" into a rule.
 */
const SEEDS = 3;

describe("a destroyed obstacle leaves nothing behind", () => {
  for (const route of ["smashed", "toppled"] as const) {
    it(`holds on every map, for every breakable, when ${route}`, () => {
      const problems: string[] = [];
      let checked = 0;

      for (const level of levels) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          vi.spyOn(Math, "random").mockImplementation(seedRandom(seed));
          const game = build(level);
          const breakables = game.destructibles.filter(d => d.kind === "breakable" && d.obstaclePolygon);
          if (breakables.length === 0) { vi.restoreAllMocks(); continue; }

          const record = breakables.map(d => ({
            id: d.id, poly: d.obstaclePolygon!, sealed: (d.sealedCells ?? []).slice(),
          }));

          // "smashed": every breakable goes through the destroy queue.
          // "toppled": only the SUPPORTERS do, so anything resting on them has
          // to be finished off by toppleSupportedBy instead.
          let queue = breakables;
          if (route === "toppled") {
            const supporters = new Set(
              game.stackObjects.filter(s => s.supporterId).map(s => s.supporterId as string),
            );
            queue = breakables.filter(d => supporters.has(d.id));
          }
          if (queue.length === 0) { vi.restoreAllMocks(); continue; }
          for (const d of queue) { d.destroyed = true; game.pendingDestroys.push(d); }
          processDestroysFn(game, CB, level.level, DEFAULT_MODIFIERS);

          const grid = game.spaceGrid!;
          // Only the ones that actually went down. A breakable still standing
          // is supposed to still be solid.
          const gone = new Set(game.destructibles.filter(d => d.destroyed).map(d => d.id));
          for (const r of record) {
            if (!gone.has(r.id)) continue;
            checked++;
            const where = `${level.id}/seed${seed} ${r.id}`;
            const c = centreOf(r.poly);

            if (game.obstaclePolygons.includes(r.poly)) {
              problems.push(`${where}: still solid to the fence clipper`);
            }
            if (game.walls.some(w => w.id.startsWith(`obstacle-${r.id}-edge-`))) {
              problems.push(`${where}: its edge walls survive, so cuts near it are refused`);
            }
            const cell = grid.cells[worldToGridIndex(grid, c.x, c.y)];
            if (cell !== CellState.ACTIVE) {
              problems.push(`${where}: its ground is state ${cell}, not ACTIVE`);
            }
            if (cutAnchorsBreakable(game, c, c, ANCHOR_TOLERANCE)) {
              problems.push(`${where}: cuts anchoring there still dud`);
            }
            const stillSealed = r.sealed.filter(i => grid.cells[i] === CellState.REMOVED);
            if (stillSealed.length > 0) {
              problems.push(
                `${where}: ${stillSealed.length}/${r.sealed.length} cells of the area it gated`
                + " are still locked, and nothing left on the board can open them",
              );
            }
          }
          vi.restoreAllMocks();
        }
      }

      expect(checked, "no breakable was destroyed at all - vacuous").toBeGreaterThan(0);
      expect([...new Set(problems)].join("\n") || "none", `${problems.length} leftovers`).toBe("none");
    });
  }
});
