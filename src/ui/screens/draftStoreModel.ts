/**
 * The draft store's "next map" line (CARDS_PLAN.md): what the map after this
 * one has on it, in the words the cards use, so a card that only works on
 * some maps is never a blind pick.
 */
import type { TFunction } from "i18next";
import type { LevelConfig } from "@/types/level";
import { mapContextOf } from "@/lib/upgradeConditions";
import { contentText } from "@/i18n/content";
import type { NextMapInfo } from "./draftStoreParts";
import type { UpgradeConfig } from "@/types/upgrade";
import { isPlusCard, slotCards } from "@/lib/cardRules";

/** The features a card can care about, in a fixed order. */
export function nextMapFeatureKeys(level: LevelConfig): string[] {
  const map = mapContextOf(level);
  const keys: string[] = [];
  if (map.hasBoss) {
    keys.push("boss");
  }
  if (map.hasMover) {
    keys.push("movers");
  }
  if (map.hasWell) {
    keys.push("well");
  }
  if (map.hasBreakable) {
    keys.push("breakables");
  }
  if (map.hasArea) {
    keys.push("areas");
  }
  return keys;
}

export function nextMapInfo(level: LevelConfig | null, levelNumber: number, t: TFunction): NextMapInfo | null {
  if (!level) {
    return null;
  }
  const balls = mapContextOf(level).balls;
  const features = [
    ...(balls > 0 ? [t("cardDraft.featureBalls", { count: balls })] : []),
    ...nextMapFeatureKeys(level).map(k => t(`cardDraft.feature.${k}`)),
  ];
  return { level: levelNumber, name: contentText.levelName(t, level), features };
}

// ── The draft's rules, apart from the component so they can be tested ─────

/**
 * The cards taken free this visit: the first `count` picked off the shelf.
 * Under the earned rules that is none at an ordinary store and one at the
 * store after a won contract (CONTRACT_FREE_PICKS). While fewer than `count`
 * are picked, every card on the shelf is still free. An ability is never a
 * free card.
 */
export function freePickIdsOf(selectedIds: readonly string[], offered: readonly UpgradeConfig[], count = 0): string[] {
  return selectedIds.filter(id => offered.some(o => o.id === id)).slice(0, count);
}

/** What a card costs under the draft rules: nothing for a free pick, its store price otherwise. */
export function draftPriceOf(u: UpgradeConfig, freePickIds: readonly string[], count: number, storePrice: number): number {
  if (!u.grantsAbility && (freePickIds.length < count || freePickIds.includes(u.id))) {
    return 0;
  }
  return storePrice;
}

export interface DraftBuild {
  /** Held slot cards that stay: owned ones not given up this visit. */
  held: UpgradeConfig[];
  /** Slot cards picked this visit. */
  picked: UpgradeConfig[];
  /** Ids given up for a card that is still picked. */
  dropped: string[];
  /** Slots in use if the visit ended now. */
  count: number;
}

/**
 * The build as it would stand if the visit ended now. A drop only counts
 * while the card it made room for is still picked, so unpicking a card gives
 * back the one it was replacing.
 */
export function draftBuild(
  ownedIds: readonly string[], lookup: Map<string, UpgradeConfig>,
  selectedIds: readonly string[], offered: readonly UpgradeConfig[],
  drops: Readonly<Record<string, string>>,
): DraftBuild {
  const dropped = Object.entries(drops).filter(([picked]) => selectedIds.includes(picked)).map(([, gone]) => gone);
  const held = slotCards(ownedIds, lookup).filter(c => !dropped.includes(c.id));
  const picked = selectedIds.flatMap(id => {
    const u = offered.find(o => o.id === id);
    return u && !isPlusCard(u) ? [u] : [];
  });
  return { held, picked, dropped, count: held.length + picked.length };
}

/** Does taking this card need one given up first? A "+" and an ability take no slot. */
export function needsReplacement(u: UpgradeConfig, build: DraftBuild, slots: number): boolean {
  return !u.grantsAbility && !isPlusCard(u) && build.count >= slots;
}
