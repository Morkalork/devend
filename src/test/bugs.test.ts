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
  authoredBugCarriers,
} from "@/lib/bugs";
import {
  BUG_RADIUS, BUG_TAP_SLOP, spawnBug, updateBugs, squashBugs, effectiveBugChance,
  requestBugSpawn, clearPendingBugSpawn, resetBugCounters, tapSquashBug, bugAtTap,
  assignShardBugs, releaseBugFrom, mapHasBugs,
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
import type { Ball, DestructibleState } from "@/types/game";
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
  // Neither may the run seed. The integration tests below arm one, and an
  // armed seed turns getRunRng from a Math.random passthrough into a
  // deterministic stream for EVERY later file sharing this worker - which
  // would quietly make another suite's random map deals repeat one deal.
  setRunSeedText(null);
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
    game.activePlaySeconds += DEFAULT_BUG_CONFIG.lifetimeSeconds + 1;
    updateBugs(game, 1 / 60);
    expect(game.bugs!.length).toBe(0);
  });

  it("never appears out of thin air, however long the map runs", () => {
    // The timed spawn is gone. A bug comes out of a shard or it does not come
    // at all, which is what makes "they are released from breaking a specific
    // shard" a rule rather than a tendency.
    const game = testGame();
    for (let i = 0; i < 400; i++) {
      game.activePlaySeconds += 0.5;
      updateBugs(game, 1 / 60);
    }
    expect(game.bugs!.length, "a bug arrived with no shard behind it").toBe(0);
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
    expect(splat.outcome).toBe("paid");
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
    expect(game.bugSplats![0].outcome).toBe("declined");
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
    const game = testGame();
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
    const game = testGame();
    requestBugSpawn("bitRot");
    for (let i = 0; i < 10; i++) {
      game.activePlaySeconds += 1;
      updateBugs(game, 1 / 60);
    }
    expect(game.bugs!.length).toBe(1);
  });

  it("forces WHICH bug the roll draws, without forcing whether", () => {
    const game = testGame({
      bugConfig: { ...DEFAULT_BUG_CONFIG },
      forcedBugEffect: "bigBang",
    });
    requestBugSpawn("bigBang");
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
  it("carries bugs in its shards, lets them out on a break, and flies them", () => {
    setRunSeedText("bugs-integration");
    const level = byLevel(LADDER, 7)!;
    // Every eligible shard carries one and the cap is lifted, so the break is
    // what is being measured rather than the roll.
    const ctxBot = createBotGame(level, 7, plainModifiers(), {
      bugs: { ...DEFAULT_BUG_CONFIG, carryChance: 1, maxPerMap: 99 },
    });

    const carriers = ctxBot.game.destructibles.filter(d => d.bug);
    expect(carriers.length, "the map was dealt with no shard carrying anything").toBeGreaterThan(0);

    let everAlive = 0;
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
      if (everAlive > 0) break;
    }

    expect(everAlive, "the bricks broke and nothing came out of any of them").toBeGreaterThan(0);
  }, 120000);

  it("leaves a map with bugs off exactly as it was", () => {
    setRunSeedText("bugs-off");
    const level = byLevel(LADDER, 7)!;
    const ctxBot = createBotGame(level, 7, plainModifiers());  // bugs off by default
    expect(ctxBot.game.bugConfig).toBeNull();
    expect(ctxBot.game.destructibles.some(d => d.bug), "a sweep grew bugs it did not ask for").toBe(false);
    for (let i = 0; i < 600; i++) stepBot(ctxBot);
    expect(ctxBot.game.bugs ?? []).toHaveLength(0);
    expect(ctxBot.game.bugsSquashedLog ?? []).toHaveLength(0);
  }, 60000);
});

// ── Tapping one ─────────────────────────────────────────────────────────────

/**
 * A tap kills a bug and pays nothing.
 *
 * Asked for as "Maybe [the player] should just tap it to splat it?", after
 * press-and-hold turned out to be unperformable on a nine-unit moving target.
 * The reason it kills rather than claims is the mechanic's own premise: the
 * power belongs to the ball that earns it, and a tap that paid out would make
 * every bug free and delete the question the pool exists to ask ("which ball,
 * and where do I let it run").
 *
 * So the tap is the OTHER half of that question: refusal. Big Bang Release
 * wears a warning ring, and this is what a player can do about it besides hope.
 */
describe("tapping a bug", () => {
  it("kills it, and pays nothing to anybody", () => {
    const ball = testBall({ position: { x: 800, y: 800 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "caffeine");
    const before = { speed: ball.speed, mult: ball.lockMultiplier };

    expect(tapSquashBug(game, game.bugs![0].id)).toBe(true);
    expect(game.bugs!.length, "the bug survived the tap").toBe(0);
    expect(ball.speed, "a tap paid a ball that was nowhere near it").toBe(before.speed);
    expect(ball.lockMultiplier).toBe(before.mult);
  });

  it("is how you refuse the one that can end the map", () => {
    // The ball sits at the board's middle, which is where fixedRng(0.5) would
    // put the bug: a different draw, or the spawn is refused for clearance and
    // the test reads as a failure of the tap.
    const game = testGame({ balls: [testBall()] });
    spawnBug(game, fixedRng(0.2), "bigBang");
    tapSquashBug(game, game.bugs![0].id);
    expect(game.bugs!).toHaveLength(0);
    // Nothing was sealed: no ring was ever laid.
    expect(game.walls).toHaveLength(0);
  });

  it("still names it, so refusing one is how you learn what it was", () => {
    const game = testGame();
    spawnBug(game, fixedRng(0.5), "forcePush");
    tapSquashBug(game, game.bugs![0].id);
    const splat = game.bugSplats![0];
    expect(splat.effect).toBe("forcePush");
    expect(splat.outcome).toBe("denied");
  });

  it("bursts radially rather than spraying, because nothing hit it", () => {
    // The direction is what tells "a ball did this" from "I did this" before
    // the name has even been read. A tap has no heading to spray along.
    const game = testGame();
    spawnBug(game, fixedRng(0.5), "branch");
    tapSquashBug(game, game.bugs![0].id);
    expect(game.bugSplats![0].direction).toEqual({ x: 0, y: 0 });
  });

  it("reads as refused rather than as an effect that misfired", () => {
    // Three outcomes and not two: a denied bug keeps its colour, a declined one
    // goes grey and struck through. Drawing a deliberate refusal as a misfire
    // would tell the player their tap failed.
    const game = testGame({ balls: [testBall({ position: { x: 300, y: 300 } })] });
    spawnBug(game, fixedRng(0.5), "allHands");
    game.bugs![0].position = { x: 300, y: 300 };
    squashBugs(game, ctx());              // no other ball to pull: declines
    spawnBug(game, fixedRng(0.5), "allHands");
    tapSquashBug(game, game.bugs![0].id);
    expect(game.bugSplats!.map(s => s.outcome)).toEqual(["declined", "denied"]);
  });

  it("logs the refusal, so the map's tally is not a lie", () => {
    const game = testGame();
    spawnBug(game, fixedRng(0.5), "bitRot");
    tapSquashBug(game, game.bugs![0].id);
    expect(game.bugsSquashedLog).toEqual([{ effect: "bitRot", outcome: "denied" }]);
  });

  it("does nothing at all for a bug that is already gone", () => {
    // A ball reached it first, or it expired, between the finger going down and
    // the command being applied a frame later. Both are misses, not errors.
    const game = testGame();
    expect(tapSquashBug(game, "bug-does-not-exist")).toBe(false);
    expect(game.bugSplats ?? []).toHaveLength(0);
  });
});

describe("finding the bug under a finger", () => {
  it("is generous enough to hit something this small and this fast", () => {
    const game = testGame();
    spawnBug(game, fixedRng(0.5), "deadlock");
    const bug = game.bugs![0];
    const at = { x: bug.position.x + BUG_RADIUS + BUG_TAP_SLOP - 1, y: bug.position.y };
    expect(bugAtTap(game, at)?.id).toBe(bug.id);
  });

  it("does not claim a bug the finger missed", () => {
    const game = testGame();
    spawnBug(game, fixedRng(0.5), "deadlock");
    const bug = game.bugs![0];
    const at = { x: bug.position.x + BUG_RADIUS + BUG_TAP_SLOP + 20, y: bug.position.y };
    expect(bugAtTap(game, at)).toBeNull();
  });

  it("takes the nearest when two are within reach", () => {
    const game = testGame();
    // Two different draws: one generator twice puts both at the same spot, and
    // the second spawn is then refused for sitting on top of the first.
    spawnBug(game, fixedRng(0.2), "bitRot");
    spawnBug(game, fixedRng(0.8), "caffeine");
    game.bugs![0].position = { x: 400, y: 400 };
    game.bugs![1].position = { x: 415, y: 400 };
    expect(bugAtTap(game, { x: 403, y: 400 })?.id).toBe(game.bugs![0].id);
    expect(bugAtTap(game, { x: 413, y: 400 })?.id).toBe(game.bugs![1].id);
  });

  it("is a command carrying the bug's id, not the point it was tapped at", () => {
    // A bug moves every frame, and a command is applied on the next one, so
    // "the bug nearest this point" would resolve to a different bug (or none)
    // by the time it ran. Same rule the tappable ball follows.
    const input = read("src/hooks/useGameInput.ts");
    expect(input).toMatch(/kind:\s*"tapBug"[\s\S]{0,80}bugId:\s*bug\.id/);
    const commands = read("src/lib/net/commands.ts");
    expect(commands).toMatch(/kind:\s*"tapBug";\s*player:\s*PlayerId;\s*bugId:\s*string/);
    expect(commands, "a tap does not travel to the other device").toContain('case "tapBug"');
  });
});

// ── Where they come from ────────────────────────────────────────────────────

/**
 * A bug is carried by a shard and released when that shard breaks.
 *
 * Asked for as "it must be clear that they are released from breaking a
 * specific shard". The old timed spawn is gone, and its going is the point: a
 * bug rolled onto the board on a clock was weather, and steering a ball into
 * one was a lottery nobody could set up. Held in a named brick it is a target,
 * and the fence drawn to reach that brick is the play.
 */
function shard(id: string, over: Partial<DestructibleState> = {}): DestructibleState {
  return {
    id,
    kind: "breakable",
    hits: 0,
    maxHits: 1,
    lastHitAt: 0,
    destroyed: false,
    ...over,
  } as DestructibleState;
}

describe("shards carrying bugs", () => {
  it("honours an authored carrier exactly, kind and all", () => {
    const shards = [shard("plain"), shard("named")];
    assignShardBugs(shards, 0, 99, new Map([["named", "bigBang"]]));
    expect(shards[1].bug).toBe("bigBang");
    expect(shards[0].bug, "a shard nobody authored was given one at chance 0").toBeUndefined();
  });

  it("lets an authored carrier through the per-map cap", () => {
    // A map that says a brick holds Big Bang Release means it. A cap silently
    // dropping it would be a set piece that vanished for no stated reason.
    const shards = [shard("a"), shard("b"), shard("c")];
    assignShardBugs(shards, 0, 1, new Map<string, boolean | string>([["a", "bigBang"], ["b", "forcePush"], ["c", true]]));
    expect(shards.filter(d => d.bug).length).toBe(3);
  });

  it("fills the rest by chance, up to the cap", () => {
    const shards = Array.from({ length: 20 }, (_, i) => shard(`s${i}`));
    assignShardBugs(shards, 1, 3, new Map());
    expect(shards.filter(d => d.bug).length).toBe(3);
  });

  it("never puts one in a chest", () => {
    // A brick holding two rewards is a brick nobody can read.
    const shards = [shard("chest", { chest: true }), shard("plain")];
    assignShardBugs(shards, 1, 99, new Map());
    expect(shards[0].bug, "a chest was given a bug as well").toBeUndefined();
    expect(shards[1].bug).toBeTruthy();
  });

  it("respects a shard the map explicitly keeps clear", () => {
    const shards = [shard("keepClear"), shard("other")];
    assignShardBugs(shards, 1, 99, new Map([["keepClear", false]]));
    expect(shards[0].bug).toBeUndefined();
    expect(shards[1].bug).toBeTruthy();
  });

  it("is seeded, so both halves of a pair deal the same bricks", () => {
    setRunSeedText("carry-seed");
    const a = Array.from({ length: 12 }, (_, i) => shard(`s${i}`));
    assignShardBugs(a, 0.5, 99, new Map());
    setRunSeedText("carry-seed");
    const b = Array.from({ length: 12 }, (_, i) => shard(`s${i}`));
    assignShardBugs(b, 0.5, 99, new Map());
    expect(b.map(d => d.bug)).toEqual(a.map(d => d.bug));
  });

  it("reads the authored carriers straight off the level", () => {
    const authored = authoredBugCarriers({
      entities: [
        { id: "a", bug: "forcePush" },
        { id: "b", bug: true },
        { id: "c", bug: false },
        { id: "d" },
      ],
    });
    expect(authored.get("a")).toBe("forcePush");
    expect(authored.get("b")).toBe(true);
    expect(authored.get("c")).toBe(false);
    expect(authored.has("d"), "a shard that says nothing became an entry").toBe(false);
  });

  it("is what level 17 promises: one named brick holds the hammer", () => {
    const level = byLevel(LADDER, 17)!;
    const authored = authoredBugCarriers(level as { entities?: { id?: string; bug?: boolean | string }[] });
    expect([...authored.entries()]).toEqual([["brick-a1", "forcePush"]]);
  });
});

describe("whether a map has bugs at all", () => {
  it("says yes on any map with a chance", () => {
    expect(mapHasBugs(0.3, new Map())).toBe(true);
  });

  it("says no on a map with neither a chance nor an authored carrier", () => {
    expect(mapHasBugs(0, new Map())).toBe(false);
    expect(mapHasBugs(0, new Map([["a", false]]))).toBe(false);
  });

  it("says YES for an authored carrier even at chance zero", () => {
    // The bug this replaced, found by putting a pinned carrier on a board and
    // watching it not appear: the chance gate nulled the config before the
    // assignment could honour anything, so a map that named a brick by hand
    // and left bugChance alone got no bugs whatsoever, and the set piece
    // vanished with nothing said. The chance governs the RANDOM FILL only.
    expect(mapHasBugs(0, new Map([["brick", "forcePush"]]))).toBe(true);
    expect(mapHasBugs(0, new Map([["brick", true]]))).toBe(true);
  });

  it("makes chance 0 the useful setting it reads as: these shards and no others", () => {
    const shards = [shard("named"), shard("a"), shard("b"), shard("c")];
    assignShardBugs(shards, 0, 99, new Map([["named", "bigBang"]]));
    expect(shards.map(d => d.bug)).toEqual(["bigBang", undefined, undefined, undefined]);
  });
});

describe("releasing one", () => {
  it("puts it exactly where the shard stood", () => {
    const game = testGame();
    const d = shard("brick", { bug: "forcePush" });
    const bug = releaseBugFrom(game, d, { x: 321, y: 654 });
    expect(bug).not.toBeNull();
    expect(bug!.position).toEqual({ x: 321, y: 654 });
    expect(bug!.effect).toBe("forcePush");
    expect(game.bugs!).toHaveLength(1);
  });

  it("marks where it came from, so the burst can stay on the shard", () => {
    const game = testGame({ activePlaySeconds: 12 });
    const bug = releaseBugFrom(game, shard("brick", { bug: "branch" }), { x: 100, y: 100 })!;
    expect(bug.bornAtSeconds).toBe(12);
    expect(bug.spawnPosition).toEqual({ x: 100, y: 100 });
  });

  it("spends the shard, so one brick can never pay twice", () => {
    const game = testGame();
    const d = shard("brick", { bug: "branch" });
    expect(releaseBugFrom(game, d, { x: 100, y: 100 })).not.toBeNull();
    expect(d.bug).toBeUndefined();
    expect(releaseBugFrom(game, d, { x: 100, y: 100 })).toBeNull();
    expect(game.bugs!).toHaveLength(1);
  });

  it("does nothing for a shard that was carrying nothing", () => {
    const game = testGame();
    expect(releaseBugFrom(game, shard("empty"), { x: 1, y: 1 })).toBeNull();
    expect(game.bugs ?? []).toHaveLength(0);
  });

  it("fires from the break itself, not from a later tick", () => {
    // The rule lives in the destroy path; this pins that it is wired there, so
    // a bug can never appear a beat after the shard it came out of.
    const source = read("src/lib/physics/destructibles.ts");
    expect(source).toMatch(/d\.bug && d\.obstaclePolygon[\s\S]{0,140}releaseBugFrom/);
  });
});

// ── Stepping in front of a ball ─────────────────────────────────────────────

/**
 * "To make it a little more likely that a ball hit one of them, which it
 * almost never does now, bugs should try to step in front of balls that come
 * near them. A little help, albeit not too overly obvious."
 *
 * Both halves are tested: that it helps at all, and that the help stays small.
 * The second is the harder one to keep, and the one a later tuning pass is most
 * likely to break.
 */
describe("a bug stepping into a ball's path", () => {
  /** Fly a bug for `seconds` and report how close the ball ever came. */
  function closestApproach(game: CanvasGameState, seconds: number): number {
    let best = Infinity;
    const dt = 1 / 120;
    for (let i = 0; i < seconds / dt; i++) {
      game.activePlaySeconds += dt;
      updateBugs(game, dt);
      for (const ball of game.balls) {
        ball.position.x += ball.velocity.x * dt;
        ball.position.y += ball.velocity.y * dt;
        for (const bug of game.bugs ?? []) {
          best = Math.min(best, Math.hypot(ball.position.x - bug.position.x, ball.position.y - bug.position.y));
        }
      }
    }
    return best;
  }

  it("closes the near miss it was asked to close", () => {
    // A ball passing about 60 units to one side: close enough to notice, far
    // enough that an indifferent bug would sail past it. Averaged over several
    // starting phases, because one bug's wander is not evidence of anything.
    let helped = 0;
    let ignored = 0;
    for (let seed = 0; seed < 8; seed++) {
      const start = { x: 200, y: 300 };
      const mk = () => {
        const ball = testBall({ position: { x: 60, y: 360 }, velocity: { x: 260, y: 0 } });
        const game = testGame({ balls: [ball] });
        spawnBug(game, fixedRng(0.5), "bitRot");
        game.bugs![0].position = { ...start };
        game.bugs![0].wander = seed;
        game.bugs![0].wanderSeed = seed * 0.7;
        return game;
      };
      const withHelp = closestApproach(mk(), 1.4);
      // The same board with the ball parked, so the bug has nothing to step
      // for: that is the indifferent path this replaced.
      const idle = mk();
      idle.balls[0].velocity = { x: 0, y: 0 };
      const noHelp = closestApproach(idle, 1.4);
      if (withHelp < noHelp) helped++; else ignored++;
    }
    expect(helped, `only ${helped} of 8 runs closed the gap`).toBeGreaterThanOrEqual(6);
  });

  it("ignores a ball that is going the other way", () => {
    // Stepping in front of a ball that is leaving means chasing it down from
    // behind, which is the single most obvious thing a bug could do.
    const ball = testBall({ position: { x: 300, y: 300 }, velocity: { x: -260, y: 0 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "bitRot");
    const bug = game.bugs![0];
    bug.position = { x: 420, y: 300 };
    const before = bug.position.x;
    for (let i = 0; i < 60; i++) {
      game.activePlaySeconds += 1 / 60;
      updateBugs(game, 1 / 60);
      ball.position.x += ball.velocity.x / 60;
    }
    // It may wander anywhere; what it must not do is track the departing ball.
    const chased = bug.position.x < before - 120;
    expect(chased, "the bug set off after a ball that was leaving").toBe(false);
  });

  it("ignores a ball too far away to be about to arrive", () => {
    const ball = testBall({ position: { x: 20, y: 300 }, velocity: { x: 260, y: 0 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "bitRot");
    const bug = game.bugs![0];
    bug.position = { x: 800, y: 300 };
    const startY = bug.position.y;
    for (let i = 0; i < 30; i++) {
      game.activePlaySeconds += 1 / 60;
      updateBugs(game, 1 / 60);
    }
    // Half a second at this distance is pure wander: it cannot have homed.
    expect(Math.abs(bug.position.y - startY)).toBeLessThan(60);
  });

  it("stays a skitter, not a homing missile", () => {
    // The help is capped well under the bug's own wander, so even flying
    // straight at a stationary target it does not arrive in a straight line.
    // A beeline would cover the distance almost exactly; this must not.
    const ball = testBall({ position: { x: 100, y: 300 }, velocity: { x: 200, y: 0 } });
    const game = testGame({ balls: [ball] });
    spawnBug(game, fixedRng(0.5), "bitRot");
    const bug = game.bugs![0];
    bug.position = { x: 240, y: 300 };
    const start = { ...bug.position };
    let travelled = 0;
    for (let i = 0; i < 90; i++) {
      const was = { ...bug.position };
      game.activePlaySeconds += 1 / 60;
      updateBugs(game, 1 / 60);
      travelled += Math.hypot(bug.position.x - was.x, bug.position.y - was.y);
    }
    const net = Math.hypot(bug.position.x - start.x, bug.position.y - start.y);
    // A straight line would put net/travelled near 1.
    expect(net / Math.max(travelled, 1), "the bug flew straight at the ball").toBeLessThan(0.9);
  });

  it("never lets the help drive it through a fence", () => {
    // The wall check runs after the assist, not before it: a bug that could be
    // lured into captured space would be a power-up the board could eat.
    const grid = openGrid();
    for (let row = 0; row < grid.height; row++) {
      for (let col = 30; col < grid.width; col++) grid.cells[row * grid.width + col] = CellState.REMOVED;
    }
    // Ball beyond the captured edge, driving toward the bug.
    const ball = testBall({ position: { x: 300, y: 300 }, velocity: { x: 260, y: 0 } });
    const game = testGame({ spaceGrid: grid, balls: [ball] });
    // A draw well clear of the ball: one generator returns the same point on
    // every attempt, so a spot inside the ball's clearance is 40 refusals and
    // no bug at all.
    spawnBug(game, fixedRng(0.1), "bitRot");
    const bug = game.bugs![0];
    bug.position = { x: 400, y: 300 };
    for (let i = 0; i < 300; i++) {
      game.activePlaySeconds += 1 / 60;
      updateBugs(game, 1 / 60);
      expect(isPositionActive(grid, bug.position), `left live space at step ${i}`).toBe(true);
    }
  });
});
