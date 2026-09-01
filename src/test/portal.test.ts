/**
 * Portals: the first object that changes the board's topology, not its shape.
 *
 * Every other object rearranges where a ball can go by putting solid matter in
 * the way. A portal pair leaves the geometry alone and changes what is next to
 * what, which is a different kind of authoring tool - and a different kind of
 * hazard, because it breaks an assumption the lock system quietly relies on.
 *
 * ── The decision this object needed before it could exist ───────────────────
 *
 * A region containing a live portal CANNOT be locked. A lock means "this ball
 * is sealed in a pocket it cannot leave"; a pocket with a portal in it is one
 * the ball CAN leave, it just does not look like one. Paying out for a seal the
 * ball escapes from a second later is the one outcome no screen could explain.
 *
 * Made a rule rather than left as a bug, it is the most interesting thing about
 * the object: a portal turns one pocket into a place you must not use.
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

import {
  portalExit, portalArrival, portalReady, inPortal, PORTAL_COOLDOWN_MS, type PortalSpec,
} from "@/lib/physics/portal";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { checkAndUpdateBallWonStates } from "@/lib/physics/checkBallWonState";
import { CellState, worldToGridIndex } from "@/lib/spaceGrid";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { Ball } from "@/types/game";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const spec = (id: string, link: string, x: number, y: number): PortalSpec =>
  ({ id, link, centre: { x, y }, radius: 40 });

const ball = (pos: { x: number; y: number }, vel: { x: number; y: number }): Ball =>
  ({ id: "b", position: { ...pos }, velocity: { ...vel }, speed: Math.hypot(vel.x, vel.y), radius: 18 } as unknown as Ball);

describe("pairing", () => {
  const a = spec("a", "north", 100, 100);
  const b = spec("b", "north", 700, 700);

  it("sends a ball out of the other end", () => {
    expect(portalExit(a, [a, b])?.id).toBe("b");
    expect(portalExit(b, [a, b])?.id).toBe("a");
  });

  it("leaves a lone portal inert rather than eating the ball", () => {
    // The silent-failure shape this codebase keeps producing: a half-authored
    // pair that swallows a ball and reports nothing.
    expect(portalExit(a, [a])).toBeNull();
  });

  it("ignores portals on a different link", () => {
    const other = spec("c", "south", 400, 400);
    expect(portalExit(a, [a, other])).toBeNull();
  });

  it("chains three or more into a ring, in a stable order", () => {
    const c = spec("c", "north", 400, 400);
    // Sorted by id, so the ring does not depend on which one the entity loop
    // happened to see first - a map would otherwise play differently per run.
    expect(portalExit(a, [c, b, a])?.id).toBe("b");
    expect(portalExit(b, [c, b, a])?.id).toBe("c");
    expect(portalExit(c, [c, b, a])?.id).toBe("a");
  });
});

describe("arriving", () => {
  const exit = spec("b", "north", 700, 700);

  it("keeps the ball's speed and heading: a portal moves, it does not aim", () => {
    const bl = ball({ x: 100, y: 100 }, { x: 0, y: -300 });
    const at = portalArrival(bl, exit);
    expect(at.x).toBeCloseTo(700, 6);
    expect(at.y).toBeLessThan(700);          // carried on upward
    expect(bl.velocity).toEqual({ x: 0, y: -300 });
  });

  it("puts the ball clear of the mouth it came out of", () => {
    // Landing inside the exit is what turns a pair into a loop.
    const bl = ball({ x: 100, y: 100 }, { x: 300, y: 0 });
    const at = portalArrival(bl, exit);
    expect(Math.hypot(at.x - exit.centre.x, at.y - exit.centre.y))
      .toBeGreaterThan(exit.radius);
    expect(inPortal(at, exit)).toBe(false);
  });

  it("still emits a stationary ball somewhere legal", () => {
    const at = portalArrival(ball({ x: 100, y: 100 }, { x: 0, y: 0 }), exit);
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true);
    expect(inPortal(at, exit)).toBe(false);
  });
});

describe("the cooldown, which is what stops a pair being a hang", () => {
  it("lets a fresh ball straight through", () => {
    expect(portalReady(ball({ x: 0, y: 0 }, { x: 1, y: 0 }), 1000)).toBe(true);
  });

  it("refuses one that just arrived", () => {
    const bl = ball({ x: 0, y: 0 }, { x: 1, y: 0 });
    bl.lastPortalAt = 1000;
    expect(portalReady(bl, 1000 + PORTAL_COOLDOWN_MS - 1)).toBe(false);
    expect(portalReady(bl, 1000 + PORTAL_COOLDOWN_MS)).toBe(true);
  });
});

 
const level = (portal: boolean): LevelConfig => ({
  id: "portal-test", level: 5, name: "P", sizeThreshold: 30, expectedCuts: 4,
  points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
  entities: [
    { id: "pa", kind: "wall", shape: "circle", cx: 250, cy: 450, radius: 45, ...(portal ? { portal: "x" } : {}) },
    { id: "pb", kind: "wall", shape: "circle", cx: 700, cy: 450, radius: 45, ...(portal ? { portal: "x" } : {}) },
  ],
} as unknown as LevelConfig);
 

describe("in the running game", () => {
  const build = (portal: boolean) => createInitialGameData(level(portal), 5, DEFAULT_MODIFIERS);

  it("registers both ends and puts the spec on their edge walls", () => {
    const d = build(true);
    expect(d.portals.size).toBe(2);
    const edges = d.walls.filter(w => w.id.startsWith("obstacle-pa-"));
    expect(edges.length).toBeGreaterThan(0);
    for (const w of edges) expect(w.portal).toBeTruthy();
  });

  /**
   * Positions come from the BUILT portals, never from the authored cx/cy.
   *
   * A map is dealt in one of four rotations, so an obstacle authored at
   * (250,450) is somewhere else by the time a ball could reach it - which is
   * exactly how the launcher came to be authored facing right and built facing
   * up. A test that assumes authored coordinates tests a board that does not
   * exist.
   */
  const inGame = (portal: boolean) => {
    const d = build(portal);
    const game = { ...d } as unknown as CanvasGameState;
    const bl = game.balls[0];
    return { game, bl, mouths: [...(d.portals?.values() ?? [])] };
  };

  const dropInto = (bl: Ball, at: { x: number; y: number }) => {
    bl.position = { x: at.x, y: at.y };
    bl.velocity = { x: 260, y: 0 };
    bl.speed = 260;
  };

  it("carries a ball across the board instead of bouncing it", () => {
    const { game, bl, mouths } = inGame(true);
    const [from, to] = mouths;
    dropInto(bl, from.centre);
    const startedFrom = Math.hypot(bl.position.x - to.centre.x, bl.position.y - to.centre.y);
    updateBall(bl, 1 / 120, game);
    const endedNear = Math.hypot(bl.position.x - to.centre.x, bl.position.y - to.centre.y);
    expect(endedNear, "the ball did not come out of the far portal")
      .toBeLessThan(startedFrom / 2);
  });

  it("bounces off the same obstacle when it is not a portal", () => {
    // The control. Without it "it moved" proves nothing about portals: the two
    // maps are identical but for the flag.
    const withPortals = inGame(true);
    const plain = inGame(false);
    const target = withPortals.mouths[1].centre;
    dropInto(plain.bl, withPortals.mouths[0].centre);
    const before = Math.hypot(plain.bl.position.x - target.x, plain.bl.position.y - target.y);
    updateBall(plain.bl, 1 / 120, plain.game);
    const after = Math.hypot(plain.bl.position.x - target.x, plain.bl.position.y - target.y);
    expect(plain.game.portals?.size ?? 0).toBe(0);
    expect(Math.abs(after - before), "a plain obstacle teleported the ball").toBeLessThan(50);
  });

  it("does not ping-pong: one crossing per approach", () => {
    const { game, bl, mouths } = inGame(true);
    const [from, to] = mouths;
    const span = Math.hypot(to.centre.x - from.centre.x, to.centre.y - from.centre.y);
    dropInto(bl, from.centre);
    let crossings = 0;
    let last = { x: bl.position.x, y: bl.position.y };
    for (let i = 0; i < 30; i++) {
      updateBall(bl, 1 / 120, game);
      if (Math.hypot(bl.position.x - last.x, bl.position.y - last.y) > span / 2) crossings++;
      last = { x: bl.position.x, y: bl.position.y };
    }
    expect(crossings, "the pair looped").toBe(1);
  });
});

/**
 * The rule: a pocket with a portal in it is not a pocket.
 *
 * Pinned against the SHIPPED lock path rather than a re-statement of it, because
 * a re-statement would agree with the bug for as long as the bug existed. The
 * region is sealed the way the game seals one - cells removed around the ball -
 * and the only difference between the two runs is whether the obstacle sitting
 * in that pocket carries a portal link.
 */
describe("a region holding a portal cannot be locked", () => {
  const sealAround = (portal: boolean) => {
    const lvl = {
      id: "portal-lock", level: 5, name: "PL", sizeThreshold: 40, expectedCuts: 4,
      points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
      entities: [
        { id: "pa", kind: "wall", shape: "circle", cx: 250, cy: 250, radius: 30, ...(portal ? { portal: "x" } : {}) },
        { id: "pb", kind: "wall", shape: "circle", cx: 700, cy: 700, radius: 30, ...(portal ? { portal: "x" } : {}) },
      ],
    } as unknown as LevelConfig;
    const d = createInitialGameData(lvl, 5, DEFAULT_MODIFIERS);
    const game = { ...d } as unknown as CanvasGameState;
    game.assimilations = new Map();
    game.lockBonus = 0; game.lockDeliveryBonus = 0; game.superiorLockBonus = 0;
    game.superiorLockCount = 0; game.zoneLockBonus = 0; game.zoneLockCount = 0;
    game.multiLockBonus = 0; game.multiLockBest = 1;
    game.lockedBallsCount = 0; game.moneyMultiplier = 1;

    // Seal a small pocket around the FIRST mouth, wherever the rotation put it,
    // and stand the ball in it.
    const mouth = [...(d.portals?.values() ?? [])][0]
      ?? { centre: { x: d.balls[0].position.x, y: d.balls[0].position.y } };
    const grid = game.spaceGrid!;
    const ball = game.balls[0];
    ball.position = { x: mouth.centre.x, y: mouth.centre.y + 45 };
    const idx = worldToGridIndex(grid, ball.position.x, ball.position.y);
    const col = idx % grid.width, row = Math.floor(idx / grid.width);
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== 4) continue;
        const c = col + dc, r = row + dr;
        if (c >= 0 && c < grid.width && r >= 0 && r < grid.height) {
          grid.cells[r * grid.width + c] = CellState.REMOVED;
        }
      }
    }
    const noop = () => {};
    checkAndUpdateBallWonStates(
      game, DEFAULT_MODIFIERS, 0,
      { setLockedBallsCount: noop, onBallTypeLocked: () => false, onBallCountChanged: noop, onBossState: noop },
      null,
    );
    return ball.state;
  };

  it("locks the ball when the pocket is ordinary", () => {
    // The control, and the thing that makes the next test mean anything: this
    // exact pocket DOES lock when the obstacle in it is just an obstacle.
    expect(sealAround(false)).toBe("won");
  });

  it("refuses the lock when the same pocket holds a portal", () => {
    expect(sealAround(true), "a pocket the ball can leave was paid out as a lock")
      .not.toBe("won");
  });
});
