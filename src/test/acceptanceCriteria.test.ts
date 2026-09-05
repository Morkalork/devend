/**
 * The Acceptance Criteria are a LIST, and the list says what is optional.
 *
 * They used to be one run-on paragraph: every clause - the required ones, the
 * alternatives, the time limit, the fence budget, and the "trap it outside and
 * you lose a life" penalty - joined with a space into a block of centred prose.
 * The player had to work out from the wording alone which parts they HAD to do,
 * which were upside, and which were the punishment. On a map with four clauses
 * and a fail state that is a paragraph nobody reads twice.
 *
 * Two things were not merely unclear but ABSENT:
 *
 * - A bonus colored area pays 1.5x to 3x and gates nothing, and it was never
 *   mentioned at all. The clause switch only fires on an `area` win CLAUSE, so
 *   the greed hook - the thing half of section 6.2 of the design guidelines is
 *   about - was invisible in the one screen that exists to say what a map wants.
 * - Nothing named the maps that pose a genuine either/or.
 *
 * These pin the grouping rather than the wording: the strings are i18n keys and
 * will be reworded, but which LIST a line lands in is the whole feature.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { TFunction } from "i18next";
import { winConditions, renderCriteria, CRITERION_GROUPS } from "@/lib/winConditions";
import type { LevelConfig, LevelData } from "@/types/level";

/** Echoes the key, so a test asserts which STRING was chosen, not its English. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key) as unknown as TFunction;

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];
const at = (n: number) => LEVELS.find(l => l.level === n)!;
const groups = (n: number) => {
  const out: Record<string, string[]> = {};
  for (const c of winConditions(t, at(n), n)) (out[c.group] ??= []).push(c.text);
  return out;
};

describe("every line lands in a named list", () => {
  it("puts nothing in a group that does not exist", () => {
    for (const l of LEVELS) {
      if (l.level == null) continue;
      for (const c of winConditions(t, l, l.level)) {
        expect(CRITERION_GROUPS, `${l.id} used the group ${c.group}`).toContain(c.group);
      }
    }
  });

  it("gives every playable map at least one required line", () => {
    // A criteria screen whose MUST DO list is empty is worse than no screen:
    // it says the map wants nothing.
    for (const l of LEVELS) {
      if (l.level == null) continue;
      const req = winConditions(t, l, l.level).filter(c => c.group === "required");
      expect(req.length, `${l.id} lists nothing to do`).toBeGreaterThan(0);
    }
  });

  it("never files a penalty as something to do", () => {
    // "Trap the target outside the area and you lose a life" sat beside the win
    // in one paragraph, where it read as an instruction. It is a FAIL.
    for (const l of LEVELS) {
      if (l.level == null) continue;
      for (const c of winConditions(t, l, l.level)) {
        if (c.text.startsWith("winConditions.areaFail")) {
          expect(c.group, `${l.id} files the area penalty as ${c.group}`).toBe("fail");
        }
      }
    }
  });
});

describe("optional is marked optional", () => {
  it("names the bonus pocket the modal used to hide", () => {
    // Level 5's var pocket: pays 1.5x, gates nothing, and no line of the old
    // paragraph mentioned it existed.
    const g = groups(5);
    expect(g.optional?.join(" "), "the bonus pocket is still invisible")
      .toContain("winConditions.bonusArea");
    expect(g.required?.join(" "), "the bonus was filed as a requirement")
      .not.toContain("bonusArea");
  });

  it("counts a bonus pocket on every map that has one", () => {
    // 19 of the playable maps carry one, so a rule that quietly stopped firing
    // would be invisible on any single map.
    const withBonus = LEVELS.filter(l =>
      l.level != null && (l.coloredAreas ?? []).some(a => a.required === false));
    expect(withBonus.length, "the bonus pockets vanished from the ladder")
      .toBeGreaterThan(10);
    for (const l of withBonus) {
      const opt = winConditions(t, l, l.level as number).filter(c => c.group === "optional");
      expect(opt.length, `${l.id} carries a bonus pocket it never mentions`).toBeGreaterThan(0);
    }
  });

  it("never files a GATE area as optional", () => {
    // The opposite mistake, and the expensive one: a gate is the whole win on
    // the maps that have one, and calling it optional would tell the player to
    // skip the map.
    for (const n of [8, 34]) {
      expect(groups(n).optional ?? [], `level ${n}'s gate is offered as optional`)
        .toEqual([]);
    }
  });
});

describe("a real either/or is called one", () => {
  it("names the trade on the budgeted map that poses it", () => {
    // 17: ten fences for everything, and a let pocket in the corner. The design
    // guidelines put it as "the bonus is affordable or the map is, not both".
    expect(groups(17).trade?.join(" "), "level 17 no longer states its trade")
      .toContain("winConditions.tradeBudgetBonus");
  });

  it("stays quiet where there is no trade to state", () => {
    // The rule that keeps this worth reading. Every map past the tutorial band
    // has a clock, so "the pocket costs time" is true everywhere - a trade
    // announced on 30 maps is not a trade, it is wallpaper.
    const posed = LEVELS.filter(l => l.level != null
      && winConditions(t, l, l.level).some(c => c.group === "trade"))
      .map(l => l.level);
    expect(posed, "the trade line started firing on maps with no trade").toEqual([17]);
  });

  it("only calls it a trade when both halves are real", () => {
    // A budget with no pocket is not a choice, and a pocket with unlimited
    // fences is not a cost.
    for (const l of LEVELS) {
      if (l.level == null) continue;
      const hasTrade = winConditions(t, l, l.level).some(c => c.group === "trade");
      if (!hasTrade) continue;
      expect(l.fenceBudget, `${l.id} claims a trade with no budget`).not.toBeUndefined();
      expect((l.coloredAreas ?? []).some(a => a.required === false),
        `${l.id} claims a trade with no optional pocket`).toBe(true);
    }
  });
});

describe("the rendered block", () => {
  it("prints a heading and a bullet per line, groups blank-line separated", () => {
    const body = renderCriteria(t, winConditions(t, at(17), 17));
    expect(body).toContain("winConditions.group.optional\n  - ");
    expect(body).toContain("winConditions.group.trade\n  - ");
    expect(body).toContain("\n\n");
  });

  it("prints no heading for a group with nothing in it", () => {
    // "Optional: none" costs a reader attention to learn something they did
    // not ask about.
    const body = renderCriteria(t, winConditions(t, at(1), 1));
    expect(body, "an empty group printed its heading anyway")
      .not.toContain("winConditions.group.optional");
    expect(body).not.toContain("winConditions.group.fail");
  });

  it("says ALL OF THESE only when there is more than one", () => {
    // Over a single bullet it reads as though something is missing.
    expect(renderCriteria(t, winConditions(t, at(1), 1)))
      .toContain("winConditions.groupRequiredAll");
    expect(renderCriteria(t, winConditions(t, at(34), 34)))
      .toContain("winConditions.group.required");
  });
});
