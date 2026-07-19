/**
 * mapPools — shared selection helpers for the per-map catalogues rolled from the
 * run seed (map mutators #54, map objectives #55; the slot resolver #53 uses the
 * weighted pick too). Factored out so the level-eligibility gate and the subtle
 * "none bucket" weighted draw live in ONE tested place instead of being copied
 * per catalogue.
 */
import type { Rng } from "@/lib/runRng";

/** A catalogue entry that may restrict itself to a level range. */
export interface LevelGated {
  minLevel?: number;
  maxLevel?: number;
}

/** A catalogue entry with a relative pick weight (default 1). */
export interface Weighted {
  weight?: number;
}

/**
 * Entries eligible at `levelNumber`: below `minFloor` nothing is eligible (the
 * procedural band gate); otherwise each entry's [minLevel ?? minFloor, maxLevel
 * ?? ∞] range must contain the level.
 */
export function eligibleByLevel<T extends LevelGated>(
  levelNumber: number,
  pool: T[],
  minFloor: number,
): T[] {
  if (levelNumber < minFloor) return [];
  return pool.filter((e) => {
    const min = e.minLevel ?? minFloor;
    const max = e.maxLevel ?? Infinity;
    return levelNumber >= min && levelNumber <= max;
  });
}

/**
 * Weighted pick among `items`, plus a synthetic "none" bucket of weight
 * `noneWeight` that yields null (used to leave some maps un-mutated / goal-free).
 * Deterministic given `rng`. Returns null when the pool is empty, all weights are
 * zero, or the draw lands in the none bucket. `noneWeight = 0` makes it a plain
 * weighted pick that always returns an item (when any positive weight exists).
 */
export function weightedPick<T extends Weighted>(
  items: T[],
  noneWeight: number,
  rng: Rng,
): T | null {
  if (items.length === 0) return null;
  const weightOf = (e: T) => Math.max(0, e.weight ?? 1);
  const total = items.reduce((s, e) => s + weightOf(e), 0) + Math.max(0, noneWeight);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const e of items) {
    r -= weightOf(e);
    if (r < 0) return e;
  }
  return null; // fell into the none bucket
}

/** Coerce an unknown YAML value to a finite number, or undefined. */
export function finiteOrUndefined(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
