/**
 * Archetype-tag helpers — the build system's shared math.
 *
 * Tags (lock/freeze/bank/tempo/risk/safety, see UpgradeTag) drive two things:
 *  - the shop's tag-weighted offers (draft coherence): a candidate's weight is
 *    1 + the number of owned upgrades sharing at least one tag with it, and
 *  - set bonuses: free modifier bundles auto-granted while the player owns at
 *    least `threshold` upgrades of a tag (tagSets in upgrades.yml).
 */
import { UpgradeConfig, TagSetBonus, TagSetsConfig } from '@/types/upgrade';

export const DEFAULT_TAG_SET_THRESHOLD = 3;

/** How many owned upgrades carry each tag. */
export function ownedTagCounts(ownedIds: string[], upgrades: UpgradeConfig[]): Map<string, number> {
  const counts = new Map<string, number>();
  const byId = new Map(upgrades.map(u => [u.id, u]));
  for (const id of ownedIds) {
    for (const tag of byId.get(id)?.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/** Shop-offer weight: 1 + owned upgrades sharing at least one tag. */
export function tagWeight(u: UpgradeConfig, counts: Map<string, number>): number {
  let w = 1;
  for (const tag of u.tags ?? []) w += counts.get(tag) ?? 0;
  return w;
}

// Unlock-recency window: full weight while an upgrade is fresh, then a 15%
// decay per level of age down to a floor. Keeps a level-14 shelf from filling
// with level-2 shelf-filler while a build-critical early root can still roll.
const RECENCY_GRACE_LEVELS = 4;
const RECENCY_DECAY_PER_LEVEL = 0.15;
const RECENCY_FLOOR = 0.25;

/** 1.0 for recently unlocked upgrades, decaying with age to RECENCY_FLOOR. */
export function unlockRecencyWeight(u: UpgradeConfig, completedLevel: number): number {
  const age = completedLevel - (u.unlockLevel ?? 1);
  if (age <= RECENCY_GRACE_LEVELS) return 1;
  return Math.max(RECENCY_FLOOR, 1 - RECENCY_DECAY_PER_LEVEL * (age - RECENCY_GRACE_LEVELS));
}

/**
 * Weighted sample without replacement (n picks; weights re-normalise as the
 * pool shrinks). Returns fewer than n when the pool runs out. With no owned
 * tags every weight is 1, i.e. a uniform shuffle. When `completedLevel` is
 * given, weights also lean toward recently unlocked upgrades (see
 * unlockRecencyWeight), so late shelves stay expensive and interesting.
 */
export function weightedSample(
  items: UpgradeConfig[],
  n: number,
  counts: Map<string, number>,
  completedLevel?: number,
  rng: () => number = Math.random,
): UpgradeConfig[] {
  const weightOf = (u: UpgradeConfig) =>
    tagWeight(u, counts) * (completedLevel !== undefined ? unlockRecencyWeight(u, completedLevel) : 1);
  const pool = [...items];
  const picked: UpgradeConfig[] = [];
  while (picked.length < n && pool.length > 0) {
    const total = pool.reduce((sum, it) => sum + weightOf(it), 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weightOf(pool[i]);
      if (r <= 0) { idx = i; break; }
    }
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/** The set bonuses currently active for an owned-upgrade set. */
export function computeActiveTagSets(
  ownedIds: string[],
  upgrades: UpgradeConfig[],
  tagSets: TagSetsConfig | undefined,
): TagSetBonus[] {
  if (!tagSets || tagSets.bonuses.length === 0) return [];
  const threshold = tagSets.threshold > 0 ? tagSets.threshold : DEFAULT_TAG_SET_THRESHOLD;
  const counts = ownedTagCounts(ownedIds, upgrades);
  return tagSets.bonuses.filter(b => (counts.get(b.tag) ?? 0) >= threshold);
}
