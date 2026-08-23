/**
 * Sizing a lock mission to the block it is actually set over.
 *
 * The tiers in assignments.yml were authored as absolute numbers, and nothing
 * checked them against how many balls the next five maps put on the board.
 * Measured, they were not merely tight, most were impossible:
 *
 *   block   balls available   lock_quota top tier   crunch_delivery top tier
 *    6-10          11                20 (182%)              40 (364%)
 *   11-15          14                20 (143%)              40 (286%)
 *   16-20          14                20 (143%)              40 (286%)
 *   31-35           8                20 (250%)              40 (500%)
 *
 * A mission asking for more locks than there are balls is not a hard mission,
 * it is a dead one: the player takes the constraint for the whole block and the
 * reward was never reachable. Even the reachable ones had no slack, with
 * cost_cutting wanting 10 superior locks out of 11 possible on the first block.
 *
 * So thresholds are scaled to a SHARE of the block's real capacity, preserving
 * the shape the author gave them. A three-tier mission stays three tiers with
 * the same relative spacing; only the scale moves. That way the roster can be
 * balanced by feel in the YAML, and retuning a map's `maxBalls` later cannot
 * silently make a mission unwinnable again.
 */
import type { AssignmentConfig } from "@/types/assignment";
import type { LevelConfig } from "@/types/level";

/** Maps in one assignment block. Matches assignments.yml's cadence. */
export const BLOCK_SIZE = 5;

/**
 * How much of a block's lock capacity the TOP tier may ask for.
 *
 * Below level 20 there is deliberate slack: a player is still learning to seal
 * pockets at all, the roster is small, and a block that demands near-perfect
 * conversion turns the draft into a trap you learn to skip. Later blocks tighten
 * because by then locking reliably IS the skill the game is testing.
 */
export const TOP_TIER_SHARE_EARLY = 0.60;
export const TOP_TIER_SHARE_LATE = 0.75;

/**
 * The same, for SUPERIOR locks, which are a different ask entirely: every one
 * needs a pocket tight enough to grade, so converting even half the roster is a
 * strong block. Sharing a number with plain locks is what left cost_cutting
 * wanting ten superior locks from eleven balls.
 */
export const SUPERIOR_TOP_TIER_SHARE_EARLY = 0.40;
export const SUPERIOR_TOP_TIER_SHARE_LATE = 0.55;

/** The level from which the tighter shares apply. */
export const TIGHTEN_FROM_LEVEL = 20;

/**
 * How many balls the block starting at `fromLevel` puts on the board.
 *
 * Reads `maxBalls` off the authored maps. Deliberately ignores the extra balls
 * a rainbow can spawn, a boss can divide into, or a pickup can clone: none is
 * guaranteed on any given map, and a target a player can only reach on a lucky
 * roster is the same trap in a subtler form. Anything extra is slack in the
 * player's favour, which is the direction an assignment should err.
 *
 * Level variants (level-2b and friends) share a level number and only one is
 * ever played, so the first is taken and the rest ignored: summing them would
 * double-count balls that never coexist.
 */
export function blockLockCapacity(
  levels: readonly LevelConfig[], fromLevel: number, blockSize = BLOCK_SIZE,
): number {
  const seen = new Set<number>();
  let total = 0;
  for (let n = fromLevel; n < fromLevel + blockSize; n++) {
    const map = levels.find(l => l.level === n);
    if (!map || seen.has(n)) continue;
    seen.add(n);
    total += map.maxBalls ?? map.balls?.length ?? 1;
  }
  return total;
}

/** The share of capacity the top tier of this mission may ask for. */
export function topTierShare(kind: string, fromLevel: number): number {
  const early = fromLevel < TIGHTEN_FROM_LEVEL;
  if (kind === "superiorLocks") {
    return early ? SUPERIOR_TOP_TIER_SHARE_EARLY : SUPERIOR_TOP_TIER_SHARE_LATE;
  }
  return early ? TOP_TIER_SHARE_EARLY : TOP_TIER_SHARE_LATE;
}

/**
 * An assignment with its lock thresholds sized to the block it is offered for.
 *
 * Only `cumulative` missions counting locks are touched. An `everyMap` mission's
 * thresholds are maps-passed out of five and have nothing to do with how many
 * balls there are; scaling those by ball count would be nonsense.
 *
 * Every tier keeps its relative position, so the author's shape survives: a
 * 20/30/40 mission on a 14-ball block becomes 5/7/10, still three rungs at the
 * same spacing, with the top one asking for 75% of what the block can give.
 * Each tier is floored at 1 and kept strictly ascending, because two tiers that
 * round to the same number would pay the lower reward for the higher effort.
 */
export function scaleAssignmentToBlock(
  a: AssignmentConfig, capacity: number, fromLevel: number,
): AssignmentConfig {
  const track = a.mission?.track;
  const summed = track?.kind === "lockCount" || track?.kind === "superiorLocks";
  if (!track || track.mode !== "cumulative" || !summed) return a;
  if (!Number.isFinite(capacity) || capacity <= 0) return a;

  const tiers = a.mission.tiers;
  if (tiers.length === 0) return a;
  const authoredTop = Math.max(...tiers.map(t => t.threshold));
  if (authoredTop <= 0) return a;

  const target = capacity * topTierShare(track.kind, fromLevel);
  const factor = target / authoredTop;
  // Never scale a mission UP. The authored numbers are the design's intent for
  // a generous block; a roomy block should make a mission easier to clear, not
  // move the goalposts to keep it just as hard.
  if (factor >= 1) return a;

  let previous = 0;
  const scaled = tiers.map(t => {
    const next = Math.max(1, previous + 1, Math.round(t.threshold * factor));
    previous = next;
    return { ...t, threshold: next };
  });
  return { ...a, mission: { ...a.mission, tiers: scaled } };
}

/** Scale a whole offer set for the block that follows `completedLevel`. */
export function scaleOffersForBlock(
  offers: readonly AssignmentConfig[],
  levels: readonly LevelConfig[],
  completedLevel: number,
): AssignmentConfig[] {
  const fromLevel = completedLevel + 1;
  const capacity = blockLockCapacity(levels, fromLevel);
  return offers.map(a => scaleAssignmentToBlock(a, capacity, fromLevel));
}
