/**
 * Sprint Planning offers (SPRINT_PLANNING_PLAN.md): the run-start draft deals
 * one card from each pool, and the player takes one or skips. Defined in
 * public/offers.yml; parsed and rolled by src/lib/sprintOffers.ts.
 */
import type { UpgradeTag } from "./upgrade";

export type OfferPool = "boon" | "specialisation" | "gamble";

export const OFFER_POOLS: readonly OfferPool[] = ["boon", "specialisation", "gamble"];

/** Upgrades an offer grants at the pick. */
export type OfferPrize =
  | {
      kind: "chain";
      /** 1 = a Junior, 2 = Junior + Senior, 3 = Junior + Senior + Principal. */
      steps: 1 | 2 | 3;
      /** Only upgrades on sale by this level can be granted. */
      shoppedThrough: number;
      /** Let the player choose one of this many chains after the draft. */
      choose?: number;
      /** The choices lead with different archetype tags. */
      distinctTags?: boolean;
    }
  /** A random Architect with all its prerequisites, waived. */
  | { kind: "architect" };

export type OfferUnlock =
  | { kind: "always" }
  | { kind: "levelReached"; level: number }
  /** Own a set's worth of one tag in a single run (the set bonus firing). */
  | { kind: "archetypeMet"; tag: UpgradeTag };

export interface RunOffer {
  id: string;
  pool: OfferPool;
  name: string;
  /** The upside, shown on the card. */
  description: string;
  /** The downside, shown in red. Present whenever `price` is. */
  priceText?: string;
  /** Active for as long as the offer is (see forMaps). extraLives applies once, at the pick. */
  modifiers?: Record<string, number>;
  /** `modifiers` apply only for the run's first N maps. */
  forMaps?: number;
  /** Adverse modifiers for the whole run. */
  price?: Record<string, number>;
  /** Overtime hours banked at the pick. */
  overtime?: number;
  prize?: OfferPrize;
  unlock?: OfferUnlock;
  // Specialisation only
  tag?: UpgradeTag;
  affinity?: number;
  guaranteedSlot?: boolean;
  countsTowardSet?: number;
  // Gamble only
  weight?: number;
  jackpot?: boolean;
}

export interface OfferCatalogue {
  boons: RunOffer[];
  specialisations: RunOffer[];
  gambles: RunOffer[];
}

/**
 * The shop's lean toward a Specialisation's tag, as the store and the set
 * bonus read it. Null when the run has none.
 */
export interface ShopLean {
  tag: UpgradeTag;
  /** Virtual owned upgrades of the tag, for the shelf weights. */
  affinity: number;
  /** Every shelf holds at least one card of the tag when the pool has one. */
  guaranteedSlot: boolean;
  /** Virtual owned upgrades of the tag, toward its set bonus. */
  countsTowardSet: number;
}
