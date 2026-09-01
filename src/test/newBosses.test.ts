/**
 * Issue #64: the introduced ball gifts (big / chained / black), the boss pair
 * spawn + fence-breaking chain, black-ball fence fracture, and the periodic
 * fence-wipe attack timing.
 */
import { describe, it, expect, vi } from "vitest";
// Explicit no-op mocks (a Proxy hides the named exports vitest binds against).
vi.mock("@/lib/gameAudio", () => ({
  playWallHitSound: () => {}, playBallCollideSound: () => {}, playFenceBreakSound: () => {},
  playDeathSound: () => {}, playBallLockSound: () => {}, playCutClaimedSound: () => {},
  playPickupClaimedSound: () => {}, playBossJumpSound: () => {}, playHeartbeatSound: () => {},
  playBossChargeSound: () => {}, playBossLandSound: () => {}, playLevelCompleteSound: () => {},
  setAudioMuted: () => {}, setSfxVolume: () => {}, getSfxVolume: () => 1,
  isAudioMuted: () => false, initAudio: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {}, vibrateDeath: () => {},
  vibrateBallLock: () => {}, setHapticsEnabled: () => {}, isHapticsEnabled: () => false,
}));

import { canAnchorChain, BIG_BALL_RADIUS_SCALE, CHAINED_MIN_LEVEL, BIG_BALL_MIN_LEVEL } from "@/lib/ballGifts";
import { getBallType, getEligibleBallTypes } from "@/lib/ballTypes";
import { registerFenceFracture } from "@/lib/physics/breakFenceWall";
import { tickBossFenceWipe } from "@/lib/physics/bossPhases";
import { createInitialGameData } from "@/lib/initGame";
import { checkAndUpdateBallWonStates } from "@/lib/physics/checkBallWonState";
import { CellState, worldToGridIndex } from "@/lib/spaceGrid";
import { lineSegmentIntersection, pointInPolygon } from "@/lib/polygon";
import { Ball } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { Wall } from "@/lib/wallGeometry";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";

const MODS: GameModifiers = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, extraLives: 0, extraShopItems: 0,
  shopRestockCount: 0, extraAbilityOffers: 0, freeAbilityPerStore: 0, extraContinues: 0, extraCertificateHours: 0,
  startingCapturePercent: 0, fenceDurabilityBonus: 0, microManagerPerLock: 0,
  fastestBallSlowPercent: 0,
  ballPathPredictionBounces: 0, ballPathPredictionBalls: 0, disablePushYourLuck: 0, ballFreezeDuration: 0,
  freezeUsesPerMap: 0, slowOneBallFactor: 0, freezePickups: 0, ballFreezeCount: 0, autoFreezeDuration: 0, showHighscoreProgress: 0,
  overtimePerLock: 0, overtimePerSuperiorLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0, gravityLockBonus: 0, gravityBendMultiplier: 1,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0, fenceSpeedPerMapCleared: 0, underParInstantFence: 0,
  bankedSlowPer50h: 0, spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1,
  runwayInstantFenceAt: 0, runwayConcurrentFenceAt: 0, runwayFreezeAt: 0,
  spendInstantFencePerChunk: 0, spendFenceSpeedPerChunk: 0, spendCapturePerChunk: 0, spendChunkCapBonus: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0, pickupChanceBonus: 0, pickupPayoutLevel: 0,
} as GameModifiers;

describe("ball gifts config (#64)", () => {
  it("only yellow and purple can anchor a chain", () => {
    expect(canAnchorChain("variableSpeed")).toBe(true); // yellow
    expect(canAnchorChain("slowOthers")).toBe(true);    // purple
    expect(canAnchorChain("none")).toBe(false);
    expect(canAnchorChain("breakObjects")).toBe(false); // black
    expect(BIG_BALL_RADIUS_SCALE).toBeGreaterThan(1);
    expect(CHAINED_MIN_LEVEL).toBeGreaterThan(BIG_BALL_MIN_LEVEL);
  });

  it("the black ball is enabled and foreshadows the L30 boss (unlock 25)", () => {
    const black = getBallType("black");
    expect(black).toBeDefined();
    expect(black!.ability).toBe("breakObjects");
    expect(black!.unlockLevel).toBe(25);
    expect(getEligibleBallTypes(25).some(t => t.id === "black")).toBe(true);
    expect(getEligibleBallTypes(24).some(t => t.id === "black")).toBe(false);
  });
});

describe("boss pair spawn (#64)", () => {
  const PAIR_LEVEL: LevelConfig = {
    id: "pair-test", level: 20, sizeThreshold: 20, expectedCuts: 5, points: 20,
    maxBalls: 1, variety: 0, randomShapes: 0,
    coloredAreas: [{ kind: "var", x: 500, y: 45, width: 355, height: 335 }],
    boss: {
      name: "Pair", intro: "x",
      objective: { id: "d", name: "d", description: "d", kind: "defeatBoss", reward: 10 },
      bossBall: { hp: 1, count: 2, chained: true, radiusScale: 1.6 },
    },
  } as unknown as LevelConfig;

  it("spawns two boss balls linked by a fence-breaking chain", () => {
    const data = createInitialGameData(PAIR_LEVEL, 20, MODS);
    const bosses = data.balls.filter(b => b.isBoss);
    expect(bosses.length).toBe(2);
    expect(data.chains.length).toBe(1);
    expect(data.chains[0].breaksFences).toBe(true);
    const ids = new Set(bosses.map(b => b.id));
    expect(ids.has(data.chains[0].aId) && ids.has(data.chains[0].bId)).toBe(true);
  });

  it("a phasing entity becomes a registered phasing object", () => {
    const LVL = { ...PAIR_LEVEL, id: "phase-test", entities: [
      { id: "pp", kind: "wall", shape: "circle", cx: 300, cy: 430, radius: 55, isPhasing: true },
    ] } as unknown as LevelConfig;
    const data = createInitialGameData(LVL, 20, MODS);
    expect(data.phasingObjects.length).toBe(1);
    expect(data.phasingObjects[0].wallIds.length).toBeGreaterThan(0);
  });

  it("the boss pair's tether is never born crossing an obstacle (#70)", () => {
    // A big central obstacle: a naive placement would routinely put the two
    // bosses on opposite sides with the tether slicing through it. The spawn
    // must re-roll until the straight tether is clear.
    const LVL = { ...PAIR_LEVEL, id: "chain-clear-test", entities: [
      { id: "block", kind: "wall", shape: "rect", x: 300, y: 300, width: 400, height: 400 },
    ] } as unknown as LevelConfig;
    for (let seed = 0; seed < 20; seed++) {
      const data = createInitialGameData(LVL, 20, MODS);
      const ch = data.chains[0];
      const a = ch.nodes[0], b = ch.nodes[ch.nodes.length - 1];
      for (const obstacle of data.obstaclePolygons) {
        const v = obstacle.vertices;
        for (let i = 0; i < v.length; i++) {
          expect(
            lineSegmentIntersection(a, b, v[i], v[(i + 1) % v.length]),
            `tether ${JSON.stringify(a)}->${JSON.stringify(b)} crosses an obstacle edge`,
          ).toBeNull();
        }
        expect(pointInPolygon(a, obstacle) || pointInPolygon(b, obstacle)).toBe(false);
      }
    }
  });
});

describe("colored area lights up when a ball locks inside it", () => {
  const AREA_LEVEL = {
    id: "area-lit", level: 10, sizeThreshold: 15, expectedCuts: 8, points: 20,
    maxBalls: 1, variety: 0, randomShapes: 0,
    coloredAreas: [{ kind: "var", x: 500, y: 45, width: 355, height: 335 }],
    boss: {
      name: "B", intro: "x",
      objective: { id: "d", name: "d", description: "d", kind: "defeatBoss", reward: 10 },
      bossBall: { hp: 1, radiusScale: 2, color: "#ff0000" },
    },
  } as unknown as LevelConfig;

  it("marks the area used for a NON-target (minion) lock, without satisfying the win gate", () => {
    const data = createInitialGameData(AREA_LEVEL, 10, MODS);
    const game = { ...data } as unknown as CanvasGameState;
    game.coloredAreaSatisfied = false;
    game.lockBonus = game.lockBonus ?? 0;
    game.superiorLockBonus = game.superiorLockBonus ?? 0;
    game.superiorLockCount = game.superiorLockCount ?? 0;
    game.lockedBallsCount = game.lockedBallsCount ?? 0;
    game.assimilations = game.assimilations ?? new Map();
    // GameCanvas populates game.coloredAreas at map load (initGame does not), so
    // set it here as the runtime does.
    game.coloredAreas = (AREA_LEVEL.coloredAreas ?? []).map(a => ({ ...a }));
    const grid = game.spaceGrid!;

    // A non-boss minion parked inside the var area (centre ~677,212).
    const mx = 677, my = 212;
    const minion = {
      id: "minion", isBoss: false, state: "active",
      position: { x: mx, y: my }, velocity: { x: 60, y: 0 }, speed: 60,
      radius: 14, lockMultiplier: 1, typeId: "red", ability: "none",
    } as unknown as Ball;
    game.balls = [...game.balls, minion];

    // Seal it into a tiny 3x3 island by carving a REMOVED ring around it, so its
    // region falls below the lock threshold and it locks this pass.
    const idx = worldToGridIndex(grid, mx, my);
    const col = idx % grid.width, row = Math.floor(idx / grid.width);
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== 2) continue; // the ring
        const c = col + dc, r = row + dr;
        if (c >= 0 && c < grid.width && r >= 0 && r < grid.height) {
          grid.cells[r * grid.width + c] = CellState.REMOVED;
        }
      }
    }

    const noop = () => {};
    checkAndUpdateBallWonStates(
      game, MODS, 0,
      { setLockedBallsCount: noop, onBallTypeLocked: () => false, onBallCountChanged: noop, onBossState: noop },
      null,
    );

    expect(minion.state).toBe("won");                    // it actually locked
    expect(game.coloredAreas![0].satisfied).toBe(true);  // ...so the zone lit up
    expect(game.coloredAreaSatisfied).toBe(false);       // but the win gate (the boss) is NOT satisfied
  });

  // Rule: a ball SEALED INSIDE a colored area locks there and activates it,
  // without having to shrink the pocket to the normal threshold first.
  //
  // This is what made areas hard to activate. The area here is 355x335 on a
  // 900x900 board - about 15% of it - so a pocket the size of the area sits at
  // or above the lock threshold and never locked. Activation already accepted a
  // ball whose centre was inside; the lock was the part that never happened.
  it("locks a ball sealed inside the area, even though the pocket is too big to lock normally", () => {
    const data = createInitialGameData(AREA_LEVEL, 10, MODS);
    const game = { ...data } as unknown as CanvasGameState;
    game.coloredAreaSatisfied = false;
    game.lockBonus = 0;
    game.superiorLockBonus = 0;
    game.superiorLockCount = 0;
    game.lockedBallsCount = 0;
    game.assimilations = new Map();
    game.coloredAreas = (AREA_LEVEL.coloredAreas ?? []).map(a => ({ ...a }));
    const grid = game.spaceGrid!;
    const area = game.coloredAreas![0];

    // Carve everything OUTSIDE the area away, so the ball's region is exactly
    // the area: sealed inside it, and far larger than the lock threshold.
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        const x = grid.originX + c * grid.cellSize + grid.cellSize / 2;
        const y = grid.originY + r * grid.cellSize + grid.cellSize / 2;
        const inside = x >= area.x && x <= area.x + area.width
          && y >= area.y && y <= area.y + area.height;
        if (!inside) grid.cells[r * grid.width + c] = CellState.REMOVED;
      }
    }

    const ball = {
      id: "ball-1", isBoss: false, state: "active",
      position: { x: area.x + area.width / 2, y: area.y + area.height / 2 },
      velocity: { x: 60, y: 0 }, speed: 60,
      radius: 14, lockMultiplier: 1, typeId: "red", ability: "none",
    } as unknown as Ball;
    game.balls = [ball];

    const noop = () => {};
    checkAndUpdateBallWonStates(
      game, MODS, 0,
      { setLockedBallsCount: noop, onBallTypeLocked: () => false, onBallCountChanged: noop, onBossState: noop },
      null,
    );

    expect(ball.state).toBe("won");
    expect(game.coloredAreas![0].satisfied).toBe(true);
  });
});

describe("black-ball fence fracture (#64)", () => {
  function game(): CanvasGameState {
    return { pendingWallBreaks: [] } as unknown as CanvasGameState;
  }
  function fence(id = "wall-1"): Wall {
    return { id, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 6 } as Wall;
  }

  it("cracks a player fence apart in three debounced hits", () => {
    const g = game();
    const w = fence();
    expect(registerFenceFracture(g, w, 0)).toBe(true);
    expect(registerFenceFracture(g, w, 100)).toBe(false); // within 250ms debounce
    expect(registerFenceFracture(g, w, 300)).toBe(true);
    expect(registerFenceFracture(g, w, 600)).toBe(true);
    expect(w.blackHits).toBe(3);
    expect(g.pendingWallBreaks).toContain(w);
    // Already shattered: no further hits register.
    expect(registerFenceFracture(g, w, 900)).toBe(false);
  });

  it("never fractures board edges or obstacle boundaries", () => {
    const g = game();
    const board = { id: "board-0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, thickness: 6, isBoardEdge: true } as Wall;
    const obstacle = { id: "obstacle-x-edge-0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, thickness: 6 } as Wall;
    expect(registerFenceFracture(g, board, 0)).toBe(false);
    expect(registerFenceFracture(g, obstacle, 0)).toBe(false);
    expect(g.pendingWallBreaks.length).toBe(0);
  });
});

describe("boss fence-wipe attack timing (#64)", () => {
  const LVL = { id: "wipe", level: 30, boss: { bossBall: { fenceWipeSeconds: 30 } } } as unknown as LevelConfig;
  function boss(): Ball {
    return { id: "boss-rc", isBoss: true, state: "active", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } } as unknown as Ball;
  }

  it("telegraphs (stop + freeze) then wipes once per interval", () => {
    const b = boss();
    const g = { balls: [b], activePlaySeconds: 0 } as unknown as CanvasGameState;
    let wipes = 0;
    const wipe = () => { wipes++; };

    tickBossFenceWipe(g, LVL, wipe, 0);         // anchors the interval
    expect(b.lastFenceWipeAt).toBe(0);
    expect(wipes).toBe(0);

    g.activePlaySeconds = 30;
    tickBossFenceWipe(g, LVL, wipe, 1000);      // due -> begin the vibrate wind-up
    expect(b.fenceWipeChargeStart).toBe(1000);
    expect(b.frozenUntil).toBeGreaterThan(1000); // stopped during the window
    expect(wipes).toBe(0);

    tickBossFenceWipe(g, LVL, wipe, 1000 + 1000); // wind-up complete -> wipe fires
    expect(wipes).toBe(1);
    expect(b.fenceWipeChargeStart).toBeUndefined();
    expect(b.lastFenceWipeAt).toBe(30);
  });
});
