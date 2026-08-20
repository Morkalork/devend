/**
 * The Ascension ladder: ten named rungs, applied cumulatively.
 *
 * What this is replacing matters for what the tests are for. Ascension used to
 * be one number, speedRampPerDepth ^ depth, plus a single blanket rule that was
 * identical at depth 1 and depth 12. Depth 3 and depth 4 were the same game
 * with the balls 8% apart, so "I am on Ascension 6" described nothing. The
 * ladder's whole job is that each depth is describable and different.
 *
 * So the tests here are mostly about the ladder as AUTHORED, not just the fold
 * function: that the rungs are distinct, that they accumulate, and above all
 * that they are rules rather than stat nerfs. That last one is a design
 * invariant with a specific failure it prevents, and it is the one worth
 * guarding in code, because the tempting fix for "make depth N harder" is
 * always to subtract from a stat, and the shop sells the counter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  ascensionRules, rungsUpTo, rungAt, shopOpensAfter, ascensionAnnouncement,
  NO_ASCENSION_RULES, LADDER_LENGTH,
} from "@/lib/ascensionLadder";
import type { AscensionRung } from "@/types/loadout";
import type { UpgradeConfig } from "@/types/upgrade";

const PUBLIC = resolve(__dirname, "../../public");
const LOADOUTS = yaml.load(readFileSync(resolve(PUBLIC, "loadouts.yml"), "utf8")) as {
  ascension: { ladder: AscensionRung[] };
  loadouts: { id: string; neverDrafted?: boolean; modifiers: Record<string, number> }[];
};
const LADDER = LOADOUTS.ascension.ladder;
const UPGRADES = (yaml.load(readFileSync(resolve(PUBLIC, "upgrades.yml"), "utf8")) as
  { upgrades: UpgradeConfig[] }).upgrades;

describe("the ladder as authored", () => {
  it("has ten rungs, one per depth, in order", () => {
    expect(LADDER).toHaveLength(LADDER_LENGTH);
    expect(LADDER.map(r => r.depth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("gives every rung a name and a description, with no em-dashes", () => {
    for (const r of LADDER) {
      expect(r.name?.trim(), `depth ${r.depth} name`).toBeTruthy();
      expect(r.description?.trim(), `depth ${r.depth} description`).toBeTruthy();
      expect(r.name, `depth ${r.depth} name`).not.toContain("—");
      expect(r.description, `depth ${r.depth} description`).not.toContain("—");
    }
  });

  it("makes every rung actually do something", () => {
    for (const r of LADDER) {
      const e = r.effects ?? {};
      const does = Object.keys(e).length > 0 &&
        (e.shopEveryOtherLevel || e.noCapstone || e.fencesWearOut || e.everyMapMutated ||
         e.doorOffers != null || e.pickupLifetimeFactor != null ||
         e.forcedCurseLoadoutId != null || Object.keys(e.modifiers ?? {}).length > 0);
      expect(does, `depth ${r.depth} (${r.name}) has no effect`).toBe(true);
    }
  });

  /**
   * The design invariant, and the reason the ladder was rewritten.
   *
   * A rung that subtracts from a stat meets the shop upgrade that adds to it.
   * The original draft had `fenceDurabilityBonus: -1` at depth 2, which
   * Defensive Programming cancels exactly, and Defensive Programming exists for
   * nothing else: the rung would have made one upgrade a mandatory tax and left
   * it dead everywhere else.
   *
   * Two collisions are allowed by name because their counter is a real
   * decision rather than a purchase: overtimeCapBonus against the once-per-run
   * Stock Options capstone, and ball speed against Runtime Optimisation.
   */
  it("does not dock a stat the shop sells the exact counter to", () => {
    const ALLOWED = new Set(["overtimeCapBonus", "ballSpeedMultiplier"]);
    const shopKeys = new Set<string>();
    for (const u of UPGRADES) for (const k of Object.keys(u.modifiers ?? {})) shopKeys.add(k);

    const offenders: string[] = [];
    for (const r of LADDER) {
      for (const key of Object.keys(r.effects?.modifiers ?? {})) {
        if (ALLOWED.has(key)) continue;
        if (shopKeys.has(key)) offenders.push(`depth ${r.depth} (${r.name}) -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is mostly rules, so most rungs cannot be bought back at any price", () => {
    const ruleShaped = LADDER.filter(r => {
      const e = r.effects ?? {};
      return Boolean(e.shopEveryOtherLevel || e.doorOffers != null || e.noCapstone ||
        e.fencesWearOut || e.everyMapMutated || e.pickupLifetimeFactor != null ||
        e.forcedCurseLoadoutId);
    });
    expect(ruleShaped.length).toBeGreaterThanOrEqual(LADDER.length / 2);
  });

  it("points its forced curse at a real loadout that is never drafted", () => {
    const forced = LADDER.map(r => r.effects?.forcedCurseLoadoutId).filter(Boolean) as string[];
    expect(forced.length).toBeGreaterThan(0);
    for (const id of forced) {
      const l = LOADOUTS.loadouts.find(x => x.id === id);
      expect(l, `${id} must exist in loadouts.yml`).toBeTruthy();
      expect(l!.neverDrafted, `${id} must never be offered as a reward`).toBe(true);
    }
  });
});

// ── Folding ─────────────────────────────────────────────────────────────────

describe("what is in force at a depth", () => {
  it("changes nothing at depth 0", () => {
    expect(ascensionRules(0, LADDER)).toEqual(NO_ASCENSION_RULES);
    expect(rungsUpTo(0, LADDER)).toEqual([]);
  });

  it("accumulates, so a deeper run keeps every rule below it", () => {
    for (let d = 1; d <= LADDER_LENGTH; d++) {
      expect(rungsUpTo(d, LADDER), `depth ${d}`).toHaveLength(d);
    }
  });

  it("gives every depth a different rule set from the one below", () => {
    for (let d = 1; d <= LADDER_LENGTH; d++) {
      const here = JSON.stringify(ascensionRules(d, LADDER));
      const below = JSON.stringify(ascensionRules(d - 1, LADDER));
      expect(here, `depth ${d} is indistinguishable from ${d - 1}`).not.toBe(below);
    }
  });

  it("keeps the whole ladder past its end", () => {
    const top = ascensionRules(LADDER_LENGTH, LADDER);
    expect(ascensionRules(LADDER_LENGTH + 5, LADDER)).toEqual(top);
  });

  it("names the rung earned at exactly this depth", () => {
    expect(rungAt(1, LADDER)?.depth).toBe(1);
    expect(rungAt(LADDER_LENGTH, LADDER)?.depth).toBe(LADDER_LENGTH);
    expect(rungAt(LADDER_LENGTH + 1, LADDER)).toBeNull();
  });

  it("survives an empty ladder, which is what a failed load leaves behind", () => {
    expect(ascensionRules(5, [])).toEqual(NO_ASCENSION_RULES);
  });
});

describe("folding rules together", () => {
  const mk = (depth: number, effects: AscensionRung["effects"]): AscensionRung =>
    ({ depth, name: `r${depth}`, description: "d", effects });

  it("takes the tighter door count, so a later rung can never widen the draft", () => {
    const l = [mk(1, { doorOffers: 2 }), mk(2, { doorOffers: 3 })];
    expect(ascensionRules(2, l).doorOffers).toBe(2);
  });

  it("multiplies pickup lifetime, so two halvings quarter it", () => {
    const l = [mk(1, { pickupLifetimeFactor: 0.5 }), mk(2, { pickupLifetimeFactor: 0.5 })];
    expect(ascensionRules(2, l).pickupLifetimeFactor).toBeCloseTo(0.25, 6);
  });

  it("sums additive modifiers and compounds multiplicative ones", () => {
    const l = [
      mk(1, { modifiers: { overtimeCapBonus: -10, ballSpeedMultiplier: 1.1 } }),
      mk(2, { modifiers: { overtimeCapBonus: -10, ballSpeedMultiplier: 1.1 } }),
    ];
    const r = ascensionRules(2, l);
    expect(r.modifiers.overtimeCapBonus).toBe(-20);
    expect(r.modifiers.ballSpeedMultiplier).toBeCloseTo(1.21, 6);
  });

  it("ignores a rung whose depth is above the current one", () => {
    const l = [mk(1, { noCapstone: true }), mk(9, { everyMapMutated: true })];
    const r = ascensionRules(1, l);
    expect(r.noCapstone).toBe(true);
    expect(r.everyMapMutated).toBe(false);
  });
});

describe("the store cadence", () => {
  it("opens after every level until Hiring Freeze bites", () => {
    for (const lv of [1, 2, 3, 4, 5]) {
      expect(shopOpensAfter(lv, NO_ASCENSION_RULES), `level ${lv}`).toBe(true);
    }
  });

  /**
   * Counted from the first level, so level 1's store still opens: a run that
   * could not spend its opening income would be strictly worse than one that
   * never earned it.
   */
  it("skips every other level once it does, starting with the first open", () => {
    const rules = ascensionRules(1, LADDER);
    expect(rules.shopEveryOtherLevel).toBe(true);
    expect([1, 2, 3, 4, 5, 6].map(lv => shopOpensAfter(lv, rules)))
      .toEqual([true, false, true, false, true, false]);
  });
});

// ── The announcement ────────────────────────────────────────────────────────

/**
 * Arriving at a depth without being told what changed was the original
 * complaint: the rules were in force and only the Specs panel knew about them.
 *
 * `t` is stubbed to echo its key plus the interpolated values, so these tests
 * check WHICH strings are assembled rather than what any locale says they are.
 */
const fakeT = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}(${Object.values(vars).join("|")})` : key) as unknown as Parameters<typeof ascensionAnnouncement>[0];

describe("announcing a depth", () => {
  it("says nothing at depth 0, so no modal opens on a normal run", () => {
    expect(ascensionAnnouncement(fakeT, 0, LADDER)).toBeNull();
  });

  it("says nothing when the ladder failed to load", () => {
    expect(ascensionAnnouncement(fakeT, 4, [])).toBeNull();
  });

  it("leads with the rung just earned", () => {
    const a = ascensionAnnouncement(fakeT, 4, LADDER)!;
    expect(a.title).toContain("4");
    // The lead rung's description is spelled out in full.
    expect(a.body).toContain(LADDER[3].description);
  });

  it("names the rungs already in force without repeating their descriptions", () => {
    const a = ascensionAnnouncement(fakeT, 4, LADDER)!;
    expect(a.body).toContain("ascension.alsoInForce");
    for (const below of LADDER.slice(0, 3)) {
      expect(a.body, below.name).toContain(below.name);
      expect(a.body, `${below.name} description should not be repeated`)
        .not.toContain(below.description);
    }
  });

  it("has nothing to list at depth 1, where the lead rung is the only one", () => {
    const a = ascensionAnnouncement(fakeT, 1, LADDER)!;
    expect(a.body).toContain(LADDER[0].description);
    expect(a.body).not.toContain("ascension.alsoInForce");
  });

  /**
   * Past the ladder's end no rung is earned, but the run is still governed by
   * all ten and the player still deserves to be told which.
   */
  it("still describes the run past the ladder's end", () => {
    const a = ascensionAnnouncement(fakeT, LADDER_LENGTH + 3, LADDER)!;
    expect(a.title).toContain(String(LADDER_LENGTH + 3));
    expect(a.body).toContain(LADDER[LADDER_LENGTH - 1].description);
  });
});
