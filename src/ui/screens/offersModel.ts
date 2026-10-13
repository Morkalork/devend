/**
 * What the Sprint Planning collection page shows, split from the drawing so it
 * can be tested without a canvas.
 */
import type { TFunction } from "i18next";
import type { OfferCatalogue, OfferPool, OfferUnlock, RunOffer } from "@/types/offer";
import { isOfferUnlocked, type OfferUnlockContext } from "@/lib/sprintOffers";

export interface OfferSection {
  pool: OfferPool;
  unlocked: RunOffer[];
  locked: RunOffer[];
}

/** One section per pool, in the draft's order, each split into open and locked. */
export function offerSections(catalogue: OfferCatalogue, ctx: OfferUnlockContext): OfferSection[] {
  const pools: [OfferPool, RunOffer[]][] = [
    ["boon", catalogue.boons], ["specialisation", catalogue.specialisations], ["gamble", catalogue.gambles],
  ];
  return pools.map(([pool, offers]) => ({
    pool,
    unlocked: offers.filter(o => isOfferUnlocked(o, ctx)),
    locked: offers.filter(o => !isOfferUnlocked(o, ctx)),
  }));
}

/** How many offers are open, of how many: the page's counter. */
export function offerCount(sections: OfferSection[]): { open: number; total: number } {
  let open = 0, total = 0;
  for (const s of sections) { open += s.unlocked.length; total += s.unlocked.length + s.locked.length; }
  return { open, total };
}

/** A locked offer's requirement, in words. */
export function unlockText(t: TFunction, unlock: OfferUnlock | undefined): string {
  if (!unlock || unlock.kind === "always") return "";
  if (unlock.kind === "levelReached") return t("offers.unlockLevel", { level: unlock.level });
  return t("offers.unlockArchetype", { tag: t(`upgradeShop.tags.${unlock.tag}`) });
}
