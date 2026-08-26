/**
 * Level 19, played out many times: no ball may ever stop moving.
 *
 * Reported from a real session: "balls stopping to bounce for some reason".
 *
 * That is not cosmetic. The game is a race between the space you are sealing
 * and the balls you have to dodge, so a ball at rest is one you can fence
 * around for free - or, worse, one wedged where a fence can never be finished,
 * on a map whose win gate is a size threshold.
 *
 * It is also a rule the design states outright. mapMutators.yml, on the gravity
 * mutator: the pull bends a ball's HEADING and never its speed, precisely so
 * "they must bounce" stays structural, since a ball at constant speed can never
 * come to rest. A ball that stops has broken an invariant the maps are authored
 * around, not merely looked wrong.
 *
 * ── Why this sweeps seeds ─────────────────────────────────────────────────
 *
 * Ball spawns come from raw Math.random (findValidSpawnPosition), so one run of
 * this map is one sample of a distribution. The first draft of this file ran
 * two samples and drew a conclusion from the difference between them, which was
 * wrong twice over: the two runs differed only by spawn luck, and the one
 * labelled "gravity" was not running gravity at all.
 *
 * So Math.random is seeded here and the map is played many times. That turns
 * "it happened once" into a rate, and hands back a seed that reproduces it.
 *
 * ── Faithful gravity ──────────────────────────────────────────────────────
 *
 * `mapGravityActive` requires BOTH `mapMutator.behavior === "gravity"` AND a
 * `gravityConfig`. Setting only the config (as that first draft did) builds a
 * state the real game never produces, in which the renderer tilts the board and
 * the physics does not pull. The gravity case here sets both, and asserts the
 * pull is really on before trusting a word of it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { normaliseGravity } from "@/lib/physics/gravity";
import { mapGravityActive, steerWorldOf } from "@/lib/physics/steering";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelData, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const levels = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;

const PHYSICS_STEP = 1 / 120;
/**
 * Most of one turn of the gravity sequence (9s x 8 entries = 72s), so every
 * pull direction is exercised at least once.
 *
 * It was 120s, and that is why CI went red. Not on an assertion - all 2142
 * passed - but on `[vitest-worker]: Timeout calling "onTaskUpdate"`: a soak
 * this long is one uninterrupted synchronous loop, and 47 seconds without
 * yielding starves the event loop until vitest's worker RPC gives up. The
 * suite then exits 1 with every test green, which is a maximally confusing
 * way to fail.
 *
 * Halved here and yielded between seeds below. The wedge this guards against
 * showed itself within two seconds of the map starting, so the extra minute
 * was buying nothing but CI time - it was most of the whole suite's runtime.
 */
const SOAK_SECONDS = 60;
/** Enough samples to turn "it happened" into a rate. */
const SEEDS = 6;
/** A quarter second of not moving reads on screen as a ball that has stopped. */
const WEDGE_STEPS = 30;

/** The gravity mutator exactly as public/mapMutators.yml authors it. */
const GRAVITY = {
  id: "gravity_well",
  behavior: "gravity" as const,
  gravity: {
    turnRate: 1.1,
    period: 9,
    sequence: ["down", "none", "left", "none", "up", "none", "right", "none"],
  },
};

/** Deterministic Math.random, so a failure names a seed that reproduces it. */
function seedRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frame scratch the loop owns; createInitialGameData builds only the model. */
const FRAME_BUFFERS = [
  "activeWalls", "pickups", "objectDebris", "debris", "fallingObjects",
  "fallingSlabs", "lockFlashes", "wallImpacts", "ballPops", "abilityFx",
  "pickupLockMarkers", "pickupFeedback", "pendingDestroys", "pendingWallBreaks",
  "pendingBeats", "firedBeats", "warnedBeats", "bossFiredPhases",
];

function build(level: LevelConfig, gravity: boolean): CanvasGameState {
  const game = createInitialGameData(level, level.level, DEFAULT_MODIFIERS) as never as CanvasGameState;
  const g = game as unknown as Record<string, unknown>;
  for (const k of FRAME_BUFFERS) g[k] = [];
  g.assimilations = new Map();
  g.activePlaySeconds = 0;
  // The loop owns this and GameCanvas sets it to 1 at init. Leaving it
  // undefined makes the grey wind-down compute NaN, which the minimum-speed
  // floor then launders into a fixed +x nudge - a harness artifact that looks
  // exactly like the bug being hunted.
  g.ballSpeedScale = 1;
  g.creepFactor = 1;
  if (gravity) {
    g.mapMutator = GRAVITY;
    g.gravityConfig = normaliseGravity(GRAVITY.gravity as never);
  }
  return game;
}

interface Wedge { id: string; steps: number; atSecond: number; x: number; y: number }

/**
 * Play the map and return the worst wedge found.
 *
 * Tracks POSITION, not speed. A ball pinned against a surface keeps a perfectly
 * healthy velocity while going nowhere, so watching speed alone reports
 * everything as fine - which is exactly what the first draft did, and it passed
 * on the very run where a ball sat still for seventy-seven seconds.
 */
function soak(game: CanvasGameState, seconds: number): Wedge | null {
  const steps = Math.round(seconds / PHYSICS_STEP);
  const run = new Map<string, number>();
  let worst: Wedge | null = null;

  for (let i = 0; i < steps; i++) {
    (game as unknown as { activePlaySeconds: number }).activePlaySeconds = i * PHYSICS_STEP;
    for (const ball of game.balls) {
      if (ball.state !== "active") continue;
      const bx = ball.position.x, by = ball.position.y;
      updateBall(ball, PHYSICS_STEP, game);

      const moved = Math.hypot(ball.position.x - bx, ball.position.y - by);
      // A step should carry a ball speed x dt. A tenth of that is wedged, not
      // slow: the floor is 150 world units/s, so a real step moves 1.25.
      const floor = (ball.minimumSpeed ?? 150) * PHYSICS_STEP * 0.1;
      const n = moved < floor ? (run.get(ball.id) ?? 0) + 1 : 0;
      run.set(ball.id, n);
      if (!worst || n > worst.steps) {
        worst = {
          id: ball.id, steps: n, atSecond: i * PHYSICS_STEP,
          x: ball.position.x, y: ball.position.y,
        };
      }
    }
  }
  return worst;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("level 19, soaked over many spawns", () => {
  const level = levels.find(l => l.id === "level-19")!;

  for (const gravity of [false, true]) {
    const label = gravity ? "with the gravity mutator" : "without gravity";

    // Twelve maps x two minutes of 120Hz physics is not a fast test; the
    // default 5s budget is for unit tests, not a soak.
    it(`never leaves a ball wedged in place, ${label}`, { timeout: 120_000 }, async () => {
      const failures: string[] = [];
      let played = 0;

      for (let seed = 1; seed <= SEEDS; seed++) {
        // spyOn, not stubGlobal: Math's methods are non-enumerable, so
        // spreading it produces an object with a `random` and no `min`.
        vi.spyOn(Math, "random").mockImplementation(seedRandom(seed));
        const game = build(level, gravity);

        if (seed === 1) {
          expect(game.balls.length, "no balls would make this vacuous").toBeGreaterThan(0);
          // The gravity case must actually be pulling, or it is the no-gravity
          // case wearing a different name.
          expect(mapGravityActive(steerWorldOf(game as never)), "gravity active").toBe(gravity);
        }

        const worst = soak(game, SOAK_SECONDS);
        played++;
        // Let the event loop breathe between maps. Each soak is a solid block
        // of synchronous physics, and vitest's worker has to be able to report
        // progress home or the run fails with everything passing.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (worst && worst.steps >= WEDGE_STEPS) {
          failures.push(
            `seed ${seed}: ${worst.id} stopped for ${(worst.steps * PHYSICS_STEP).toFixed(1)}s`
            + ` at (${worst.x.toFixed(0)},${worst.y.toFixed(0)}) ending ${worst.atSecond.toFixed(0)}s`,
          );
        }
      }

      expect(played, "no map was ever played").toBe(SEEDS);
      expect(
        failures.join(" | ") || "none",
        `${failures.length}/${SEEDS} spawns wedged`,
      ).toBe("none");
    });
  }
});
