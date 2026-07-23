/**
 * Chest-earned abilities (#38): the YAML catalogue + the seeded, level-gated
 * reward roll (src/lib/abilities.ts), and the pure param-driven effects
 * (src/lib/abilityEffects.ts). Clear All Fences has its own suite.
 */
import { describe, it, expect } from "vitest";
import {
  getAllAbilities,
  getAbility,
  getEligibleAbilities,
  rollAbilityReward,
} from "@/lib/abilities";
import {
  freezeAllBalls,
  applySlowAll,
  abilitySpeedFactor,
  magnetPull,
  shockwavePush,
  applyFenceRush,
  abilityFenceRushFactor,
  applyFenceShield,
  abilityFenceShieldActive,
  fireAbility,
  fireTargetedAbility,
} from "@/lib/abilityEffects";
import { CanvasGameState } from "@/types/gameState";
import { Ball } from "@/types/game";

/** A square board centred on (450,450) for the magnet/shockwave geometry. */
const BOARD_POLY = { vertices: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }] };

function movingBall(id: string, x: number, y: number, vx: number, vy: number, state: "active" | "won" = "active"): Ball {
  const speed = Math.hypot(vx, vy);
  return { id, state, position: { x, y }, velocity: { x: vx, y: vy }, speed, baseSpeed: speed, minimumSpeed: 50 } as Ball;
}

/** Deterministic RNG (mulberry32) for repeatable rolls. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ball(id: string, state: "active" | "won" = "active"): Ball {
  return { id, state, velocity: { x: 100, y: 0 }, speed: 100, minimumSpeed: 50 } as Ball;
}

describe("ability catalogue", () => {
  it("bakes the authored abilities.yml (freeze / slow / clearFences)", () => {
    const ids = getAllAbilities().map(a => a.id);
    expect(ids).toContain("freezeAll");
    expect(ids).toContain("slowAll");
    expect(ids).toContain("clearFences");
    // Each carries a valid colour + a known kind.
    const KINDS = ["freeze", "slow", "clearFences", "magnet", "shockwave", "fenceRush", "fenceShield"];
    for (const a of getAllAbilities()) {
      expect(a.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(KINDS).toContain(a.kind);
    }
  });

  it("gates by startLevel: clearFences (startLevel 7) is not eligible on level 1", () => {
    const early = getEligibleAbilities(1).map(a => a.id);
    expect(early).toContain("freezeAll");
    expect(early).toContain("slowAll");
    expect(early).not.toContain("clearFences");
    // By level 7 it unlocks.
    expect(getEligibleAbilities(7).map(a => a.id)).toContain("clearFences");
  });
});

describe("reward roll", () => {
  it("only ever returns an ability unlocked at the level", () => {
    const r = rng(1);
    for (let i = 0; i < 300; i++) {
      const id = rollAbilityReward(undefined, 3, r);
      expect(id).not.toBeNull();
      expect(getAbility(id!)!.startLevel).toBeLessThanOrEqual(3);
    }
  });

  it("never rolls a still-locked ability, even at a low level", () => {
    const r = rng(5);
    for (let i = 0; i < 300; i++) {
      expect(rollAbilityReward(undefined, 1, r)).not.toBe("clearFences"); // startLevel 7
    }
  });

  it("an authored pool narrows the eligible set", () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      expect(rollAbilityReward(["freezeAll"], 20, r)).toBe("freezeAll");
    }
  });

  it("a pool of only-locked ids falls back to the full eligible set", () => {
    const r = rng(9);
    // clearFences is locked at level 1, so the pool is empty -> fall back.
    const id = rollAbilityReward(["clearFences"], 1, r);
    expect(["freezeAll", "slowAll"]).toContain(id);
  });

  it("is deterministic for a given seed", () => {
    const a = Array.from({ length: 20 }, (() => { const g = rng(42); return () => rollAbilityReward(undefined, 20, g); })());
    const b = Array.from({ length: 20 }, (() => { const g = rng(42); return () => rollAbilityReward(undefined, 20, g); })());
    expect(a).toEqual(b);
  });
});

describe("freezeAllBalls", () => {
  it("freezes every active ball for the given duration and skips won balls", () => {
    const balls = [ball("a"), ball("b"), ball("c", "won")];
    const game = { balls } as unknown as CanvasGameState;
    freezeAllBalls(game, 1000, 3000);
    expect(balls[0].frozenUntil).toBe(4000);
    expect(balls[1].frozenUntil).toBe(4000);
    expect(balls[2].frozenUntil).toBeUndefined(); // won ball untouched
  });
});

describe("slow all", () => {
  it("applies a timed global slow that expires by the active-play clock", () => {
    const game = { activePlaySeconds: 10 } as unknown as CanvasGameState;
    applySlowAll(game, 0.45, 5);
    expect(game.abilitySlowUntil).toBe(15);
    expect(game.abilitySlowMult).toBe(0.45);
    game.activePlaySeconds = 12;
    expect(abilitySpeedFactor(game)).toBe(0.45); // inside window
    game.activePlaySeconds = 15.01;
    expect(abilitySpeedFactor(game)).toBe(1);    // after -> self-reverts
  });

  it("returns a factor of 1 when no slow is active", () => {
    const game = { activePlaySeconds: 5 } as unknown as CanvasGameState;
    expect(abilitySpeedFactor(game)).toBe(1);
  });
});

describe("magnet", () => {
  it("redirects active balls toward the board centre, keeping their speed", () => {
    // Ball above the centre moving right -> should end up moving straight down.
    const b = movingBall("a", 450, 100, 100, 0);
    const game = { balls: [b], boardPolygon: BOARD_POLY } as unknown as CanvasGameState;
    magnetPull(game);
    expect(b.velocity.y).toBeGreaterThan(0);            // now heading toward centre (downward)
    expect(Math.abs(b.velocity.x)).toBeLessThan(1);
    expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeCloseTo(100, 3); // speed preserved
  });

  it("leaves won balls untouched", () => {
    const b = movingBall("w", 450, 100, 100, 0, "won");
    const game = { balls: [b], boardPolygon: BOARD_POLY } as unknown as CanvasGameState;
    magnetPull(game);
    expect(b.velocity).toEqual({ x: 100, y: 0 });
  });

  it("pulls toward a chosen target point (targeted fire)", () => {
    // Ball left of a target to its right -> should end up moving right.
    const b = movingBall("a", 100, 450, 0, 100);
    const game = { balls: [b], boardPolygon: BOARD_POLY } as unknown as CanvasGameState;
    const ok = fireTargetedAbility("magnet", game, 1000, { x: 700, y: 450 });
    expect(ok).toBe(true);
    expect(b.velocity.x).toBeGreaterThan(0);           // now heading toward (700,450)
    expect(Math.abs(b.velocity.y)).toBeLessThan(1);
    expect(game.abilityFx?.length).toBe(1);            // burst plays at the point
    expect(game.abilityFx![0].expand).toBe(false);     // converging
  });

  it("fireTargetedAbility rejects a non-targeted ability", () => {
    const game = { balls: [], boardPolygon: BOARD_POLY } as unknown as CanvasGameState;
    expect(fireTargetedAbility("shockwave", game, 1000, { x: 1, y: 1 })).toBe(false);
  });
});

describe("shockwave", () => {
  it("redirects active balls away from the board centre with an outward speed kick", () => {
    const b = movingBall("a", 450, 100, 100, 0); // above centre, speed 100
    const game = { balls: [b], boardPolygon: BOARD_POLY } as unknown as CanvasGameState;
    shockwavePush(game, 1.25);
    expect(b.velocity.y).toBeLessThan(0);              // pushed further up, away from centre
    expect(Math.abs(b.velocity.x)).toBeLessThan(1);
    expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeCloseTo(125, 3); // 100 x 1.25 boost
  });
});

describe("fence overclock", () => {
  it("multiplies fence-growth speed inside the window and reverts after", () => {
    const game = { activePlaySeconds: 10 } as unknown as CanvasGameState;
    applyFenceRush(game, 6, 4);
    expect(abilityFenceRushFactor(game)).toBe(6);       // 10 < 14
    game.activePlaySeconds = 14.1;
    expect(abilityFenceRushFactor(game)).toBe(1);
  });

  it("is 1 when no rush is active", () => {
    const game = { activePlaySeconds: 3 } as unknown as CanvasGameState;
    expect(abilityFenceRushFactor(game)).toBe(1);
  });
});

describe("fence shield", () => {
  it("is active inside the window and off after", () => {
    const game = { activePlaySeconds: 10 } as unknown as CanvasGameState;
    applyFenceShield(game, 5);
    expect(abilityFenceShieldActive(game)).toBe(true);  // 10 < 15
    game.activePlaySeconds = 15.1;
    expect(abilityFenceShieldActive(game)).toBe(false);
  });

  it("is off when never applied", () => {
    const game = { activePlaySeconds: 1 } as unknown as CanvasGameState;
    expect(abilityFenceShieldActive(game)).toBe(false);
  });
});

describe("ability visual feedback", () => {
  const noop = { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} };
  const makeGame = () => ({ balls: [movingBall("a", 450, 100, 100, 0)], boardPolygon: BOARD_POLY, activePlaySeconds: 0 } as unknown as CanvasGameState);

  it("every fired ability queues a burst so the player always sees SOMETHING", () => {
    for (const id of ["freezeAll", "slowAll", "magnet", "shockwave", "fenceOverclock", "fenceShield"]) {
      const game = makeGame();
      expect(fireAbility(id, game, 1000, noop)).toBe(true);
      expect(game.abilityFx?.length).toBe(1);
      expect(game.abilityFx![0].startTime).toBe(1000);
    }
  });

  it("Magnet converges (rings inward); the others emanate outward", () => {
    const magnet = makeGame();
    fireAbility("magnet", magnet, 1000, noop);
    expect(magnet.abilityFx![0].expand).toBe(false);

    const shock = makeGame();
    fireAbility("shockwave", shock, 1000, noop);
    expect(shock.abilityFx![0].expand).toBe(true);
  });

  it("an unknown ability id does nothing and queues no burst", () => {
    const game = makeGame();
    expect(fireAbility("nope", game, 1000, noop)).toBe(false);
    expect(game.abilityFx ?? []).toHaveLength(0);
  });
});
