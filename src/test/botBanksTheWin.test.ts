/**
 * The bot never walks away from a won map.
 *
 * A Push Your Luck offer sets neither `levelComplete` nor `gameOver`: the map
 * is won, and the engine is waiting to be told whether to bank it or push. The
 * bot loop breaks on those two flags only, so a prompted map left it cutting
 * into a board it had already cleared until the frame cap or the fence budget
 * ran out - and the run was then reported as a stall, or an outOfFences.
 *
 * That is not a rounding error in a sweep. It silently converts WINS into
 * failures, and it converts them on exactly the maps that are going well. Level
 * 14 went 0/6 to 6/6 on the one line that banks the offer, and I twice read the
 * old result as a broken map before finding the prompt underneath it.
 *
 * Banking rather than pushing is deliberate: it is the choice with no further
 * decisions in it, so a sweep measures the MAP rather than a betting policy
 * nobody wrote down. A bot that pushes is a separate experiment.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { runBot } from "@/lib/bot/runBot";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];
const at = (n: number) => LEVELS.find(l => l.level === n)!;

describe("a prompted map is a won map", () => {
  it("wins level 14 on every seed it is given", () => {
    // The map this was found on. Its win is space + locks with nothing
    // operable, so the bot reaches the threshold comfortably and is offered the
    // push every time - which is precisely why it used to report 0 wins.
    const runs = [1, 2, 3, 4].map(s => runBot(at(14), 14, s, { maxFrames: 9000 }));
    expect(runs.filter(r => r.won).length, "level 14 stopped banking its wins").toBe(4);
  });

  it("leaves no run parked at the prompt", () => {
    // The general form. A run that is neither won nor lost and is sitting in a
    // push state is the bug, whatever the map.
    for (const n of [1, 14, 21, 24, 28]) {
      const r = runBot(at(n), n, 3, { maxFrames: 9000 });
      expect(
        r.won || r.lost,
        `level ${n} ended undecided after ${r.cuts} cuts at ${r.remainingPercent}%`,
      ).toBe(true);
    }
  });

  it("banks rather than pushes, so a sweep measures the map", () => {
    // If the bot ever starts pushing, `won` stops meaning "this map can be
    // finished" and starts meaning "this map can be finished AND the bet came
    // off", which is a different question and not one a map sweep is asking.
    const src = readFileSync(resolve(process.cwd(), "src/lib/bot/runBot.ts"), "utf8");
    const idx = src.indexOf('pushMode === "prompt"');
    expect(idx, "the bot no longer answers the prompt at all").toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 260);
    expect(block, "the bot takes the bet now").not.toContain('"pushing"');
    expect(block).toContain("levelComplete = true");
  });
});
