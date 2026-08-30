/**
 * What sealing several balls in one cut is worth, and saying so.
 *
 * The multiplier was never missing: `simultaneousMultiplier = newlyLocked +
 * chainBonus`, so two at once already paid double and three triple. What was
 * missing is that NOTHING said so. It is folded into lockBonus at lock time,
 * inside the same product as the money, frozen, zone and superior multipliers,
 * so by the time any screen sees it a big multi-lock and the same number of
 * ordinary locks are the same number. Players concluded the play paid nothing.
 *
 * This is the fix the Colored Areas already got, for the same reason and by the
 * same method: price the pass a SECOND time against the alternative, and report
 * the difference. Reporting is all it is - not one hour is added to the payout,
 * which is the property most worth pinning, because a "readout" that quietly
 * pays twice is an economy bug wearing a UI change's clothes.
 *
 * The baseline is the same balls locked ONE AT A TIME, not "with no multiplier
 * at all". One-at-a-time is the choice the player actually had; a multiplier of
 * zero is a board state they could never reach, and measuring against it would
 * inflate the reported figure by the whole Chain Reaction bonus.
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
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

const mods = (over: Partial<GameModifiers> = {}) => ({
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, frozenLockBonus: 0, gravityLockBonus: 0, simultaneousLockBonus: 0,
  overtimePerLock: 0, overtimePerSuperiorLock: 0, microManagerPerLock: 0,
  lockThresholdBonus: 0, startingCapturePercent: 0, ...over,
} as unknown as GameModifiers);

const LEVEL: LevelConfig = {
  id: "multi-lock-test", name: "Multi", sizeThreshold: 40, expectedCuts: 4, entities: [],
} as unknown as LevelConfig;

interface Pass { pay: number; delivery: number; multiBonus: number; best: number; locked: number }

/**
 * Seal `count` balls, either all in ONE pass or one pass each.
 *
 * Separate islands far apart, so the only difference between the two runs is
 * whether the locks land together. Same balls, same pockets, same everything
 * else: if the reported bonus moved, the stacking is the only thing that moved
 * it.
 */
function seal(count: number, together: boolean, over: Partial<GameModifiers> = {}): Pass {
  const MODS = mods(over);
  const game = { ...createInitialGameData(LEVEL, count, MODS) } as unknown as CanvasGameState;
  game.assimilations = new Map();
  game.lockBonus = 0;
  game.lockDeliveryBonus = 0;
  game.superiorLockBonus = 0;
  game.superiorLockCount = 0;
  game.zoneLockBonus = 0;
  game.zoneLockCount = 0;
  game.multiLockBonus = 0;
  game.multiLockBest = 1;
  game.lockedBallsCount = 0;
  game.moneyMultiplier = 1;
  const grid = game.spaceGrid!;

  const spots = Array.from({ length: count }, (_, i) => ({ x: 200 + i * 220, y: 450 }));
  game.balls = spots.map((p, i) => ({
    id: `b${i}`, isBoss: false, state: "active",
    position: { x: p.x, y: p.y }, velocity: { x: 30, y: 0 }, speed: 30,
    radius: 14, lockMultiplier: 1, typeId: "red", ability: "none", color: "#ff5b5b",
  } as unknown as Ball));

  /** Ring-fence one ball's cell island so the next pass locks exactly it. */
  const island = (x: number, y: number) => {
    const idx = worldToGridIndex(grid, x, y);
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
  };

  const noop = () => {};
  const run = () => checkAndUpdateBallWonStates(
    game, MODS, 0,
    { setLockedBallsCount: noop, onBallTypeLocked: () => false, onBallCountChanged: noop, onBossState: noop },
    null,
  );

  if (together) {
    for (const p of spots) island(p.x, p.y);
    run();
  } else {
    for (const p of spots) { island(p.x, p.y); run(); }
  }

  const locked = game.balls.filter(b => b.state === "won").length;
  expect(locked, `the harness sealed ${locked} of ${count}`).toBe(count);
  return {
    pay: game.lockBonus,
    delivery: game.lockDeliveryBonus ?? 0,
    multiBonus: game.multiLockBonus,
    best: game.multiLockBest,
    locked,
  };
}

describe("locking several at once is worth more, and now says so", () => {
  it("reports nothing at all for a single lock", () => {
    // x1 is not a bonus, and a row reading "+0h" for one lock is the same
    // "arithmetic for nothing" the zone row already had to be fixed for.
    const one = seal(1, true);
    expect(one.multiBonus).toBe(0);
    expect(one.best).toBe(1);
  });

  it("reports nothing when the same balls are locked one at a time", () => {
    const apart = seal(3, false);
    expect(apart.multiBonus).toBe(0);
    expect(apart.best, "separate passes were counted as one big cut").toBe(1);
  });

  it("reports a bonus when they land together", () => {
    const together = seal(3, true);
    expect(together.best).toBe(3);
    expect(together.multiBonus, "the multi-lock reported nothing").toBeGreaterThan(0);
  });

  it("reports exactly the hours the stacking was worth", () => {
    // The honesty check: reported bonus == what one cut paid minus what three
    // separate cuts would have paid, on the same balls.
    const together = seal(3, true);
    const apart = seal(3, false);
    expect(together.pay - apart.pay).toBe(together.multiBonus);
  });

  it("pays more for three at once than for three one at a time", () => {
    // Guards the premise. If this ever fails the multiplier itself is gone and
    // the readout is reporting a bonus nobody receives.
    expect(seal(3, true).pay).toBeGreaterThan(seal(3, false).pay);
  });

  it("grows with the size of the cut", () => {
    expect(seal(3, true).multiBonus).toBeGreaterThan(seal(2, true).multiBonus);
  });
});

describe("the readout does not change what is paid", () => {
  it("adds not one hour to lock income", () => {
    // THE test. The zone row's own comment warns that its hours are already
    // inside lockBonus and must not be added again; this is that invariant for
    // the new row, checked from the outside. A readout that pays is a bug.
    //
    // What one cut paid == what the separate cuts paid, plus exactly the figure
    // the row reports. Nothing beyond the multiplier already in the economy has
    // been introduced.
    const together = seal(3, true);
    const apart = seal(3, false);
    expect(together.pay).toBe(apart.pay + together.multiBonus);
  });

  it("keeps Delivery blind to how the balls were sealed", () => {
    // Delivery is "did you ship the roster", and locking three in one cut ships
    // exactly as many balls as locking them in three. The multi-lock block never
    // touches lockDeliveryBonus; if it ever does, the same work is scored twice.
    expect(seal(3, true).delivery).toBe(seal(3, false).delivery);
  });
});

describe("Chain Reaction is part of the baseline, not part of the bonus", () => {
  it("does not bill the player's upgrade as a multi-lock bonus", () => {
    // Chain Reaction (`simultaneousLockBonus`) makes EVERY pass count as bigger,
    // including a single lock. Measuring against a multiplier of zero rather
    // than against one-at-a-time would fold that whole upgrade into this row and
    // report hours the multi-lock did not earn.
    const solo = seal(1, true, { simultaneousLockBonus: 2 });
    expect(solo.multiBonus, "a lone lock billed the Chain Reaction bonus").toBe(0);
  });

  it("still reports the stacking on top of it", () => {
    const together = seal(3, true, { simultaneousLockBonus: 2 });
    const apart = seal(3, false, { simultaneousLockBonus: 2 });
    expect(together.multiBonus).toBeGreaterThan(0);
    expect(together.pay - apart.pay).toBe(together.multiBonus);
  });
});
