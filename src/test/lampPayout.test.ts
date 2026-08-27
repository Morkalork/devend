/**
 * What sealing the lit ball is worth, and why it cannot break the economy.
 *
 * The bonus is deliberately a QUALITY multiplier, sitting with frozen and
 * gravity inside `basePoints` rather than anywhere near `rawCapacity`. That one
 * placement is the whole safety argument and it is invisible from the outside:
 *
 *   DELIVERY is scored on rawCapacity - "did you ship the roster" - and must be
 *     untouched. A lamp bonus that leaked into it would mean a lucky lamp draw
 *     scored as having locked more balls than you did.
 *   CRAFT is scored on the premium over that raw capacity, and is capped at
 *     totalCapacity x (superiorMultiplier - 1). Everything the lamp pays lands
 *     here, so the ceiling bounds it no matter what the config says. Turning
 *     the number up reaches the cap with fewer perfect locks; it cannot go past
 *     it.
 *
 * Move that multiplier one line, into the same product as rawCapacity, and
 * every screen still looks right while the economy quietly inflates. Hence
 * these.
 */
import { describe, it, expect, vi } from "vitest";
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

import { createInitialGameData } from "@/lib/initGame";
import { checkAndUpdateBallWonStates } from "@/lib/physics/checkBallWonState";
import { CellState, worldToGridIndex } from "@/lib/spaceGrid";
import { getLampLockMultiplier, getLockQuality } from "@/lib/scoring";
import { bankAxes } from "@/lib/scoreAxes";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

const MODS = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, frozenLockBonus: 0, gravityLockBonus: 0, simultaneousLockBonus: 0,
  overtimePerLock: 0, overtimePerSuperiorLock: 0, microManagerPerLock: 0,
  lockThresholdBonus: 0, startingCapturePercent: 0,
} as unknown as GameModifiers;

const LEVEL: LevelConfig = {
  id: "lamp-test", name: "Lamp", sizeThreshold: 40, expectedCuts: 4, entities: [],
} as unknown as LevelConfig;

/** Seal one ball into a tiny island so it locks on the next pass. */
function lockOne(lampId: string | null): { pay: number; delivery: number } {
  const game = { ...createInitialGameData(LEVEL, 3, MODS) } as unknown as CanvasGameState;
  // GameCanvas sets these up at map load rather than createInitialGameData
  // (same as coloredAreas): the flash map the lock pass writes into, and the
  // running pay tallies it adds to.
  game.assimilations = new Map();
  game.lockBonus = 0;
  game.lockDeliveryBonus = 0;
  game.superiorLockBonus = 0;
  game.superiorLockCount = 0;
  game.zoneLockBonus = 0;
  game.zoneLockCount = 0;
  game.lockedBallsCount = 0;
  // Sits inside the pay product; undefined makes every payout NaN.
  game.moneyMultiplier = 1;
  const grid = game.spaceGrid!;

  const bx = 450, by = 450;
  const target = {
    id: "target", isBoss: false, state: "active",
    position: { x: bx, y: by }, velocity: { x: 30, y: 0 }, speed: 30,
    radius: 14, lockMultiplier: 1, typeId: "red", ability: "none", color: "#ff5b5b",
  } as unknown as Ball;
  game.balls = [target];
  game.lamp = lampId ? { ballId: lampId, fromBallId: null, switchedAt: 0 } : undefined;

  const idx = worldToGridIndex(grid, bx, by);
  const col = idx % grid.width, row = Math.floor(idx / grid.width);
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) !== 2) continue;
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
  expect(target.state, "the harness failed to lock the ball").toBe("won");
  return { pay: game.lockBonus, delivery: game.lockDeliveryBonus ?? 0 };
}

describe("sealing the lit ball", () => {
  it("pays more than sealing an unlit one", () => {
    const lit = lockOne("target");
    const unlit = lockOne(null);
    expect(unlit.pay).toBeGreaterThan(0);
    expect(lit.pay, "the lamp paid nothing extra").toBeGreaterThan(unlit.pay);
    expect(lit.pay / unlit.pay).toBeCloseTo(getLampLockMultiplier(), 1);
  });

  it("pays a ball that is not the lamp exactly nothing extra", () => {
    // The bonus is for the LIT ball, not for any ball while a lamp exists.
    expect(lockOne("someone-else").pay).toBe(lockOne(null).pay);
  });

  it("leaves DELIVERY untouched, which is the whole safety argument", () => {
    // THE structural test. Delivery is "did you ship the roster" and a lamp
    // draw must never flatter it. If this ever fails, the multiplier has moved
    // into the same product as rawCapacity and the economy is inflating in a
    // way no screen will show.
    const lit = lockOne("target");
    const unlit = lockOne(null);
    expect(lit.delivery, "the lamp bonus leaked into Delivery").toBe(unlit.delivery);
  });

  it("puts all of it in the premium, which is what Craft is capped on", () => {
    const lit = lockOne("target");
    const unlit = lockOne(null);
    const premium = (r: { pay: number; delivery: number }) => r.pay - r.delivery;
    expect(premium(lit)).toBeGreaterThan(premium(unlit));
    // Everything it added is premium, to the hour.
    expect(lit.pay - unlit.pay).toBe(premium(lit) - premium(unlit));
  });
});

describe("the bonus cannot break the economy", () => {
  const CEILINGS = {
    delivery: 30, craft: 30, tempo: 24, thrift: 20, greed: 25,
    thriftFullAtParFraction: 0.4, greedFullAtSlackFraction: 0.6,
  };
  const axes = (premiumEarned: number) => bankAxes({
    lockedCapacity: 48, totalCapacity: 48,
    premiumEarned, premiumAvailable: 48,
    usedFences: 4, parFences: 4, actualRemovedRatio: 0.6, requiredRemovedRatio: 0.6,
    shipEarlyPercent: 0, shipEarlyMaxPercent: 1,
    thriftFullAtParFraction: 0.4, greedFullAtSlackFraction: 0.6,
  }, CEILINGS);

  it("cannot push Craft past its ceiling however big the premium gets", () => {
    // The ceiling is structural, so the config value is safe to tune. A lamp
    // that paid ten times over would still bank exactly 30.
    expect(axes(48).craft).toBe(CEILINGS.craft);
    expect(axes(480).craft).toBe(CEILINGS.craft);
    expect(axes(48_000).craft).toBe(CEILINGS.craft);
  });

  it("cannot move Delivery at all, whatever the premium is", () => {
    expect(axes(480).delivery).toBe(axes(0).delivery);
  });
});

describe("the configured multiplier", () => {
  it("is a real bonus that stacks with a superior lock", () => {
    // 2.0 x 1.5 = 3x is the combo the mechanic is for: find the lit ball AND
    // seal it tight.
    const lamp = getLampLockMultiplier();
    expect(lamp).toBeGreaterThan(1);
    expect(lamp * getLockQuality().superiorMultiplier).toBeGreaterThanOrEqual(2.5);
  });

  it("stays modest enough that an unlit lock is still worth making", () => {
    // If the lit ball paid several times a normal lock, every other ball on the
    // board would be a distraction, and the map would stop being about the
    // board and start being about chasing one dot.
    expect(getLampLockMultiplier()).toBeLessThanOrEqual(2);
  });
});
