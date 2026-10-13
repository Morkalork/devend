/**
 * Sprint Planning's offers (SPRINT_PLANNING_PLAN.md): the catalogue, the deal,
 * the prizes, and the shop's lean toward a Specialisation's tag.
 *
 * Against the real offers.yml and upgrades.yml: a deal that only works on a
 * fixture would say nothing about the cards a player is shown.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import {
  allOffers, architectWithAncestors, getOfferCatalogue, isOfferUnlocked, offerModifierLayers, parseOfferCatalogue,
  pickLivesDelta, resetOfferCatalogue, resolvePrize, rollSprintDeal, shopLeanOf, TENURE_OFFER,
  type OfferUnlockContext,
} from "@/lib/sprintOffers";
import { computeActiveTagSets, ownedTagCounts, tagWeight } from "@/lib/upgradeTags";
import { rollShelf, shelfTagCounts } from "@/ui/screens/shopModel";
import { setRunSeedText } from "@/lib/runRng";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const upgradesDoc = yaml.load(read("public/upgrades.yml")) as UpgradeData;
const UPGRADES: UpgradeConfig[] = upgradesDoc.upgrades;
const FRESH: OfferUnlockContext = { highestLevelReached: 0, metArchetypes: [] };
const EVERYTHING: OfferUnlockContext = { highestLevelReached: 99, metArchetypes: ["lock", "freeze", "bank", "tempo", "risk", "safety"] };

/** A deterministic stream, so a deal is a fixed draw. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

beforeEach(() => { resetOfferCatalogue(); setRunSeedText(null); });

describe("the catalogue", () => {
  const cat = getOfferCatalogue();

  it("has every pool, and one Specialisation per archetype tag", () => {
    expect(cat.boons.length).toBeGreaterThanOrEqual(3);
    expect(cat.gambles.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cat.specialisations.map(s => s.tag))).toEqual(new Set(["lock", "freeze", "bank", "tempo", "risk", "safety"]));
  });

  it("gives every Specialisation the shared shape and a signature rule of its own", () => {
    for (const s of cat.specialisations) {
      expect(s.affinity, s.id).toBeGreaterThan(0);
      expect(s.guaranteedSlot, s.id).toBe(true);
      expect(s.countsTowardSet, s.id).toBeGreaterThan(0);
      expect(Object.keys(s.modifiers ?? {}), s.id).toHaveLength(1);
    }
    // Six signatures, six different rules.
    const rules = cat.specialisations.map(s => Object.keys(s.modifiers!)[0]);
    expect(new Set(rules).size).toBe(rules.length);
  });

  it("names a real modifier with every key, so nothing in the YAML is silently ignored", () => {
    for (const o of allOffers(cat)) {
      for (const key of [...Object.keys(o.modifiers ?? {}), ...Object.keys(o.price ?? {})]) {
        expect(key in DEFAULT_MODIFIERS, `${o.id}: ${key}`).toBe(true);
      }
    }
  });

  it("says out loud what every price costs", () => {
    for (const o of allOffers(cat)) if (o.price) expect(o.priceText, o.id).toBeTruthy();
  });

  it("keeps em-dashes out of the displayed text", () => {
    for (const o of allOffers(cat)) {
      expect(`${o.name} ${o.description} ${o.priceText ?? ""}`, o.id).not.toMatch(/—/);
    }
  });

  it("has exactly one jackpot, and it is never locked", () => {
    const jackpots = cat.gambles.filter(g => g.jackpot);
    expect(jackpots).toHaveLength(1);
    expect(isOfferUnlocked(jackpots[0], FRESH)).toBe(true);
  });

  it("can unlock every locked offer: the level exists and the tag is real", () => {
    const levels = (yaml.load(read("public/map.yml")) as { levels: unknown[] }).levels.length;
    for (const o of allOffers(cat)) {
      if (o.unlock?.kind === "levelReached") expect(o.unlock.level, o.id).toBeLessThanOrEqual(levels);
    }
    for (const o of allOffers(cat)) expect(isOfferUnlocked(o, EVERYTHING), o.id).toBe(true);
  });

  it("opens with something in every pool for a brand-new player", () => {
    expect(cat.boons.some(o => isOfferUnlocked(o, FRESH))).toBe(true);
    expect(cat.specialisations.filter(o => isOfferUnlocked(o, FRESH)).map(o => o.tag).sort()).toEqual(["bank", "safety", "tempo"]);
    expect(cat.gambles.some(o => isOfferUnlocked(o, FRESH))).toBe(true);
  });

  it("drops a malformed entry rather than the whole file", () => {
    const parsed = parseOfferCatalogue("boons:\n  - id: ok\n    name: Ok\n    description: Fine.\n  - name: no id\nspecialisations:\n  - id: s\n    name: S\n    description: No tag.\n");
    expect(parsed.boons.map(o => o.id)).toEqual(["ok"]);
    expect(parsed.specialisations).toEqual([]);
    expect(parseOfferCatalogue(": not yaml :")).toEqual({ boons: [], specialisations: [], gambles: [] });
  });
});

describe("the deal", () => {
  const cat = getOfferCatalogue();

  it("deals one card per pool, boon first", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const cards = rollSprintDeal({ catalogue: cat, upgrades: UPGRADES, unlock: FRESH, rng: seeded(seed) });
      expect(cards.map(c => c.offer.pool)).toEqual(["boon", "specialisation", "gamble"]);
    }
  });

  it("never deals a locked offer", () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const c of rollSprintDeal({ catalogue: cat, upgrades: UPGRADES, unlock: FRESH, rng: seeded(seed) })) {
        expect(isOfferUnlocked(c.offer, FRESH), c.offer.id).toBe(true);
      }
    }
  });

  it("deals the jackpot rarely, and the common gamble most", () => {
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 2000; seed++) {
      const g = rollSprintDeal({ catalogue: cat, upgrades: UPGRADES, unlock: EVERYTHING, rng: seeded(seed) })[2];
      seen.set(g.offer.id, (seen.get(g.offer.id) ?? 0) + 1);
    }
    const jackpot = seen.get("unicorn") ?? 0;
    expect(jackpot).toBeGreaterThan(0);
    expect(jackpot / 2000).toBeLessThan(0.1);
    expect(Math.max(...seen.values())).toBe(seen.get("death_march"));
  });

  it("puts Tenure in the boon slot when it is owed", () => {
    const chain = { headId: "x", name: "X", upgrades: UPGRADES.slice(0, 2) };
    const cards = rollSprintDeal({
      catalogue: cat, upgrades: UPGRADES, unlock: FRESH, rng: seeded(3),
      tenure: { chain, earnedAtLevel: 22, continued: true },
    });
    expect(cards[0].offer).toBe(TENURE_OFFER);
    expect(cards[0].grants).toEqual(chain.upgrades);
    expect(cards[0].tenure).toEqual({ earnedAtLevel: 22, continued: true });
    expect(cards.map(c => c.offer.pool)).toEqual(["boon", "specialisation", "gamble"]);
  });

  it("lets Admin force any offer into its pool's slot, locked or not, and force the jackpot", () => {
    const forced = rollSprintDeal({ catalogue: cat, upgrades: UPGRADES, unlock: FRESH, rng: seeded(4), force: { offerId: "containment" } });
    expect(forced[1].offer.id).toBe("containment");
    const jackpot = rollSprintDeal({ catalogue: cat, upgrades: UPGRADES, unlock: FRESH, rng: seeded(4), force: { jackpot: true } });
    expect(jackpot[2].offer.jackpot).toBe(true);
  });

  it("is a pure function of its stream, so a seeded Daily deals the same three cards", () => {
    const a = rollSprintDeal({ catalogue: cat, upgrades: UPGRADES, unlock: FRESH, rng: seeded(9) });
    const b = rollSprintDeal({ catalogue: cat, upgrades: UPGRADES, unlock: FRESH, rng: seeded(9) });
    expect(a.map(c => [c.offer.id, c.grants.map(u => u.id)])).toEqual(b.map(c => [c.offer.id, c.grants.map(u => u.id)]));
  });

  it("skips a pool with nothing to deal instead of showing a dud", () => {
    const cards = rollSprintDeal({ catalogue: { ...cat, gambles: [] }, upgrades: UPGRADES, unlock: FRESH, rng: seeded(1) });
    expect(cards.map(c => c.offer.pool)).toEqual(["boon", "specialisation"]);
  });
});

describe("prizes", () => {
  it("resolves a chain prize to exactly that many tiers, on sale by its level", () => {
    for (const steps of [1, 2, 3] as const) {
      const r = resolvePrize({ kind: "chain", steps, shoppedThrough: 20 }, UPGRADES, seeded(steps))!;
      expect(r.grants).toHaveLength(steps);
      for (const u of r.grants) expect(u.unlockLevel ?? 1).toBeLessThanOrEqual(20);
    }
  });

  it("offers a choose prize as distinct choices, leading with different tags when asked", () => {
    const r = resolvePrize({ kind: "chain", steps: 3, shoppedThrough: 20, choose: 3, distinctTags: true }, UPGRADES, seeded(5))!;
    expect(r.grants).toEqual([]);
    expect(r.choices!.length).toBeGreaterThan(1);
    const tags = r.choices!.map(c => c.upgrades[0].tags?.[0]);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("offers Pick a Junior as the first-shelf Juniors", () => {
    const junior = getOfferCatalogue().boons.find(b => b.id === "pick_a_junior")!;
    const r = resolvePrize(junior.prize!, UPGRADES, seeded(1))!;
    expect(r.choices!.length).toBeGreaterThanOrEqual(2);
    for (const c of r.choices!) {
      expect(c.upgrades).toHaveLength(1);
      expect(c.upgrades[0].tier).toBe("Junior");
      expect(c.upgrades[0].unlockLevel ?? 1).toBe(1);
    }
  });

  it("grants the jackpot Architect with everything under it, lowest first", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = resolvePrize({ kind: "architect" }, UPGRADES, seeded(seed))!;
      const top = r.grants[r.grants.length - 1];
      expect(top.tier).toBe("Architect");
      const ids = new Set(r.grants.map(u => u.id));
      for (const u of r.grants) for (const p of u.prerequisites ?? []) expect(ids.has(p), `${u.id} needs ${p}`).toBe(true);
    }
  });

  it("walks every prerequisite, not just the first", () => {
    const a = { id: "a", name: "A", tier: "Junior", description: "" } as UpgradeConfig;
    const b = { id: "b", name: "B", tier: "Junior", description: "" } as UpgradeConfig;
    const c = { id: "c", name: "C", tier: "Architect", description: "", prerequisites: ["a", "b"] } as UpgradeConfig;
    expect(architectWithAncestors(c, [a, b, c]).map(u => u.id)).toEqual(["a", "b", "c"]);
  });
});

describe("what a taken offer does", () => {
  const cat = getOfferCatalogue();
  const byId = (id: string) => allOffers(cat).find(o => o.id === id)!;

  it("charges a price all run and gives a forMaps boon only for its first maps", () => {
    const buddy = byId("onboarding_buddy");
    expect(offerModifierLayers(buddy, 0)).toEqual([buddy.modifiers]);
    expect(offerModifierLayers(buddy, buddy.forMaps! - 1)).toEqual([buddy.modifiers]);
    expect(offerModifierLayers(buddy, buddy.forMaps!)).toEqual([]);
    const freeze = byId("hiring_freeze");
    expect(offerModifierLayers(freeze, 30)).toEqual([freeze.price]);
    expect(offerModifierLayers(null, 0)).toEqual([]);
  });

  it("changes lives once, at the pick, including lives a granted upgrade carries", () => {
    expect(pickLivesDelta(byId("spare_laptop"), [])).toBe(1);
    expect(pickLivesDelta(byId("death_march"), [])).toBe(-1);
    const lifeUp = { id: "l", name: "L", tier: "Junior", description: "", modifiers: { extraLives: 1 } } as UpgradeConfig;
    expect(pickLivesDelta(byId("death_march"), [lifeUp])).toBe(0);
  });

  it("leans the shop only for a Specialisation", () => {
    expect(shopLeanOf(byId("reliability"))).toEqual({ tag: "safety", affinity: 2, guaranteedSlot: true, countsTowardSet: 1 });
    expect(shopLeanOf(byId("onboarding_buddy"))).toBeNull();
    expect(shopLeanOf(TENURE_OFFER)).toBeNull();
  });
});

describe("the shop's lean", () => {
  const lean = shopLeanOf(getOfferCatalogue().specialisations.find(s => s.tag === "lock")!)!;

  it("weights a card of the tag as though the run owned the affinity's worth of it", () => {
    const counts = shelfTagCounts([], UPGRADES, lean);
    const lockCard = UPGRADES.find(u => u.tags?.length === 1 && u.tags[0] === "lock")!;
    const otherCard = UPGRADES.find(u => u.tags?.length === 1 && u.tags[0] === "bank")!;
    expect(tagWeight(lockCard, counts)).toBe(1 + lean.affinity);
    expect(tagWeight(otherCard, counts)).toBe(1);
    // Without a lean, nothing changes.
    expect(shelfTagCounts([], UPGRADES, null)).toEqual(ownedTagCounts([], UPGRADES));
  });

  it("guarantees a card of the tag on every shelf the unlocked pool can fill with one", () => {
    let guaranteed = 0;
    for (let level = 1; level <= 30; level++) {
      setRunSeedText(`lean-${level}`);
      const shelf = rollShelf({ upgrades: UPGRADES, ownedUpgradeIds: [], completedLevel: level, heldFenceTypeIds: [], shopSlots: 3, lean });
      const poolHasOne = UPGRADES.some(u => u.tags?.includes("lock") && (u.unlockLevel ?? 1) <= level && !(u.prerequisites?.length));
      if (!poolHasOne) continue;
      expect(shelf.some(u => u.tags?.includes("lock")), `level ${level}`).toBe(true);
      guaranteed++;
    }
    expect(guaranteed).toBeGreaterThan(5);
  });

  it("counts toward the tag's set, so two purchases light a three-card set", () => {
    const tagSets = upgradesDoc.tagSets;
    const twoLocks = UPGRADES.filter(u => u.tags?.includes("lock") && !(u.prerequisites?.length)).slice(0, 2).map(u => u.id);
    expect(computeActiveTagSets(twoLocks, UPGRADES, tagSets).some(s => s.tag === "lock")).toBe(false);
    expect(computeActiveTagSets(twoLocks, UPGRADES, tagSets, { tag: "lock", amount: lean.countsTowardSet }).some(s => s.tag === "lock")).toBe(true);
  });
});
