/**
 * Bugs: the flying mini power-ups, and the rules that keep them a decision.
 *
 * Asked for as "mini-powerups. Kind of like how they work in Arkanoid, but with
 * features that better fit the game. But since there might be no gravity on a
 * map, it is likely actually, they should not be falling down, rather fly
 * around. Bugs. If a ball run over it, it splats And give the power it holds."
 *
 * That sentence contains three constraints and this file pins all three:
 *
 *   IT FLIES              no gravity on most of the ladder, so a drop would
 *                         hang or sink. A bug moves under its own power and
 *                         stays in live space.
 *   A BALL CLAIMS IT      not a fence, not a tap. Running it over is the whole
 *                         interaction, and the power lands on the ball that
 *                         did it - which is what makes "which ball do I let
 *                         run, and where" the decision being rewarded.
 *   IT HOLDS A POWER      and each one is double-edged, because a pool of pure
 *                         upside is a chore with a reward attached rather than
 *                         a choice. The honesty of the pool is a property of
 *                         the LIST, so it is checked as one.
 *
 * The pool: six the request named (Bit Rot, Deadlock, Feature Bloat, Branch,
 * Auto Merge, Big Bang Release) and three suggested back (Force Push, All Hands,
 * Caffeine).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAllBugs, getBug, drawBug, bugMagnitude, applyBugCatalogue, isKnownBug,
} from "@/lib/bugs";
import {
  BUG_RADIUS, spawnBug, updateBugs, squashBugs, effectiveBugChance,
  requestBugSpawn, clearPendingBugSpawn, resetBugCounters,
} from "@/lib/physics/bugs";
import { applyBugEffect, expireBugBuffs, MAX_BLOAT_SCALE, resetBugSplitCounter } from "@/lib/physics/bugEffects";
import { isWrecking, isAttracting, WRECKING_DAMAGE_MULTIPLIER } from "@/lib/bugBuffs";
import { isLodestone } from "@/lib/physics/lodestone";
import { ballImpactDamage } from "@/lib/physics/destructibles";
import { ringFits, fittingRingRadius, ringPoints, sealRings } from "@/lib/physics/bugRing";
import { DEFAULT_BUG_CONFIG } from "@/types/bugs";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { CellState, isPositionActive, type SpaceGrid } from "@/lib/spaceGrid";
import { installClock, releaseClock, plainModifiers, createBotGame, stepBot } from "@/lib/bot/headlessGame";
import { LADDER, byLevel } from "./fixtures/maps";
import { setRunSeedText } from "@/lib/runRng";
import { simNow } from "@/lib/simClock";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { WinSpec } from "@/types/winSpec";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

// ── A board built by hand, so every question below has a known answer ───────

/** 900x900 of 15-unit cells, all open. */
function openGrid(): SpaceGrid {
  const n = 60;
  return {
    cellSize: 15, width: n, height: n, originX: 0, originY: 0,
    cells: new Uint8Array(n * n).fill(CellState.ACTIVE),
    initialActiveCount: n * n, activeCount: n * n, cellRegionIds: [],
  } as unknown as SpaceGrid;
}

function testBall(over: Partial<Ball> = {}): Ball {
  return {
    id: "b1",
    position: { x: 450, y: 450 },
    velocity: { x: 250, y: 0 },
    radius: BASE_BALL_RADIUS,
    speed: 250,
    baseSpeed: 250,
    topSpeed: 600,
    minimumSpeed: 60,
    lockMultiplier: 1,
    state: "active",
    typeId: "red",
    ability: "none",
    color: "#ff5b5b",
    ...over,
  } as Ball;
}

function testGame(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    spaceGrid: openGrid(),
    walls: [],
    balls: [],
    regions: [],
    gridRegions: [],
    activePlaySeconds: 0,
    bugs: [],
    bugSplats: [],
    bugConfig: { ...DEFAULT_BUG_CONFIG },
    lastBugRollAt: 0,
    bugRollContext: "bugs:test",
    bugRollIndex: 0,
    pendingDestroys: [],
    pendingWallBreaks: [],
    // What the lock pass reaches for once a ring seals a pocket. A ring is not
    // a special case, so it goes through checkBallWonState like every other
    // seal - which means a fixture that wants to watch one has to be a board
    // the real lock pass can run on.
    assimilations: new Map(),
    lockDust: [],
    lockFlashes: [],
    claimFlashes: [],
    lockedBallsCount: 0,
    superiorLockCount: 0,
    qualifiedOvertime: 0,
    qualifiedLockCount: 0,
    coloredAreas: [],
    gravityWells: [],
    pickups: [],
    pickupFeedback: [],
    pickupLockMarkers: [],
    destructibles: [],
    activeWalls: [],
    ...over,
  } as unknown as CanvasGameState;
}

const SPEC: WinSpec = { require: [{ kind: "space", threshold: 10 }] } as unknown as WinSpec;

/** Everything applyBugEffect needs, with the lock callbacks stubbed out. */
function ctx() {
  return {
    modifiers: plainModifiers(),
    cumulativeLockedBalls: 0,
    spec: SPEC,
    callbacks: {
      setLockedBallsCount: () => { /* counted elsewhere */ },
      // Returns whether the lock was the map's last; false is the honest answer
      // on a fixture board with no win spec behind it.
      onBallTypeLocked: () => false,
      onBallCountChanged: () => { /* ditto */ },
      onBossState: () => { /* ditto */ },
    },
  };
}

/** A deterministic 0..1 generator, so a draw can be aimed at a known entry. */
function fixedRng(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

beforeEach(() => {
  installClock();
  resetBugCounters();
  resetBugSplitCounter();
  clearPendingBugSpawn();
});

afterEach(() => {
  releaseClock();
  // The catalogue is module state; a test that swapped it must not leak.
  applyBugCatalogue(read("public/bugs.yml"));
});

// ── The pool ────────────────────────────────────────────────────────────────

describe("the catalogue", () => {
  it("carries the six that were asked for and the three that were offered", () => {
    const ids = getAllBugs().map(b => b.id);
    for (const asked of ["bitRot", "deadlock", "featureBloat", "branch", "autoMerge", "bigBang"]) {
      expect(ids, `${asked} is missing from bugs.yml`).toContain(asked);
    }
    for (const offered of ["forcePush", "allHands", "caffeine"]) {
      expect(ids, `${offered} is missing from bugs.yml`).toContain(offered);
    }
  });

  it("gives every entry a name, a colour and a weight the draw can use", () => {
    for (const bug of getAllBugs()) {
      expect(bug.name.length, `${bug.id} has no name`).toBeGreaterThan(0);
      expect(bug.color, `${bug.id} has no board colour`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(bug.weight, `${bug.id} has a negative weight`).toBeGreaterThanOrEqual(0);
    }
  });

  it("has no em-dash in anything a player reads (CLAUDE.md)", () => {
    for (const bug of getAllBugs()) {
      expect(bug.name, `${bug.id}'s name has an em-dash`).not.toContain("—");
    }
  });

  it("every catalogue id has an implementation, and none is a silent no-op", () => {
    // A bug in the YAML with no case in applyBugEffect spawns, flies, squashes
    // and declines - which is a visible nothing, but still a nothing. This is
    // the check that keeps the two files in step.
    const source = read("src/lib/physics/bugEffects.ts");
    for (const bug of getAllBugs()) {
      expect(source, `${bug.id} has no case in applyBugEffect`).toContain(`case "${bug.id}":`);
    }
  });

  it("marks the one that can cost you the map, and only that one", () => {
    // `danger` drives a warning ring on the board. Marking everything would
    // make the ring meaningless; marking nothing would make Big Bang Release a
    // trap rather than a choice.
    const dangerous = getAllBugs().filter(b => b.danger).map(b => b.id);
    expect(dangerous).toEqual(["bigBang"]);
  });

  it("keeps the dangerous one rare", () => {
    const all = getAllBugs();
    const total = all.reduce((s, b) => s + b.weight, 0);
    const bigBang = getBug("bigBang")!;
    expect(bigBang.weight / total).toBeLessThan(0.08);
  });

  it("survives a malformed file rather than emptying the pool", () => {
    const before = getAllBugs().length;
    expect(applyBugCatalogue("this: [is not")).toBe(false);
    expect(applyBugCatalogue("bugs: []")).toBe(false);
    expect(getAllBugs().length, "a bad file emptied the catalogue").toBe(before);
    expect(isKnownBug("autoMerge")).toBe(true);
  });
});

describe("the draw", () => {
  it("is weighted, and the same generator always gives the same bug", () => {
    const a = drawBug(fixedRng(0.5))!.id;
    const b = drawBug(fixedRng(0.5))!.id;
    expect(a).toBe(b);
  });

  it("reaches the first and last entries of the pool", () => {
    const pool = getAllBugs().filter(b => b.weight > 0);
    expect(drawBug(fixedRng(0))!.id).toBe(pool[0].id);
    expect(drawBug(fixedRng(0.999999))!.id).toBe(pool[pool.length - 1].id);
  });

  it("never draws a weight-0 entry", () => {
    expect(applyBugCatalogue(`bugs:\n  - id: never\n    weight: 0\n  - id: always\n    weight: 5\n`)).toBe(true);
    for (let i = 0; i < 40; i++) {
      expect(drawBug(fixedRng(i / 40))!.id).toBe("always");
    }
  });

  it("draws a ranged magnitude inside its range, and a flat one exactly", () => {
    const bloat = getBug("featureBloat")!;
    expect(bloat.valueMax, "Feature Bloat is meant to be a range").toBeGreaterThan(bloat.value);
    expect(bugMagnitude(bloat, fixedRng(0))).toBeCloseTo(bloat.value, 6);
    expect(bugMagnitude(bloat, fixedRng(1))).toBeCloseTo(bloat.valueMax!, 6);

    const deadlock = getBug("deadlock")!;
    expect(bugMagnitude(deadlock, fixedRng(0.37))).toBeCloseTo(deadlock.value, 6);
  });
});

// ── Flight ──────────────────────────────────────────────────────────────────

describe("a bug in the air", () => {
  it("spawns in live space, clear of walls and balls", () => {
    const game = testGame({ balls: [testBall()] });
    const bug = spawnBug(game, fixedRng(0.3, 0.6, 0.2, 0.8, 0.5), "bitRot");
    expect(bug).not.toBeNull();
    expect(isPositionActive(game.spaceGrid!, bug!.position)).toBe(true);
    const d = Math.hypot(bug!.position.x - 450, bug!.position.y - 450);
    expect(d, "a bug spawned under the ball").toBeGreaterThan(BUG_RADIUS);
  });

  it("moves without gravity, which is the whole reason it is not a drop", () => {
    const game = testGame();
    spawnBug(game, fixedRng(0.4, 0.5, 0.5, 0.5, 0.5), "bitRot");
    const bug = game.bugs![0];
    const start = { ...bug.position };
    let lowest = bug.position.y;
    for (let i = 0; i < 240; i++) {
      game.activePlaySeconds += 1 / 60;
      updateBugs(game, 1 / 60);
      lowest = Math.max(lowest, bug.position.y);
    }
    const moved = Math.hypot(bug.position.x - start.x, bug.position.y - start.y);
    expect(moved, "the bug never went anywhere").toBeGreaterThan(20);
    // Four seconds of real falling would put it on the floor. It must not have
    // drifted monotonically downward.
    expect(lowest - start.y, "the bug fell like a drop").toBeLessThan(400);
  });

  it("turns rather than flying out through a fence", () => {
    // Box the bug into the top-left ninth of the board and let it fly for ten
    // seconds. It must still be in live space at every step.
    const grid = openGrid();
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        if (row > 20 || col > 20) grid.cells[row * grid.width + col] = CellState.REMOVED;
      }
    }
    const game = testGame({ spaceGrid: grid });
    spawnBug(game, fixedRng(0.1, 0.1, 0.3, 0.7, 0.5), "deadlock");
    const bug = game.bugs![0];
    for (let i = 0; i < 600; i++) {
      game.activePlaySeconds += 1 / 60;
      updateBugs(game, 1 / 60);
      expect(
        isPositionActive(game.spaceGrid!, bug.position),
        `escaped into captured space at step ${i} (${bug.position.x}, ${bug.position.y})`,
      ).toBe(true);
    }
  });

  it("does not teleport across a fence when a frame is enormous", () => {
    // A tab returning from the background hands out a huge dt. Integrated
    // whole, that is a bug several board-widths away, in captured space.
    const game = testGame();
    spawnBug(game, fixedRng(0.5, 0.5, 0.5, 0.5, 0.5), "bitRot");
    const bug = game.bugs![0];
    const before = { ...bug.position };
    game.activePlaySeconds += 4;
    updateBugs(game, 4);
    const jump = Math.hypot(bug.position.x - before.x, bug.position.y - before.y);
    expect(jump, "one frame moved the bug further than it can fly in a step").toBeLessThan(40);
  });

  it("ages out on the active-play clock, so a pause never eats it", () => {
    const game = testGame();
    spawnBug(game, fixedRng(0.5), "bitRot");
    expect(game.bugs!.length).toBe(1);
    // Frames go by, but no active-play time does: the game is paused.
    for (let i = 0; i < 200; i++) updateBugs(game, 1 / 60);
    expect(game.bugs!.length, "a paused game aged the bug out").toBe(1);
    // Chance to zero for the jump: the clock skipping a lifetime also skips
    // the roll cadence, so a board left on its default chance can cull the old
    // bug and spawn a new one in the same call - which is correct behaviour and
    // would make this test read as "it never expired".
    game.bugConfig = { ...DEFAULT_BUG_CONFIG, spawnChance: 0 };
    game.activePlaySeconds += DEFAULT_BUG_CONFIG.lifetimeSeconds + 1;
    updateBugs(game, 1 / 60);
    expect(game.bugs!.length).toBe(0);
  });

  it("holds the simultaneous cap, so the board never becomes a swarm", () => {
    const game = testGame({ bugConfig: { ...DEFAULT_BUG_CONFIG, spawnChance: 1, spawnCheckSeconds: 0 } });
    for (let i = 0; i < 30; i++) {
      game.activePlaySeconds += 1;
      updateBugs(game, 1 / 60);
    }
    expect(game.bugs!.length).toBeLessThanOrEqual(DEFAULT_BUG_CONFIG.maxSimultaneous);
  });

  it("does nothing at all on a map with bugs switched off", () => {
    const game = testGame({ bugConfig: null });
    game.activePlaySeconds += 60;
    updateBugs(game, 1 / 60);
    expect(game.bugs!.length).toBe(0);
  });
});

describe("the map's own say", () => {
  it("bypasses the global gate when a map states a chance", () => {
    const cfg = { ...DEFAULT_BUG_CONFIG, startLevel: 999, spawnChance: 0.35 };
    expect(effectiveBugChance(cfg, 7, undefined), "the gate leaked").toBe(0);
    expect(effectiveBugChance(cfg, 7, 0.5)).toBe(0.5);
  });

  it("lets a map suppress them outright", () => {
    const cfg = { ...DEFAULT_BUG_CONFIG, startLevel: 1, spawnChance: 0.35 };
    expect(effectiveBugChance(cfg, 7, 0)).toBe(0);
  });

  it("is the shape the shipped maps use", () => {
    // The four Demolition maps opted in, and nothing else. This is a design
    // decision that was argued (a Meet beat introduces one thing, so 5 and 6
    // stay out), so it is worth being told when it silently changes.
    const map = read("public/map.yml");
    // Split on the level headers rather than matching across them: a lazy
    // regex over the whole file happily runs from one map's header to a later
    // map's bugChance, which reported levels 1, 8 and 10 as opted in.
    const opted = map.split(/\n {2}- id: level-/).slice(1)
      .filter(block => /^ {4}bugChance: [\d.]+$/m.test(block))
      .map(block => Number(block.split("\n")[0].trim()));
    expect(opted.sort((a, b) => a - b)).toEqual([7, 9, 17, 18]);
    expect(read("public/game-config.yml")).toMatch(/bugs:[\s\S]*?start_level: 999/);
  });
});

// ── The squash ──────────────────────────────────────────────────────────────

describe("squashing", () => {
  it("pays the ball that ran it over, not a random one", () => {
    const squasher = testBall({ id: "squasher", position: { x: 300, y: 300 } });
    const bystander = testBall({ id: "bystander", position: { x: 700, y: 700 } });
    const game = testGame({ balls: [squasher, bystander] });
    spawnBug(game, fixedRng(0.5), "caffeine");
    game.bugs![0].position = { x: 300, y: 300 };

    const before = { squasher: squasher.speed, bystander: bystander.speed };
    squashBugs(game, ctx());
    expect(squasher.speed, "the squasher was not paid").toBeGreaterThan(before.squasher);
    expect(bystander.speed, "a bystander was paid").toBe(before.bystander);
  });

  it("only fires on contact, not on proximity", () => {
    const ball = testBall({ position: { x: 300, y: 300 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "caffeine");
    // Just outside the sum of the radii.
    game.bugs![0].position = { x: 300 + ball.radius + BUG_RADIUS + 2, y: 300 };
    squashBugs(game, ctx());
    expect(game.bugs!.length, "squashed without touching").toBe(1);
    expect(game.bugSplats!.length).toBe(0);
  });

  it("leaves a splat that points the way the ball was going", () => {
    const ball = testBall({ position: { x: 300, y: 300 }, velocity: { x: 0, y: 250 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "deadlock");
    game.bugs![0].position = { x: 300, y: 300 };
    squashBugs(game, ctx());
    expect(game.bugs!.length).toBe(0);
    const splat = game.bugSplats![0];
    expect(splat.applied).toBe(true);
    expect(splat.direction.y).toBeCloseTo(1, 5);
    expect(splat.direction.x).toBeCloseTo(0, 5);
  });

  it("is squashed exactly once, however long the ball sits on it", () => {
    const ball = testBall({ position: { x: 300, y: 300 }, velocity: { x: 0, y: 0 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "branch");
    game.bugs![0].position = { x: 300, y: 300 };
    for (let i = 0; i < 20; i++) squashBugs(game, ctx());
    expect(game.bugSplats!.length, "one bug paid out more than once").toBe(1);
    expect(game.balls.length).toBe(2);
  });

  it("says so when the effect declined, rather than swallowing it", () => {
    // All Hands with nobody to pull: the bug is gone either way, and a splat
    // that claimed a buff nobody got is how a mechanic ships broken.
    const ball = testBall({ position: { x: 300, y: 300 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "allHands");
    game.bugs![0].position = { x: 300, y: 300 };
    squashBugs(game, ctx());
    expect(game.bugSplats![0].applied).toBe(false);
    expect(isAttracting(ball)).toBe(false);
  });

  it("ignores a ball that is already locked away", () => {
    const won = testBall({ id: "won", position: { x: 300, y: 300 }, state: "won" });
    const game = testGame({ balls: [won] });
    spawnBug(game, fixedRng(0.5), "caffeine");
    game.bugs![0].position = { x: 300, y: 300 };
    squashBugs(game, ctx());
    expect(game.bugs!.length, "a locked ball squashed a bug").toBe(1);
  });
});

// ── Each power ──────────────────────────────────────────────────────────────

describe("Bit Rot and Caffeine (the same axis, both ways)", () => {
  it("Bit Rot slows the ball and keeps the heading", () => {
    const ball = testBall();
    const applied = applyBugEffect(testGame(), ball, getBug("bitRot")!, 0, ctx());
    expect(applied).toBe(true);
    expect(ball.speed).toBeLessThan(250);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeCloseTo(ball.speed, 4);
    expect(ball.velocity.y).toBeCloseTo(0, 5);
  });

  it("Bit Rot never slows a ball below its own floor", () => {
    const ball = testBall({ speed: 60, velocity: { x: 60, y: 0 }, minimumSpeed: 60 });
    const applied = applyBugEffect(testGame(), ball, getBug("bitRot")!, 0, ctx());
    expect(ball.speed).toBeGreaterThanOrEqual(60);
    expect(applied, "claimed a slow-down that could not happen").toBe(false);
  });

  it("Caffeine speeds it up and pays the same multiple more", () => {
    const ball = testBall();
    const def = getBug("caffeine")!;
    applyBugEffect(testGame(), ball, def, 0, ctx());
    expect(ball.speed).toBeCloseTo(250 * def.value, 4);
    expect(ball.lockMultiplier).toBeCloseTo(def.value, 4);
    // ...and the ceiling other systems clamp to moved with it, or the next
    // thing that read topSpeed would pull the buff straight back off.
    expect(ball.topSpeed).toBeGreaterThanOrEqual(ball.speed);
  });

  it("they really are opposites, which is what makes reading the bug matter", () => {
    const slow = testBall();
    const fast = testBall();
    applyBugEffect(testGame(), slow, getBug("bitRot")!, 0, ctx());
    applyBugEffect(testGame(), fast, getBug("caffeine")!, 0, ctx());
    expect(slow.speed).toBeLessThan(250);
    expect(fast.speed).toBeGreaterThan(250);
    // And the damage model turns that into the hammer trade the pool promises.
    expect(ballImpactDamage(fast, fast.speed)).toBeGreaterThan(ballImpactDamage(slow, slow.speed));
  });
});

describe("Deadlock", () => {
  it("holds the ball for its stated seconds, on the freeze the game already has", () => {
    const ball = testBall();
    const def = getBug("deadlock")!;
    const t0 = simNow();
    applyBugEffect(testGame(), ball, def, 0, ctx());
    expect(ball.frozenUntil).toBeCloseTo(t0 + def.value * 1000, -1);
  });

  it("never cuts a longer hold short", () => {
    const ball = testBall({ frozenUntil: simNow() + 30_000 });
    applyBugEffect(testGame(), ball, getBug("deadlock")!, 0, ctx());
    expect(ball.frozenUntil).toBeGreaterThan(simNow() + 20_000);
  });
});

describe("Feature Bloat", () => {
  it("grows the ball by the rolled fraction and pays exactly as much more", () => {
    const ball = testBall();
    applyBugEffect(testGame(), ball, getBug("featureBloat")!, 0.6, ctx());
    expect(ball.radius).toBeCloseTo(BASE_BALL_RADIUS * 1.6, 4);
    expect(ball.lockMultiplier, "it grew without paying for it").toBeCloseTo(1.6, 4);
  });

  it("rolls between 50% and 80%, which is what was asked for", () => {
    const def = getBug("featureBloat")!;
    expect(def.value).toBeCloseTo(0.5, 5);
    expect(def.valueMax).toBeCloseTo(0.8, 5);
  });

  it("stops at a ceiling, so a ball can never stop fitting down its own map", () => {
    const ball = testBall();
    for (let i = 0; i < 12; i++) {
      applyBugEffect(testGame(), ball, getBug("featureBloat")!, 0.8, ctx());
    }
    expect(ball.radius).toBeLessThanOrEqual(BASE_BALL_RADIUS * MAX_BLOAT_SCALE + 0.001);
    // ...and at the ceiling it declines rather than paying for growth it did
    // not deliver.
    const before = ball.lockMultiplier;
    expect(applyBugEffect(testGame(), ball, getBug("featureBloat")!, 0.8, ctx())).toBe(false);
    expect(ball.lockMultiplier).toBeCloseTo(before, 6);
  });

  it("measures the ceiling from where the ball started, not from where it got to", () => {
    const ball = testBall();
    applyBugEffect(testGame(), ball, getBug("featureBloat")!, 0.5, ctx());
    expect(ball.bugBaseRadius).toBeCloseTo(BASE_BALL_RADIUS, 6);
  });
});

describe("Branch", () => {
  it("splits the squashing ball, and the clone starts clear of it", () => {
    const ball = testBall();
    const game = testGame({ balls: [ball] });
    expect(applyBugEffect(game, ball, getBug("branch")!, 0, ctx())).toBe(true);
    expect(game.balls.length).toBe(2);
    const clone = game.balls[1];
    const gap = Math.hypot(clone.position.x - ball.position.x, clone.position.y - ball.position.y);
    expect(gap, "the clone was born inside its parent").toBeGreaterThan(ball.radius);
    expect(clone.typeId).toBe(ball.typeId);
  });

  it("does not hand the clone a buff the parent was wearing", () => {
    const ball = testBall({ wreckingUntil: simNow() + 9_000, attractUntil: simNow() + 9_000 });
    const game = testGame({ balls: [ball] });
    applyBugEffect(game, ball, getBug("branch")!, 0, ctx());
    const clone = game.balls[1];
    expect(isWrecking(clone), "Branch doubled a Force Push").toBe(false);
    expect(isAttracting(clone), "Branch doubled an All Hands").toBe(false);
  });
});

describe("Force Push", () => {
  it("triples the damage AND lifts the per-hit cap, or it does nothing to a slab", () => {
    const plain = testBall({ typeId: "black" });
    const wrecking = testBall({ typeId: "black", wreckingUntil: simNow() + 6_000 });
    // At a speed that already pins the ordinary cap: multiplying under the old
    // ceiling would have changed precisely nothing here, which is the case the
    // buff is sold on.
    const capped = ballImpactDamage(plain, 900);
    expect(ballImpactDamage(wrecking, 900)).toBeCloseTo(capped * WRECKING_DAMAGE_MULTIPLIER, 4);
    expect(ballImpactDamage(wrecking, 250)).toBeGreaterThan(ballImpactDamage(plain, 250));
  });

  it("takes a 3-integrity slab in a single ordinary contact", () => {
    const wrecking = testBall({ wreckingUntil: simNow() + 6_000 });
    expect(ballImpactDamage(wrecking, 250)).toBeGreaterThanOrEqual(3);
  });

  it("expires, and the ball goes back to being ordinary", () => {
    const ball = testBall();
    applyBugEffect(testGame(), ball, getBug("forcePush")!, 0, ctx());
    expect(isWrecking(ball)).toBe(true);
    const game = testGame({ balls: [ball] });
    expireBugBuffs(game, simNow() + 60_000);
    expect(ball.wreckingUntil).toBeUndefined();
    expect(isWrecking(ball)).toBe(false);
  });

  it("costs the player their own fences, which is the whole trade", () => {
    // The rule lives in the wall-collision path; this pins that it reads the
    // buff rather than only the black ball's ability.
    const source = read("src/lib/physics/updateBall.ts");
    expect(source).toMatch(/isWrecking\(ball, now\)[\s\S]{0,80}registerFenceFracture/);
  });
});

describe("All Hands", () => {
  it("lends the ball the lodestone's pull, and every reader agrees it has it", () => {
    const ball = testBall();
    const game = testGame({ balls: [ball, testBall({ id: "other", position: { x: 600, y: 600 } })] });
    expect(applyBugEffect(game, ball, getBug("allHands")!, 0, ctx())).toBe(true);
    expect(isAttracting(ball)).toBe(true);
    expect(isLodestone(ball), "the pull was lent but the puller does not pull").toBe(true);
    expect(ball.attractTurnRate).toBeGreaterThan(0);
    expect(ball.attractRadius).toBeGreaterThan(0);
  });

  it("takes the pull back when it expires", () => {
    const ball = testBall();
    const game = testGame({ balls: [ball, testBall({ id: "other", position: { x: 600, y: 600 } })] });
    applyBugEffect(game, ball, getBug("allHands")!, 0, ctx());
    expireBugBuffs(game, simNow() + 60_000);
    expect(isLodestone(ball)).toBe(false);
    expect(ball.attractTurnRate).toBeUndefined();
  });

  it("never disarms a ball whose TYPE is the lodestone", () => {
    // Its pull is not on loan and does not belong to this timer.
    const native = testBall({ ability: "attract", attractTurnRate: 1.6, attractRadius: 320 });
    const game = testGame({ balls: [native] });
    native.attractUntil = simNow() + 10;
    expireBugBuffs(game, simNow() + 60_000);
    expect(isLodestone(native), "a bug's timer switched off a ball type").toBe(true);
    expect(native.attractTurnRate).toBe(1.6);
  });
});

// ── The ring ────────────────────────────────────────────────────────────────

describe("Auto Merge's ring", () => {
  it("closes a ring around the ball and lets the ordinary lock pass take it", () => {
    const ball = testBall({ position: { x: 450, y: 450 } });
    const game = testGame({ balls: [ball] });
    const sealed = sealRings(game, [ball], b => b.radius * 2.6, {
      callbacks: ctx().callbacks, modifiers: plainModifiers(), cumulativeLockedBalls: 0, spec: SPEC,
    });
    expect(sealed.map(b => b.id)).toEqual(["b1"]);
    // Real walls, not a special case: a ring that set a flag would be a second
    // locking mechanism with its own answers to value, quality and the band.
    expect(game.walls.length).toBeGreaterThan(10);
    expect(ball.state, "the ring closed but the ball never locked").toBe("won");
  });

  it("refuses rather than sealing a bystander in with it", () => {
    const ball = testBall({ position: { x: 450, y: 450 } });
    const neighbour = testBall({ id: "n", position: { x: 450 + BASE_BALL_RADIUS * 2, y: 450 } });
    const game = testGame({ balls: [ball, neighbour] });
    expect(ringFits(game, ball, BASE_BALL_RADIUS * 2.6)).toBe(false);
  });

  it("refuses rather than drawing an open arc through captured space", () => {
    const grid = openGrid();
    // Capture everything right of x=450: a ring there would be half a ring.
    for (let row = 0; row < grid.height; row++) {
      for (let col = 30; col < grid.width; col++) grid.cells[row * grid.width + col] = CellState.REMOVED;
    }
    const ball = testBall({ position: { x: 440, y: 300 } });
    const game = testGame({ spaceGrid: grid, balls: [ball] });
    expect(ringFits(game, ball, BASE_BALL_RADIUS * 2.6)).toBe(false);
  });

  it("settles for a tighter ring in a corridor rather than giving up", () => {
    const grid = openGrid();
    // A corridor 150 units wide down the middle.
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        if (col < 25 || col > 34) grid.cells[row * grid.width + col] = CellState.REMOVED;
      }
    }
    const ball = testBall({ position: { x: 445, y: 300 } });
    const game = testGame({ spaceGrid: grid, balls: [ball] });
    const wanted = BASE_BALL_RADIUS * 2.6;
    const got = fittingRingRadius(game, ball, wanted);
    expect(got, "no ring at all in a corridor that has room for a small one").not.toBeNull();
    expect(got!).toBeLessThanOrEqual(wanted);
    expect(got!).toBeGreaterThan(ball.radius);
  });

  it("never kills the ball it closes around", () => {
    // A cut drawn through a ball costs a life. A ring nobody drew must not.
    const ball = testBall({ position: { x: 450, y: 450 } });
    const game = testGame({ balls: [ball] });
    sealRings(game, [ball], b => b.radius * 2.6, {
      callbacks: ctx().callbacks, modifiers: plainModifiers(), cumulativeLockedBalls: 0, spec: SPEC,
    });
    expect(ball.state).not.toBe("dead");
    const points = ringPoints(ball.position, ball.radius * 2.6);
    for (const p of points) {
      const d = Math.hypot(p.x - ball.position.x, p.y - ball.position.y);
      expect(d, "the ring was drawn through the ball").toBeGreaterThan(ball.radius);
    }
  });
});

describe("Big Bang Release", () => {
  it("rings every free ball it can, and the ones it cannot keep playing", () => {
    const room = testBall({ id: "room", position: { x: 200, y: 200 } });
    const alsoRoom = testBall({ id: "alsoRoom", position: { x: 700, y: 700 } });
    // Two balls close together: neither can take a ring without sealing the
    // other in, so both are refused.
    const crowdedA = testBall({ id: "crowdedA", position: { x: 450, y: 200 } });
    const crowdedB = testBall({ id: "crowdedB", position: { x: 450 + BASE_BALL_RADIUS * 2, y: 200 } });
    const game = testGame({ balls: [room, alsoRoom, crowdedA, crowdedB] });

    const applied = applyBugEffect(game, room, getBug("bigBang")!, 0, ctx());
    expect(applied).toBe(true);
    expect(room.state).toBe("won");
    expect(alsoRoom.state).toBe("won");
    expect(crowdedA.state, "a crowded ball was sealed in with its neighbour").toBe("active");
    expect(crowdedB.state).toBe("active");
  });

  it("declines, rather than throwing, when no ball has room at all", () => {
    const a = testBall({ id: "a", position: { x: 450, y: 450 } });
    const b = testBall({ id: "b", position: { x: 450 + BASE_BALL_RADIUS * 2, y: 450 } });
    const game = testGame({ balls: [a, b] });
    expect(applyBugEffect(game, a, getBug("bigBang")!, 0, ctx())).toBe(false);
    expect(game.walls.length, "walls were laid for rings that were refused").toBe(0);
  });
});

// ── Admin (CLAUDE.md: a chance-based mechanic must be forceable) ────────────

describe("admin can reach it", () => {
  it("spawns one on demand, jumping the cadence and the chance both", () => {
    const game = testGame({ bugConfig: { ...DEFAULT_BUG_CONFIG, spawnChance: 0 } });
    requestBugSpawn("bigBang");
    updateBugs(game, 1 / 60);
    expect(game.bugs!.length).toBe(1);
    expect(game.bugs![0].effect).toBe("bigBang");
  });

  it("still cannot conjure one onto a map that has bugs switched off", () => {
    const game = testGame({ bugConfig: null });
    requestBugSpawn("bigBang");
    updateBugs(game, 1 / 60);
    expect(game.bugs!.length).toBe(0);
  });

  it("the request is spent once, not every frame after", () => {
    const game = testGame({ bugConfig: { ...DEFAULT_BUG_CONFIG, spawnChance: 0 } });
    requestBugSpawn("bitRot");
    for (let i = 0; i < 10; i++) {
      game.activePlaySeconds += 1;
      updateBugs(game, 1 / 60);
    }
    expect(game.bugs!.length).toBe(1);
  });

  it("forces WHICH bug the roll draws, without forcing whether", () => {
    const game = testGame({
      bugConfig: { ...DEFAULT_BUG_CONFIG, spawnChance: 1, spawnCheckSeconds: 0 },
      forcedBugEffect: "bigBang",
    });
    game.activePlaySeconds += 1;
    updateBugs(game, 1 / 60);
    expect(game.bugs![0].effect).toBe("bigBang");
  });

  it("has a picker in the Playground and a field in the Map Builder", () => {
    // Source checks for the same reason adminCoverage.test.ts uses them: this
    // is "does a control exist", which no render would show.
    const playground = read("src/components/admin/PlaygroundScreen.tsx");
    expect(playground, "the bug picker is not catalogue-driven").toContain("getAllBugs()");
    expect(playground, "there is no way to spawn one on demand").toContain("requestBugSpawn(");
    expect(read("src/components/admin/LevelPanel.tsx")).toContain('field="bugChance"');
  });
});

// ── On a real map, through the real loop ────────────────────────────────────

/**
 * The unit tests above run on a hand-built board, which proves the RULES and
 * proves nothing at all about the wiring. This drives an actual ladder map
 * through the bot harness - the same tick order the browser runs - so a bug
 * that spawns, flies and is squashed here has been through initGame, the
 * space grid, the physics step and the lock pass.
 *
 * Level 7 rather than 17, and the reason is worth recording: 17's balls start
 * DORMANT and are booted by lighting its circuit terminals, so a harness that
 * only steps time (rather than playing the map) watches three sleeping balls
 * for a minute and squashes nothing. That is the map behaving correctly and the
 * test asking the wrong board. 7 is the other end of the archetype - act I's
 * first real brick wall - and its balls are loose from the first frame.
 */
describe("on a real Demolition map, through the harness", () => {
  it("grows bugs, flies them in live space, and lets a ball squash one", () => {
    setRunSeedText("bugs-integration");
    const level = byLevel(LADDER, 7)!;
    const ctxBot = createBotGame(level, 7, plainModifiers());
    // The sweep leaves bugs off by default (see stepBot); this map wants them.
    // Pinned on and crowded: the shipped map rolls 0.8 with a cap of two, and
    // waiting on that would make this a test of patience. What is being proved
    // is the wiring, not the tuning.
    ctxBot.game.bugConfig = {
      ...DEFAULT_BUG_CONFIG, spawnChance: 1, spawnCheckSeconds: 1, maxSimultaneous: 6,
    };
    ctxBot.game.bugRollContext = "bugs:level-7";

    let everAlive = 0;
    let squashed = 0;
    for (let i = 0; i < 24000; i++) {
      // The map's own clock runs out at 60s with nobody playing it, and a
      // finished board steps no physics: keep the reading inside the map's life.
      if (ctxBot.game.gameOver || ctxBot.game.levelComplete) break;
      stepBot(ctxBot);
      const bugs = ctxBot.game.bugs ?? [];
      everAlive = Math.max(everAlive, bugs.length);
      for (const bug of bugs) {
        expect(
          isPositionActive(ctxBot.game.spaceGrid!, bug.position),
          `a bug left live space at step ${i}`,
        ).toBe(true);
      }
      squashed = (ctxBot.game.bugsSquashedLog ?? []).length;
      if (squashed > 0 && everAlive > 0) break;
    }

    expect(everAlive, "no bug ever appeared on a map with the chance pinned to 1").toBeGreaterThan(0);
    expect(squashed, "a minute of play and no ball ever ran one over").toBeGreaterThan(0);
  }, 120000);

  it("leaves a map with bugs off exactly as it was", () => {
    setRunSeedText("bugs-off");
    const level = byLevel(LADDER, 7)!;
    const ctxBot = createBotGame(level, 7, plainModifiers());
    ctxBot.game.bugConfig = null;
    for (let i = 0; i < 600; i++) stepBot(ctxBot);
    expect(ctxBot.game.bugs ?? []).toHaveLength(0);
    expect(ctxBot.game.bugsSquashedLog ?? []).toHaveLength(0);
  }, 60000);
});
