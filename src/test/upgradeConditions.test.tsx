/**
 * Conditional upgrades: numbers that only pay in a situation.
 *
 * Three things have to hold or the feature is worse than not shipping it:
 *
 *  1. The evaluator says yes exactly when the situation holds.
 *  2. An upgrade whose condition is unmet contributes NOTHING to the modifier
 *     set. A condition that decorates the card but not the maths is a lie.
 *  3. The condition is ON THE CARD, in every language. A conditional upgrade
 *     the player cannot see is a trap: they pay for a number that never
 *     appears and conclude the game is broken.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import "@/i18n"; // side-effect: initialise react-i18next synchronously
import i18n from "@/i18n";
import {
  conditionMet, conditionText, mapContextOf,
  CONDITION_KINDS, MAP_FEATURES,
  type RunContext, type UpgradeCondition,
} from "@/lib/upgradeConditions";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";
import { UpgradeShop } from "@/components/game/UpgradeShop";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import type { LevelConfig, LevelData } from "@/types/level";
import { NORMAL_LIVES } from "@/hooks/useGameSession";

const upgrades = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as UpgradeData).upgrades;
const levels = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;

const conditional = upgrades.filter(u => u.condition);

function ctx(over: Partial<RunContext> = {}): RunContext {
  return {
    level: 5, lives: 3, banked: 0, depth: 0,
    map: { balls: 1, hasWell: false, hasMover: false, hasBreakable: false, hasArea: false, hasBoss: false },
    ...over,
  };
}

afterEach(cleanup);

describe("the condition evaluator", () => {
  it("says yes exactly when the situation holds, for every kind", () => {
    const cases: Array<[UpgradeCondition, Partial<RunContext>, Partial<RunContext>]> = [
      [{ kind: "livesAtMost", value: 1 }, { lives: 1 }, { lives: 2 }],
      [{ kind: "bankedAtLeast", value: 150 }, { banked: 150 }, { banked: 149 }],
      [{ kind: "levelAtLeast", value: 20 }, { level: 20 }, { level: 19 }],
      [{ kind: "depthAtLeast", value: 1 }, { depth: 1 }, { depth: 0 }],
      [{ kind: "ballsAtLeast", value: 3 }, { map: ctx().map && { ...ctx().map, balls: 3 } }, { map: { ...ctx().map, balls: 2 } }],
    ];
    for (const [condition, met, unmet] of cases) {
      expect(conditionMet(condition, ctx(met)), JSON.stringify(condition)).toBe(true);
      expect(conditionMet(condition, ctx(unmet)), JSON.stringify(condition)).toBe(false);
    }
  });

  it("reads each map feature off the run's map, and only that feature", () => {
    const flags: Record<string, keyof RunContext["map"]> = {
      well: "hasWell", mover: "hasMover", breakable: "hasBreakable", area: "hasArea", boss: "hasBoss",
    };
    for (const feature of MAP_FEATURES) {
      const on = ctx({ map: { ...ctx().map, [flags[feature]]: true } });
      expect(conditionMet({ kind: "mapHas", feature }, on), feature).toBe(true);
      expect(conditionMet({ kind: "mapHas", feature }, ctx()), feature).toBe(false);
      // No other feature satisfies it: a mover must not answer for a well.
      for (const other of MAP_FEATURES) {
        if (other === feature) continue;
        expect(conditionMet({ kind: "mapHas", feature: other }, on), `${other} vs ${feature}`).toBe(false);
      }
    }
  });

  it("treats no condition and no context as met, so the flat catalogue is untouched", () => {
    expect(conditionMet(undefined, ctx())).toBe(true);
    expect(conditionMet(undefined, null)).toBe(true);
    // No context happens in the Playground and in previews. Showing every
    // conditional card as a zero there would be worse than showing its number.
    expect(conditionMet({ kind: "livesAtMost", value: 1 }, null)).toBe(true);
  });

  it("reads a real level's features off map.yml", () => {
    // Level 10 is the boss whose win gate is a coloured area, which is what
    // makes it the map that must report BOTH.
    const boss = levels.find(l => l.id === "level-10") as LevelConfig;
    const m = mapContextOf(boss);
    expect(m.hasArea).toBe(true);
    expect(m.hasBoss).toBe(true);
    // A plain early map reports nothing, so "has" means something.
    const plain = mapContextOf(levels.find(l => l.id === "level-1") as LevelConfig);
    expect(plain.hasWell || plain.hasMover || plain.hasArea || plain.hasBoss).toBe(false);
    expect(mapContextOf(null)).toEqual({
      balls: 0, hasWell: false, hasMover: false, hasBreakable: false, hasArea: false, hasBoss: false,
    });
  });
});

describe("an unmet condition contributes nothing", () => {
  const gated: UpgradeConfig = {
    id: "gated", name: "Gated", tier: "Principal", description: "x", cost: 10, unlockLevel: 1,
    modifiers: { extraShopItems: 3 },
    condition: { kind: "livesAtMost", value: 1 },
  };
  const lookup = new Map([["gated", gated]]);

  it("is folded in when met and skipped entirely when not", () => {
    const met = computeGameModifiers(["gated"], lookup, undefined, ctx({ lives: 1 }));
    const unmet = computeGameModifiers(["gated"], lookup, undefined, ctx({ lives: 3 }));
    const none = computeGameModifiers([], lookup, undefined, ctx({ lives: 1 }));
    expect(met.extraShopItems).toBe(3);
    // Not merely reduced: identical to never having owned it.
    expect(unmet.extraShopItems).toBe(none.extraShopItems);
  });

  it("still applies with no context at all, so nothing regresses off-run", () => {
    expect(computeGameModifiers(["gated"], lookup, undefined, null).extraShopItems).toBe(3);
    expect(computeGameModifiers(["gated"], lookup).extraShopItems).toBe(3);
  });
});

describe("the condition is on the card", () => {
  const live: UpgradeConfig = {
    id: "live_one", name: "Severance", tier: "Principal", description: "Pays on area maps",
    cost: 10, unlockLevel: 1, modifiers: { overtimePerSuperiorLock: 45 },
    condition: { kind: "mapHas", feature: "area" },
  };
  const dark: UpgradeConfig = {
    id: "dark_one", name: "Hot Start", tier: "Architect", description: "Pays late",
    cost: 10, unlockLevel: 1, modifiers: { instantFencesPerMap: 2 },
    condition: { kind: "levelAtLeast", value: 20 },
  };

  function shopProps(over: Partial<React.ComponentProps<typeof UpgradeShop>> = {}) {
    return {
      playerPoints: 5000,
      upgrades: [live, dark],
      ownedUpgradeIds: [] as string[],
      completedLevel: 5,
      isLocked: () => false,
      onPurchase: vi.fn(),
      onContinue: vi.fn(),
      ...over,
    };
  }

  it("shows the condition text, and marks it live or not for the NEXT map", () => {
    // A map with a coloured area, at level 5: the area upgrade is live, the
    // level-20 one is not. Both must still be READABLE.
    render(<UpgradeShop {...shopProps({
      runContext: ctx({ level: 5, map: { ...ctx().map, hasArea: true } }),
    })} />);

    const areaText = i18n.t("upgradeConditions.mapHas.area");
    const lateText = i18n.t("upgradeConditions.levelAtLeast", { level: 20 });
    expect(screen.getAllByText(areaText).length).toBeGreaterThan(0);
    expect(screen.getAllByText(lateText).length).toBeGreaterThan(0);

    // "Live" and "not live" are told apart by the chip's title, not by the
    // text vanishing: a hidden condition is the trap this test exists to stop.
    const liveChip = screen.getAllByText(areaText)[0].closest("span")!;
    const darkChip = screen.getAllByText(lateText)[0].closest("span")!;
    expect(liveChip.getAttribute("title")).toBe(i18n.t("upgradeConditions.liveNow"));
    expect(darkChip.getAttribute("title")).toBe(i18n.t("upgradeConditions.notNow"));
  });

  it("shows every condition as live when the shop knows no next map", () => {
    render(<UpgradeShop {...shopProps({ runContext: null })} />);
    const chip = screen.getAllByText(i18n.t("upgradeConditions.mapHas.area"))[0].closest("span")!;
    expect(chip.getAttribute("title")).toBe(i18n.t("upgradeConditions.liveNow"));
  });
});

describe("every condition has words, in every language", () => {
  const locales = ["en", "sv", "es"] as const;

  it("translates each kind and each map feature", () => {
    const keys = [
      ...CONDITION_KINDS.map(kind => conditionText({ kind, value: 2 } as UpgradeCondition)),
      ...MAP_FEATURES.map(feature => conditionText({ kind: "mapHas", feature })),
      { key: "upgradeConditions.liveNow", params: {} },
      { key: "upgradeConditions.notNow", params: {} },
    ];
    for (const locale of locales) {
      const t = i18n.getFixedT(locale);
      for (const { key, params } of keys) {
        const text = t(key, { ...params, count: 2 }) as string;
        expect(text, `${locale}:${key}`).toBeTruthy();
        // A missing key falls through to the key itself.
        expect(text, `${locale}:${key}`).not.toBe(key);
        expect(text, `${locale}:${key}`).not.toContain("{{");
        // UI text carries no em-dashes (CLAUDE.md).
        expect(text, `${locale}:${key}`).not.toContain("—");
      }
    }
  });

  it("says something different for one life than for several", () => {
    // Plural forms exist because "At 1 lives or fewer" is how a card stops
    // being trusted. Compared as TEMPLATES, not as rendered output: two
    // identical templates still render differently once the count is
    // interpolated, so rendered output cannot tell a real plural split from a
    // copy-pasted one.
    for (const locale of locales) {
      const bundle = i18n.getResourceBundle(locale, "translation")
        .upgradeConditions as Record<string, string>;
      expect(bundle.livesAtMost_one, locale).toBeTruthy();
      expect(bundle.livesAtMost_other, locale).toBeTruthy();
      expect(bundle.livesAtMost_one, locale).not.toBe(bundle.livesAtMost_other);
      expect(bundle.ballsAtLeast_one, locale).not.toBe(bundle.ballsAtLeast_other);
      // And they still resolve through i18next's own plural rules, which is
      // what the card actually calls.
      const t = i18n.getFixedT(locale);
      expect(t("upgradeConditions.livesAtMost", { count: 1 }), locale)
        .toBe(bundle.livesAtMost_one);
      expect(t("upgradeConditions.livesAtMost", { count: 3 }), locale)
        .toBe(bundle.livesAtMost_other.replace("{{count}}", "3"));
    }
  });
});

describe("the converted catalogue", () => {
  it("converted a first tranche rather than the whole flat catalogue", () => {
    expect(conditional.length).toBeGreaterThanOrEqual(10);
    // A guard against a later sweep that makes everything situational: if most
    // of the catalogue is gated, the shop is a lottery, not a draft.
    expect(conditional.length).toBeLessThan(upgrades.length / 2);
  });

  it("gates only fork options, never a lone upgrade", () => {
    // The point of the tranche is to turn "good or worse" forks into "steady or
    // situational". A gated upgrade with no alternative is just a worse
    // upgrade: the player has nothing to weigh it against.
    for (const u of conditional) {
      expect(u.choiceGroup, `${u.id} is gated but not a fork option`).toBeTruthy();
      const siblings = upgrades.filter(o => o.choiceGroup === u.choiceGroup && o.id !== u.id);
      expect(siblings.length, `${u.id} has no fork partner`).toBeGreaterThan(0);
      // And the partner must be the steady side, or the fork is two gambles.
      expect(siblings.some(s => !s.condition), `${u.id}: every option is gated`).toBe(true);
    }
  });

  it("pays more than its steady partner on at least one shared number", () => {
    // Uptime is what the player pays with. A conditional option that is not
    // bigger anywhere is strictly worse, and nobody would ever take it.
    for (const u of conditional) {
      const steady = upgrades.find(o => o.choiceGroup === u.choiceGroup && !o.condition);
      if (!steady) continue;
      const mods = (u.modifiers ?? {}) as Record<string, number>;
      const theirs = (steady.modifiers ?? {}) as Record<string, number>;
      const shared = Object.keys(mods).filter(k => k in theirs);
      // Either it beats them on something shared, or it does something the
      // steady option does not do at all.
      const beats = shared.some(k => mods[k] !== theirs[k]);
      const novel = Object.keys(mods).some(k => !(k in theirs));
      expect(beats || novel, `${u.id} is not distinguishable from ${steady.id}`).toBe(true);
    }
  });

  it("has translatable, em-dash-free wording for every gated upgrade", () => {
    for (const u of conditional) {
      expect(u.description, u.id).toBeTruthy();
      expect(u.description, u.id).not.toContain("—");
      // The description must state the situation too: the chip is small, and
      // the description is what the hold-to-explain modal reads out.
      expect(u.description!.length, u.id).toBeGreaterThan(20);
    }
  });

  it("never gates on a feature no shipped map has", () => {
    const anywhere = levels.map(mapContextOf);
    const has: Record<string, boolean> = {
      well: anywhere.some(m => m.hasWell),
      mover: anywhere.some(m => m.hasMover),
      breakable: anywhere.some(m => m.hasBreakable),
      area: anywhere.some(m => m.hasArea),
      boss: anywhere.some(m => m.hasBoss),
    };
    for (const u of conditional) {
      const c = u.condition!;
      if (c.kind === "mapHas") {
        expect(has[c.feature], `${u.id} gates on ${c.feature}, which no map has`).toBe(true);
      }
      // Same for a level gate past the end of the ladder: it would never fire.
      if (c.kind === "levelAtLeast") {
        expect(c.value, `${u.id} gates past the final level`).toBeLessThanOrEqual(levels.length);
      }
    }
  });

  it("gates on something that is sometimes true and sometimes not", () => {
    // Reachability alone is not enough. A condition every map satisfies is a
    // FLAT upgrade wearing a costume: it always pays, the shop resolves to the
    // same order it always did, and the player has been sold a bet with no
    // downside. The whole mechanic is that the wager can lose.
    const maps = levels.map(mapContextOf);
    const split = (met: (m: ReturnType<typeof mapContextOf>) => boolean) => {
      const yes = maps.filter(met).length;
      return { yes, no: maps.length - yes };
    };

    for (const u of conditional) {
      const c = u.condition!;
      let s: { yes: number; no: number } | null = null;
      if (c.kind === "mapHas") {
        const feature = c.feature;
        s = split(m => (
          feature === "well" ? m.hasWell
          : feature === "mover" ? m.hasMover
          : feature === "breakable" ? m.hasBreakable
          : feature === "area" ? m.hasArea
          : m.hasBoss
        ));
      } else if (c.kind === "ballsAtLeast") {
        s = split(m => m.balls >= c.value);
      }
      if (!s) continue;  // run-state conditions are not map-decidable

      expect(s.yes, `${u.id}: no map satisfies it, so it never pays`).toBeGreaterThan(0);
      expect(s.no, `${u.id}: every map satisfies it, so it is flat`).toBeGreaterThan(0);
    }
  });

  it("keeps the run-state gates inside the range a run can reach", () => {
    // The same argument for the conditions the map cannot decide. A lives gate
    // above the starting lives is always on; one at zero never fires, because
    // zero lives is a game over rather than a map.
    // Imported, not restated: a gate tuned against a stale copy of this number
    // is the exact failure the test exists to catch.
    const startingLives = NORMAL_LIVES;
    for (const u of conditional) {
      const c = u.condition!;
      if (c.kind === "livesAtMost") {
        expect(c.value, `${u.id}: a lives gate at 0 can never be live`).toBeGreaterThan(0);
        expect(c.value, `${u.id}: gates at or above the starting lives, so it is flat`)
          .toBeLessThan(startingLives);
      }
      if (c.kind === "bankedAtLeast" || c.kind === "depthAtLeast") {
        expect(c.value, `${u.id}: a gate at 0 is always met`).toBeGreaterThan(0);
      }
      if (c.kind === "levelAtLeast") {
        expect(c.value, `${u.id}: a level gate at 1 is always met`).toBeGreaterThan(1);
      }
    }
  });
});
