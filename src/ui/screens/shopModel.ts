/**
 * The between-levels store's rules, pulled out of the component (canvas port
 * of components/game/UpgradeShop.tsx) so they can be read and tested without
 * rendering anything. The component keeps the state; these decide what it
 * means. The reasoning comments are the DOM file's, kept where they still hold.
 */
import type { TFunction } from "i18next";
import type { UpgradeConfig, UpgradeTag, UpgradeTier } from "@/types/upgrade";
import type { Certificate } from "@/types/certificate";
import { ownedTagCounts, weightedSample } from "@/lib/upgradeTags";
import { prerequisitesMet, unlockRequirements } from "@/lib/upgradeUnlock";
import { fenceOfferIsEmpty } from "@/lib/fenceOwnership";
import { getRunRng } from "@/lib/runRng";
import { contentText } from "@/i18n/content";
import { COLOR } from "../theme";
import { tint } from "../kit/style";

type IsLocked = (upgradeId: string, ownedIds: string[]) => boolean;

/**
 * Remove `id` from the selection, then keep removing any selected upgrades
 * whose prerequisites are no longer satisfied (by owned or still-selected
 * items): deselecting a Junior tier also deselects a Senior tier that was
 * picked up via restock on top of it.
 */
export function deselectWithDependents(
  selected: string[],
  id: string,
  ownedIds: string[],
  upgrades: UpgradeConfig[],
): string[] {
  let next = selected.filter(s => s !== id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sid of next) {
      const prereqs = upgrades.find(u => u.id === sid)?.prerequisites ?? [];
      if (prereqs.some(p => !ownedIds.includes(p) && !next.includes(p))) {
        next = next.filter(s => s !== sid);
        changed = true;
        break;
      }
    }
  }
  return next;
}

/** Collapse a choice group to ONE representative card (the chooser expands the full group). */
function collapseChoiceGroups(list: UpgradeConfig[]): UpgradeConfig[] {
  const seen = new Set<string>();
  return list.filter(u => {
    if (!u.choiceGroup) return true;
    if (seen.has(u.choiceGroup)) return false;
    seen.add(u.choiceGroup);
    return true;
  });
}

export interface ShelfInput {
  upgrades: UpgradeConfig[];
  ownedUpgradeIds: string[];
  completedLevel: number;
  heldFenceTypeIds: string[];
  /** 3 + extraShopItems. */
  shopSlots: number;
}

/**
 * The shelf a visit opens on: rolled once (on mount), restocks append to it.
 * Picks are tag-weighted toward the player's owned archetypes (weightedSample),
 * plus at most one locked "teaser" if there is room.
 */
export function rollShelf({ upgrades, ownedUpgradeIds, completedLevel, heldFenceTypeIds, shopSlots }: ShelfInput): UpgradeConfig[] {
  // Filter out owned, upgrades not yet unlocked by level progression, and any
  // choice group whose pick is already made (a sibling owned).
  // The fence bar holds four types and the catalogue has six, so a
  // fence-granting card offered into a full bar would take the player's hours
  // and grant nothing (fenceSlotsFrom caps silently): the one outcome a store
  // must never have.
  const available = upgrades.filter(u =>
    !ownedUpgradeIds.includes(u.id) &&
    completedLevel >= (u.unlockLevel ?? 1) &&
    !fenceOfferIsEmpty(u.grantsFenceType, heldFenceTypeIds) &&
    !(u.choiceGroup && upgrades.some(o => o.choiceGroup === u.choiceGroup && ownedUpgradeIds.includes(o.id)))
  );
  // Through the shared rule, not a second copy of it, so the shelf never
  // offers a card the buy button (isLocked) then refuses.
  const byId = new Map(upgrades.map(u => [u.id, u]));
  const unlocked = collapseChoiceGroups(
    available.filter(u => prerequisitesMet(u, ownedUpgradeIds, byId)));
  const locked = collapseChoiceGroups(
    available.filter(u => !prerequisitesMet(u, ownedUpgradeIds, byId)));
  const counts = ownedTagCounts(ownedUpgradeIds, upgrades);
  // Seeded runs (Daily Stand-up) roll the shelf from the run seed keyed by the
  // level, so everyone opening this shop sees the same offers. Only the roll
  // is shared, not the choices.
  const shelfRng = getRunRng(`shop:${completedLevel}`);
  const offers = weightedSample(unlocked, shopSlots, counts, completedLevel, shelfRng);
  if (offers.length < shopSlots && locked.length > 0) {
    offers.push(weightedSample(locked, 1, counts, completedLevel, shelfRng)[0]);
  }
  return offers;
}

/** Reverse prerequisite index: id -> the upgrades that list it (what it unlocks). */
export function dependentsIndex(upgrades: UpgradeConfig[]): Map<string, UpgradeConfig[]> {
  const map = new Map<string, UpgradeConfig[]>();
  for (const u of upgrades) {
    for (const prereqId of u.prerequisites ?? []) {
      const list = map.get(prereqId);
      if (list) list.push(u);
      else map.set(prereqId, [u]);
    }
  }
  return map;
}

export interface CertChase { cert: Certificate; current: number; required: number }

/**
 * Upgrade-chain certificates, keyed the way useGameSession credits a purchase:
 * by `choiceGroup` when the tier forks, otherwise by upgrade id. Buying a
 * max-tier upgrade silently advances a certificate; this is the only evidence
 * the purchase counted. Unlocked ones drop out: their chase is over.
 */
export function certChaseIndex(
  certificates: Certificate[],
  unlockedCertIds: string[],
  maxTierCounts: Record<string, number>,
): Map<string, CertChase> {
  const map = new Map<string, CertChase>();
  for (const cert of certificates) {
    if (cert.unlockType !== "upgrade-chain" || !cert.sourceUpgradeId) continue;
    if (unlockedCertIds.includes(cert.id)) continue;
    const required = cert.requiredRuns ?? 3;
    map.set(cert.sourceUpgradeId, {
      cert,
      current: Math.min(maxTierCounts[cert.sourceUpgradeId] ?? 0, required),
      required,
    });
  }
  return map;
}

/**
 * Is this shelf item locked? A retainer never is: its id (`ability:<id>`) is
 * synthesised at roll time and is in no catalogue, so asking `isLocked` about
 * it answers "locked" for every ability ever offered. It has no prerequisites
 * by construction, so there is nothing to ask.
 */
export function lockedFor(u: UpgradeConfig, owned: string[], isLocked: IsLocked): boolean {
  return !u.grantsAbility && isLocked(u.id, owned);
}

/**
 * Company Card capstone: the cheapest PURCHASABLE offer on the shelf is free.
 * Locked teasers are skipped - a free price on something you can't buy would
 * waste the perk.
 */
export function freeOfferIdFor(
  enabled: boolean,
  offered: UpgradeConfig[],
  allOwnedIds: string[],
  isLocked: IsLocked,
): string | null {
  if (!enabled) return null;
  let cheapest: UpgradeConfig | null = null;
  for (const u of offered) {
    if (allOwnedIds.includes(u.id)) continue;
    if (isLocked(u.id, allOwnedIds)) continue;
    if (!cheapest || u.cost < cheapest.cost) cheapest = u;
  }
  return cheapest?.id ?? null;
}

export interface PriceRules {
  freeOfferId: string | null;
  /** Market-rate inflation for the level (inflationForLevel). */
  inflation: number;
  /** Bulk Licensing certificate (<1 = cheaper). */
  discount: number;
}

/**
 * What a shelf item costs. A retainer pays out once per REMAINING map, so it
 * is worth less the later it is bought - the opposite of block inflation - and
 * is exempt from it. The player's own discount still applies.
 */
export function priceOf(u: UpgradeConfig, { freeOfferId, inflation, discount }: PriceRules): number {
  if (u.id === freeOfferId) return 0;
  if (u.grantsAbility) return Math.max(1, Math.round(u.cost * discount));
  return Math.max(1, Math.round(u.cost * inflation * discount));
}

/** Total cost of the current selection (ids not on the shelf cost nothing here, as in the DOM). */
export function selectionCost(selectedIds: string[], shelfItems: UpgradeConfig[], price: (u: UpgradeConfig) => number): number {
  return selectedIds.reduce((sum, id) => {
    const u = shelfItems.find(o => o.id === id);
    return sum + (u ? price(u) : 0);
  }, 0);
}

/** Restock candidates, evaluated as if the selection were already owned. */
export function restockCandidates(
  upgrades: UpgradeConfig[],
  ownedAfterSelect: string[],
  completedLevel: number,
  offered: UpgradeConfig[],
  isLocked: IsLocked,
): UpgradeConfig[] {
  return upgrades.filter(u =>
    !ownedAfterSelect.includes(u.id) &&
    completedLevel >= (u.unlockLevel ?? 1) &&
    !offered.some(o => o.id === u.id) &&
    // Don't restock a choice group that's already on the shelf (one card each).
    !(u.choiceGroup && offered.some(o => o.choiceGroup === u.choiceGroup)) &&
    !isLocked(u.id, ownedAfterSelect)
  );
}

export type ClickOutcome =
  | { kind: "ignore" }
  | { kind: "deselect"; selectedIds: string[] }
  | { kind: "shake" }
  /** `restock`: this selection is an upgrade purchase, so it may restock the shelf. */
  | { kind: "select"; selectedIds: string[]; restock: boolean };

export interface ClickInput {
  closed: boolean;
  upgrade: UpgradeConfig;
  alreadySelected: boolean;
  allOwnedIds: string[];
  selectedIds: string[];
  upgrades: UpgradeConfig[];
  isLocked: IsLocked;
  price: number;
  remainingBudget: number;
}

/** What tapping an ordinary (non-choice) card does. */
export function itemClickOutcome(p: ClickInput): ClickOutcome {
  if (p.closed) return { kind: "ignore" }; // store is closed this round: no purchases
  if (p.allOwnedIds.includes(p.upgrade.id)) return { kind: "ignore" };
  if (p.alreadySelected) {
    return { kind: "deselect", selectedIds: deselectWithDependents(p.selectedIds, p.upgrade.id, p.allOwnedIds, p.upgrades) };
  }
  // Selections count toward prerequisites of other shelf items.
  const effectiveOwned = [...p.allOwnedIds, ...p.selectedIds];
  if (lockedFor(p.upgrade, effectiveOwned, p.isLocked)) return { kind: "ignore" };
  // Can't afford: shake instead of toast.
  if (p.price > p.remainingBudget) return { kind: "shake" };
  // A retainer is not an upgrade purchase, so it does not restock the shelf:
  // otherwise the always-present ability card is a free extra upgrade.
  return { kind: "select", selectedIds: [...p.selectedIds, p.upgrade.id], restock: !p.upgrade.grantsAbility };
}

/**
 * Pick one option of a tier-3 choice group: strips any sibling first, then
 * toggles this variant in (budget-checked). The chosen variant may not be on
 * the shelf (only the group's representative is), so it is priced from the
 * full catalogue.
 */
export function chooseVariantOutcome(
  prev: string[],
  member: UpgradeConfig,
  upgrades: UpgradeConfig[],
  offered: UpgradeConfig[],
  price: (u: UpgradeConfig) => number,
  budget: number,
): { selectedIds: string[]; shake: boolean } {
  const group = member.choiceGroup;
  const base = prev.filter(id => upgrades.find(o => o.id === id)?.choiceGroup !== group);
  if (prev.includes(member.id)) return { selectedIds: base, shake: false }; // toggled off
  const spentOnBase = base.reduce((sum, id) => {
    const u = offered.find(o => o.id === id) || upgrades.find(o => o.id === id);
    return sum + (u ? price(u) : 0);
  }, 0);
  if (price(member) > budget - spentOnBase) return { selectedIds: prev, shake: true };
  return { selectedIds: [...base, member.id], shake: false };
}

export interface Purchase {
  /** A retainer is bought down its own channel; it never touches ownedUpgradeIds. */
  channel: "ability" | "upgrade";
  /** The ability id for a retainer, the upgrade id otherwise. */
  id: string;
  /** The shelf id, for the session's purchased list. */
  shelfId: string;
  price: number;
}

/** What "Buy & Continue" hands over, in selection order. */
export function purchasesFor(
  selectedIds: string[],
  shelfItems: UpgradeConfig[],
  upgrades: UpgradeConfig[],
  price: (u: UpgradeConfig) => number,
): Purchase[] {
  const out: Purchase[] = [];
  for (const id of selectedIds) {
    const u = shelfItems.find(o => o.id === id) || upgrades.find(o => o.id === id);
    if (!u) continue;
    out.push(u.grantsAbility
      ? { channel: "ability", id: u.grantsAbility, shelfId: u.id, price: price(u) }
      : { channel: "upgrade", id: u.id, shelfId: u.id, price: price(u) });
  }
  return out;
}

/** The pips' "already chosen" flags: a choice card counts once any member is chosen or owned. */
export function shelfMarks(
  shelfItems: UpgradeConfig[],
  upgrades: UpgradeConfig[],
  selectedIds: string[],
  allOwnedIds: string[],
): boolean[] {
  return shelfItems.map(u => u.choiceGroup
    ? upgrades.some(o => o.choiceGroup === u.choiceGroup && (selectedIds.includes(o.id) || allOwnedIds.includes(o.id)))
    : selectedIds.includes(u.id) || allOwnedIds.includes(u.id));
}

export interface CardModel {
  /** The store's ability slot, drawn inverted. */
  inv: boolean;
  isChoice: boolean;
  choiceOptions: UpgradeConfig[];
  chosenMember: UpgradeConfig | undefined;
  /** The chosen option of a choice card, else the card itself. */
  displayUpgrade: UpgradeConfig;
  owned: boolean;
  selected: boolean;
  locked: boolean;
  /** Ids counted as owned for this card's prerequisites (other selections count). */
  effectiveOwned: string[];
  shownPrice: number;
  purchasable: boolean;
  cantAfford: boolean;
  certChase: CertChase | undefined;
  certShown: number;
}

export interface CardInput {
  upgrade: UpgradeConfig;
  upgrades: UpgradeConfig[];
  selectedIds: string[];
  allOwnedIds: string[];
  isLocked: IsLocked;
  price: (u: UpgradeConfig) => number;
  effectiveOvertime: number;
  remainingBudget: number;
  certChaseByKey: Map<string, CertChase>;
}

/** Everything one shelf card shows, derived from the shop's state. */
export function cardModel(p: CardInput): CardModel {
  const { upgrade, upgrades, selectedIds, allOwnedIds } = p;
  const inv = !!upgrade.grantsAbility;
  const isChoice = !!upgrade.choiceGroup;
  const choiceOptions = isChoice ? upgrades.filter(u => u.choiceGroup === upgrade.choiceGroup) : [];
  const chosenMember = isChoice ? choiceOptions.find(u => selectedIds.includes(u.id)) : undefined;
  const displayUpgrade = chosenMember ?? upgrade;
  const owned = allOwnedIds.includes(upgrade.id);
  const selected = isChoice ? !!chosenMember : selectedIds.includes(upgrade.id);
  // Other selected items count toward this card's prerequisites, so a
  // restocked Senior tier unlocks while its Junior is selected.
  const effectiveOwned = [...allOwnedIds, ...selectedIds.filter(id => id !== upgrade.id)];
  const locked = lockedFor(upgrade, effectiveOwned, p.isLocked);
  // Price shown: the chosen option, else the cheapest of a choice, else this card's.
  const shownPrice = chosenMember
    ? p.price(chosenMember)
    : isChoice ? Math.min(...choiceOptions.map(p.price)) : p.price(upgrade);
  const purchasable = !owned && !locked && shownPrice <= p.effectiveOvertime;
  // Can't afford with the remaining budget (unless already selected).
  const cantAfford = !locked && !owned && !selected && shownPrice > p.remainingBudget;
  // Either fork of a choice credits the same certificate, so key on the group.
  const certChase = p.certChaseByKey.get(upgrade.choiceGroup ?? upgrade.id);
  // Count the pending selection: the note previews what this purchase does.
  const certPending = certChase != null && (selected || owned);
  const certShown = certChase ? Math.min(certChase.current + (certPending ? 1 : 0), certChase.required) : 0;
  return {
    inv, isChoice, choiceOptions, chosenMember, displayUpgrade, owned, selected, locked,
    effectiveOwned, shownPrice, purchasable, cantAfford, certChase, certShown,
  };
}

/**
 * Why a locked card is locked: both gates. A card locked only by a family
 * gate has NO prerequisites, so listing those alone printed "Requires" and
 * then nothing, which reads as the shop being broken.
 */
export function lockedReasonParts(t: TFunction, upgrade: UpgradeConfig, upgrades: UpgradeConfig[], effectiveOwned: string[]): string[] {
  const need = unlockRequirements(upgrade, upgrades);
  const parts = need.prereqs
    .filter(p => !effectiveOwned.includes(p.id))
    .map(p => contentText.upgradeName(t, p));
  if (need.maxedFamily) parts.push(t("upgradeShop.requiresMaxedFamily", { family: need.maxedFamily }) as string);
  return parts;
}

/** Build readout chips, largest set first, with their set-bonus suffix. */
export function buildTagChips(counts: Map<string, number>, threshold: number): { tag: UpgradeTag; active: boolean; suffix: string }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => {
      const active = count >= threshold;
      return { tag: tag as UpgradeTag, active, suffix: active ? "✓" : `${count}/${threshold}` };
    });
}

// ── How a ticket is drawn ──────────────────────────────────────────────────

/** Tailwind's tier palette as numbers (types/upgrade.ts TIER_COLORS). */
const TIER_PALETTE: Record<UpgradeTier, { text: number; border: string }> = {
  Junior: { text: 0xcbd5e1, border: tint(COLOR.white, 0.7) },
  Senior: { text: 0x60a5fa, border: tint(0x3b82f6, 0.5) },
  Principal: { text: 0xc084fc, border: tint(0xa855f7, 0.5) },
  Architect: { text: 0xfbbf24, border: tint(0xf59e0b, 0.5) },
  Wizard: { text: 0x6ee7b7, border: tint(0x34d399, 0.5) },
};

export function tierPalette(tier: UpgradeTier): { text: number; border: string } {
  return TIER_PALETTE[tier] ?? TIER_PALETTE.Junior;
}
