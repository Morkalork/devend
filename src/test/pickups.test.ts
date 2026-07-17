import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playPickupClaimedSound: () => {},
}));

import { CanvasGameState } from "@/types/gameState";
import { PickupConfig, PickupState } from "@/types/pickups";
import { Ball } from "@/types/game";
import { createRectPolygon } from "@/lib/polygon";
import { createSpaceGrid, worldToGridIndex, CellState } from "@/lib/spaceGrid";
import {
  updatePickups,
  claimPickupsInPocket,
  wasteCapturedPickups,
  effectivePickupChance,
  FORK_CONSOLATION_OVERTIME,
} from "@/lib/pickups";
import { calculateScore } from "@/lib/scoring";
import { createBallEffectState } from "@/lib/ballEffects";

const CFG: PickupConfig = {
  startLevel: 8,
  spawnCheckSeconds: 5,
  spawnChance: 1, // every roll spawns (when below the cap)
  maxSimultaneous: 2,
  lifetimeSeconds: 14,
  effects: [{ effect: "overtime", weight: 1, value: 4 }],
};

function makeBall(id: string, x: number, y: number): Ball {
  return {
    id, position: { x, y }, velocity: { x: 100, y: 50 }, radius: 18,
    speed: 112, baseSpeed: 112, topSpeed: 112, color: "#ff5b5b", regionId: "r1",
    rotation: 0, flashIntensity: 0, effects: createBallEffectState(),
    state: "active", wonSpinSpeed: 0, wonTime: 0, assimScale: 1, assimColorFade: 0,
    typeId: "red", ability: "none", lockMultiplier: 1, spawnTime: 0, minimumSpeed: 80,
  } as Ball;
}

/** Bare game with a live 900x900 grid, one ball, and pickup state wired. */
function makeGame(): CanvasGameState {
  const board = createRectPolygon(45, 45, 855, 855);
  const grid = createSpaceGrid(board, [], 15);
  return {
    spaceGrid: grid,
    walls: [],
    balls: [makeBall("red-0", 450, 450)],
    activePlaySeconds: 0,
    pickups: [] as PickupState[],
    pickupConfig: CFG,
    pickupSpots: [],
    lastPickupRollAt: 0,
    pickupOvertime: 0,
    pickupCapBonus: 0,
    freezeCharges: 0,
    freezeChargeSeconds: 0,
    pickupFeedback: [],
  } as unknown as CanvasGameState;
}

function makeToken(game: CanvasGameState, x: number, y: number, effect = "overtime", value = 4): PickupState {
  const token: PickupState = {
    id: `t-${x}-${y}`, effect: effect as PickupState["effect"], value,
    position: { x, y },
    spawnedAtSeconds: game.activePlaySeconds,
    expiresAtSeconds: game.activePlaySeconds + 14,
  };
  game.pickups.push(token);
  return token;
}

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(1000);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("pickup spawning", () => {
  it("spawns on the roll cadence, never past maxSimultaneous", () => {
    const game = makeGame();
    // First roll only after spawnCheckSeconds of active play.
    updatePickups(game);
    expect(game.pickups.length).toBe(0);
    game.activePlaySeconds = 5;
    updatePickups(game);
    expect(game.pickups.length).toBe(1);
    // Same window: no second roll yet.
    updatePickups(game);
    expect(game.pickups.length).toBe(1);
    game.activePlaySeconds = 10;
    updatePickups(game);
    expect(game.pickups.length).toBe(2);
    // At the cap: further rolls do nothing.
    game.activePlaySeconds = 15;
    updatePickups(game);
    game.activePlaySeconds = 20;
    updatePickups(game);
    expect(game.pickups.length).toBe(2);
  });

  it("does nothing when the map's config is null (level gate)", () => {
    const game = makeGame();
    game.pickupConfig = null;
    game.activePlaySeconds = 30;
    updatePickups(game);
    expect(game.pickups.length).toBe(0);
  });

  it("expires tokens after their lifetime (active-play clock)", () => {
    const game = makeGame();
    game.activePlaySeconds = 5;
    updatePickups(game);
    expect(game.pickups.length).toBe(1);
    game.activePlaySeconds = 5 + 14; // lifetime elapsed
    updatePickups(game);
    expect(game.pickups.length).toBeLessThanOrEqual(1); // old one gone (a new roll may add one)
    expect(game.pickups.every(t => t.expiresAtSeconds > game.activePlaySeconds)).toBe(true);
  });

  it("freezePickups (Cryo Protocol): tokens spawn with no expiry and never cull", () => {
    const game = makeGame();
    game.freezePickups = true;
    game.activePlaySeconds = 5;
    updatePickups(game); // spawns one
    expect(game.pickups.length).toBe(1);
    expect(game.pickups[0].expiresAtSeconds).toBe(Infinity);
    // Far past the normal 14s lifetime: the frozen token is still there.
    game.activePlaySeconds = 5 + 14 + 100;
    updatePickups(game);
    expect(game.pickups.some(t => t.expiresAtSeconds === Infinity)).toBe(true);
  });

  it("spawned tokens sit in open space away from walls", () => {
    const game = makeGame();
    for (let s = 5; s <= 60 && game.pickups.length < 2; s += 5) {
      game.activePlaySeconds = s;
      updatePickups(game);
    }
    expect(game.pickups.length).toBeGreaterThan(0);
    for (const t of game.pickups) {
      const idx = worldToGridIndex(game.spaceGrid!, t.position.x, t.position.y);
      expect(game.spaceGrid!.cells[idx]).toBe(CellState.ACTIVE);
    }
  });

  it("prefers a curated map spot when one is free", () => {
    const game = makeGame();
    game.pickupSpots = [{ x: 200, y: 200 }];
    game.activePlaySeconds = 5;
    updatePickups(game);
    expect(game.pickups.length).toBe(1);
    expect(game.pickups[0].position).toEqual({ x: 200, y: 200 });
  });
});

describe("claiming (lock with the token in the pocket)", () => {
  it("overtime token pays into pickupOvertime and is removed", () => {
    const game = makeGame();
    const token = makeToken(game, 300, 300);
    const idx = worldToGridIndex(game.spaceGrid!, 300, 300);
    claimPickupsInPocket(game, new Set([idx]));
    expect(game.pickupOvertime).toBe(4);
    expect(game.pickups.length).toBe(0);
    expect(game.pickupFeedback.length).toBe(1);
    expect(game.pickupFeedback[0].kind).toBe("claimed");
    expect(game.pickupFeedback[0].position).toEqual(token.position);
  });

  it("a token outside the pocket is untouched", () => {
    const game = makeGame();
    makeToken(game, 700, 700);
    const idx = worldToGridIndex(game.spaceGrid!, 300, 300);
    claimPickupsInPocket(game, new Set([idx]));
    expect(game.pickupOvertime).toBe(0);
    expect(game.pickups.length).toBe(1);
  });

  it("capRaise raises this map's cap bonus", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "capRaise", 5);
    claimPickupsInPocket(game, new Set([worldToGridIndex(game.spaceGrid!, 300, 300)]));
    expect(game.pickupCapBonus).toBe(5);
  });

  it("freezeCharge grants a charge and its duration", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "freezeCharge", 3);
    claimPickupsInPocket(game, new Set([worldToGridIndex(game.spaceGrid!, 300, 300)]));
    expect(game.freezeCharges).toBe(1);
    expect(game.freezeChargeSeconds).toBe(3);
  });

  it("freeShopItem banks a free-store voucher (issue #48)", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "freeShopItem", 1);
    claimPickupsInPocket(game, new Set([worldToGridIndex(game.spaceGrid!, 300, 300)]));
    expect(game.freeShopItems).toBe(1);
    expect(game.pickups.length).toBe(0);
    expect(game.pickupFeedback[0].kind).toBe("claimed");
  });

  it("every claim lands in the per-map log with its resolved effect and value", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "overtime", 4);
    makeToken(game, 315, 300, "freeShopItem", 1);
    const cells = new Set([
      worldToGridIndex(game.spaceGrid!, 300, 300),
      worldToGridIndex(game.spaceGrid!, 315, 300),
    ]);
    claimPickupsInPocket(game, cells);
    expect(game.pickupsClaimedLog).toEqual([
      { effect: "overtime", value: 4 },
      { effect: "freeShopItem", value: 1 },
    ]);
  });

  it("fork splits a random free ball into two of the same type", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "fork", 0);
    const onBallCountChanged = vi.fn();
    claimPickupsInPocket(game, new Set([worldToGridIndex(game.spaceGrid!, 300, 300)]), { onBallCountChanged });
    expect(game.balls.length).toBe(2);
    expect(game.balls[1].typeId).toBe("red");
    expect(game.balls[1].state).toBe("active");
    expect(game.balls[1].id).not.toBe(game.balls[0].id);
    expect(onBallCountChanged).toHaveBeenCalledWith(2);
  });

  it("fork with no free ball pays the overtime consolation", () => {
    const game = makeGame();
    game.balls[0].state = "won";
    game.balls[0].speed = 0;
    makeToken(game, 300, 300, "fork", 0);
    claimPickupsInPocket(game, new Set([worldToGridIndex(game.spaceGrid!, 300, 300)]));
    expect(game.balls.length).toBe(1);
    expect(game.pickupOvertime).toBe(FORK_CONSOLATION_OVERTIME);
  });
});

describe("wasting (captured with no lock)", () => {
  it("a token whose cell got captured is destroyed with waste feedback", () => {
    const game = makeGame();
    makeToken(game, 300, 300);
    const idx = worldToGridIndex(game.spaceGrid!, 300, 300);
    game.spaceGrid!.cells[idx] = CellState.REMOVED;
    wasteCapturedPickups(game);
    expect(game.pickups.length).toBe(0);
    expect(game.pickupOvertime).toBe(0);
    expect(game.pickupFeedback.length).toBe(1);
    expect(game.pickupFeedback[0].kind).toBe("wasted");
  });

  it("a token in still-open space survives", () => {
    const game = makeGame();
    makeToken(game, 300, 300);
    wasteCapturedPickups(game);
    expect(game.pickups.length).toBe(1);
    expect(game.pickupFeedback.length).toBe(0);
  });
});

describe("Total Compensation (pickup payout enhancer)", () => {
  const claimAt = (game: CanvasGameState, x: number, y: number, level: number) =>
    claimPickupsInPocket(game, new Set([worldToGridIndex(game.spaceGrid!, x, y)]), undefined, level);

  it("overtime and capRaise tokens pay +1h per level", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "overtime", 4);
    claimAt(game, 300, 300, 2);
    expect(game.pickupOvertime).toBe(6);
    expect(game.pickupFeedback[0].value).toBe(6); // the label shows the real payout
    makeToken(game, 600, 600, "capRaise", 5);
    claimAt(game, 600, 600, 3);
    expect(game.pickupCapBonus).toBe(8);
  });

  it("freeze charges hold +1s per level", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "freezeCharge", 3);
    claimAt(game, 300, 300, 2);
    expect(game.freezeChargeSeconds).toBe(5);
  });

  it("fork slows the split balls 5% per level", () => {
    const game = makeGame();
    const src = game.balls[0];
    const before = Math.hypot(src.velocity.x, src.velocity.y); // hypot of {100,50}
    makeToken(game, 300, 300, "fork", 0);
    claimAt(game, 300, 300, 2); // -10%
    expect(game.balls.length).toBe(2);
    for (const b of game.balls) {
      expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeCloseTo(before * 0.9, 5);
    }
    expect(src.speed).toBeCloseTo(before * 0.9, 5);
  });

  it("the fork slow never drops a ball below its minimum speed", () => {
    const game = makeGame();
    const src = game.balls[0];
    src.minimumSpeed = Math.hypot(src.velocity.x, src.velocity.y) - 1; // floor just under current speed
    makeToken(game, 300, 300, "fork", 0);
    claimAt(game, 300, 300, 3); // -15% would cross the floor
    for (const b of game.balls) {
      expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeCloseTo(src.minimumSpeed, 5);
    }
  });

  it("fork at level 3 splits a ball into THREE", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "fork", 0);
    claimAt(game, 300, 300, 3);
    expect(game.balls.length).toBe(3);
    expect(new Set(game.balls.map(b => b.id)).size).toBe(3);
    expect(game.balls.every(b => b.typeId === "red" && b.state === "active")).toBe(true);
  });

  it("without the upgrade, fork keeps full speed and yields two balls", () => {
    const game = makeGame();
    makeToken(game, 300, 300, "fork", 0);
    claimAt(game, 300, 300, 0);
    expect(game.balls.length).toBe(2);
    // Clone speed = the source's actual velocity magnitude (hypot of {100,50})
    expect(Math.hypot(game.balls[1].velocity.x, game.balls[1].velocity.y)).toBeCloseTo(Math.hypot(100, 50), 5);
  });
});

describe("effective spawn chance (level gate + map override + Benefits Package)", () => {
  const cfg = { ...CFG, startLevel: 8, spawnChance: 0.1 };

  it("gated below the start level, base chance at/after it", () => {
    expect(effectivePickupChance(cfg, 7, undefined, 0)).toBe(0);
    expect(effectivePickupChance(cfg, 8, undefined, 0)).toBe(0.1);
  });

  it("Benefits Package adds to the chance, but never enables gated maps", () => {
    expect(effectivePickupChance(cfg, 8, undefined, 0.06)).toBeCloseTo(0.16);
    expect(effectivePickupChance(cfg, 5, undefined, 0.06)).toBe(0); // raises frequency, never turns pickups on
  });

  it("a map override bypasses the gate and stacks with the bonus, capped at 1", () => {
    expect(effectivePickupChance(cfg, 3, 0.5, 0.03)).toBeCloseTo(0.53);
    expect(effectivePickupChance(cfg, 3, 0, 0.09)).toBe(0);  // explicit 0 suppresses tokens outright
    expect(effectivePickupChance(cfg, 20, 1, 0.09)).toBe(1); // capped
  });
});

describe("scoring: pickup overtime pays AFTER the per-map cap", () => {
  it("postCapBonus lands on top of a capped score", () => {
    const base = 20; // cap = 20 x 4 = 80 with default config
    const capped = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000 }).levelScore;
    const withTokens = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000, postCapBonus: 8 }).levelScore;
    expect(withTokens).toBe(capped + 8);
  });

  it("postCapBonus is inert at zero / negative", () => {
    const base = 20;
    const a = calculateScore(5, 5, 10, 30, base, {}).levelScore;
    const b = calculateScore(5, 5, 10, 30, base, { postCapBonus: 0 }).levelScore;
    const c = calculateScore(5, 5, 10, 30, base, { postCapBonus: -5 }).levelScore;
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});
