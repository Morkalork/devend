import { useMemo } from 'react';
import { UpgradeConfig } from '@/types/upgrade';

/**
 * Central GameModifiers — the ONLY structure gameplay systems should read.
 * All modifier resolution happens here. No modifier logic elsewhere.
 */
export interface GameModifiers {
  // Multiplicative (cumulative product)
  ballSpeedMultiplier: number;
  ballSizeMultiplier: number;
  fenceGenerationSpeedMultiplier: number;
  scoreMultiplier: number;
  shopDiscountMultiplier: number; // scales upgrade-shop prices (<1 = cheaper)
  pushBonusMultiplier: number;    // scales push-your-luck chunk payouts

  // Additive (sum)
  instantFencesPerMap: number;
  additionalConcurrentFences: number;
  bonusRemovalChance: number;
  bonusRemovalAmount: number;
  extraLives: number;
  scoreInterestRate: number;
  extraShopItems: number;
  shopRestockCount: number; // purchases per shop visit that refill their slot with a new offer
  extraContinues: number;   // extra per-run revives beyond the base 1 (cert/upgrade grantable)
  extraCertificateHours: number;
  startingCapturePercent: number; // board starts with this % already captured (Equity Grant)
  fenceDurabilityBonus: number;   // extra ball hits Ascension fences survive

  // Additive (sum) — dynamic: applied per locked ball in-game
  microManagerPerLock: number;
  overtimePerLock: number;   // flat overtime hours added to the lock bonus per locked ball (Severance Package)
  fenceSpeedPerLock: number; // fence-speed bonus per ball locked this map (0.04 = +4% per lock; Knowledge Transfer)
  // Additive (sum) — Frozen Assets: extra lock-bonus multiplier when a ball is
  // locked while frozen (1 = frozen locks pay double, 2 = triple; 0 = off)
  frozenLockBonus: number;
  // Additive (sum) — Venture Capital: raises the per-map interest cap above the
  // base 8h (see useGameSession's level-complete interest credit)
  scoreInterestCapBonus: number;
  // Additive (sum) — lock set bonus: every lock pass counts as this many balls
  // bigger for the simultaneous-trap multiplier (Chain Reaction)
  simultaneousLockBonus: number;
  // Additive (sum) — freeze set bonus: >0 = freeze taps have no re-freeze
  // cooldown after thawing (Absolute Zero)
  freezeNoCooldown: number;
  // Additive (sum) — Continuous Delivery: fence-speed bonus per fence already
  // completed this map (0.04 = +4% per fence; resets each map)
  fenceSpeedPerFence: number;
  // Additive (sum) — Clean Release: instant fences granted on the NEXT map
  // after finishing a map under par (folded per-map by useGameSession)
  underParInstantFence: number;
  // Additive (sum) — War Chest: ball-speed reduction per 50h banked at map
  // start, capped in useGameSession (0.02 = 2% per 50h)
  bankedSlowPer50h: number;

  // Multiplicative — Tech Evangelist: scales the space-optimization bonus
  spaceBonusMultiplier: number;

  // Additive (sum) — SCRUM Master
  ballPathPredictionBounces: number; // how many bounces ahead to show
  ballPathPredictionBalls: number;   // how many balls to track (by speed desc; ≥100 = all)

  // Additive (sum) — Feature Freeze: seconds a tapped ball stays frozen (0 = upgrade not owned)
  ballFreezeDuration: number;
  // Additive (sum) — Cascade Freeze: extra balls a single tap freezes beyond the tapped one
  ballFreezeCount: number;
  // Additive (sum) — Cron Job: seconds an auto-frozen ball stays frozen (0 = upgrade not owned).
  // The freeze fires automatically on a fixed interval (AUTO_FREEZE_INTERVAL_MS).
  autoFreezeDuration: number;

  // Additive (sum) — Benchmarking (#45): 0 = off, >0 = show the map-highscore
  // progress bar in the HUD (a second bar under the capture readout). Gated in
  // upgrades.yml behind the ball-size upgrade.
  showHighscoreProgress: number;
}

/**
 * Hard ceiling on the MicroManager per-lock speed reduction (issue #42
 * follow-up): a locked ball never slows the others by more than 1%, no matter
 * how the upgrade, certificate and loadout stack. Enforced once on the final
 * aggregated value so physics and every HUD readout see the same capped number.
 */
export const MAX_MICRO_MANAGER_PER_LOCK = 0.01;

/**
 * A single named contributor to the merged GameModifiers — an owned upgrade,
 * certificate, activated achievement, drafted loadout, or the ascension ramp.
 * Its `modifiers` are that source's raw (pre-merge) contribution, so the HUD
 * can attribute each active modifier to what produced it.
 */
export interface ModifierSource {
  kind: 'upgrade' | 'certificate' | 'achievement' | 'loadout' | 'ascension' | 'tagSet';
  id: string;
  name: string;
  modifiers: Record<string, number>;
}

// Keys that stack multiplicatively
export const MULTIPLICATIVE_KEYS: (keyof GameModifiers)[] = [
  'ballSpeedMultiplier',
  'ballSizeMultiplier',
  'fenceGenerationSpeedMultiplier',
  'scoreMultiplier',
  'shopDiscountMultiplier',
  'pushBonusMultiplier',
  'spaceBonusMultiplier',
];

/**
 * Merge two bonus maps (e.g., achievement bonuses + certificate bonuses).
 * Multiplicative keys are multiplied together; additive keys are summed.
 */
export function mergeBonuses(
  a?: Partial<Record<keyof GameModifiers, number>>,
  b?: Partial<Record<keyof GameModifiers, number>>,
): Partial<Record<keyof GameModifiers, number>> | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  const result: Partial<Record<keyof GameModifiers, number>> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (!Number.isFinite(value as number)) continue; // guard against bad YAML values
    const k = key as keyof GameModifiers;
    if (MULTIPLICATIVE_KEYS.includes(k)) {
      result[k] = ((result[k] as number) ?? 1) * (value as number);
    } else {
      result[k] = ((result[k] as number) ?? 0) + (value as number);
    }
  }
  return result;
}

const DEFAULT_MODIFIERS: GameModifiers = {
  ballSpeedMultiplier: 1,
  ballSizeMultiplier: 1,
  fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1,
  shopDiscountMultiplier: 1,
  pushBonusMultiplier: 1,
  instantFencesPerMap: 0,
  additionalConcurrentFences: 0,
  bonusRemovalChance: 0,
  bonusRemovalAmount: 0,
  extraLives: 0,
  scoreInterestRate: 0,
  extraShopItems: 0,
  shopRestockCount: 0,
  extraContinues: 0,
  extraCertificateHours: 0,
  startingCapturePercent: 0,
  fenceDurabilityBonus: 0,
  microManagerPerLock: 0,
  overtimePerLock: 0,
  fenceSpeedPerLock: 0,
  frozenLockBonus: 0,
  scoreInterestCapBonus: 0,
  simultaneousLockBonus: 0,
  freezeNoCooldown: 0,
  fenceSpeedPerFence: 0,
  underParInstantFence: 0,
  bankedSlowPer50h: 0,
  spaceBonusMultiplier: 1,
  ballPathPredictionBounces: 0,
  ballPathPredictionBalls: 0,
  ballFreezeDuration: 0,
  ballFreezeCount: 0,
  autoFreezeDuration: 0,
  showHighscoreProgress: 0,
};

/**
 * Aggregate modifiers from all owned upgrades plus optional extra bonuses
 * (e.g., from completed achievements). Multipliers multiply cumulatively;
 * flat values sum. Unknown modifier keys in YAML are silently ignored.
 */
export function computeGameModifiers(
  ownedUpgradeIds: string[],
  upgradeLookup: Map<string, UpgradeConfig>,
  extraBonuses?: Partial<Record<keyof GameModifiers, number>>,
): GameModifiers {
  const result = { ...DEFAULT_MODIFIERS };

  // Cast once to an indexable record — all GameModifier values are numbers,
  // so this is provably safe. Avoids `as any` on every individual key access.
  const r = result as Record<keyof GameModifiers, number>;

  for (const id of ownedUpgradeIds) {
    const upgrade = upgradeLookup.get(id);
    if (!upgrade) continue;

    for (const [key, value] of Object.entries(upgrade.modifiers)) {
      if (!(key in result)) continue; // ignore unknown keys from YAML gracefully
      if (!Number.isFinite(value)) continue; // ignore non-numeric/NaN YAML values

      const k = key as keyof GameModifiers;
      if (MULTIPLICATIVE_KEYS.includes(k)) {
        r[k] *= value;
      } else {
        r[k] += value;
      }
    }
  }

  // Apply extra bonuses (e.g., from completed achievements or certificates)
  if (extraBonuses) {
    for (const [key, value] of Object.entries(extraBonuses)) {
      if (!(key in result)) continue;
      if (!Number.isFinite(value)) continue;
      const k = key as keyof GameModifiers;
      if (MULTIPLICATIVE_KEYS.includes(k)) {
        r[k] *= value;
      } else {
        r[k] += value;
      }
    }
  }

  // Cap the MicroManager per-lock reduction at 1% across all sources.
  result.microManagerPerLock = Math.min(result.microManagerPerLock, MAX_MICRO_MANAGER_PER_LOCK);

  return result;
}

/**
 * React hook wrapper around computeGameModifiers.
 * Pass `extraBonuses` (e.g., from useAchievementManager.getBonusModifiers())
 * to include achievement bonuses in the computed result.
 */
export function useActiveModifiers(
  ownedUpgradeIds: string[],
  upgrades: UpgradeConfig[],
  extraBonuses?: Partial<Record<keyof GameModifiers, number>>,
): GameModifiers {
  // Rebuilds only when YAML reloads — not on every upgrade purchase
  const upgradeLookup = useMemo(
    () => new Map(upgrades.map(u => [u.id, u])),
    [upgrades],
  );
  return useMemo(
    () => computeGameModifiers(ownedUpgradeIds, upgradeLookup, extraBonuses),
    [ownedUpgradeIds, upgradeLookup, extraBonuses],
  );
}
