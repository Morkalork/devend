/**
 * Issue #65 ("invincible wall / grid artifacts on level 6"): destroying a
 * breakable must not DOUBLE-register the board-grid sample points over its
 * footprint. initGame samples every board cell outside an obstacle POLYGON,
 * which includes the seal band the grid marks REMOVED around the obstacle's
 * edges. Re-adding those on the break used to duplicate the sample points, so
 * the board grid was painted twice there - a denser patch that reads as a
 * lingering wall/artifact (the reopened footprint itself is fully capturable).
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { createInitialGameData } from "@/lib/initGame";
import { processDestroysFn } from "@/lib/physics/destructibles";
import { CellState, gridIndexToWorld } from "@/lib/spaceGrid";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import { CanvasGameState } from "@/types/gameState";
import { Vector2 } from "@/types/game";

const MODS: GameModifiers = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, bonusRemovalChance: 0,
  bonusRemovalAmount: 0, extraLives: 0, extraShopItems: 0,
  shopRestockCount: 0, extraContinues: 0, extraCertificateHours: 0,
  startingCapturePercent: 0, fenceDurabilityBonus: 0, microManagerPerLock: 0,
  ballPathPredictionBounces: 0, ballPathPredictionBalls: 0, disablePushYourLuck: 0, ballFreezeDuration: 0,
  freezeUsesPerMap: 0, slowOneBallFactor: 0, freezePickups: 0, ballFreezeCount: 0, autoFreezeDuration: 0, showHighscoreProgress: 0,
  overtimePerLock: 0, overtimePerSuperiorLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0, fenceSpeedPerMapCleared: 0, underParInstantFence: 0,
  bankedSlowPer50h: 0, spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1,
  runwayInstantFenceAt: 0, runwayConcurrentFenceAt: 0, runwayFreezeAt: 0,
  spendInstantFencePerChunk: 0, spendFenceSpeedPerChunk: 0, spendCapturePerChunk: 0, spendChunkCapBonus: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0, pickupChanceBonus: 0, pickupPayoutLevel: 0,
} as GameModifiers;

// The real level-6 soft-wall (a thin, board-spanning breakable), isolated.
const LEVEL: LevelConfig = {
  id: "level-6", level: 6, sizeThreshold: 30, expectedCuts: 4, points: 20, maxBalls: 2,
  variety: 0, randomShapes: 0,
  entities: [
    { id: "soft-wall", kind: "wall", shape: "rect", x: 530, y: 100, width: 26, height: 700, breakable: true, hitsToBreak: 3, objective: true },
    { id: "nub", kind: "wall", shape: "circle", cx: 230, cy: 450, radius: 45 },
  ],
} as unknown as LevelConfig;

function makeGame(): CanvasGameState {
  const d = createInitialGameData(LEVEL, 6, MODS);
  return { ...d, pendingDestroys: [], objectDebris: [], fallingObjects: [], objectivesBroken: 0, breakBonus: 0, breakMultiplier: 1, chestLoot: [], activePlaySeconds: 0 } as unknown as CanvasGameState;
}

const key = (p: Vector2) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;

function duplicateCount(points: Vector2[]): number {
  const seen = new Set<string>();
  let dups = 0;
  for (const p of points) { const k = key(p); if (seen.has(k)) dups++; else seen.add(k); }
  return dups;
}

describe("breakable destruction does not duplicate board-grid sample points (#65)", () => {
  it("the sample set has no duplicates before OR after the break", () => {
    const game = makeGame();
    expect(duplicateCount(game.initialSamplePoints)).toBe(0);

    const d = game.destructibles.find(x => x.id === "soft-wall")!;
    d.destroyed = true; d.destroyedBy = game.balls[0]?.id ?? "b";
    game.pendingDestroys.push(d);
    processDestroysFn(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {}, onObjectDestroyed: () => {} }, 6);

    // The bug added ~100 duplicate seal-band points here.
    expect(duplicateCount(game.initialSamplePoints)).toBe(0);
  });

  it("every reopened footprint cell is represented by exactly one sample point", () => {
    const game = makeGame();
    const d = game.destructibles.find(x => x.id === "soft-wall")!;
    const vs = d.obstaclePolygon!.vertices;
    const bb = {
      minX: Math.min(...vs.map(v => v.x)), maxX: Math.max(...vs.map(v => v.x)),
      minY: Math.min(...vs.map(v => v.y)), maxY: Math.max(...vs.map(v => v.y)),
    };
    d.destroyed = true; d.destroyedBy = game.balls[0]?.id ?? "b";
    game.pendingDestroys.push(d);
    processDestroysFn(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {}, onObjectDestroyed: () => {} }, 6);

    // Footprint fully reopened (capturable), and each ACTIVE footprint cell maps
    // to a single sample point (no bare patch, no doubled patch).
    const grid = game.spaceGrid!;
    const sampleKeys = new Set(game.initialSamplePoints.map(key));
    for (let i = 0; i < grid.cells.length; i++) {
      const w = gridIndexToWorld(grid, i);
      if (w.x < bb.minX || w.x > bb.maxX || w.y < bb.minY || w.y > bb.maxY) continue;
      expect(grid.cells[i]).toBe(CellState.ACTIVE);
      expect(sampleKeys.has(key(w))).toBe(true);
    }
    expect(duplicateCount(game.initialSamplePoints)).toBe(0);
  });
});
