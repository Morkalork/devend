/**
 * A ball delivered into ground the player already claimed.
 *
 * Reported from play on level 17: the far portal's chamber was captured first,
 * a ball went in the near mouth, and it came out somewhere that is no longer
 * part of the board. "It moved around, but I couldn't lock it away."
 *
 * That was exact. A captured cell belongs to no region, so
 * findGridRegionForBall returns null, so the lock sweep's first line skipped
 * the ball - on that pass and every pass after it. The ball bounced around
 * finished board forever and its lock was simply gone, with nothing on screen
 * to say why.
 *
 * It locks now, and the reasoning is that the seal ALREADY EXISTS: the player
 * spent the fences to close that ground off, so a ball delivered into it has
 * been delivered into a sealed pocket, just one paid for earlier. Refusing the
 * warp was the alternative and it is worse to read - an object that works
 * except when it silently does not.
 *
 * Portals are the only door to this today. Nothing in the fix is
 * portal-specific, because anything that moves a ball across a fence lands in
 * the same place.
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

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { checkAndUpdateBallWonStates } from "@/lib/physics/checkBallWonState";
import { setRunSeedText } from "@/lib/runRng";
import { CellState, ballInClaimedSpace, worldToGridIndex } from "@/lib/spaceGrid";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig, LevelData } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { SpaceGrid } from "@/lib/spaceGrid";

/** A tiny grid, all open, so the predicate can be read rather than inferred. */
function grid(w = 9, h = 9): SpaceGrid {
  return {
    width: w, height: h, cellSize: 10, originX: 0, originY: 0,
    cells: new Uint8Array(w * h).fill(CellState.ACTIVE),
  } as unknown as SpaceGrid;
}
const claim = (g: SpaceGrid, col: number, row: number) => {
  g.cells[row * g.width + col] = CellState.REMOVED;
};

describe("what counts as standing in claimed space", () => {
  it("is false on open board", () => {
    expect(ballInClaimedSpace(grid(), 45, 45)).toBe(false);
  });

  it("is false on the boundary of claimed ground", () => {
    // The case findGridRegionForBall's own 5x5 fallback exists to forgive: a
    // ball a hair over the edge of a live region is still playing.
    const g = grid();
    claim(g, 4, 4);
    expect(ballInClaimedSpace(g, 45, 45), "one claimed cell read as stranded").toBe(false);
  });

  it("is true only once the whole neighbourhood is claimed", () => {
    const g = grid();
    for (let r = 3; r <= 5; r++) for (let c = 3; c <= 5; c++) claim(g, c, r);
    expect(ballInClaimedSpace(g, 45, 45)).toBe(true);
  });

  it("is false off the board, so a different bug stays visible", () => {
    // A ball outside the board is its own fault somewhere else. Awarding it a
    // lock would bury that one underneath this one.
    const g = grid();
    expect(ballInClaimedSpace(g, -50, -50)).toBe(false);
    expect(ballInClaimedSpace(g, 5000, 5000)).toBe(false);
  });
});

describe("level 17: a ball warped into a chamber that was already taken", () => {
  /** Build the real map, claim the far mouth's ground, and send a ball through. */
  function warpIntoClaimedGround() {
    setRunSeedText("deal-a");
    const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
    const lvl = doc.levels.find(l => l.level === 17) as unknown as LevelConfig;
    const d = createInitialGameData(lvl, 17, DEFAULT_MODIFIERS);
    const game = {
      ...d, objectDebris: [], pendingDestroys: [], bouncerFlashes: [], assimilations: new Map(),
    } as unknown as CanvasGameState;
    game.lockBonus = 0; game.lockDeliveryBonus = 0; game.superiorLockBonus = 0;
    game.superiorLockCount = 0; game.zoneLockBonus = 0; game.zoneLockCount = 0;
    game.multiLockBonus = 0; game.multiLockBest = 1;
    game.lockedBallsCount = 0; game.moneyMultiplier = 1;

    const mouths = [...(game.portals?.values() ?? [])];
    const [near, far] = mouths;
    const g = game.spaceGrid!;

    // The player got there first: everything around the far mouth is captured.
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        const x = g.originX + (c + 0.5) * g.cellSize;
        const y = g.originY + (r + 0.5) * g.cellSize;
        if (Math.hypot(x - far.centre.x, y - far.centre.y) < 190) {
          g.cells[r * g.width + c] = CellState.REMOVED;
        }
      }
    }

    const ball = game.balls[0];
    ball.state = "active";
    ball.position = { x: near.centre.x, y: near.centre.y };
    ball.velocity = { x: 0, y: -260 };
    ball.speed = 260;
    for (let i = 0; i < 4; i++) updateBall(ball, 1 / 120, game);
    setRunSeedText(null);
    return { game, ball, far };
  }

  const sweep = (game: CanvasGameState) => {
    const noop = () => {};
    checkAndUpdateBallWonStates(game, DEFAULT_MODIFIERS, 0,
      { setLockedBallsCount: noop, onBallTypeLocked: () => false, onBallCountChanged: noop, onBossState: noop },
      null);
  };

  it("really does come out in ground with no region left", () => {
    // The premise. If the warp stopped landing in claimed space this whole
    // file would pass while testing nothing.
    const { game, ball, far } = warpIntoClaimedGround();
    expect(Math.hypot(ball.position.x - far.centre.x, ball.position.y - far.centre.y),
      "the ball never made the trip").toBeLessThan(120);
    const idx = worldToGridIndex(game.spaceGrid!, ball.position.x, ball.position.y);
    expect(game.spaceGrid!.cells[idx], "it landed on live board, not claimed ground")
      .toBe(CellState.REMOVED);
  });

  it("locks it instead of leaving it bouncing forever", () => {
    const { game, ball } = warpIntoClaimedGround();
    expect(ball.state).toBe("active");
    sweep(game);
    expect(ball.state, "the ball is still loose in finished board").toBe("won");
    expect(game.lockedBallsCount, "the lock was not counted").toBe(1);
  });

  it("pays it as an ordinary lock, never a superior one", () => {
    // Its synthetic pocket is one cell, which would take the superior grade
    // automatically - and a superior lock is a tight pocket the player built on
    // purpose, not a delivery into a room they finished earlier.
    const { game } = warpIntoClaimedGround();
    sweep(game);
    expect(game.lockBonus, "an ordinary lock paid nothing").toBeGreaterThan(0);
    expect(game.superiorLockCount, "a delivery graded as a superior lock").toBe(0);
  });

  it("does not lock a ball that has no region for some OTHER reason", () => {
    // The mutation this exists for: "no region" alone is not the condition.
    // A ball off the board also has no region, and awarding it a lock would
    // turn an escaped-ball bug into a silent point award - burying the bug
    // under the fix for a different one.
    const { game, ball } = warpIntoClaimedGround();
    ball.position = { x: -400, y: -400 };
    ball.state = "active";
    sweep(game);
    expect(ball.state, "a ball off the board was awarded a lock").toBe("active");
    expect(game.lockedBallsCount).toBe(0);
  });

  it("leaves a ball on live board alone", () => {
    // The counter-test: without it "the ball locked" is also what a sweep that
    // locks everything looks like.
    const { game, ball } = warpIntoClaimedGround();
    // Put it back on open ground, still nowhere near a small pocket.
    const g = game.spaceGrid!;
    let openIdx = -1;
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === CellState.ACTIVE) { openIdx = i; break; }
    expect(openIdx).toBeGreaterThanOrEqual(0);
    ball.position = {
      x: g.originX + ((openIdx % g.width) + 0.5) * g.cellSize,
      y: g.originY + (Math.floor(openIdx / g.width) + 0.5) * g.cellSize,
    };
    ball.state = "active";
    sweep(game);
    expect(ball.state, "a ball on the open board was locked for free").toBe("active");
  });
});
