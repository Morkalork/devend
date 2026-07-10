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

/**
 * Weighted sample without replacement (n picks; weights re-normalise as the
 * pool shrinks). Returns fewer than n when the pool runs out. With no owned
 * tags every weight is 1, i.e. a uniform shuffle.
 */
export function weightedSample(
  items: UpgradeConfig[],
  n: number,
  counts: Map<string, number>,
): UpgradeConfig[] {
  const pool = [...items];
  const picked: UpgradeConfig[] = [];
  while (picked.length < n && pool.length > 0) {
    const total = pool.reduce((sum, it) => sum + tagWeight(it, counts), 0);
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= tagWeight(pool[i], counts);
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
