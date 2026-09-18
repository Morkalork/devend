/**
 * The same inputs deal the same board, twice running.
 *
 * Written after a flake that took a full-suite repeat to catch and a morning to
 * attribute. The harness had started rolling the map's mutator unconditionally,
 * which is right for a sweep and wrong for everything else: `getRunRng` falls
 * through to `Math.random` when no run seed is armed, and eighteen test files
 * deal a board through createBotGame without arming one. Overnight, every one
 * of those at level 11 or above began drawing crunch, overclock or none at
 * random, so any assertion downstream of ball speed became a coin toss that
 * came up tails about once a suite.
 *
 * The lesson is not "seed those eighteen files". It is that a harness whose
 * determinism depends on remembering to arm something will lose that bet, so
 * the DEFAULT has to be repeatable and the randomness has to be asked for. This
 * file holds that, from the outside, by dealing the same board repeatedly and
 * insisting nothing moves.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot } from "@/lib/bot/headlessGame";
import { runBot } from "@/lib/bot/runBot";
import { setRunSeedText } from "@/lib/runRng";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { LADDER } from "./fixtures/maps";
import type { LevelConfig } from "@/types/level";

const at = (n: number) => (LADDER as LevelConfig[]).find(l => l.level === n)!;
const mutatorOf = (g: { mapMutator: unknown }) =>
  (g.mapMutator as { id?: string } | null)?.id ?? "none";

describe("a board dealt without a run seed is repeatable", () => {
  // No setRunSeedText anywhere in this block, on purpose: that is the state the
  // eighteen files are in, and the one that broke.
  for (const level of [11, 12, 14, 17, 18]) {
    it(`deals level ${level} the same way every time`, () => {
      const lv = at(level);
      if (!lv) return;
      const seen = new Set<string>();
      for (let i = 0; i < 25; i++) {
        seen.add(mutatorOf(createBotGame(lv, level, DEFAULT_MODIFIERS).game));
      }
      expect([...seen], `level ${level} dealt more than one kind of board`).toHaveLength(1);
    });
  }

  it("steps to the same place, not merely starts from it", () => {
    // The mutator is the input; ball positions are what actually broke. Two
    // boards dealt and stepped identically must agree to the last decimal.
    const lv = at(12);
    const play = () => {
      const ctx = createBotGame(lv, 12, DEFAULT_MODIFIERS);
      for (let i = 0; i < 400; i++) stepBot(ctx);
      return ctx.game.balls.map(b => `${b.position.x.toFixed(6)},${b.position.y.toFixed(6)}`).join("|");
    };
    expect(play()).toBe(play());
  });
});

describe("a run asks for the weather, and still reproduces", () => {
  it("gives one seed one mutator, however often it is run", () => {
    const lv = at(14);
    const ids = new Set<string>();
    for (let i = 0; i < 6; i++) {
      setRunSeedText(null);           // the worst case: nothing armed beforehand
      ids.add(runBot(lv, 14, 3, { maxFrames: 120 }).levelId);
    }
    expect(ids.size).toBe(1);
  });

  it("reproduces a whole run from its seed", () => {
    const lv = at(12);
    const once = runBot(lv, 12, 5, { maxFrames: 900 });
    const twice = runBot(lv, 12, 5, { maxFrames: 900 });
    expect({ won: once.won, cuts: once.cuts, locks: once.locks, rem: once.remainingPercent })
      .toEqual({ won: twice.won, cuts: twice.cuts, locks: twice.locks, rem: twice.remainingPercent });
  });

  it("still lets a caller pin the weather, and honours it", () => {
    // Asserted on the board rather than inferred from where the run ended up.
    // The first version of this test compared two runs' cut counts and called a
    // match a failure, which is a test that passes when physics happens to
    // diverge rather than when the mutator is applied - it went green for the
    // wrong reason and red for a worse one.
    const lv = at(12);
    expect(mutatorOf(createBotGame(lv, 12, DEFAULT_MODIFIERS, { mutator: "crunch" }).game)).toBe("crunch");
    expect(mutatorOf(createBotGame(lv, 12, DEFAULT_MODIFIERS, { mutator: null }).game)).toBe("none");
    expect(mutatorOf(createBotGame(lv, 12, DEFAULT_MODIFIERS).game)).toBe("none");
  });

  it("deals a gravity map its gravity, config and mutator together", () => {
    // mapGravityActive reads `mapMutator.behavior === "gravity" && gravityConfig`,
    // so either one alone is inert. They are set from the same resolved mutator
    // for that reason; set separately they went out of step immediately.
    const lv = at(14);
    const g = createBotGame(lv, 14, DEFAULT_MODIFIERS, { mutator: "tipping" }).game;
    expect(mutatorOf(g)).toBe("tipping");
    expect(g.gravityConfig, "a gravity mutator with no config is inert").toBeTruthy();
  });
});
