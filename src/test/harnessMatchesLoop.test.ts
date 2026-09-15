/**
 * The headless harness runs the same passes the browser's loop runs.
 *
 * This file exists because headlessGame.ts has now diverged from useGameLoop
 * FIVE times, always in the same shape and always silently:
 *
 *   1. map beats were never ticked, so maps that guarantee their smash clause
 *      with a `breakId` beat were swept without it;
 *   2. the three end-of-frame passes were missing, so breaking something had no
 *      effect on the world while `destroyed` still flipped;
 *   3. the win conditions were only evaluated in reaction to a cut, so every
 *      sweep ever run played a map with no time limit;
 *   4. `game.creepFactor` was seeded to 1 and never moved, so no sweep had
 *      Scope Creep, a beat's speed spike, or a speed mutator's effect on balls;
 *   5. `handleBallCollisions`, `tickCages`, `tickChains`, `updatePickups` and
 *      the whole `spawnTimedBalls` bundle were absent, so balls passed through
 *      one another and a BOSS MAP HAS NEVER BEEN PLAYABLE headlessly.
 *
 * Every one of those was found by accident, months apart, and each time the
 * harness had been cited as evidence in the interval. A bot that plays a
 * different game than the browser is worse than no bot, because it produces
 * numbers people then design against.
 *
 * So this is a SOURCE check, deliberately. There is no way to assert "these two
 * step the same world" from behaviour without reimplementing one of them, and
 * the failure mode is not a wrong value, it is an absent call. Reading both
 * files and comparing which engine passes each one names is crude, and it is
 * the only thing that would have caught all five.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source with its COMMENTS REMOVED.
 *
 * Not a refinement: without it this whole file is decorative. Every check below
 * asks whether a name is called, and both of these files are unusually heavily
 * commented - the harness discusses `handleBallCollisions` by name in three
 * places. Matching raw text meant a pass could be deleted from the code and the
 * guard would still pass on the prose explaining why it was once there. That
 * was verified by deleting one and watching this file stay green.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // A line comment, but not the // in a URL.
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const read = (p: string) => stripComments(readFileSync(resolve(process.cwd(), p), "utf8"));
/**
 * THE REAL FRAME IS TWO FILES. useGameLoop owns the fixed-step body, but the
 * passes it reaches through callbacks - the whole `spawnTimedBalls` bundle, the
 * map beats, the boss - are written in GameCanvas. Reading only the loop is how
 * "the bot has never played a boss map" stayed invisible: the loop calls
 * `callbacks.spawnTimedBalls?.()` and says nothing about what that does.
 */
const LOOP_FILE = read("src/hooks/useGameLoop.ts");
const CANVAS = read("src/components/game/GameCanvas.tsx");
const LOOP = LOOP_FILE + "\n" + CANVAS;
const HARNESS = read("src/lib/bot/headlessGame.ts");

/**
 * Engine passes the loop runs that move the WORLD, and so must appear in the
 * harness too.
 *
 * Adding a name here is how you say "the bot must do this as well". Anything
 * the loop calls that is purely presentational belongs in RENDER_ONLY below,
 * with the reason, rather than being left out of both lists - an unlisted call
 * is one nobody has decided about.
 */
const WORLD_PASSES = [
  "applyLodestones",
  "updateMoverControlFn",
  "updateMoversFn",
  "tickPhasing",
  "tickCages",
  "updateBall",
  "handleBallCollisions",
  "updateLauncherArming",
  "collectDeliveries",
  "tickChains",
  "updatePickups",
  "tickRainbowSpawns",
  "tickBossPhases",
  "tickBossSpit",
  "tickBossFenceWipe",
  "tickMapBeats",
  "tickCharges",
  "tickDrills",
  "creepFactor",
  "updateBallEffects",
  "collectPhasedOut",
] as const;

/**
 * Called by the loop and deliberately NOT by the harness, each with the reason.
 * A name may only join this list with one.
 */
const RENDER_ONLY: Record<string, string> = {
  advanceLamp: "which ball lights the board: a rendering fact with no effect on physics",
  updateChestLoot: "loot gems bouncing on the floor, drawn and then culled",
  applyLockGlide: "interpolates a locked ball's RENDER position toward its pocket",
  updateObstacleImpacts: "decays the dent/bulge visuals an impact leaves behind",
  updateWallImpacts: "the same, for fences",
  renderEmpty: "a renderer call",
};

/**
 * Loop passes the harness runs under a different name.
 *
 * The browser reaches the fence work through callbacks so the component can
 * repaint around it; headlessly there is nothing to repaint, so the harness
 * calls the engine functions straight. Same pass, one less indirection.
 */
const ALIASES: Record<string, string> = {
  updateWall: "updateFenceWallFn",
  applyCut: "applyCutFn",
};

describe("the headless harness runs the browser's passes", () => {
  it("is reading both files, so a rename cannot make this vacuous", () => {
    expect(LOOP.length).toBeGreaterThan(5000);
    expect(HARNESS.length).toBeGreaterThan(2000);
    expect(LOOP).toContain("PHYSICS_STEP");
    expect(HARNESS).toContain("PHYSICS_STEP");
  });

  for (const pass of WORLD_PASSES) {
    it(`runs ${pass}, as the loop does`, () => {
      // Called, not merely imported: `foo(` rather than the identifier alone.
      const called = new RegExp(`\\b${pass}\\s*\\(`);
      expect(called.test(LOOP), `${pass} is not called by useGameLoop`).toBe(true);
      expect(called.test(HARNESS), `${pass} is called by the loop and NOT by the harness`).toBe(true);
    });
  }

  it("has a reason on record for every loop pass the harness skips", () => {
    // Every `xxxFn(` / `tickXxx(` the loop calls, minus what the harness calls,
    // minus the documented render-only set, must be empty.
    // Scoped to useGameLoop's own body: GameCanvas is a component with hundreds
    // of calls that are nothing to do with a frame, and sweeping it here would
    // report noise rather than gaps.
    const calls = new Set(
      [...LOOP_FILE.matchAll(/\b(tick[A-Z]\w+|update[A-Z]\w+|apply[A-Z]\w+|collect[A-Z]\w+|process[A-Z]\w+|handle[A-Z]\w+|advance[A-Z]\w+)\s*\(/g)]
        .map(m => m[1]),
    );
    const unexplained = [...calls]
      .filter(name => {
        const target = ALIASES[name] ?? name;
        return !new RegExp(`\\b${target}\\s*\\(`).test(HARNESS);
      })
      .filter(name => !(name in RENDER_ONLY))
      .sort();
    expect(unexplained, "loop passes the harness neither runs nor explains").toEqual([]);
  });
});

describe("the harness plays the map the player gets", () => {
  it("rolls the mutator from the run seed rather than only reading a pin", () => {
    // The roll is a pure function of the run seed and the level id, exactly
    // like the obstacle variety and ball types the harness already takes from
    // it. Consulting only `level.mutator` meant 78% of real plays of a late map
    // were outside anything a sweep had measured.
    expect(HARNESS).toContain("selectMapMutator");
    expect(HARNESS).toContain("mapMutator:");
  });

  it("keeps a way to hold the weather still, for isolating a map", () => {
    expect(HARNESS).toMatch(/opts\.mutator/);
  });

  it("drives creepFactor from the same four terms the loop multiplies", () => {
    for (const term of ["creepFactor(", "mutatorSpeedFactor(", "abilitySpeedFactor(", "beatSpeedMult"]) {
      expect(HARNESS, `creepFactor is missing ${term}`).toContain(term);
    }
  });
});
