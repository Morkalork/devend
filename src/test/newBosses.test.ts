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
import { Ball } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { Wall } from "@/lib/wallGeometry";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";

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
