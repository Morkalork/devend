/**
 * The draft catalogue (public/cards.yml, CARDS_PLAN.md) is well formed.
 *
 * It rides the classic store's whole pipeline (the modifier merge, the shelf
 * roll, the tag sets, Sprint Planning), so a card that names a key nothing
 * reads, or a "+" with no card under it, fails silently in play: the card is
 * taken and nothing happens. These say so here instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import { DEFAULT_MODIFIERS, computeGameModifiers, MULTIPLICATIVE_KEYS, type GameModifiers } from "@/hooks/useActiveModifiers";
import { UPGRADE_ICONS } from "@/components/game/upgradeIcons";
import { CARD_SLOTS, isPlusCard, slotCards, withPlus, rerollPrice } from "@/lib/cardRules";
import { rollShelf } from "@/ui/screens/shopModel";
import { rollSprintDeal, parseOfferCatalogue } from "@/lib/sprintOffers";
import { eligibleTenureChains, TENURE_THRESHOLDS } from "@/lib/tenure";

const read = (f: string) => readFileSync(resolve(__dirname, "../../public", f), "utf8");
const DATA = yaml.load(read("cards.yml")) as UpgradeData;
const CARDS = DATA.upgrades;
const BY_ID = new Map(CARDS.map(c => [c.id, c]));
const BASE = CARDS.filter(c => !isPlusCard(c));
const PLUS = CARDS.filter(isPlusCard);
const TAGS = ["lock", "freeze", "bank", "tempo", "risk", "safety"];
const FENCE_IDS = new Set((yaml.load(read("fences.yml")) as { fences: { id: string }[] }).fences.map(f => f.id));
const CERT_SOURCES = new Set(
  (yaml.load(read("certificates.yml")) as { certificates: { sourceUpgradeId?: string }[] }).certificates
    .flatMap(c => (c.sourceUpgradeId ? [c.sourceUpgradeId] : [])),
);

describe("the catalogue's shape", () => {
  it("is about fifty cards, each one idea", () => {
    // Forty when the draft opened; the fence payoffs, Hot Reload and the five
    // verb cards (phase 9) brought it to the mid fifties. The cap is a brake on
    // the catalogue growing by numbers, not by ideas.
    expect(BASE.length).toBeGreaterThanOrEqual(36);
    expect(BASE.length).toBeLessThanOrEqual(60);
    // One card per name: the ladders are gone.
    expect(new Set(BASE.map(c => c.name)).size).toBe(BASE.length);
  });

  it("has unique ids", () => {
    expect(BY_ID.size).toBe(CARDS.length);
  });

  it.each(CARDS.map(c => [c.id, c] as const))("%s is complete and reads only real keys", (_id, c) => {
    expect(c.name && c.description).toBeTruthy();
    expect(["Junior", "Senior", "Principal"]).toContain(c.tier);
    expect(c.tags?.length).toBeGreaterThan(0);
    for (const tag of c.tags ?? []) {
      expect(TAGS).toContain(tag);
    }
    for (const [key, value] of Object.entries(c.modifiers)) {
      expect(key in DEFAULT_MODIFIERS, `${c.id}: no modifier is called ${key}`).toBe(true);
      expect(Number.isFinite(value)).toBe(true);
    }
    // A card does something: a modifier or a fence type.
    expect(Object.keys(c.modifiers).length > 0 || !!c.grantsFenceType, `${c.id} does nothing`).toBe(true);
    if (c.grantsFenceType) {
      expect(FENCE_IDS.has(c.grantsFenceType)).toBe(true);
    }
    if (c.certCredit) {
      expect(CERT_SOURCES.has(c.certCredit), `${c.id}: no certificate chases ${c.certCredit}`).toBe(true);
    }
    for (const text of [c.name, c.description, c.downside ?? ""]) {
      expect(text).not.toContain("—");
    }
  });

  it.each(BASE.map(c => [c.id, c] as const))("%s has an icon the registry knows", (_id, c) => {
    expect(c.icon && c.icon in UPGRADE_ICONS, `${c.id}: icon ${c.icon}`).toBe(true);
  });

  it.each(PLUS.map(c => [c.id, c] as const))("%s rides on a real card and is its only upgrade", (_id, c) => {
    const base = BY_ID.get(c.upgradeOf!);
    expect(base, `${c.id}: no card ${c.upgradeOf}`).toBeDefined();
    expect(isPlusCard(base)).toBe(false);
    expect(PLUS.filter(p => p.upgradeOf === c.upgradeOf)).toHaveLength(1);
    expect(c.name).toBe(`${base!.name}+`);
    expect(c.id).toBe(`${base!.id}_plus`);
  });

  it("keeps the set bonuses the six archetypes build toward", () => {
    expect(DATA.tagSets?.bonuses.map(b => b.tag).sort()).toEqual([...TAGS].sort());
  });
});

describe("what a card pays off", () => {
  const byId = new Map(CARDS.map(c => [c.id, c]));

  it("names cards that exist, never a + and never itself", () => {
    const problems: string[] = [];
    for (const c of CARDS) {
      for (const id of c.paysOff ?? []) {
        const target = byId.get(id);
        if (!target) problems.push(`${c.id} pays off ${id}, which is not a card`);
        else if (target.upgradeOf) problems.push(`${c.id} pays off ${id}, which is a +`);
        if (id === c.id) problems.push(`${c.id} pays off itself`);
      }
      if (c.upgradeOf && c.paysOff) problems.push(`${c.id} is a + and lists payoffs of its own`);
    }
    expect(problems).toEqual([]);
  });

  it("covers every fence type's payoff, Redeploy included", () => {
    // The six fence cards each have a card that pays for using them.
    const fenceCards = CARDS.filter(c => c.grantsFenceType).map(c => c.id);
    for (const fence of fenceCards) {
      expect(CARDS.some(c => c.paysOff?.includes(fence)), `no card pays off ${fence}`).toBe(true);
    }
  });
});

describe("every effect is big enough to feel", () => {
  // The sweep's finding: a 5% nudge is noise. A multiplier here moves its
  // number by at least 15%, in either direction.
  it.each(BASE.map(c => [c.id, c] as const))("%s has no small multiplier", (_id, c) => {
    for (const [key, value] of Object.entries(c.modifiers)) {
      if ((MULTIPLICATIVE_KEYS as string[]).includes(key)) {
        expect(Math.abs(value - 1), `${c.id}.${key} = ${value}`).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  it("a card and its + merge into the upgraded effect", () => {
    const m = computeGameModifiers(["slow_motion", "slow_motion_plus"], BY_ID);
    expect(m.ballSpeedMultiplier).toBeCloseTo(0.7, 5);
    const f = computeGameModifiers(["feature_freeze", "feature_freeze_plus"], BY_ID);
    expect(f.ballFreezeDuration).toBe(3);
    expect(f.freezeUsesPerMap).toBe(2);
    expect(f.ballFreezeCount).toBe(1);
  });

  it("stays inside the engine's caps", () => {
    const all = computeGameModifiers(CARDS.map(c => c.id), BY_ID) as GameModifiers;
    expect(all.startingCapturePercent).toBeLessThanOrEqual(40);
    expect(all.fenceGraceMs).toBeLessThanOrEqual(250);
  });
});

describe("the draft's rules", () => {
  it("counts slot cards, not their upgrades", () => {
    const owned = ["slow_motion", "slow_motion_plus", "fast_compile", "cold_storage_ice"];
    expect(slotCards(owned, BY_ID).map(c => c.id)).toEqual(["slow_motion", "fast_compile", "cold_storage_ice"]);
    expect(withPlus("slow_motion", owned, BY_ID)).toEqual(["slow_motion", "slow_motion_plus"]);
    expect(withPlus("fast_compile", owned, BY_ID)).toEqual(["fast_compile"]);
    expect(CARD_SLOTS).toBeGreaterThanOrEqual(5);
  });

  it("charges more for each reroll of a visit", () => {
    expect(rerollPrice(1)).toBeGreaterThan(rerollPrice(0));
    expect(rerollPrice(0, 0.7)).toBeLessThan(rerollPrice(0));
  });

  it("never offers a + whose card the build does not hold, and offers it once it does", () => {
    const withPrereqs = CARDS.map(c => (c.upgradeOf ? { ...c, prerequisites: [c.upgradeOf] } : c));
    for (let level = 1; level <= 12; level++) {
      const shelf = rollShelf({
        upgrades: withPrereqs, ownedUpgradeIds: [], completedLevel: level, heldFenceTypeIds: [], shopSlots: 3, noTeaser: true,
      });
      expect(shelf.length).toBe(3);
      expect(shelf.some(isPlusCard)).toBe(false);
    }
    const owned = BASE.filter(c => PLUS.some(p => p.upgradeOf === c.id)).map(c => c.id);
    const shelf = rollShelf({
      upgrades: withPrereqs.filter(c => owned.includes(c.id) || isPlusCard(c)),
      ownedUpgradeIds: owned, completedLevel: 12, heldFenceTypeIds: [], shopSlots: 3, noTeaser: true,
    });
    expect(shelf.length).toBe(3);
    expect(shelf.every(isPlusCard)).toBe(true);
  });

  it("has something to offer from the first store on", () => {
    expect(BASE.filter(c => (c.unlockLevel ?? 1) <= 1).length).toBeGreaterThanOrEqual(4);
  });
});

describe("Tenure on the draft catalogue", () => {
  const rng = () => 0.5;
  const prereqd = CARDS.map(c => (c.upgradeOf ? { ...c, prerequisites: [c.upgradeOf] } : c));

  it("pays one card at the first depth, and a card with its + at the deeper ones", () => {
    const one = eligibleTenureChains(prereqd, TENURE_THRESHOLDS[0], rng);
    expect(one.length).toBeGreaterThan(5);
    expect(one.every(c => c.upgrades.length === 1 && !isPlusCard(c.upgrades[0]))).toBe(true);
    for (const depth of [TENURE_THRESHOLDS[1], TENURE_THRESHOLDS[2]]) {
      const chains = eligibleTenureChains(prereqd, depth, rng);
      // The deepest run must not earn less than a shallower one.
      expect(chains.length, `depth ${depth}`).toBeGreaterThan(3);
      for (const chain of chains) {
        expect(chain.upgrades).toHaveLength(2);
        expect(chain.upgrades[1].upgradeOf).toBe(chain.upgrades[0].id);
      }
    }
  });
});

describe("Sprint Planning on the draft catalogue", () => {
  it("still deals a hand, and only prizes the catalogue can pay", () => {
    const catalogue = parseOfferCatalogue(read("offers.yml"));
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 20; i++) {
      const deal = rollSprintDeal({
        catalogue, upgrades: CARDS as UpgradeConfig[], rng,
        unlock: { highestLevelReached: 30, metArchetypes: ["lock", "freeze", "bank", "tempo", "risk", "safety"] },
      });
      expect(deal.length).toBeGreaterThanOrEqual(2);
      for (const card of deal) {
        for (const grant of card.grants) {
          expect(BY_ID.has(grant.id)).toBe(true);
        }
      }
    }
  });
});

describe("card text in every language", () => {
  const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
  const numbers = (text: string) =>
    (text.replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d))).replace(/,/g, ".").match(/\d+(\.\d+)?/g) ?? []).sort().join(" ");
  // Numbers a language may write as a word ("two shields"), so only the cards
  // whose English uses digits are held to the digits.
  const hasDigits = (text: string) => /\d/.test(text);

  it.each(["es", "sv", "bn"])("%s has every card, with the same numbers as the English", (lang) => {
    const locale = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${lang}.json`), "utf8")) as {
      content: { cards: Record<string, { name?: string; description?: string; downside?: string }> };
    };
    const cards = locale.content.cards;
    expect(Object.keys(cards).sort()).toEqual(CARDS.map(c => c.id).sort());
    for (const c of CARDS) {
      const tr = cards[c.id];
      expect(tr.name, `${lang} ${c.id} name`).toBeTruthy();
      expect(tr.description, `${lang} ${c.id} description`).toBeTruthy();
      expect(!!tr.downside, `${lang} ${c.id} downside`).toBe(!!c.downside);
      for (const text of [tr.name, tr.description, tr.downside ?? ""]) {
        expect(text).not.toContain("\u2014");
      }
      if (hasDigits(c.description)) {
        expect(numbers(tr.description!), `${lang} ${c.id}: ${tr.description}`).toBe(numbers(c.description));
      }
      if (c.downside && hasDigits(c.downside)) {
        expect(numbers(tr.downside!), `${lang} ${c.id} downside`).toBe(numbers(c.downside));
      }
    }
  });

  it("reads the draft's own namespace, so a classic id with other numbers cannot leak in", () => {
    const content = readFileSync(resolve(__dirname, "../i18n/content.ts"), "utf8");
    // The tree (tree.yml) has its own namespace too, for the same reason.
    expect(content).toMatch(/rules === 'draft' \? 'cards' : rules === 'tree' \? 'tree' : 'upgrades'/);
  });
});
