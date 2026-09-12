/**
 * Upgrade pricing — an upgrade's cost is a fraction of what one good map pays:
 *
 *   cost = max(minCost, round(anchorHours * tierFactor[tier]))
 *
 * ── Why this stopped being derived from level points ───────────────────────
 *
 * It used to be `basePoints(unlockLevel) * tierFactor`, on the stated reasoning
 * that "both player income and upgrade cost scale with a level's `points`, so
 * the scarcity ratio stays constant". That was true when income was the flat
 * map base plus a lock bonus. It stopped being true the day the Performance
 * Review landed: income is now six axes paid in ABSOLUTE hours (delivery 30,
 * craft 30, engagement 35, tempo 24, greed 25, thrift 20), and the flat base is
 * a rounding error beside them. `points` is 20 on all 15 maps; a strong run
 * banks 124h through the axes alone, and more with the win premium on top.
 *
 * So price was pinned to 20 while income ran at 120+, and the whole act I shelf
 * cost less than one map. Reported as "I could afford way too much during the
 * first maps"; measured at 39-88h per map from the bot and 159h from a player
 * on map 1, against a 30h cheapest card.
 *
 * The axes are absolute, which is what makes ONE anchor correct: every map's
 * ceiling is the same at levels 1, 5, 10 and 15 alike, so a per-level
 * price would be a distinction the scoring model does not make. Depth is priced
 * by `blockInflation` below instead, which is the honest place for it.
 *
 * ANCHORED ON A GOOD RUN, not a perfect one. Measured through calculateScore
 * itself: flawless 184h, good 136h, ordinary 61h, scrappy 23h. 190 puts the
 * cheapest tier at 34h, so a good map buys one thing and a flawless one buys
 * one thing and banks half the next. Anchoring on the ceiling would price out
 * everyone who is not perfect; anchoring on an ordinary clear is what produced
 * the complaint.
 *
 * An explicit `cost:` on an upgrade overrides the formula entirely (the four
 * level-1 first hires, the two hand-priced specials, and the ascension trio
 * whose post-L30 economy is tuned separately).
 */
import { UpgradeTier, UpgradePricing } from '@/types/upgrade';

export const DEFAULT_UPGRADE_PRICING: UpgradePricing = {
  minCost: 8,
  anchorHours: 190,
  // Mirrors public/upgrades.yml. Fractions of one good map: the cheapest tier
  // is a map, the top tier a little over two.
  tierFactor: {
    Junior: 0.70,
    Senior: 0.95,
    Principal: 1.30,
    Architect: 1.70,
    Wizard: 2.10,
  },
  // Softer than the 1.35 it replaces, because the base prices it compounds on
  // are now ~3x what they were: 1.35 reached x2.46 by level 15 and would have
  // put the cheapest card past what any map can pay.
  blockInflation: 1.15,
};

/** Merge a parsed `pricing:` block over the defaults (per-field, tier-by-tier). */
export function mergePricing(parsed?: Partial<UpgradePricing>): UpgradePricing {
  return {
    minCost:
      typeof parsed?.minCost === 'number' ? parsed.minCost : DEFAULT_UPGRADE_PRICING.minCost,
    anchorHours:
      typeof parsed?.anchorHours === 'number' && parsed.anchorHours > 0
        ? parsed.anchorHours
        : DEFAULT_UPGRADE_PRICING.anchorHours,
    tierFactor: { ...DEFAULT_UPGRADE_PRICING.tierFactor, ...(parsed?.tierFactor ?? {}) },
    blockInflation:
      typeof parsed?.blockInflation === 'number' && parsed.blockInflation > 0
        ? parsed.blockInflation
        : DEFAULT_UPGRADE_PRICING.blockInflation,
  };
}

// ── Market-rate inflation ────────────────────────────────────────────────────
// Base costs are flat (every level's points is the same by the flat-economy
// design), so without a counterweight the flat per-map income eventually buys
// the whole shelf every visit. Prices therefore rise with RUN progress: each
// completed 5-level assignment block multiplies effective prices by
// `pricing.blockInflation`. Levels 1-5 play at face value; block 2 is ×1.35,
// block 3 ×1.82, block 4 ×2.46... The Budget Cycle spend chunk scales by the
// same index so the spender archetype doesn't simply win inflation.

/** Levels per inflation step. Matches the assignment cadence (doors.yml). */
export const INFLATION_BLOCK_SIZE = 5;

// Live pricing loaded from upgrades.yml (useUpgradeManager); the default is a
// safe fallback for early calls and tests.
let livePricing: UpgradePricing = DEFAULT_UPGRADE_PRICING;

export function setLivePricing(pricing: UpgradePricing): void {
  livePricing = pricing;
}

/**
 * Price multiplier in effect at the shop after `completedLevel`. Shops run
 * after levels 1-4 at ×1; the first assignment (level 5) starts block 2.
 */
export function inflationForLevel(
  completedLevel: number,
  pricing: UpgradePricing = livePricing,
): number {
  const rate = pricing.blockInflation ?? 1;
  if (!(rate > 0) || rate === 1 || !Number.isFinite(completedLevel)) return 1;
  const blocks = Math.max(0, Math.floor(completedLevel / INFLATION_BLOCK_SIZE));
  return Math.pow(rate, blocks);
}

/**
 * The formula cost for a tier. Returns null when the tier has no factor, so the
 * caller can surface a configuration error instead of silently charging wrong.
 *
 * No level argument any more, and that is the change rather than a tidy-up: the
 * scoring axes are absolute, so every map's ceiling is identical and a price
 * that varied by unlock level would be asserting a difference the economy does
 * not have. Depth is priced by inflation at purchase time.
 */
export function computeUpgradeCost(
  tier: UpgradeTier,
  pricing: UpgradePricing = DEFAULT_UPGRADE_PRICING,
): number | null {
  const factor = pricing.tierFactor[tier];
  if (typeof factor !== 'number') return null;
  return Math.max(pricing.minCost, Math.round(pricing.anchorHours * factor));
}

/**
 * The price the shop will actually charge, from the catalogue entry.
 *
 * The whole resolution in one place, in order:
 *   explicit `cost`, else derived from unlock level x tier
 *   x `costMultiplier`  - a deliberate adjustment the formula cannot see,
 *                         usually because the upgrade is a DOOR and the player
 *                         is buying access to a line as well as an effect
 *   x 1.5 if `choiceGroup` - the price of getting to pick between alternatives
 *
 * Extracted from useUpgradeManager because a test that recomputed this
 * arithmetic alongside it proved nothing: deleting the multiplier from the hook
 * left every assertion green. One reading, or the guard is decorative.
 */
export function resolveUpgradeCost(
  upgrade: { cost?: number; tier: UpgradeTier; costMultiplier?: number; choiceGroup?: string },
  pricing: UpgradePricing = DEFAULT_UPGRADE_PRICING,
): number | null {
  let cost = typeof upgrade.cost === 'number'
    ? upgrade.cost
    : computeUpgradeCost(upgrade.tier, pricing);
  if (cost === null) return null;
  if (typeof upgrade.costMultiplier === 'number') cost = Math.round(cost * upgrade.costMultiplier);
  if (upgrade.choiceGroup) cost = Math.round(cost * 1.5);
  return cost;
}
