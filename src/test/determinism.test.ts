/**
 * The two properties two-player lockstep rests on (TWO_PLAYER_PLAN.md steps 1
 * and 2), pinned so they cannot quietly regress.
 *
 *   1. Nothing inside a physics tick reads the WALL clock. Time in the
 *      simulation comes from src/lib/simClock.ts, which advances one
 *      PHYSICS_STEP per step, so tick N is the same instant on every device
 *      that has run N ticks.
 *   2. Nothing inside a physics tick rolls an UNSEEDED number that can change
 *      where a ball ends up. Gameplay randomness comes from runRng.ts, so a
 *      shared seed deals the same map to both players.
 *
 * Both are the kind of thing that regresses by someone typing the obvious
 * thing (`performance.now()`, `Math.random()`) in a new physics module, which
 * is why this is a source scan and not a behavioural test: a behavioural test
 * would only catch it on the map that happens to exercise that line.
 *
 * The allowlists below are the claims "this one is cosmetic" and "this one
 * measures real time", each written down with its reason. They may SHRINK.
 * Adding to them means arguing in the reason field that the value can never
 * reach the physics, and the bar for that is high: the moment a debris shard
 * or a dust particle is allowed to touch a ball, the claim is false and the
 * two boards drift apart.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createBotGame, stepBot, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { advanceSimClock, resetSimClock, simNow, SIM_CLOCK_START_MS } from "@/lib/simClock";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { LADDER } from "./fixtures/maps";

// ── What counts as "inside a tick" ──────────────────────────────────────────

const TICK_PATH = [
  ...readdirSync("src/lib/physics").filter(f => f.endsWith(".ts")).map(f => join("src/lib/physics", f)),
  "src/lib/initGame.ts",
  "src/lib/pickups.ts",
  "src/lib/chests.ts",
  "src/lib/ballEffects.ts",
  "src/lib/abilityEffects.ts",
  "src/lib/gameUtils.ts",
  "src/lib/wallImpactEffects.ts",
  "src/hooks/useGameLoop.ts",
  "src/hooks/useGameInput.ts",
];

/**
 * Unseeded rolls that are allowed to stay, because what they decide is never
 * read back by the physics: it is drawn and then thrown away.
 */
const COSMETIC_ROLLS: Record<string, { count: number; why: string }> = {
  "src/lib/physics/checkBallWonState.ts": {
    count: 9,
    why: "lock dust particles: angle, speed, lifetime, size and length of a puff drawn on a lock. Never read by anything but the renderer.",
  },
  "src/lib/physics/destructibles.ts": {
    count: 19,
    why: "debris shards from a smashed block: position jitter, velocity, spin and size. Debris has no collision; it is drawn and expires.",
  },
  "src/lib/chests.ts": {
    count: 2,
    why: "the pop a gem makes leaving a smashed chest. The reward is granted on the smash, so the gem is a receipt with no gameplay left in it.",
  },
  "src/lib/ballEffects.ts": {
    count: 1,
    why: "the starting phase of a ball's idle pulse, so a row of balls does not pulse in lockstep. Visual only.",
  },
};

/**
 * Wall-clock reads that are allowed to stay, because they are measuring real
 * elapsed time rather than positioning anything in the simulation.
 */
const WALL_CLOCK_READS: Record<string, { count: number; why: string }> = {
  "src/hooks/useGameLoop.ts": {
    count: 8,
    why: "the performance counters (recordBg/recordFrame/recordCut). They measure how long a real frame took, which is the one thing sim time cannot tell them.",
  },
};

/**
 * Strip comments and string literals before counting.
 *
 * Both names appear in prose all over this codebase - headers explaining why a
 * roll IS seeded, notes about what used to be here - and a scan that counts
 * those is a scan people learn to work around by rewording a comment. It has
 * to count calls.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")      // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")   // line comments, sparing a URL's //
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")     // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

const countOf = (src: string, needle: RegExp) => (code(src).match(needle) ?? []).length;

describe("nothing in a tick reads the wall clock", () => {
  for (const file of TICK_PATH) {
    it(`${file} takes its time from the sim clock`, () => {
      const src = readFileSync(file, "utf-8");
      const found = countOf(src, /performance\.now\(/g);
      const allowed = WALL_CLOCK_READS[file];
      if (allowed) {
        expect(found, `${file}: ${allowed.why}`).toBe(allowed.count);
      } else {
        expect(found, `${file} reads performance.now(); use simNow() so both devices agree on when this happened`).toBe(0);
      }
    });
  }
});

describe("nothing in a tick rolls an unseeded number that moves a ball", () => {
  for (const file of TICK_PATH) {
    it(`${file} rolls from the run seed`, () => {
      const src = readFileSync(file, "utf-8");
      // Only real calls; the word appears in prose in several headers.
      const found = countOf(src, /Math\.random\(\)/g);
      const allowed = COSMETIC_ROLLS[file];
      if (allowed) {
        expect(found, `${file}: ${allowed.why}`).toBe(allowed.count);
      } else {
        expect(found, `${file} calls Math.random(); use getRunRng/runStream so a shared seed deals the same board`).toBe(0);
      }
    });
  }

  it("the six the plan named are all seeded now", () => {
    const seeded: [string, RegExp][] = [
      ["useGameLoop.ts (Cron Job's target)", /runStream\("autoFreeze"\)/],
      ["initGame.ts (Runtime Optimisation's victim)", /getRunRng\(`slowOne:\$\{level\.id\}`\)/],
      ["circuit.ts (a woken ball's heading)", /runStream\(`wake:\$\{ballId\}`\)/],
      ["charge.ts (the blast-centre fallback)", /runStream\("chargeBlast"\)/],
      ["phasing.ts (the same fallback)", /runStream\("phaseShock"\)/],
      ["initGame.ts (a ball's starting spin)", /runStream\("ballSpin"\)/],
    ];
    const sources = Object.fromEntries(
      ["src/hooks/useGameLoop.ts", "src/lib/initGame.ts", "src/lib/physics/circuit.ts",
       "src/lib/physics/charge.ts", "src/lib/physics/phasing.ts"]
        .map(f => [f, readFileSync(f, "utf-8")]));
    const all = Object.values(sources).join("\n");  // raw: these look for the call shape, backticks and all
    for (const [what, re] of seeded) {
      expect(all, `${what} is not drawing from the run seed`).toMatch(re);
    }
  });

  it("the two the scan turned up beyond the plan's six are seeded too", () => {
    const src = readFileSync("src/lib/pickups.ts", "utf-8");
    expect(src, "which ball turns rainbow").toMatch(/runStream\("rainbowConvert"\)/);
    expect(src, "which ball a split forks from").toMatch(/runStream\("forkSource"\)/);
  });
});

describe("the sim clock", () => {
  it("only ever moves forward", () => {
    resetSimClock();
    expect(simNow()).toBe(SIM_CLOCK_START_MS);
    advanceSimClock(100);
    expect(simNow()).toBe(SIM_CLOCK_START_MS + 100);
    advanceSimClock(-5000);
    expect(simNow(), "a negative delta must not rewind the clock").toBe(SIM_CLOCK_START_MS + 100);
  });

  it("puts a run's outcome in the hands of its seed, not the machine's speed", () => {
    const level = LADDER.find(l => l.level === 14)!;
    const play = (pauseEveryNTicks: number) => {
      releaseClock();
      installClock();
      setRunSeedText("determinism-probe");
      try {
        const ctx = createBotGame(level, 14, plainModifiers());
        for (let f = 0; f < 1800; f++) {
          stepBot(ctx, PHYSICS_STEP);
          // Burn real time at an uneven rate, the way a phone under load does.
          // Sim time must not notice.
          if (pauseEveryNTicks && f % pauseEveryNTicks === 0) {
            const spin = Date.now();
            while (Date.now() - spin < 1) { /* hold the thread */ }
          }
        }
        return ctx.game.balls
          .map(b => `${b.id}@${b.position.x.toFixed(6)},${b.position.y.toFixed(6)}` +
                    `:${b.velocity.x.toFixed(6)},${b.velocity.y.toFixed(6)}:${b.state}`)
          .join("|");
      } finally {
        releaseClock();
        setRunSeedText(null);
      }
    };
    const fast = play(0);
    const stuttering = play(300);
    expect(fast.length, "the probe ran no balls at all").toBeGreaterThan(0);
    expect(stuttering).toBe(fast);
  });
});
