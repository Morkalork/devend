/**
 * Play a map and report what broke.
 *
 * One run = one map, one seed, up to a frame budget. The bot cuts when it sees
 * somewhere safe, steps the real physics, and checks every invariant after
 * every frame. Everything is seeded, so a report can be replayed exactly.
 */
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { setRunSeedText } from "@/lib/runRng";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "./headlessGame";
import { checkInvariants, checkTerminal, type Violation } from "./invariants";
import { fireLauncher } from "@/lib/physics/launcher";
import { bearingVector, LAUNCH_MIN_POWER, LAUNCH_MAX_POWER } from "@/lib/launcher";
import { planCut, seededRandom } from "./policy";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

export interface BotRunResult {
  levelId: string;
  levelNumber: number;
  seed: number;
  frames: number;
  cuts: number;
  locks: number;
  remainingPercent: number;
  won: boolean;
  lost: boolean;
  violations: Violation[];
}

export interface BotRunOptions {
  /** Frames to play before giving up. 60/s of game time at PHYSICS_STEP. */
  maxFrames?: number;
  /** Frames between cut attempts, so fences have time to finish. */
  cutEvery?: number;
  modifiers?: GameModifiers;
}

export function runBot(
  level: LevelConfig, levelNumber: number, seed: number, opts: BotRunOptions = {},
): BotRunResult {
  const maxFrames = opts.maxFrames ?? 3600;   // 30s of game time
  const cutEvery = opts.cutEvery ?? 45;

  // The map's own randomness (obstacle placement, ball types) keyed off the
  // same seed, so "seed 7 on level 12" is one reproducible situation rather
  // than a policy replayed against a different board every time.
  setRunSeedText(`bot-${seed}`);
  // The engine reads performance.now(); for the length of this run, that is
  // simulated time. Released in the finally below whatever happens, or every
  // later test in the file would inherit a frozen clock.
  installClock();
  const rng = seededRandom(seed);
  const ctx = createBotGame(level, levelNumber, opts.modifiers ?? plainModifiers());

  // Fire any launcher before play starts. Without this a launcher map cannot be
  // won by a bot at all: the loaded ball stays dormant, a dormant ball holds its
  // region uncapturable, and every run would report "progress-stalled" for a
  // map that is perfectly fine.
  //
  // The POWER is drawn from the run's seeded rng rather than pinned at full, so
  // the playtest panel samples the whole wager across its seeds instead of only
  // ever reporting how the map plays at 3x. Straight down the cup's facing: the
  // aim cone is a player's tool and a bot picking angles would be testing the
  // bot, not the map.
  for (const launcher of ctx.game.launchers ?? []) {
    const power = LAUNCH_MIN_POWER + rng() * (LAUNCH_MAX_POWER - LAUNCH_MIN_POWER);
    fireLauncher(ctx.game, launcher, {
      direction: bearingVector(launcher.facing), power, clamped: false,
    });
  }

  const violations: Violation[] = [];
  const seen = new Set<string>();
  const record = (vs: Violation[]) => {
    for (const v of vs) {
      // One line per RULE per run. A NaN position repeats every frame after it
      // appears, and a report of four thousand identical lines hides the other
      // three findings.
      if (seen.has(v.rule)) continue;
      seen.add(v.rule);
      violations.push(v);
    }
  };

  // Progress, not completion, is what separates a broken map from a slow bot.
  // STALL_FRAMES is 15s of game time: long enough that a fence crossing the
  // board and a ball wandering back through a gap both resolve inside it.
  const STALL_FRAMES = 1800;
  let bestRemaining = Infinity;
  let framesSinceProgress = 0;

  try {
  for (let f = 0; f < maxFrames; f++) {
    if (ctx.game.levelComplete || ctx.game.gameOver) break;

    if (f % cutEvery === 0 && ctx.game.activeWalls.length === 0) {
      // Desperation rises while nothing is happening, so a bot pinned in a
      // nearly-cleared board eventually takes the cut a player would take
      // rather than standing still and calling the map broken.
      const desperation = Math.min(1, framesSinceProgress / 900);
      const plan = planCut(ctx.game, rng, desperation);
      if (plan) tryCut(ctx, plan.origin, plan.direction);
    }

    stepBot(ctx, PHYSICS_STEP);
    record(checkInvariants(ctx.game));

    // Half a percent, so grid rounding does not read as progress forever.
    if (ctx.events.remainingPercent < bestRemaining - 0.5) {
      bestRemaining = ctx.events.remainingPercent;
      framesSinceProgress = 0;
    } else {
      framesSinceProgress += 1;
    }
  }

  } finally {
    releaseClock();
  }

  record(checkTerminal(
    ctx.game, ctx.frames, ctx.events.cutsMade,
    ctx.events.levelComplete || ctx.game.levelComplete,
    ctx.events.gameOver || ctx.game.gameOver,
    framesSinceProgress >= STALL_FRAMES,
  ));
  setRunSeedText(null);

  return {
    levelId: level.id,
    levelNumber,
    seed,
    frames: ctx.frames,
    cuts: ctx.events.cutsMade,
    locks: ctx.events.locks,
    remainingPercent: ctx.events.remainingPercent,
    won: ctx.events.levelComplete || ctx.game.levelComplete,
    lost: ctx.events.gameOver || ctx.game.gameOver,
    violations,
  };
}

/** Play many maps across many seeds. */
export function sweep(
  levels: { level: LevelConfig; number: number }[], seeds: number[], opts: BotRunOptions = {},
): BotRunResult[] {
  const out: BotRunResult[] = [];
  for (const { level, number } of levels) {
    for (const seed of seeds) out.push(runBot(level, number, seed, opts));
  }
  return out;
}
