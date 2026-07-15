/**
 * Build recap — names the run's build from its archetype tag counts, for the
 * end-of-run result screen ("Your Freeze-Lock build banked 412h").
 *
 * The identity is the dominant archetype (primary) plus an optional second
 * one; a run with no real lean (nothing at minCount) is a Generalist. Display
 * strings live in the locale files (buildRecap.*); this module is pure logic.
 */
import { UpgradeTag } from '@/types/upgrade';

/** Deterministic tie-break order (matches the archetype docs). */
const TAG_ORDER: UpgradeTag[] = ['lock', 'freeze', 'bank', 'tempo', 'risk', 'safety'];

export interface BuildIdentity {
  /** Dominant archetype, or null when the run never leaned anywhere. */
  primary: UpgradeTag | null;
  /** Second lean, only when it also clears minCount. */
  secondary: UpgradeTag | null;
}

/** Everything the result screen needs to tell the run's story. */
export interface RunRecap extends BuildIdentity {
  /** Owned-upgrade count per tag at run end (only tags with a count > 0). */
  tagCounts: Record<string, number>;
  capstoneId: string | null;
  capstoneName: string | null;
  /** Banked overtime the run ended with. */
  score: number;
  /** True when `score` set a new personal best for the primary archetype. */
  isArchetypeRecord: boolean;
  /** The best it beat (null on a first-ever run with this primary). */
  previousBest: number | null;
}

/** How many owned upgrades a tag needs before it counts as a lean. */
export const BUILD_IDENTITY_MIN_COUNT = 2;

export function computeBuildIdentity(
  tagCounts: Map<string, number>,
  minCount: number = BUILD_IDENTITY_MIN_COUNT,
): BuildIdentity {
  const ranked = TAG_ORDER
    .map(tag => ({ tag, count: tagCounts.get(tag) ?? 0 }))
    .filter(e => e.count >= minCount)
    // Stable sort: count desc, TAG_ORDER breaks ties deterministically.
    .sort((a, b) => b.count - a.count);

  return {
    primary: ranked[0]?.tag ?? null,
    secondary: ranked[1]?.tag ?? null,
  };
}
