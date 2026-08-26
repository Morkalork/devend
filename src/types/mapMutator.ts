/**
 * Per-map mutators (issue #54): a rotating environmental modifier rolled once
 * per eligible map (level >= PROCEDURAL_MIN_LEVEL) from the run seed. Different
 * every normal run, identical for everyone on a Daily seed. Unlike doors, a
 * mutator does not merge into GameModifiers; it rides a single `game.mapMutator`
 * field and is applied directly in the physics/scoring layer (see
 * src/lib/mapMutators.ts). This keeps novel behaviours (shifting gravity, a
 * lock-driven speed ramp) out of the modifier-merge pipeline.
 */

/**
 * Behaviour kind. Each is applied by a small, winnability-safe rule:
 * - `crunch`    ball + mover speed ramp with every ball locked this map (capped).
 * - `overclock` flat ball + mover speed boost for the whole map.
 * - `gravity`   the board turns and the pull bends every heading (issue #77).
 * - `none`      no effect (a defined "breather" entry; also see noneWeight).
 */
export type MutatorBehavior = "crunch" | "overclock" | "gravity" | "none";

/** One authored mutator entry (public/mapMutators.yml). English source of truth. */
export interface MapMutator {
  id: string;
  name: string;
  description: string;
  /** Longer hold-to-clarify explainer text. */
  clarify?: string;
  behavior: MutatorBehavior;
  /** Eligible level range (inclusive). Defaults: min = PROCEDURAL_MIN_LEVEL, max = ∞. */
  minLevel?: number;
  maxLevel?: number;
  /** Relative pick weight among eligible mutators (default 1). */
  weight?: number;
  /** Behaviour tuning (e.g. crunch perLockPercent/maxPercent). */
  params?: Record<string, number>;
  /** Overtime hours awarded on clear, folded UNDER the per-map cap (issue #43). */
  overtimePremium?: number;
  /**
   * Shifting gravity (issue #77), for `behavior: gravity`. Authored as a
   * sequence of cardinal phases plus a turn rate; see src/lib/physics/gravity.ts
   * for why this steers the heading rather than accelerating the ball.
   */
  gravity?: {
    turnRate?: number;
    period?: number;
    sequence?: string[];
  };
}

/**
 * A mutator resolved for a specific map: the authored entry plus any per-map
 * rolled fields. This is what lives on `game.mapMutator` and drives the chip.
 *
 * No behaviour currently rolls anything per map, so this adds no fields today.
 * It is kept as a distinct name because the SEAM is the useful part: it marks
 * every place that holds a resolved mutator rather than a catalogue entry, and
 * resolveMutator still hands out a copy so nothing can write through to the
 * shared catalogue.
 */
export type ActiveMapMutator = MapMutator;
