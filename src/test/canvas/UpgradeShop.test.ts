/**
 * The canvas UpgradeShop (src/ui/screens/UpgradeShop.tsx), carried over from
 * upgradeShopClosed, upgradeShopAbilitySlot, upgradeShopChoice,
 * upgradeShopCertChase, shopSelectionVisible, upgradeConditions (shop part)
 * and the shop's source guards in upgradeUnlock.test.ts. The DOM tests click
 * through a rendered shop; these drive the same rules through shopModel.ts,
 * which is what the canvas shop calls.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { UpgradeConfig } from "@/types/upgrade";
import type { Certificate } from "@/types/certificate";
import { getEligibleAbilities, MAX_ABILITY_SLOTS } from "@/lib/abilities";
import { ABILITY_HOURS_PER_MAP, abilitySlotClosed, rollAbilityOffers } from "@/lib/abilityOffer";
import { inflationForLevel } from "@/lib/upgradePricing";
import { mulberry32 } from "@/lib/runRng";
import {
  cardModel, certChaseIndex, chooseVariantOutcome, deselectWithDependents, itemClickOutcome,
  lockedFor, priceOf, purchasesFor, restockCandidates, rollShelf, selectionCost, shelfMarks, type PriceRules,
} from "@/ui/screens/shopModel";
import { ticketStatus } from "@/ui/screens/storeBoardModel";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SHOP = read("src/ui/screens/UpgradeShop.tsx");
const PARTS = read("src/ui/screens/shopParts.tsx");
const MODEL = read("src/ui/screens/shopModel.ts");
const t = i18n.t.bind(i18n);

const up = (id: string, over: Partial<UpgradeConfig> = {}): UpgradeConfig => ({
  id, name: id, tier: "Junior", description: `${id} does a thing`, cost: 30, unlockLevel: 1, modifiers: {}, ...over,
});
const NO_RULES: PriceRules = { freeOfferId: null, inflation: 1, discount: 1 };
const price = (u: UpgradeConfig) => priceOf(u, NO_RULES);

/** The REAL isLocked rule (useUpgradeManager): an id the catalogue does not know is locked. */
const realIsLocked = (catalogue: UpgradeConfig[]) => (id: string, owned: string[]) =>
  !owned.includes(id) && !catalogue.some(u => u.id === id);

function click(upgrade: UpgradeConfig, over: Partial<Parameters<typeof itemClickOutcome>[0]> = {}) {
  return itemClickOutcome({
    closed: false, upgrade, alreadySelected: false, allOwnedIds: [], selectedIds: [], upgrades: [upgrade],
    isLocked: () => false, price: price(upgrade), remainingBudget: 100, ...over,
  });
}

describe("closed store (upgradeShopClosed)", () => {
  const a = up("up-a", { cost: 5 });

  it("a tap on an offered card selects nothing while closed", () => {
    expect(click(a, { closed: true })).toEqual({ kind: "ignore" });
  });

  it("the open store (control) selects it, which arms the Buy button", () => {
    const out = click(a);
    expect(out.kind).toBe("select");
    if (out.kind === "select") expect(out.selectedIds).toEqual(["up-a"]);
    expect(t("upgradeShop.buyAndContinue", { count: 1 })).toBe("Buy 1");
  });

  it("continuing a closed store buys nothing: an empty selection hands over no purchases", () => {
    expect(purchasesFor([], [a], [a], price)).toEqual([]);
  });

  it("the banner reads 'Not enough balls locked' and is held, not tapped, for its explainer", () => {
    expect(t("upgradeShop.closedNotEnoughLocks")).toBe("Not enough balls locked");
    expect(t("upgradeShop.closedInfoTitle")).toBe("Store closed");
    expect(SHOP).toMatch(/<ClosedBanner[^>]*onHold=\{\(\) => setShowClosedInfo\(true\)\}/);
    expect(PARTS).toMatch(/onHold=\{onHold\}[\s\S]*closedNotEnoughLocks/);
  });

  it("the shelf takes no touches while closed", () => {
    expect(SHOP).toMatch(/eventMode=\{closed \? "none" : "passive"\}/);
  });

  it("a closed store never opens a choice card's chooser (it shakes)", () => {
    expect(SHOP).toMatch(/if \(!model\.selected && \(closed \|\| model\.cantAfford\)\) \{ shake\(upgrade\.id\); return; \}/);
  });
});

describe("the ability slot (upgradeShopAbilitySlot)", () => {
  const plain = [up("u_a", { tags: ["bank"] })];
  const isLocked = realIsLocked(plain);
  const offers = () => rollAbilityOffers(5, 10, [], 1, mulberry32(1));

  it("can actually be selected: a synthetic retainer id is never 'locked'", () => {
    const card = offers()[0];
    expect(isLocked(card.id, []), "the real rule calls an unknown id locked").toBe(true);
    expect(lockedFor(card, [], isLocked)).toBe(false);
    const out = click(card, { upgrades: plain, isLocked, remainingBudget: 5000 });
    expect(out.kind).toBe("select");
  });

  it("comes LAST, after every upgrade, including restocked ones", () => {
    // The shelf is built in this order, and restocks append to offeredUpgrades.
    expect(SHOP).toMatch(/\[\.\.\.offeredUpgrades, \.\.\.abilityOffers\]/);
    expect(SHOP).toMatch(/setOfferedUpgrades\(prev => \[\.\.\.prev, restockedOffer\]\)/);
  });

  it("a restock appends a fresh upgrade, and a retainer purchase never restocks", () => {
    const many = ["u_a", "u_b", "u_c", "u_d"].map(id => up(id, { tags: ["bank"] }));
    const shelf = many.slice(0, 3);
    expect(restockCandidates(many, ["u_a"], 5, shelf, () => false).map(u => u.id)).toEqual(["u_d"]);
    const pick = click(many[0], { upgrades: many });
    expect(pick.kind === "select" && pick.restock).toBe(true);
    const retainer = click(offers()[0], { upgrades: many, remainingBudget: 5000 });
    expect(retainer.kind === "select" && retainer.restock).toBe(false);
  });

  it("says what it is buying, in maps", () => {
    expect(t("upgradeShop.abilityEveryMap", { count: 12 })).toMatch(/One every map, 12 left/);
    expect(PARTS).toMatch(/upgradeShop\.abilityEveryMap", \{ count: mapsRemaining \}/);
  });

  it("is a ticket of its own type, coloured by the ability, never a fourth upgrade", () => {
    expect(PARTS).toMatch(/const typeColor = inv \? \(upgrade\.abilityColor \? hex\(upgrade\.abilityColor\) : COLOR\.primary\) : schoolColor\(upgrade\);/);
    expect(PARTS).toMatch(/inv \? t\("upgradeShop\.abilityKicker"\)/);
  });

  it("buys down its own channel at the flat rate, never as an upgrade", () => {
    const card = offers()[0];
    const purchases = purchasesFor([card.id], [...plain, card], plain, price);
    expect(purchases).toHaveLength(1);
    expect(purchases[0].channel).toBe("ability");
    expect(getEligibleAbilities(5).map(a => a.id)).toContain(purchases[0].id);
    expect(purchases[0].price).toBe(10 * ABILITY_HOURS_PER_MAP);
  });

  it("does not inflate with the level, unlike the upgrade beside it", () => {
    const rules: PriceRules = { freeOfferId: null, inflation: inflationForLevel(25), discount: 1 };
    const card = rollAbilityOffers(25, 10, [], 1, mulberry32(1))[0];
    expect(priceOf(card, rules)).toBe(10 * ABILITY_HOURS_PER_MAP);
    const inflated = Math.round(30 * inflationForLevel(25));
    expect(inflated).toBeGreaterThan(30);
    expect(priceOf(plain[0], rules)).toBe(inflated);
  });

  it("closes at the cap and says so; traded away for the free grant it just goes", () => {
    const full = getEligibleAbilities(30).slice(0, MAX_ABILITY_SLOTS).map(a => a.id);
    expect(rollAbilityOffers(30, 10, full, 1, mulberry32(1))).toEqual([]);
    expect(abilitySlotClosed(full)).toBe(true);
    // The notice needs both the cap AND a slot that was on offer.
    expect(SHOP).toMatch(/abilityOfferCount > 0 && abilityCapReached\(heldAbilityIds, abilitySlots\)/);
    expect(SHOP).toMatch(/abilitySlotClosed && !closed/);
    expect(t("upgradeShop.abilitySlotClosed")).toMatch(/Ability slot closed/);
  });

  it("announces the ability the free grant handed over", () => {
    expect(t("upgradeShop.freeAbilityGranted", { name: "Freeze All" })).toMatch(/Freeze All added to your bar/);
    expect(SHOP).toMatch(/freeAbilityGranted", \{ name: freeGrant \? contentText\.abilityName\(t, freeGrant\) : freeAbilityGrant \}/);
  });

  it("offers two to choose between when Talent Scout is owned", () => {
    expect(rollAbilityOffers(5, 10, [], 2, mulberry32(1))).toHaveLength(2);
  });
});

describe("tier-3 choice card (upgradeShopChoice)", () => {
  const choice = [
    up("ff_a", { name: "Feature Freeze", tier: "Principal", description: "Rapid two quick freezes", choiceGroup: "ff3", tags: ["freeze"] }),
    up("ff_b", { name: "Feature Freeze", tier: "Principal", description: "Deep one long freeze", choiceGroup: "ff3", tags: ["freeze"] }),
  ];

  it("collapses the group to ONE card that shows the choose prompt", () => {
    const shelf = rollShelf({ upgrades: choice, ownedUpgradeIds: [], completedLevel: 5, heldFenceTypeIds: [], shopSlots: 3 });
    expect(shelf).toHaveLength(1);
    const m = cardModel({
      upgrade: shelf[0], upgrades: choice, selectedIds: [], allOwnedIds: [], isLocked: () => false, price,
      effectiveOvertime: 500, remainingBudget: 500, certChaseByKey: new Map(),
    });
    expect(m.isChoice && !m.chosenMember).toBe(true);
    expect(t("upgradeShop.choicePrompt")).toBe("Tap to choose one of two options.");
  });

  it("picking an option selects that variant, and picking it again clears it", () => {
    const picked = chooseVariantOutcome([], choice[0], choice, [choice[0]], price, 500);
    expect(picked).toEqual({ selectedIds: ["ff_a"], shake: false });
    // Switching strips the sibling.
    expect(chooseVariantOutcome(["ff_a"], choice[1], choice, [choice[0]], price, 500).selectedIds).toEqual(["ff_b"]);
    expect(chooseVariantOutcome(["ff_a"], choice[0], choice, [choice[0]], price, 500).selectedIds).toEqual([]);
  });

  it("refuses an option it cannot afford", () => {
    expect(chooseVariantOutcome([], choice[0], choice, [choice[0]], price, 10)).toEqual({ selectedIds: [], shake: true });
  });

  it("a pip counts a choice card as picked once any member is chosen", () => {
    expect(shelfMarks([choice[0]], choice, ["ff_b"], [])).toEqual([true]);
  });
});

describe("certificate chase note (upgradeShopCertChase)", () => {
  const upgrades = [
    up("chain_top", { cost: 5 }), up("plain", { cost: 5 }),
    up("fork_a", { tier: "Senior", cost: 5, choiceGroup: "fork_group" }),
    up("fork_b", { tier: "Senior", cost: 5, choiceGroup: "fork_group" }),
  ];
  const certificates: Certificate[] = [
    { id: "chain-cert", name: "Chain Cert", description: "", unlockType: "upgrade-chain", sourceUpgradeId: "chain_top", requiredRuns: 3, levels: [{ cost: 3, effect: { type: "extraLives", value: 1 } }] },
    { id: "fork-cert", name: "Fork Cert", description: "", unlockType: "upgrade-chain", sourceUpgradeId: "fork_group", requiredRuns: 3, levels: [{ cost: 3, effect: { type: "extraLives", value: 1 } }] },
    { id: "ach-cert", name: "Achievement Cert", description: "", unlockType: "achievement", sourceAchievementId: "senior-dev", levels: [{ cost: 5, effect: { type: "extraLives", value: 1 } }] },
  ];
  const model = (u: UpgradeConfig, selectedIds: string[], index = certChaseIndex(certificates, [], { chain_top: 1, fork_group: 2 })) =>
    cardModel({ upgrade: u, upgrades, selectedIds, allOwnedIds: [], isLocked: () => false, price, effectiveOvertime: 100, remainingBudget: 100, certChaseByKey: index });

  it("annotates an upgrade that sources a certificate, and only that upgrade", () => {
    const m = model(upgrades[0], []);
    expect(m.certChase?.cert.name).toBe("Chain Cert");
    expect(t("upgradeShop.certRuns", { current: m.certShown, required: 3 })).toBe("1/3 runs");
    expect(model(upgrades[1], []).certChase).toBeUndefined();
  });

  it("credits a forked tier via its choiceGroup", () => {
    const m = model(upgrades[2], []);
    expect(m.certChase?.cert.name).toBe("Fork Cert");
    expect(m.certShown).toBe(2);
  });

  it("previews the pending purchase: selecting the card advances the fraction", () => {
    expect(model(upgrades[0], []).certShown).toBe(1);
    expect(model(upgrades[0], ["chain_top"]).certShown).toBe(2);
  });

  it("drops the note once the certificate is unlocked", () => {
    expect(certChaseIndex(certificates, ["chain-cert", "fork-cert"], {}).size).toBe(0);
  });

  it("never claims a purchase advances an achievement certificate", () => {
    expect([...certChaseIndex(certificates, [], {}).values()].map(c => c.cert.id)).not.toContain("ach-cert");
  });

  it("is empty when the props are absent", () => {
    expect(certChaseIndex([], [], {}).size).toBe(0);
  });
});

describe("a selected ticket looks selected (shopSelectionVisible)", () => {
  // The store is a sprint board now (storeBoardModel.ts): a ticket's state is
  // its status lozenge plus, when committed, the accent edge and ground.
  it("changes the ground and the edge, not just the lozenge", () => {
    expect(PARTS).toMatch(/backgroundColor: selected \? tint\(accent, 0\.07\) : ROLE\.raised/);
    expect(PARTS).toMatch(/borderWidth: 2, borderColor: selected \? accent : ROLE\.edge/);
  });

  it("never draws a selected ticket as unfunded", () => {
    expect(ticketStatus({ selected: true, owned: false, locked: false, cantAfford: true })).toBe("inSprint");
  });

  it("is a different status from DONE (owned)", () => {
    expect(ticketStatus({ selected: false, owned: true, locked: false, cantAfford: false })).toBe("done");
  });

  it("gives every state its own status, checked in the old order", () => {
    const states = [
      { selected: true, owned: true, locked: true, cantAfford: true },
      { selected: false, owned: true, locked: true, cantAfford: true },
      { selected: false, owned: false, locked: true, cantAfford: true },
      { selected: false, owned: false, locked: false, cantAfford: true },
      { selected: false, owned: false, locked: false, cantAfford: false },
    ].map(ticketStatus);
    expect(states).toEqual(["inSprint", "done", "blocked", "unfunded", "todo"]);
  });
});

describe("selection rules", () => {
  it("deselecting a Junior also drops the Senior that needed it", () => {
    const upgrades = [up("jr"), up("sr", { prerequisites: ["jr"] })];
    expect(deselectWithDependents(["jr", "sr"], "jr", [], upgrades)).toEqual([]);
  });

  it("an unaffordable card shakes rather than selecting", () => {
    expect(click(up("x", { cost: 50 }), { remainingBudget: 10 })).toEqual({ kind: "shake" });
  });

  it("the selection's cost is what Buy charges", () => {
    const a = up("a", { cost: 10 }), b = up("b", { cost: 15 });
    expect(selectionCost(["a", "b"], [a, b], price)).toBe(25);
  });
});

describe("conditional upgrades (upgradeConditions)", () => {
  it("the card marks a condition live or not for the NEXT map", () => {
    expect(PARTS).toMatch(/live=\{conditionMet\(upgrade\.condition, runContext\)\}/);
    // No run context reads as met: the component defaults runContext to null.
    expect(SHOP).toMatch(/runContext = null/);
  });
});

describe("the shelf asks the shared rules (upgradeUnlock)", () => {
  it("goes through prerequisitesMet, not its own copy", () => {
    expect(MODEL).toMatch(/prerequisitesMet\(u, ownedUpgradeIds, byId\)/);
    expect(MODEL).not.toMatch(/u\.prerequisites\.every\(/);
  });

  it("asks about both gates, not just prerequisites", () => {
    expect(MODEL).toMatch(/unlockRequirements\(/);
    expect(PARTS).toMatch(/unlockRequirements\(/);
  });

  it("filters fence cards on the bar's own held list", () => {
    expect(MODEL).toMatch(/!fenceOfferIsEmpty\(u\.grantsFenceType, heldFenceTypeIds\)/);
  });
});
