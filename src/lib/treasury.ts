/**
 * Treasury — the bank archetype's two competing streams.
 *
 * Runway (hoard): while the bank sits at/above an upgrade's threshold when a
 * map starts, a passive perk applies, paid in consistency (instant fence,
 * concurrent fence, tap-freeze), never in score. Evaluated from totalScore in
 * useGameSession's dynamic modifier pass, the same seam as War Chest.
 *
 * Budget Cycle (spend): hours spent in a single shop visit charge next-map
 * boons in fixed chunks. The tension is the archetype: a big purchase can
 * drop the bank below a Runway threshold while charging the Budget Cycle.
 *
 * Pure and React-free (scoring.ts / scopeCreep.ts pattern) so the shop UI and
 * the engine derive treasury state from the same functions.
 */
import type { GameModifiers } from '@/hooks/useActiveModifiers';

/** Seconds a Runway-granted tap-freeze lasts (rides the Feature Freeze mechanic). */
export const RUNWAY_FREEZE_SECONDS = 2;
/** Hours of shop spend that charge one Budget Cycle boon. */
export const SPEND_CHUNK_HOURS = 60;
/** Ceiling on chunks counted per shop visit. */
export const MAX_SPEND_CHUNKS = 3;

type Bonuses = Partial<Record<keyof GameModifiers, number>>;

export type RunwayPerk = 'instantFence' | 'concurrentFence' | 'freeze';

export interface RunwayPerkStatus {
  perk: RunwayPerk;
  thresholdHours: number;
  met: boolean;
}

/** The owned Runway perks in threshold order, with live met/unmet state. */
export function runwayStatus(bank: number, mods: GameModifiers): RunwayPerkStatus[] {
  const safeBank = Number.isFinite(bank) ? bank : 0;
  const entries: Array<[RunwayPerk, number]> = [
    ['instantFence', mods.runwayInstantFenceAt],
    ['concurrentFence', mods.runwayConcurrentFenceAt],
    ['freeze', mods.runwayFreezeAt],
  ];
  return entries
    .filter(([, at]) => Number.isFinite(at) && at > 0)
    .map(([perk, at]) => ({ perk, thresholdHours: at, met: safeBank >= at }))
    .sort((a, b) => a.thresholdHours - b.thresholdHours);
}

/**
 * Modifier bonuses granted by the bank balance right now (undefined when
 * nothing applies). Fed into the dynamic modifier pass alongside War Chest.
 */
export function runwayBonuses(bank: number, mods: GameModifiers): Bonuses | undefined {
  let bonuses: Bonuses | undefined;
  for (const status of runwayStatus(bank, mods)) {
    if (!status.met) continue;
    bonuses = bonuses ?? {};
    if (status.perk === 'instantFence') bonuses.instantFencesPerMap = (bonuses.instantFencesPerMap ?? 0) + 1;
    if (status.perk === 'concurrentFence') bonuses.additionalConcurrentFences = (bonuses.additionalConcurrentFences ?? 0) + 1;
    if (status.perk === 'freeze') bonuses.ballFreezeDuration = (bonuses.ballFreezeDuration ?? 0) + RUNWAY_FREEZE_SECONDS;
  }
  return bonuses;
}

/** Budget Cycle chunks charged by a shop visit's total spend. */
export function spendChunks(spentHours: number): number {
  if (!Number.isFinite(spentHours) || spentHours <= 0) return 0;
  return Math.min(MAX_SPEND_CHUNKS, Math.floor(spentHours / SPEND_CHUNK_HOURS));
}

export interface SpendBoons {
  /** Instant fences granted on the next map. */
  instantFences: number;
  /** Fence-speed bonus on the next map (0.05 = +5%). */
  fenceSpeedBonus: number;
}

/** Next-map boons bought by the charged chunks. */
export function spendBoons(chunks: number, mods: GameModifiers): SpendBoons {
  const n = Number.isFinite(chunks) && chunks > 0 ? Math.floor(chunks) : 0;
  const perFence = Number.isFinite(mods.spendInstantFencePerChunk) && mods.spendInstantFencePerChunk > 0
    ? mods.spendInstantFencePerChunk : 0;
  const perSpeed = Number.isFinite(mods.spendFenceSpeedPerChunk) && mods.spendFenceSpeedPerChunk > 0
    ? mods.spendFenceSpeedPerChunk : 0;
  return { instantFences: n * perFence, fenceSpeedBonus: n * perSpeed };
}
