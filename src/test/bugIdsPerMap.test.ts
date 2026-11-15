/**
 * Bug ids start from scratch on every map.
 *
 * A bug's effect magnitude is seeded by its id, and the id counter used to run
 * for the whole app session. So one seed dealt a different bug, and a
 * different magnitude, depending on what had been played before it: a Daily
 * run could differ between players, and two paired phones could disagree. The
 * upgrade sweep caught it as level 18 runs that changed with nothing changed.
 */
import { describe, it, expect } from "vitest";
import { runBot } from "@/lib/bot/runBot";
import { plainModifiers } from "@/lib/bot/headlessGame";
import { captureSimModuleState } from "@/lib/net/simState";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_BUG_CONFIG } from "@/types/bugs";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { LADDER, byLevel } from "./fixtures/maps";

const LEVEL = byLevel(LADDER, 18)!;
const maxFrames = Math.ceil(((LEVEL.timeLimit ?? 90) + 5) / PHYSICS_STEP);
const play = (seed: number) => {
  const r = runBot(LEVEL, 18, seed, { modifiers: plainModifiers(), maxFrames, bugs: DEFAULT_BUG_CONFIG, lives: 3 });
  return `${r.won}/${r.frames}/${r.levelScore}/${r.livesLost}/${r.cuts}`;
};

describe("bug ids per map", () => {
  it("one seed plays the same whatever was played before it", () => {
    const first = play(104);
    play(105);
    play(107);
    expect(play(104)).toBe(first);
  });

  it("a new map starts the counters at zero, and the pair snapshot carries them", () => {
    createInitialGameData(LEVEL, 18, plainModifiers());
    expect(captureSimModuleState().bugIds).toEqual({ bug: 0, splat: 0 });
  });
});
