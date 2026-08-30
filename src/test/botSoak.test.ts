/**
 * A bot plays the game, and the game must not break.
 *
 * Every other test here checks one function against one situation someone
 * thought of. This drives the REAL physics - the same updateBall,
 * updateFenceWallFn and applyCutFn the browser runs - through tens of thousands
 * of frames of actual play and watches for states nobody thought of. It is the
 * difference between "does this do what I expect" and "is there any sequence of
 * legal moves that breaks it".
 *
 * ── Two classes of finding, deliberately treated differently ───────────────
 *
 * HARD invariants fail the build. A non-finite ball position, a ball outside
 * the board, a map flagged won AND lost, fences piling up unresolved: none of
 * these has an innocent explanation, and none depends on how well the bot
 * plays.
 *
 * The STALL heuristic only reports. It fires when the board stops shrinking,
 * which is what an unfinishable map looks like - and also what a mediocre
 * policy pinned in a nearly-cleared board looks like. It has already produced
 * one false alarm that survived a first glance: 135 refused cuts on level 15
 * with 1% of the board left, blamed on the map, caused entirely by the bot's
 * own caution. Until it can tell those apart it is a lead to chase, not a
 * verdict, so it prints and does not fail.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * The committed sweep is small enough to sit in `npm run test`. The full sweep
 * (every map, many seeds, longer budgets) is the same call with more of them -
 * see the sweep() helper - and is where this earns its keep.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { runBot, type BotRunResult } from "@/lib/bot/runBot";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

/** A spread across the acts rather than the first N: late maps differ in kind. */
const SAMPLE = [1, 5, 10, 16, 22, 28, 34];
const SEEDS = [1, 2];
const FRAMES = 5400; // 45s of game time

/** Findings with no innocent explanation, independent of how well the bot plays. */
const HARD = new Set([
  "ball-position-nan", "ball-velocity-nan", "ball-speed-invalid",
  "ball-escaped", "region-area-invalid", "fence-pileup",
  "won-and-lost", "no-legal-cut",
]);

const RUNS: BotRunResult[] = [];
for (const n of SAMPLE) {
  const level = LEVELS.find(l => l.level === n);
  if (!level) continue;
  for (const seed of SEEDS) RUNS.push(runBot(level, n, seed, { maxFrames: FRAMES }));
}

describe("a bot playing the real physics", () => {
  it("actually played, rather than sitting on the start screen", () => {
    // The check that keeps every assertion below honest. A harness that crashed
    // on frame one, or never got a legal cut away, would satisfy "no
    // violations" perfectly.
    expect(RUNS.length).toBeGreaterThan(0);
    const cuts = RUNS.reduce((n, r) => n + r.cuts, 0);
    const frames = RUNS.reduce((n, r) => n + r.frames, 0);
    expect(cuts, "the bot never cut anything").toBeGreaterThan(RUNS.length * 3);
    expect(frames, "the bot never stepped the world").toBeGreaterThan(10000);
  });

  it("finishes maps, so the runs are real play and not flailing", () => {
    // A bot that only ever loses is exercising the death path and nothing else.
    // Some wins mean fences complete, regions resolve, balls lock and maps end.
    const won = RUNS.filter(r => r.won).length;
    expect(won, `${won}/${RUNS.length} maps won`).toBeGreaterThan(0);
  });

  it("locks balls, which is most of the game's machinery", () => {
    const locks = RUNS.reduce((n, r) => n + r.locks, 0);
    expect(locks, "no ball was ever locked, so the lock path never ran").toBeGreaterThan(0);
  });

  it("never breaks an invariant that has no innocent explanation", () => {
    // THE test. Everything above exists so that a failure here means something.
    const hard = RUNS.flatMap(r => r.violations
      .filter(v => HARD.has(v.rule))
      .map(v => `${r.levelId} seed ${r.seed} [${v.rule}] ${v.detail}`));
    expect(hard, "the bot broke the game").toEqual([]);
  });

  it("reports stalls without failing on them", () => {
    // Printed, not asserted, and the comment at the top of this file says why.
    // Left in the suite so the number is visible when it moves: a jump here is
    // worth a look even though it is not proof of anything.
    const stalls = RUNS.filter(r => r.violations.some(v => v.rule === "progress-stalled"));
    if (stalls.length > 0) {
      console.log(`  [bot] ${stalls.length}/${RUNS.length} runs stalled - leads, not verdicts:`);
      for (const r of stalls) console.log(`    ${r.levelId} seed ${r.seed}, ${r.cuts} cuts, ${Math.round(r.remainingPercent)}% left`);
    }
    expect(stalls.length).toBeLessThanOrEqual(RUNS.length);
  });
});

describe("what the bot found on its first outing", () => {
  it("the game is not reproducible from a seed, and it ships a feature that needs it", () => {
    // THE finding, and the bot found it by failing its own reproducibility
    // check: the same map, the same seed, played twice, came out 14 cuts / 2
    // locks / won against 22 cuts / 0 locks / lost.
    //
    // The cause is unseeded Math.random() on the gameplay path. runRng.ts
    // exists precisely to avoid this - getRunRng(context) returns a seeded
    // stream, and thirteen call sites use it - but these do not, and each one
    // changes what actually happens:
    //
    //   rainbowSpawner  which ball TYPE a rainbow spits out
    //   spawnPlacement  the direction a spawned ball fires off in
    //   updateBall      the yellow ball's next variable-speed target
    //   bossPhases      where a boss spawns and which way it goes
    //   checkBallWonState  where a trapped boss LANDS when it breaks out
    //
    // That matters beyond tidiness. Daily Stand-up hands every player the same
    // seed on the promise that they are playing the same board, and these make
    // that promise false.
    //
    // Pinned as a count so it cannot quietly grow. Lower it when they are
    // converted to getRunRng; this failing because the number went DOWN is the
    // good outcome.
    const GAMEPLAY_FILES = [
      "src/lib/physics/rainbowSpawner.ts",
      "src/lib/physics/spawnPlacement.ts",
      "src/lib/physics/updateBall.ts",
      "src/lib/physics/bossPhases.ts",
    ];
    let unseeded = 0;
    for (const f of GAMEPLAY_FILES) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      unseeded += (src.match(/Math\.random\(\)/g) ?? []).length;
    }
    expect(unseeded, "unseeded randomness on the gameplay path changed count")
      .toBe(8);
  });

  it("still plays differently on different seeds, so a sweep means something", () => {
    // Weaker than "identical from the same seed", which the finding above makes
    // impossible for now. This at least proves the seed reaches the map: the
    // board is dealt by getRunRng, so different seeds are different boards even
    // while play on top of them wobbles.
    const level = LEVELS.find(l => l.level === 12)!;
    const a = runBot(level, 12, 1, { maxFrames: 2400 });
    const b = runBot(level, 12, 2, { maxFrames: 2400 });
    expect([a.cuts, a.locks, a.remainingPercent])
      .not.toEqual([b.cuts, b.locks, b.remainingPercent]);
  });

  it("leaves the real clock alone afterwards", () => {
    // The harness replaces performance.now() while a run is in progress. If it
    // ever failed to put it back, every later test in the suite would run
    // against a frozen clock and fail in ways that look like anything but this.
    const before = performance.now();
    runBot(LEVELS.find(l => l.level === 1)!, 1, 7, { maxFrames: 300 });
    expect(performance.now()).toBeGreaterThanOrEqual(before);
    expect(performance.now.toString()).not.toContain("virtualNowMs");
  });
});
