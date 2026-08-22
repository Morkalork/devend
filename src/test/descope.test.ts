/**
 * Descope: delete one obstacle from the map, for good.
 *
 * The counterpart to Scope Creep, and the only ability that changes what the
 * board IS rather than how it behaves. Two-sided by nature: the wall you delete
 * takes the pocket it formed with it.
 *
 * Two things are worth pinning hard. First, the REFUSALS, because both of them
 * protect against a silent loss rather than a visible error: descoping an
 * objective would leave a map whose task no longer exists, and descoping a chest
 * would destroy a reward the player had already earned by finding it. Second,
 * that a refusal costs no charge, since the player cannot see the hit boxes and
 * a near-miss on a thin wall would otherwise read as theft.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {}, playBossChargeSound: () => {}, playPickupClaimedSound: () => {},
  playBossJumpSound: () => {}, playBossLandSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
  vibrateDeath: () => {}, vibrateGameOver: () => {},
}));

import { descopeAt, findDescopeTarget, descopeRefusal } from "@/lib/physics/descope";
import { processDestroysFn } from "@/lib/physics/destructibles";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { getAbility } from "@/lib/abilities";
import { fireTargetedAbility } from "@/lib/abilityEffects";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

/**
 * One of each thing the ability has an opinion about, at known coordinates:
 * a plain wall, a breakable, an objective breakable, a chest and a mover.
 */
const LEVEL = {
  id: "descope-probe", level: 12, sizeThreshold: 40, expectedCuts: 6, points: 20,
  maxBalls: 1, variety: 0, randomShapes: 0,
  entities: [
    { id: "plain", kind: "wall", shape: "rect", x: 100, y: 100, width: 120, height: 120 },
    { id: "soft", kind: "wall", shape: "rect", x: 400, y: 100, width: 120, height: 120,
      breakable: true, hitsToBreak: 3 },
    { id: "task", kind: "wall", shape: "rect", x: 650, y: 100, width: 120, height: 120,
      breakable: true, objective: true, hitsToBreak: 3 },
    { id: "vault", kind: "wall", shape: "rect", x: 100, y: 400, width: 90, height: 90,
      chest: true, breakable: true, hitsToBreak: 2 },
    { id: "patrol", kind: "mover", shape: "rect", x: 400, y: 400, width: 120, height: 40,
      axis: "horizontal", range: 0, speed: 0 },
  ],
} as unknown as LevelConfig;

/** A point inside each entity, for tapping. */
const AT = {
  plain: { x: 160, y: 160 },
  soft: { x: 460, y: 160 },
  task: { x: 710, y: 160 },
  vault: { x: 145, y: 445 },
  patrol: { x: 460, y: 420 },
  nothing: { x: 800, y: 800 },
};

/**
 * Init at level 2, BELOW ROTATION_MIN_LEVEL, so the board holds its authored
 * orientation. From level 4 the run seed picks one of four rotations and every
 * coordinate in AT would land somewhere else, which is the same trap
 * codeFreezeMap.test.ts documents. Rotation is a rigid transform with its own
 * tests; what is under test here is what a tap resolves to, not where it lands.
 */
const AS_LEVEL = 2;

function probe(): CanvasGameState {
  const data = createInitialGameData(LEVEL, AS_LEVEL, DEFAULT_MODIFIERS);
  return {
    ...data, balls: data.balls, walls: data.walls, activeWalls: [],
    movers: data.movers ?? [], objectDebris: [], destructibles: data.destructibles ?? [],
    pendingDestroys: [], pendingWallBreaks: [],
    obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
    stackObjects: data.stackObjects ?? [], fallingObjects: [],
    pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
    coloredAreas: [], activePlaySeconds: 0, creepFactor: 1, ballSpeedScale: 1,
    frozenBallId: null, mapMutator: null, gravityConfig: null,
    objectivesTotal: data.objectivesTotal, objectivesBroken: 0,
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
  } as unknown as CanvasGameState;
}

describe("what the tap resolves to", () => {
  it("finds each kind of obstacle under the point", () => {
    const g = probe();
    expect(findDescopeTarget(g, AT.plain.x, AT.plain.y)?.id).toBe("plain");
    expect(findDescopeTarget(g, AT.soft.x, AT.soft.y)?.id).toBe("soft");
    expect(findDescopeTarget(g, AT.task.x, AT.task.y)?.id).toBe("task");
    expect(findDescopeTarget(g, AT.vault.x, AT.vault.y)?.id).toBe("vault");
    expect(findDescopeTarget(g, AT.patrol.x, AT.patrol.y)?.kind).toBe("mover");
  });

  it("finds nothing on empty board", () => {
    const g = probe();
    expect(findDescopeTarget(g, AT.nothing.x, AT.nothing.y)).toBeNull();
  });
});

describe("what it refuses", () => {
  it("refuses an objective: you may not descope the actual job", () => {
    const g = probe();
    expect(descopeRefusal(findDescopeTarget(g, AT.task.x, AT.task.y))).toBe("objective");
    expect(descopeAt(g, AT.task.x, AT.task.y)).toBe(false);
    expect(g.pendingDestroys).toEqual([]);
  });

  /** Its reward comes from SMASHING it, so deleting it destroys what was owed. */
  it("refuses a chest", () => {
    const g = probe();
    expect(descopeRefusal(findDescopeTarget(g, AT.vault.x, AT.vault.y))).toBe("chest");
    expect(descopeAt(g, AT.vault.x, AT.vault.y)).toBe(false);
    expect(g.pendingDestroys).toEqual([]);
  });

  it("refuses empty board", () => {
    const g = probe();
    expect(descopeRefusal(null)).toBe("none");
    expect(descopeAt(g, AT.nothing.x, AT.nothing.y)).toBe(false);
  });

  it("refuses the same obstacle twice", () => {
    const g = probe();
    expect(descopeAt(g, AT.plain.x, AT.plain.y)).toBe(true);
    expect(descopeAt(g, AT.plain.x, AT.plain.y), "already queued").toBe(false);
    expect(g.pendingDestroys).toHaveLength(1);
  });
});

describe("what it removes", () => {
  it("queues a plain wall, which has no destructible of its own", () => {
    const g = probe();
    expect(findDescopeTarget(g, AT.plain.x, AT.plain.y)?.destructible).toBeUndefined();
    expect(descopeAt(g, AT.plain.x, AT.plain.y)).toBe(true);
    expect(g.pendingDestroys).toHaveLength(1);
  });

  it("queues a breakable through its existing destructible", () => {
    const g = probe();
    const existing = findDescopeTarget(g, AT.soft.x, AT.soft.y)?.destructible;
    expect(existing).toBeTruthy();
    expect(descopeAt(g, AT.soft.x, AT.soft.y)).toBe(true);
    expect(g.pendingDestroys[0]).toBe(existing);
  });

  it("queues a mover", () => {
    const g = probe();
    expect(descopeAt(g, AT.patrol.x, AT.patrol.y)).toBe(true);
    expect(g.pendingDestroys).toHaveLength(1);
  });

  /**
   * A mover crossing a static obstacle overlaps it. The mover is what is drawn
   * on top and what the player is pointing at, so resolving to the wall beneath
   * would delete something they cannot even see at that moment.
   */
  it("prefers the mover when one overlaps a wall", () => {
    const g = probe();
    const mover = g.movers[0];
    const wall = g.stackObjects.find(s => s.id === "plain")!;
    // Park the mover on top of the plain wall.
    const cx = 160, cy = 160;
    mover.polygon = { vertices: [
      { x: cx - 40, y: cy - 20 }, { x: cx + 40, y: cy - 20 },
      { x: cx + 40, y: cy + 20 }, { x: cx - 40, y: cy + 20 },
    ] };
    expect(wall).toBeTruthy();
    expect(findDescopeTarget(g, cx, cy)?.kind).toBe("mover");
  });
});

// ── Through the real destroy pipeline ───────────────────────────────────────

describe("the obstacle actually goes", () => {
  const run = (g: CanvasGameState) =>
    processDestroysFn(g, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} }, AS_LEVEL);

  it("removes a plain wall's polygon and its collision edges", () => {
    const g = probe();
    const before = g.obstaclePolygons.length;
    const edgesBefore = g.walls.filter(w => w.id.startsWith("obstacle-plain-edge-")).length;
    expect(edgesBefore, "the probe wall must have edges, or this proves nothing")
      .toBeGreaterThan(0);

    expect(descopeAt(g, AT.plain.x, AT.plain.y)).toBe(true);
    run(g);

    expect(g.obstaclePolygons.length).toBe(before - 1);
    expect(g.walls.filter(w => w.id.startsWith("obstacle-plain-edge-"))).toHaveLength(0);
  });

  it("leaves every other obstacle standing", () => {
    const g = probe();
    const before = g.obstaclePolygons.length;
    descopeAt(g, AT.plain.x, AT.plain.y);
    run(g);
    for (const id of ["soft", "task", "vault"]) {
      expect(
        g.walls.some(w => w.id.startsWith(`obstacle-${id}-edge-`)),
        `${id} should be untouched`,
      ).toBe(true);
    }
    expect(g.obstaclePolygons.length).toBe(before - 1);
  });

  /** Deleting a wall must not be scored as having smashed an objective. */
  it("never credits an objective, since objectives cannot be descoped anyway", () => {
    const g = probe();
    descopeAt(g, AT.plain.x, AT.plain.y);
    run(g);
    expect(g.objectivesBroken).toBe(0);
  });
});

// ── The catalogue entry and the armed flow ─────────────────────────────────

describe("the ability wiring", () => {
  it("is a targeted ability, or the tap never reaches it", () => {
    const def = getAbility("descope");
    expect(def, "descope missing from abilities.yml").toBeTruthy();
    expect(def!.targeted).toBe(true);
    expect(def!.kind).toBe("descope");
  });

  it("fires through the targeted path and reports whether it removed anything", () => {
    const g = probe();
    expect(fireTargetedAbility("descope", g, 0, AT.plain)).toBe(true);
    expect(g.pendingDestroys).toHaveLength(1);
  });

  /**
   * The whole point of the boolean: the caller spends a charge only on true. A
   * miss must cost nothing, because the player cannot see the hit boxes.
   */
  it("reports false for a miss, so no charge is spent", () => {
    const g = probe();
    expect(fireTargetedAbility("descope", g, 0, AT.nothing)).toBe(false);
    expect(g.pendingDestroys).toEqual([]);
  });

  it("reports false for a refused target", () => {
    const g = probe();
    expect(fireTargetedAbility("descope", g, 0, AT.task)).toBe(false);
    expect(fireTargetedAbility("descope", g, 0, AT.vault)).toBe(false);
    expect(g.pendingDestroys).toEqual([]);
  });
});
