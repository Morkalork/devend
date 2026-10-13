/**
 * What a Sprint Planning card looks like, split from the drawing so it can be
 * tested without a canvas (SPRINT_PLANNING_PLAN.md).
 */
import type { TFunction } from "i18next";
import type { DealtOffer } from "@/lib/sprintOffers";
import type { RunOffer } from "@/types/offer";
import type { UpgradeConfig } from "@/types/upgrade";
import { contentText } from "@/i18n/content";
import { tagChipLook } from "../game/tagChipModel";

/** The gamble pool's amber and the jackpot's gold. */
export const GAMBLE_INK = "#ffb347";
export const JACKPOT_INK = "#ffd24a";

/** Which header label a card wears: its pool, or Tenure / Jackpot when it is one. */
export type CardKind = "boon" | "tenure" | "specialisation" | "gamble" | "jackpot";

export function cardKind(card: Pick<DealtOffer, "offer" | "tenure">): CardKind {
  if (card.tenure) return "tenure";
  if (card.offer.jackpot) return "jackpot";
  return card.offer.pool;
}

function hexOf(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/**
 * The card's colour. A Specialisation wears its tag's colour (the same one
 * the shop's chips use, so the lean reads as that archetype everywhere); a
 * gamble is amber, the jackpot gold; boons and Tenure take the screen accent.
 */
export function cardAccent(card: Pick<DealtOffer, "offer" | "tenure">, base: string): string {
  const kind = cardKind(card);
  if (kind === "jackpot") return JACKPOT_INK;
  if (kind === "gamble") return GAMBLE_INK;
  if (kind === "specialisation" && card.offer.tag) {
    const look = tagChipLook(card.offer.tag);
    if (look) return hexOf(look.text);
  }
  return base;
}

/** The card's name: an offer's own, or the chain's name on the Tenure card. */
export function cardName(t: TFunction, card: DealtOffer): string {
  if (card.tenure && card.grants[0]) return contentText.upgradeName(t, card.grants[0]);
  return contentText.offerName(t, card.offer);
}

/** The upside line. Tenure's says why it was earned. */
export function cardUpside(t: TFunction, card: DealtOffer): string {
  if (card.tenure) return t("sprint.tenureUpside", { level: card.tenure.earnedAtLevel });
  return contentText.offerDesc(t, card.offer);
}

/** The price line, or null for an offer with no downside. */
export function cardPrice(t: TFunction, offer: RunOffer): string | null {
  if (!offer.priceText) return null;
  return contentText.offerPrice(t, offer);
}

/** One row per granted upgrade: its tier, its name, its effect. */
export function grantRows(t: TFunction, grants: readonly UpgradeConfig[]): { id: string; tier: string; name: string; desc: string }[] {
  return grants.map(u => ({
    id: u.id,
    tier: contentText.tier(t, u.tier),
    name: contentText.upgradeName(t, u),
    desc: contentText.upgradeDesc(t, u),
  }));
}
