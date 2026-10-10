/**
 * The canvas Specs panel's logic (ui/game/specsModel.ts), carrying over the
 * behavioural assertions of hudObjectiveReadouts.test.tsx, mapRuleFocus.test.tsx
 * and noAssignments.test.tsx: objective cards read the per-map numbers in the
 * units their headings promise, a panel opened from the map-rule banner leads
 * with the map rule (once), and the run section appears only with something in it.
 */
import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import i18n from "@/i18n";
import { contentText } from "@/i18n/content";
import type { CapstoneConfig } from "@/types/capstone";
import {
  cutsCard, hasBuildSection, locksCard, microManagerPercent, mutatorPlacement, objectiveState,
  sectionHeading, specsSections, tagChipSpecs, territoryCard, type SpecsSectionInput,
} from "@/ui/game/specsModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;

describe("thread locks count THIS map", () => {
  it("does not call a per-map objective met on an untouched board", () => {
    const c = locksCard(t, 0, 2);
    expect(c.value).toBe("0 / 2");
    expect(c.met).toBe(false);
    expect(c.detail).not.toMatch(/objective met/i);
  });

  it("calls it met once the map itself has the locks", () => {
    const c = locksCard(t, 2, 2);
    expect(c.value).toBe("2 / 2");
    expect(c.met).toBe(true);
    expect(c.detail).toMatch(/objective met/i);
  });

  it("never shows a count above the requirement it is measured against", () => {
    const c = locksCard(t, 1, 2);
    expect(c.value).not.toMatch(/8[0-9] \/ 2/);
    expect(c.value).toBe("1 / 2");
  });

  it("shows a bare count when no locks are required, and is never lit", () => {
    expect(locksCard(t, 3, 0).value).toBe("3");
    expect(locksCard(t, 3, 0).met).toBe(false);
  });
});

describe("territory capture counts what was captured", () => {
  it("reads zero on an untouched board, not a hundred", () => {
    const c = territoryCard(t, 100, 5);
    expect(c.value).toBe("0% / 95%");
    expect(c.detail).toMatch(/Capture at least 95% of the board/);
    expect(c.detail).toMatch(/Currently at 0%/);
    expect(c.detail).toMatch(/need 95% more/);
  });

  it("counts up as the board is cleared", () => {
    const c = territoryCard(t, 40, 5);
    expect(c.value).toBe("60% / 95%");
    expect(c.detail).toMatch(/need 35% more/);
  });

  it("congratulates the capture, not the leftovers", () => {
    const c = territoryCard(t, 5, 5);
    expect(c.met).toBe(true);
    expect(c.detail).toMatch(/captured 95%/);
    expect(c.detail).not.toMatch(/captured 5%/);
  });
});

describe("cuts against par", () => {
  it("turns red only over par", () => {
    expect(cutsCard(t, 11, 10).overPar).toBe(true);
    expect(cutsCard(t, 10, 10).overPar).toBe(false);
    expect(cutsCard(t, 0, 10).detail).toBe(t("topBarDetails.cutsParInfo", { par: 10 }));
    expect(cutsCard(t, 4, 10).detail).toBe(t("topBarDetails.cutsRemaining", { count: 6 }));
  });
});

const BASE: SpecsSectionInput = {
  focus: null, hasMutator: true, hasBuild: false, hasAssignment: true, hasModifiers: false, manualCount: 0,
};
const headings = (i: SpecsSectionInput) => specsSections(i).map(s => sectionHeading(t, s));

describe("opening Specs from the map-rule banner", () => {
  it("puts the map rule in the very first section", () => {
    const h = headings({ ...BASE, focus: "mapRule" });
    expect(h[0], `sections were: ${h.join(" | ")}`).toBe("Map rule");
  });

  it("shows the rule exactly once", () => {
    // Hoisted OUT of ASSIGNMENT, not copied above it.
    expect(mutatorPlacement("mapRule", true)).toBe("first");
    expect(specsSections({ ...BASE, focus: "mapRule" }).filter(s => s === "mapRule")).toHaveLength(1);
  });
});

describe("opening Specs to browse", () => {
  it("leaves the map rule in its usual place, not first", () => {
    const h = headings(BASE);
    expect(h[0]).not.toBe("Map rule");
    expect(h).not.toContain("Map rule");
    expect(mutatorPlacement(null, true)).toBe("assignment");
  });
});

describe("a map with no rule", () => {
  it("shows no map-rule section even when one was asked for", () => {
    expect(headings({ ...BASE, focus: "mapRule", hasMutator: false })).not.toContain("Map rule");
    expect(mutatorPlacement("mapRule", false)).toBeNull();
  });
});

describe("Specs panel run section", () => {
  const capstone = {
    id: "stock_options", name: "Stock Options",
    description: "The per-map overtime cap rises by 20h.", tag: "risk",
    clarify: "", modifiers: {},
  } as CapstoneConfig;

  it("shows the Promotion's description", () => {
    expect(specsSections({ ...BASE, hasMutator: false, hasAssignment: true })).toContain("assignment");
    expect(contentText.capstoneDesc(t, capstone)).toBe("The per-map overtime cap rises by 20h.");
  });

  it("shows nothing from the Promotion before one is taken", () => {
    expect(specsSections({ ...BASE, hasMutator: false, hasAssignment: false })).not.toContain("assignment");
  });
});

describe("section order and contents", () => {
  it("always shows objectives, status and upgrades, and keeps the manual last", () => {
    const s = specsSections({ ...BASE, hasBuild: true, hasModifiers: true, manualCount: 2 });
    expect(s).toEqual(["build", "objectives", "assignment", "status", "upgrades", "attributes", "manual"]);
    expect(specsSections({ ...BASE, hasMutator: false, hasAssignment: false }))
      .toEqual(["objectives", "status", "upgrades"]);
  });

  it("titles the build and upgrades by depth and count", () => {
    expect(sectionHeading(t, "build", { ascensionDepth: 2 })).toBe(t("topBarDetails.buildAscension", { depth: 2 }));
    expect(sectionHeading(t, "upgrades", { upgradeCount: 3 })).toBe(t("topBarDetails.activeUpgradesCount", { count: 3 }));
    expect(sectionHeading(t, "upgrades", { upgradeCount: 0 })).toBe(t("topBarDetails.activeUpgrades"));
  });

  it("has a build only with tags, ascension or a loadout", () => {
    expect(hasBuildSection(undefined, 0, 0)).toBe(false);
    expect(hasBuildSection(new Map(), 0, 0)).toBe(false);
    expect(hasBuildSection(new Map([["lock", 1]]), 0, 0)).toBe(true);
    expect(hasBuildSection(undefined, 1, 0)).toBe(true);
    expect(hasBuildSection(undefined, 0, 1)).toBe(true);
  });

  it("orders tag chips most-owned first and checks a lit set", () => {
    const c = tagChipSpecs(new Map([["lock", 1], ["freeze", 3]]), 3);
    expect(c.map(x => x.tag)).toEqual(["freeze", "lock"]);
    expect(c[0]).toMatchObject({ setActive: true, suffix: "✓" });
    expect(c[1]).toMatchObject({ setActive: false, suffix: "1/3" });
  });

  it("reads the optional objective's state", () => {
    expect(objectiveState(null)).toEqual({ complete: false, overBudget: false, tally: null });
    expect(objectiveState({ kind: "x", mode: "accumulate", current: 3, target: 3, met: true } as never).tally).toBe("3/3 ✓");
    expect(objectiveState({ kind: "x", mode: "limit", current: 4, target: 3, met: false } as never).overBudget).toBe(true);
  });

  it("caps Micro Manager's readout at 50%", () => {
    expect(microManagerPercent(2, 0.1)).toBe(20);
    expect(microManagerPercent(20, 0.1)).toBe(50);
  });
});
