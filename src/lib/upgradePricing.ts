/**
 * Upgrade pricing — derives an upgrade's overtime cost from the base points of
 * the level it unlocks at, times a per-tier factor:
 *
 *   cost = max(minCost, round(basePoints(unlockLevel) * tierFactor[tier]))
 *
 * Because both player income and upgrade cost scale with a level's `points`,
 * the scarcity ratio stays constant as maps are added — new upgrades only need
 * an `unlockLevel` + `tier` and get priced automatically (no re-tuning). The
 * factors live in public/upgrades.yml under `pricing:` so they're designer-
 * tunable; the defaults below are the fallback if that block is absent.
 *
 * An explicit `cost:` on an upgrade overrides this formula entirely (used for
 * the ascension trio, whose post-L30 economy is tuned separately).
 */
import { UpgradeTier, UpgradePricing } from '@/types/upgrade';
import { LevelConfig } from '@/types/level';

export const DEFAULT_UPGRADE_PRICING: UpgradePricing = {
  minCost: 8,
  tierFactor: {
    Junior: 1.0,
    Senior: 1.35,
    Principal: 1.85,
    Architect: 2.4,
    Wizard: 3.0,
  },
};

/** Merge a parsed `pricing:` block over the defaults (per-field, tier-by-tier). */
export function mergePricing(parsed?: Partial<UpgradePricing>): UpgradePricing {
  return {
    minCost:
      typeof parsed?.minCost === 'number' ? parsed.minCost : DEFAULT_UPGRADE_PRICING.minCost,
    tierFactor: { ...DEFAULT_UPGRADE_PRICING.tierFactor, ...(parsed?.tierFactor ?? {}) },
  };
}

/** Build a logical-level -> base points lookup (first variant per level wins). */
export function buildLevelPoints(
  levels: Pick<LevelConfig, 'level' | 'points'>[],
): Map<number, number> {
  const points = new Map<number, number>();
  for (const lvl of levels) {
    if (typeof lvl?.level === 'number' && typeof lvl?.points === 'number' && !points.has(lvl.level)) {
      points.set(lvl.level, lvl.points);
    }
  }
  return points;
}

/**
 * Base points for an unlock level, clamping out-of-range levels to the nearest
 * defined one (so a future upgrade gated past the last map still prices off the
 * highest level, and any below the first prices off the lowest). Returns null
 * only when no level points are known at all.
 */
export function basePointsForLevel(
  levelPoints: Map<number, number>,
  unlockLevel: number,
): number | null {
  if (levelPoints.size === 0) return null;
  if (levelPoints.has(unlockLevel)) return levelPoints.get(unlockLevel)!;
  const levels = [...levelPoints.keys()].sort((a, b) => a - b);
  let chosen: number | null = null;
  for (const lvl of levels) {
    if (lvl <= unlockLevel) chosen = lvl;
    else break;
  }
  if (chosen === null) chosen = levels[0]; // unlockLevel below the lowest defined level
  return levelPoints.get(chosen)!;
}

/**
 * Compute the formula cost for an upgrade. Returns null when it can't be priced
 * (no level points known, or the tier has no factor) so the caller can surface
 * a clear configuration error instead of silently using a wrong number.
 */
export function computeUpgradeCost(
  unlockLevel: number,
  tier: UpgradeTier,
  levelPoints: Map<number, number>,
  pricing: UpgradePricing = DEFAULT_UPGRADE_PRICING,
): number | null {
  const base = basePointsForLevel(levelPoints, unlockLevel);
  if (base === null) return null;
  const factor = pricing.tierFactor[tier];
  if (typeof factor !== 'number') return null;
  return Math.max(pricing.minCost, Math.round(base * factor));
}
