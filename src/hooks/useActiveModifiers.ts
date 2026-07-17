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
  extraShopItems: number;
  shopRestockCount: number; // purchases per shop visit that refill their slot with a new offer
  extraContinues: number;   // extra per-run revives beyond the base 1 (cert/upgrade grantable)
  extraCertificateHours: number;
  startingCapturePercent: number; // board starts with this % already captured (Equity Grant)
  fenceDurabilityBonus: number;   // extra ball hits Ascension fences survive

  // Additive (sum) — dynamic: applied per locked ball in-game
  microManagerPerLock: number;
  overtimePerLock: number;   // flat overtime hours added to the lock bonus per locked ball (Severance Package)
  overtimePerSuperiorLock: number; // extra flat overtime per SUPERIOR lock, on top of overtimePerLock (Severance Package: Equity Package)
  fenceSpeedPerLock: number; // fence-speed bonus per ball locked this map (0.04 = +4% per lock; Knowledge Transfer)
  // Additive (sum) — Frozen Assets: extra lock-bonus multiplier when a ball is
  // locked while frozen (1 = frozen locks pay double, 2 = triple; 0 = off)
  frozenLockBonus: number;
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
  // Additive (sum) — Stock Options capstone: raises the per-map overtime cap
  overtimeCapBonus: number;
  // Additive (sum) — Company Card capstone: >0 = the cheapest shop offer is free
  freeCheapestOffer: number;
  // Additive (sum) — Second Wind capstone: fence-hit shields granted per map
  wallShieldsPerMap: number;
  // Additive (sum) — Ghost Protocol capstone: growing fences ignore ball hits
  // during their first N milliseconds
  fenceGraceMs: number;
  // Additive (sum) — Deadline Extension: extra seconds PER BALL added to every
  // Ship Early window (2 = each window gains 2s x the map's ball count)
  shipEarlySecondsPerBall: number;
  // Additive (sum) — Hard Deadline door: >0 = Scope Creep's grace window is
  // removed, so the first speed surge lands at second 0 of active play
  scopeCreepImmediate: number;
  // Additive (sum) — Runway (reworked Venture Capital): each value is a bank
  // threshold in hours; while totalScore is at/above it when a map starts, the
  // perk applies (see src/lib/treasury.ts). 0 = perk not owned.
  runwayInstantFenceAt: number;    // grants +1 instant fence per map
  runwayConcurrentFenceAt: number; // grants +1 concurrent fence
  runwayFreezeAt: number;          // grants a 2s tap-freeze
  // Additive (sum) — Budget Cycle: next-map boons per 60h spent in one shop
  // visit (max 3 chunks; see src/lib/treasury.ts)
  spendInstantFencePerChunk: number; // instant fences on the next map per chunk
  spendFenceSpeedPerChunk: number;   // fence-speed bonus on the next map per chunk (0.05 = +5%)
  // Additive (sum) — Code Review: percentage points added to the lock
  // threshold (base 10% of the win denominator), so slightly-too-big pockets
  // still lock their ball
  lockThresholdBonus: number;
  // Additive (sum) — Cold Boot: seconds every ball stays frozen at map start
  // (rides the Feature Freeze frozenUntil path; no re-freeze cooldown after)
  spawnFreezeSeconds: number;
  // Additive (sum) — Benefits Package: extra pickup-token spawn chance per
  // roll (0.03 = +3 percentage points). Deliberately vague in all player-facing
  // copy ("slightly more often"); only applies where pickups are enabled.
  pickupChanceBonus: number;
  // Additive (sum) — Total Compensation: each level enhances every pickup
  // payout (+1h on overtime/cap tokens, +1s on freeze charges, split balls
  // 5% slower per level; at level 3 the Fork splits a ball into THREE).
  pickupPayoutLevel: number;

  // Multiplicative — Hard Deadline door: scales the Ship Early payout
  shipEarlyBonusMultiplier: number;

  // Multiplicative — Tech Evangelist: scales the space-optimization bonus
  spaceBonusMultiplier: number;

  // Additive (sum) — SCRUM Master
  ballPathPredictionBounces: number; // how many bounces ahead to show
  ballPathPredictionBalls: number;   // how many balls to track (by speed desc; ≥100 = all)

  // Additive (sum) — Feature Freeze: seconds a tapped ball stays frozen (0 = upgrade not owned)
  ballFreezeDuration: number;
  // Additive (sum) — Feature Freeze: tap-freezes allowed per map (refills each
  // map). 0 = upgrade not owned. Tiers: 1 (Junior/Senior), then the tier-3
  // choice sets 2 (option A) or keeps 1 (option B, longer duration instead).
  freezeUsesPerMap: number;
  // Additive (sum) — Runtime Optimisation tier-3 option B: speed multiplier
  // applied to ONE random ball, re-picked each map (0 = off, 0.5 = that ball
  // runs at half speed).
  slowOneBallFactor: number;
  // Additive (sum) — Cryo Protocol capstone: >0 = pickup tokens are frozen and
  // never expire (they sit on the board, iced over, until claimed or wasted).
  freezePickups: number;
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
  kind: 'upgrade' | 'certificate' | 'achievement' | 'loadout' | 'ascension' | 'tagSet' | 'door' | 'capstone';
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
  'shipEarlyBonusMultiplier',
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
  extraShopItems: 0,
  shopRestockCount: 0,
  extraContinues: 0,
  extraCertificateHours: 0,
  startingCapturePercent: 0,
  fenceDurabilityBonus: 0,
  microManagerPerLock: 0,
  overtimePerLock: 0,
  overtimePerSuperiorLock: 0,
  fenceSpeedPerLock: 0,
  frozenLockBonus: 0,
  simultaneousLockBonus: 0,
  freezeNoCooldown: 0,
  fenceSpeedPerFence: 0,
  underParInstantFence: 0,
  bankedSlowPer50h: 0,
  overtimeCapBonus: 0,
  freeCheapestOffer: 0,
  wallShieldsPerMap: 0,
  fenceGraceMs: 0,
  shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0,
  runwayInstantFenceAt: 0,
  runwayConcurrentFenceAt: 0,
  runwayFreezeAt: 0,
  spendInstantFencePerChunk: 0,
  spendFenceSpeedPerChunk: 0,
  lockThresholdBonus: 0,
  spawnFreezeSeconds: 0,
  pickupChanceBonus: 0,
  pickupPayoutLevel: 0,
  shipEarlyBonusMultiplier: 1,
  spaceBonusMultiplier: 1,
  ballPathPredictionBounces: 0,
  ballPathPredictionBalls: 0,
  ballFreezeDuration: 0,
  freezeUsesPerMap: 0,
  slowOneBallFactor: 0,
  freezePickups: 0,
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
