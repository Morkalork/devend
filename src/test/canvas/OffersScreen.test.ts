/**
 * The Sprint Planning collection page's split and wording (SPRINT_PLANNING_PLAN.md).
 */
import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { getOfferCatalogue } from "@/lib/sprintOffers";
import { offerCount, offerSections, unlockText } from "@/ui/screens/offersModel";

const t = ((key: string, vars?: Record<string, unknown>) => `${key}${vars ? JSON.stringify(vars) : ""}`) as unknown as TFunction;

describe("offerSections", () => {
  it("lists every pool in the draft's order", () => {
    const sections = offerSections(getOfferCatalogue(), { highestLevelReached: 0, metArchetypes: [] });
    expect(sections.map(s => s.pool)).toEqual(["boon", "specialisation", "gamble"]);
  });

  it("opens a Specialisation once its archetype is met, and a gamble once its level is reached", () => {
    const fresh = offerSections(getOfferCatalogue(), { highestLevelReached: 0, metArchetypes: [] });
    const later = offerSections(getOfferCatalogue(), { highestLevelReached: 19, metArchetypes: ["lock"] });
    const ids = (s: typeof fresh, pool: string, k: "unlocked" | "locked") => s.find(x => x.pool === pool)![k].map(o => o.id);
    expect(ids(fresh, "specialisation", "locked")).toContain("containment");
    expect(ids(later, "specialisation", "unlocked")).toContain("containment");
    expect(ids(fresh, "gamble", "locked")).toContain("headhunted");
    expect(ids(later, "gamble", "unlocked")).toContain("headhunted");
    // The jackpot is never locked.
    expect(ids(fresh, "gamble", "unlocked")).toContain("unicorn");
  });

  it("counts what is open against the whole catalogue", () => {
    const sections = offerSections(getOfferCatalogue(), { highestLevelReached: 0, metArchetypes: [] });
    const { open, total } = offerCount(sections);
    expect(total).toBe(sections.reduce((n, s) => n + s.unlocked.length + s.locked.length, 0));
    expect(open).toBeLessThan(total);
    expect(open).toBeGreaterThan(0);
  });
});

describe("unlockText", () => {
  it("names the level, or the archetype to meet", () => {
    expect(unlockText(t, { kind: "levelReached", level: 20 })).toContain("offers.unlockLevel");
    expect(unlockText(t, { kind: "archetypeMet", tag: "lock" })).toContain("offers.unlockArchetype");
    expect(unlockText(t, undefined)).toBe("");
  });
});
