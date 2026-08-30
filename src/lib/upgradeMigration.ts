/**
 * Upgrade ids that no longer exist, and what they became.
 *
 * A run checkpoint stores `ownedUpgradeIds`, and lifetime `maxTierCounts` gates
 * certificate unlocks. Both outlive the catalogue, so deleting an id is not a
 * content edit: it strands whatever a player already owned. A resumed run would
 * quietly drop the upgrade's effect, and a certificate that needed "max tier of
 * X in three runs" could become unreachable through no fault of the player.
 *
 * So ids are never simply removed. A merged rung points at the rung that
 * absorbed it, and everything that reads a saved id maps it through here first.
 *
 * ── Why these two ──────────────────────────────────────────────────────────
 *
 * SCRUM Master carried its effect twice at the same tier: `_2` and `_3` were
 * both Senior granting one more tracked ball, `_4` and `_5` both Principal
 * granting one more traced bounce. Every other family puts one rung per tier,
 * so this was the only one charging twice for the same step - and at seven
 * upgrades it was the second-largest family in the game, crowding the shelf
 * with repeats of a single utility. The survivors now carry the pair's whole
 * value, so a player who owned both ends up exactly where they were.
 */

/** Retired id -> the id that absorbed it. */
export const UPGRADE_ALIASES: Record<string, string> = {
  // Merged into scrum_master_2, which now grants both extra tracked balls.
  scrum_master_3: "scrum_master_2",
  // Merged into scrum_master_4, which now grants both extra traced bounces.
  scrum_master_5: "scrum_master_4",
};

/**
 * Map a saved id onto the live catalogue.
 *
 * Unknown ids pass through unchanged rather than being dropped: an id this
 * build has never heard of is far more likely to be a newer save than a deleted
 * upgrade, and silently discarding it would turn a version mismatch into lost
 * progress.
 */
export function liveUpgradeId(id: string): string {
  return UPGRADE_ALIASES[id] ?? id;
}

/**
 * Map a saved list, dropping the duplicates a merge creates.
 *
 * A player who owned both halves of a merged pair has two ids collapsing onto
 * one, and the owned list is a set in everything but type - a repeat would be
 * counted twice by the tag-synergy scaling, which pays per owned upgrade, and
 * would silently inflate every conditional bonus in a safety or tempo build.
 */
export function liveUpgradeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const live = liveUpgradeId(id);
    if (seen.has(live)) continue;
    seen.add(live);
    out.push(live);
  }
  return out;
}

/**
 * Fold lifetime tier counts onto the live ids.
 *
 * Counts are summed rather than replaced, because they mean "how many runs
 * reached this upgrade's top tier" and a player who reached both halves of a
 * merged pair did the work twice. Taking the larger, or the last one seen,
 * would quietly walk back a certificate they had already earned.
 */
export function migrateTierCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(counts)) {
    const live = liveUpgradeId(id);
    out[live] = (out[live] ?? 0) + n;
  }
  return out;
}
