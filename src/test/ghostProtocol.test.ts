/**
 * Ghost Protocol: a fence you have just started ignores balls for a moment.
 *
 * The early catalogue was 21 Junior upgrades of which only two changed what the
 * player DOES - the freeze ability and the aim line. The rest moved numbers,
 * and nine separate upgrades moved ball size alone, so the first ten levels of
 * every run played the same whatever was bought.
 *
 * This changes the rule the whole game is built on. Normally a ball touching a
 * growing fence costs a life, so you wait for a gap; with grace you stop
 * reading gaps and start reading timing, and cut straight into traffic.
 *
 * The rule was already implemented and already authored - on `Hotfix in Prod`,
 * a LOADOUT gated behind uniqueWinsRequired: 1. The most transformative rule in
 * the game was reachable only by someone who had already finished it.
 *
 * Two things are pinned here, and they are different in kind:
 *   - the WINDOW the cards promise is the window the modifier math produces
 *     (the numbers on a card and the numbers in the code are two statements of
 *     one fact, and they drift);
 *   - the window actually protects a fence, driven through the real fence
 *     updater rather than by reading the source.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { computeGameModifiers, DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { updateFenceWallFn } from "@/lib/physics/updateFenceWall";
import { MINIMUM_WALL_TIME } from "@/lib/gameConstants";
import type { UpgradeConfig } from "@/types/upgrade";
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Ball } from "@/types/game";
import type { LevelConfig } from "@/types/level";

const upgrades = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;

const byId = new Map(upgrades.map(u => [u.id, u]));
const lookup = new Map(upgrades.map(u => [u.id, u]));

const JUNIOR = "ghost_protocol_junior";
const SENIOR = "ghost_protocol_senior";
const PRINCIPAL_A = "ghost_protocol_principal_a";
const PRINCIPAL_B = "ghost_protocol_principal_b";

/** The grace window owning `ids` actually produces. */
function graceFor(ids: string[], busyMap = false) {
  const ctx = {
    level: 5, lives: 3, banked: 0, depth: 0,
    map: {
      balls: busyMap ? 3 : 1,
      hasWell: false, hasMover: false, hasBreakable: false, hasArea: false, hasBoss: false,
    },
  };
  return computeGameModifiers(ids, lookup, undefined, ctx).fenceGraceMs;
}

describe("the family exists and starts at level 1", () => {
  it("is buyable from the first shop", () => {
    const j = byId.get(JUNIOR);
    expect(j, "Ghost Protocol has no Junior tier").toBeTruthy();
    expect(j!.unlockLevel ?? 1).toBe(1);
    expect((j!.prerequisites ?? []).length, "the entry point has a prerequisite").toBe(0);
  });

  it("is off by default, so every other run is untouched", () => {
    expect(DEFAULT_MODIFIERS.fenceGraceMs).toBe(0);
    expect(graceFor([])).toBe(0);
  });
});

describe("the window the cards promise is the window the code gives", () => {
  // fenceGraceMs is ADDITIVE and the catalogue authors families as INCREMENTS
  // with the DESCRIPTION stating the running total. Authored as absolutes the
  // family would stack to 1.25s while every card claimed something smaller,
  // which is the exact copy-versus-code split that has bitten this game before.
  const cases: Array<[string, string[], number, boolean]> = [
    ["Junior alone", [JUNIOR], 200, false],
    ["through Senior", [JUNIOR, SENIOR], 400, false],
    ["through Principal A", [JUNIOR, SENIOR, PRINCIPAL_A], 650, false],
    ["Principal B on a busy map", [JUNIOR, SENIOR, PRINCIPAL_B], 1000, true],
    ["Principal B on a quiet map", [JUNIOR, SENIOR, PRINCIPAL_B], 400, false],
  ];

  for (const [name, ids, expected, busy] of cases) {
    it(`${name} is ${expected}ms`, () => {
      expect(graceFor(ids, busy)).toBe(expected);
    });
  }

  it("states each total on the card in seconds", () => {
    const stated = (id: string) => byId.get(id)!.description!;
    expect(stated(JUNIOR)).toContain("0.2 seconds");
    expect(stated(SENIOR)).toContain("0.4 seconds");
    expect(stated(PRINCIPAL_A)).toContain("0.65 seconds");
    // The conditional side must say what a quiet map still gives, or the
    // player reads "on quieter maps" as "nothing".
    expect(stated(PRINCIPAL_B)).toContain("1 second");
    expect(stated(PRINCIPAL_B)).toContain("0.4 seconds");
  });

  it("keeps the whole family under a cut's own build time at Junior", () => {
    // A cut takes at least MINIMUM_WALL_TIME to build. A Junior window at or
    // past that would make every short snip completely free.
    expect(graceFor([JUNIOR])).toBeLessThan(MINIMUM_WALL_TIME * 1000);
  });

  it("locks the two Principals against each other", () => {
    const a = byId.get(PRINCIPAL_A)!, b = byId.get(PRINCIPAL_B)!;
    expect(a.choiceGroup).toBeTruthy();
    expect(a.choiceGroup).toBe(b.choiceGroup);
  });
});

// ── The rule itself ─────────────────────────────────────────────────────────

const LEVEL = { id: "test", level: 1, sizeThreshold: 20 } as unknown as LevelConfig;

function ballOnTheFence(): Ball {
  return {
    id: "red-0", position: { x: 300, y: 400 }, renderPosition: { x: 300, y: 400 },
    velocity: { x: 0, y: 0 }, speed: 0, baseSpeed: 250, topSpeed: 250, minimumSpeed: 150,
    radius: 18, color: "#ff5b5b", state: "active", ability: "none",
    effects: [], rotation: 0, flashIntensity: 0, regionId: "r0",
  } as unknown as Ball;
}

function growingWall(startedMsAgo: number): GrowingWall {
  return {
    origin: { x: 300, y: 400 },
    direction: { x: 0, y: 1 },
    startWaypoints: [{ x: 300, y: 400 }, { x: 300, y: 100 }],
    endWaypoints: [{ x: 300, y: 400 }, { x: 300, y: 700 }],
    startSegmentIndex: 0, endSegmentIndex: 0,
    startPoint: { x: 300, y: 300 }, endPoint: { x: 300, y: 500 },
    targetStart: { x: 300, y: 100 }, targetEnd: { x: 300, y: 700 },
    thickness: 6, isComplete: false, activeRegionId: "r0",
    startTime: performance.now() - startedMsAgo,
  } as unknown as GrowingWall;
}

function gameWith(ball: Ball): CanvasGameState {
  const g: Record<string, unknown> = {
    balls: [ball], walls: [], obstaclePolygons: [], mirrorPolygons: [], movers: [],
    regions: [{ id: "r0", polygon: { vertices: [] }, estimatedArea: 1, samplePoints: [] }],
    gridRegions: [], spaceGrid: null, boardPolygon: null, activeWalls: [],
    frozenBallId: null, frozenBallPosition: null, frozenBallVelocity: null,
    frozenBallReleaseAt: null, wallShieldsRemaining: 0, pushMode: "none",
    pendingWallBreaks: [], destructibles: [], phasingObjects: [], wallImpacts: [],
    isRecovering: false, recoveryEndTime: 0,
  };
  return g as unknown as CanvasGameState;
}

/** Enough of the callback surface for the collision path to run. */
function callbacks(lives: { value: number }) {
  const noop = () => {};
  return {
    getLives: () => lives.value,
    setLivesRef: (n: number) => { lives.value = n; },
    setDisplayLives: noop, onLivesChange: noop,
    setIsRecovering: noop, setScreenFlash: noop, setIsShaking: noop,
    setWallShieldCount: noop, repaintRegionCanvas: noop, setRemainingPercent: noop,
    flashTimeoutRef: { current: null }, shakeTimeoutRef: { current: null },
  } as never;
}

/** Run one fence step with the given grace, and report whether it cost a life. */
function fenceHitCostsALife(graceMs: number, wallAgeMs: number): boolean {
  const ball = ballOnTheFence();
  const game = gameWith(ball);
  const wall = growingWall(wallAgeMs);
  const lives = { value: 3 };
  updateFenceWallFn(
    1 / 60, game, LEVEL, 1,
    { ...DEFAULT_MODIFIERS, fenceGraceMs: graceMs },
    200, 100, 5,
    callbacks(lives), wall,
  );
  return lives.value < 3;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("a young fence ignores the ball on it", () => {
  it("costs a life with no grace at all, which is the rule being changed", () => {
    // The control. Without this the two tests below could both pass because
    // the ball never touched the fence in the first place.
    expect(fenceHitCostsALife(0, 50), "the ball never hit the fence").toBe(true);
  });

  it("costs nothing while the fence is inside its grace window", () => {
    expect(fenceHitCostsALife(200, 50)).toBe(false);
  });

  it("costs a life once the fence has outgrown the window", () => {
    // The window is a moment, not immunity: the tail of a long cut is still
    // exposed, which is what keeps a big committal cut a decision.
    expect(fenceHitCostsALife(200, 350)).toBe(true);
  });

  it("scales with the window, so buying more of the family buys more cover", () => {
    expect(fenceHitCostsALife(200, 500)).toBe(true);
    expect(fenceHitCostsALife(650, 500)).toBe(false);
  });
});
