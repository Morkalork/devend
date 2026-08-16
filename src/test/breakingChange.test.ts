/**
 * Breaking Change: fewer hits to bring a destructible down, and a fork over
 * what all that smashing is for.
 *
 * The reduction is applied to an object's authored integrity at level init
 * rather than by quietly boosting impact damage. That is the difference between
 * the upgrade doing what it says and doing something that merely feels similar:
 * maxHits is the number the dent rendering, the fatal-hit shatter and the
 * "about three solid hits" calibration all key off, so moving it is what makes
 * a 3-hit crate genuinely a 2-hit crate.
 *
 * Only two reduction steps exist on purpose. Every breakable in map.yml is
 * authored at 2 or 3 hits bar three outliers, and maxHits floors at 1, so after
 * -2 an ordinary crate already comes apart on the first solid contact. A third
 * -1 would be invisible on 14 of the 17 objects in the game, so the last tier
 * is the fork instead.
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { processDestroysFn, BREAK_MULTIPLIER_PER } from "@/lib/physics/destructibles";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { LevelConfig } from "@/types/level";
import type { UpgradeConfig } from "@/types/upgrade";
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";

const mods = (over: Partial<GameModifiers> = {}): GameModifiers =>
  ({ ...DEFAULT_MODIFIERS, ...over });

/** A level with one crate of each authored toughness, plus a mirror. */
const LEVEL = {
  id: "breaking-change", level: 6, sizeThreshold: 40, expectedCuts: 5, points: 40,
  maxBalls: 1, variety: 0, randomShapes: 0,
  entities: [
    { id: "crate-2", kind: "wall", shape: "rect", x: 100, y: 100, width: 60, height: 60, breakable: true, hitsToBreak: 2 },
    { id: "crate-3", kind: "wall", shape: "rect", x: 300, y: 100, width: 60, height: 60, breakable: true, hitsToBreak: 3 },
    { id: "crate-7", kind: "wall", shape: "rect", x: 500, y: 100, width: 60, height: 60, breakable: true, hitsToBreak: 7 },
  ],
} as unknown as LevelConfig;

const integrityOf = (m: GameModifiers) => {
  const data = createInitialGameData(LEVEL, 6, m);
  const out: Record<string, number> = {};
  for (const d of data.destructibles) out[d.id] = d.maxHits;
  return out;
};

describe("fewer hits to break", () => {
  it("leaves everything at its authored toughness with nothing owned", () => {
    expect(integrityOf(mods())).toMatchObject({ "crate-2": 2, "crate-3": 3, "crate-7": 7 });
  });

  it("takes one hit off every destructible at the first tier", () => {
    expect(integrityOf(mods({ destructibleHitsReduction: 1 })))
      .toMatchObject({ "crate-2": 1, "crate-3": 2, "crate-7": 6 });
  });

  it("takes two off at the second, which is one solid contact for most things", () => {
    expect(integrityOf(mods({ destructibleHitsReduction: 2 })))
      .toMatchObject({ "crate-2": 1, "crate-3": 1, "crate-7": 5 });
  });

  /** Nothing may become free, or a map could be cleared by looking at it. */
  it("never drops an object below one hit, however much is owned", () => {
    for (const reduction of [3, 5, 99]) {
      const got = integrityOf(mods({ destructibleHitsReduction: reduction }));
      for (const [id, hits] of Object.entries(got)) {
        expect(hits, `${id} at reduction ${reduction}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ── The fork ────────────────────────────────────────────────────────────────

function gameWith(kind: DestructibleState["kind"], destroyedBy?: string): CanvasGameState {
  const d = {
    id: "obj", kind, hits: 3, maxHits: 3, destroyed: true, destroyedBy,
    obstaclePolygon: { vertices: [{ x: 300, y: 300 }, { x: 360, y: 300 }, { x: 360, y: 360 }, { x: 300, y: 360 }] },
    mirrorPolygon: { vertices: [{ x: 300, y: 300 }, { x: 360, y: 300 }, { x: 360, y: 360 }, { x: 300, y: 360 }] },
    moverId: "mover-1",
  } as unknown as DestructibleState;

  return {
    destructibles: [d], pendingDestroys: [d],
    stackObjects: [], mirrorPolygons: [], obstaclePolygons: [], objectDebris: [],
    movers: [{ id: "mover-1", polygon: { vertices: [{ x: 300, y: 300 }, { x: 360, y: 300 }, { x: 360, y: 360 }, { x: 300, y: 360 }] } }],
    balls: [{ id: "black-1", lockMultiplier: 4, state: "active" }],
    walls: [], regions: [], chestLoot: [],
    breakBonus: 0, breakMultiplier: 1, objectivesBroken: 0,
    activePlaySeconds: 4, spaceGrid: null,
  } as unknown as CanvasGameState;
}

const smash = (game: CanvasGameState, m?: GameModifiers) =>
  processDestroysFn(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} }, 18, m);

describe("Write-Off: smashing compounds the payout harder", () => {
  it("compounds at the base rate without it", () => {
    const game = gameWith("breakable");
    smash(game, mods());
    expect(game.breakMultiplier).toBeCloseTo(BREAK_MULTIPLIER_PER, 5);
  });

  it("adds its bonus to every smash", () => {
    const game = gameWith("breakable");
    smash(game, mods({ breakMultiplierBonus: 0.15 }));
    expect(game.breakMultiplier).toBeCloseTo(BREAK_MULTIPLIER_PER + 0.15, 5);
  });

  it("compounds, so a demolition run pulls away from the base rate", () => {
    const plain = gameWith("breakable");
    const upgraded = gameWith("breakable");
    for (let i = 0; i < 4; i++) {
      plain.pendingDestroys = [plain.destructibles[0]];
      upgraded.pendingDestroys = [upgraded.destructibles[0]];
      smash(plain, mods());
      smash(upgraded, mods({ breakMultiplierBonus: 0.15 }));
    }
    expect(upgraded.breakMultiplier).toBeGreaterThan(plain.breakMultiplier * 1.5);
  });

  it("is never dragged below the base rate by a negative value", () => {
    const game = gameWith("breakable");
    smash(game, mods({ breakMultiplierBonus: -5 }));
    expect(game.breakMultiplier).toBeCloseTo(BREAK_MULTIPLIER_PER, 5);
  });
});

/**
 * Destroying a mirror or a mover costs the ball a point of lock multiplier. It
 * is the price of wrecking: the ball that smashes is worth less when it is
 * finally sealed away. Blameless Postmortem is the fork that waives it, which
 * only means anything because the cost is real.
 */
describe("Blameless Postmortem: smashing stops costing the lock", () => {
  for (const kind of ["mirror", "mover"] as const) {
    it(`still costs a point on a ${kind} without it`, () => {
      const game = gameWith(kind, "black-1");
      smash(game, mods());
      expect(game.balls[0].lockMultiplier).toBe(3);
    });

    it(`keeps the multiplier on a ${kind} with it`, () => {
      const game = gameWith(kind, "black-1");
      smash(game, mods({ smashKeepsLockMultiplier: 1 }));
      expect(game.balls[0].lockMultiplier).toBe(4);
    });
  }

  it("does not touch a ball that broke an ordinary crate either way", () => {
    for (const m of [mods(), mods({ smashKeepsLockMultiplier: 1 })]) {
      const game = gameWith("breakable", "black-1");
      smash(game, m);
      expect(game.balls[0].lockMultiplier).toBe(4);
    }
  });

  it("survives a caller that passes no modifiers at all", () => {
    const game = gameWith("mirror", "black-1");
    expect(() => smash(game, undefined)).not.toThrow();
    expect(game.balls[0].lockMultiplier).toBe(3); // unowned behaviour
  });
});

// ── The catalogue entry ─────────────────────────────────────────────────────

describe("the family as authored", () => {
  const UPGRADES = (yaml.load(
    readFileSync(resolve(__dirname, "../../public/upgrades.yml"), "utf8"),
  ) as { upgrades: UpgradeConfig[] }).upgrades;
  const family = UPGRADES.filter(u => u.name === "Breaking Change");

  it("reduces by exactly one per tier, so the tiers sum to two", () => {
    const trunk = family.filter(u => !u.choiceGroup);
    expect(trunk.map(u => u.tier)).toEqual(["Junior", "Senior"]);
    const total = trunk.reduce((n, u) => n + (u.modifiers.destructibleHitsReduction ?? 0), 0);
    expect(total).toBe(2);
  });

  /**
   * The fork must not sneak in a third reduction: both options are meant to be
   * about what demolition GIVES you, not more of the same.
   */
  it("adds no further reduction at the fork", () => {
    for (const opt of family.filter(u => u.choiceGroup)) {
      expect(opt.modifiers.destructibleHitsReduction ?? 0, opt.id).toBe(0);
    }
  });

  it("forks into exactly two options at its last tier", () => {
    const options = family.filter(u => u.choiceGroup === "breaking_change_principal");
    expect(options).toHaveLength(2);
    expect(new Set(options.map(o => o.tier))).toEqual(new Set(["Principal"]));
    // One pays, one protects: the fork is a real decision, not two flavours.
    expect(options.some(o => (o.modifiers.breakMultiplierBonus ?? 0) > 0)).toBe(true);
    expect(options.some(o => (o.modifiers.smashKeepsLockMultiplier ?? 0) > 0)).toBe(true);
  });

  it("unlocks in tier order", () => {
    const levels = ["Junior", "Senior", "Principal"].map(
      t => Math.min(...family.filter(u => u.tier === t).map(u => u.unlockLevel ?? 1)),
    );
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});
