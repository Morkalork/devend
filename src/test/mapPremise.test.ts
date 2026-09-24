/**
 * Every shipped map states its idea in one sentence.
 *
 * The first check on a map is whether it is ABOUT something, and until this
 * field nothing recorded the answer. A play review of the ladder found the maps
 * rated weakest were the ones whose objects did not add up to one idea - a box
 * the win ignored, a chest nothing asked for, a mirror the map never needed -
 * and no test could see that, because the idea was never written down.
 *
 * So it is written down, before anything is placed, and checked for shape: one
 * sentence, short. The wording is the designer's; a premise that cannot be
 * written in 140 characters is the finding.
 */
import { describe, it, expect } from "vitest";
import { LADDER } from "./fixtures/maps";
import { premiseProblems, PREMISE_MAX_CHARS } from "@/lib/mapPremise";

describe("a map's premise", () => {
  it("is on every map on the ladder, and is one short sentence", () => {
    const problems = LADDER.flatMap(l => premiseProblems(l.premise).map(p => `${l.id}: ${p}`));
    expect(problems).toEqual([]);
  });

  it("is different on every map, since two maps with one idea are one map", () => {
    const seen = new Map<string, string>();
    for (const l of LADDER) {
      const key = (l.premise ?? "").trim().toLowerCase();
      expect(seen.get(key), `${l.id} states the same premise as ${seen.get(key)}`).toBeUndefined();
      seen.set(key, l.id);
    }
  });
});

describe("premiseProblems", () => {
  it("refuses a missing or blank premise", () => {
    expect(premiseProblems(undefined)).toHaveLength(1);
    expect(premiseProblems("   ")).toHaveLength(1);
  });

  it("refuses a paragraph, by length or by sentence count", () => {
    expect(premiseProblems("x".repeat(PREMISE_MAX_CHARS + 1)).join(" ")).toMatch(/characters/);
    expect(premiseProblems("The one where a box. And a mirror.").join(" ")).toMatch(/more than one sentence/);
  });

  it("accepts one sentence, colons and all", () => {
    expect(premiseProblems("The one where the pink box is the win: clear the board and lock a ball inside it.")).toEqual([]);
  });
});
