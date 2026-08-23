/**
 * Everything that bends a ball's heading, in one place.
 *
 * The Scrum Master preview and updateBall each used to decide independently
 * what curves a path, and they had drifted apart in three ways at once:
 *
 *   - The physics steers toward gravity WELLS on six authored maps. The preview
 *     had never heard of them, so on every one of those maps it drew a
 *     confident straight line the ball then curved away from.
 *   - The physics scales the bend by `gravityBendMultiplier` (the Free Fall
 *     upgrade line). The preview used the raw authored turn rate, so buying an
 *     upgrade made the preview wrong in proportion to how much you had spent.
 *   - The physics applied map gravity on `mutator.behavior === "gravity" && cfg`
 *     while the preview applied it on `cfg` alone. Two readings of one fact,
 *     which is the same failure the win conditions had.
 *
 * A forecast the player has spent hundreds of overtime hours on has to be drawn
 * from the same rule the ball obeys, so there is now exactly one rule. Anything
 * added here reaches both; anything added to only one of them is a bug that
 * reports itself as "the tracker is broken".
 *
 * Ball-specific steering (the Compass turn, the Lodestone pull) is deliberately
 * NOT here: both depend on per-ball state the preview cannot know a second
 * ahead, and pretending otherwise would draw a different wrong line. See
 * `steerablePathIsApproximate`.
 */
import type { Vector2 } from "@/lib/polygon";
import type { GravityWell } from "@/types/level";
import type { GravityConfig } from "@/lib/physics/gravity";
import { gravityStep, gravityVectorAt } from "@/lib/physics/gravity";
import {
  wellStep, liveWellAt, PULL_VECTORS, DEFAULT_PULL, DEFAULT_WELL_TURN_RATE,
} from "@/lib/physics/gravityWells";

/**
 * The parts of game state that bend a heading.
 *
 * A narrow structural type rather than CanvasGameState so the preview can build
 * one and the tests can too, without a hundred unrelated fields.
 */
export interface SteerWorld {
  /** Map gravity, live only when the map mutator is actually a gravity one. */
  gravityConfig: GravityConfig | null;
  mapMutatorBehavior?: string;
  gravityWells?: readonly GravityWell[];
  /** Wells can be dormant until the map has been cleared past a threshold. */
  spaceRemainingPercent?: number;
  /** Free Fall (Escape Velocity): softens every bend. */
  gravityBendMultiplier?: number;
}

/**
 * Read a SteerWorld off live game state.
 *
 * One adapter, so a new field that bends a heading is added here and both the
 * physics and the preview get it, instead of one of them getting it and the
 * other reporting itself as a broken tracker.
 */
export function steerWorldOf(game: {
  gravityConfig?: GravityConfig | null;
  mapMutator?: { behavior?: string } | null;
  gravityWells?: readonly GravityWell[];
  spaceRemainingPercent?: number;
  gravityBendMultiplier?: number;
}): SteerWorld {
  return {
    gravityConfig: game.gravityConfig ?? null,
    mapMutatorBehavior: game.mapMutator?.behavior,
    gravityWells: game.gravityWells,
    spaceRemainingPercent: game.spaceRemainingPercent,
    gravityBendMultiplier: game.gravityBendMultiplier,
  };
}

/** Is map gravity actually running? The ONE reading of it. */
export function mapGravityActive(world: SteerWorld): boolean {
  return world.mapMutatorBehavior === "gravity" && !!world.gravityConfig;
}

/**
 * The velocity a ball should have after `dt` of steering, or null when nothing
 * is pulling on it.
 *
 * Order matches updateBall: map gravity first, then a well on top, so a ball
 * inside a well on a gravity map feels both. Each returns null when it does not
 * apply, so the common case (neither) costs two cheap checks.
 */
export function steerHeading(
  position: Vector2,
  velocity: Vector2,
  world: SteerWorld,
  activeSeconds: number,
  dt: number,
): Vector2 | null {
  let out: Vector2 | null = null;
  const bend = world.gravityBendMultiplier ?? 1;

  if (mapGravityActive(world)) {
    const steered = gravityStep(velocity, activeSeconds, world.gravityConfig!, dt, bend);
    if (steered) out = steered;
  }

  const pulled = wellStep(
    position, out ?? velocity, world.gravityWells, dt, world.spaceRemainingPercent, bend,
  );
  if (pulled) out = pulled;

  return out;
}

/**
 * Is anything on this board able to curve a path at all?
 *
 * Lets the preview take its cheap analytic straight-line cast on the maps where
 * nothing bends, which is most of them, instead of marching every leg in chords
 * on the off chance.
 */
export function anySteeringActive(world: SteerWorld, activeSeconds: number): boolean {
  if (mapGravityActive(world) && gravityVectorAt(activeSeconds, world.gravityConfig!)) return true;
  return (world.gravityWells?.length ?? 0) > 0;
}

/**
 * Is a ball's path bent by something the preview cannot see ahead?
 *
 * The Compass turns on its own timer and the Lodestone pulls toward a ball that
 * is itself moving unpredictably. Neither can be honestly projected, so this
 * exists to let a caller say so rather than quietly draw a line that is wrong
 * for a reason the player cannot deduce.
 */
export function steerablePathIsApproximate(ability: string | undefined): boolean {
  return ability === "turnTimer" || ability === "attract";
}

/** Where a ball inside a live well is being pulled, for the preview's marching. */
export function wellPullAt(
  position: Vector2, world: SteerWorld,
): Vector2 | null {
  const well = liveWellAt(
    position.x, position.y, world.gravityWells, world.spaceRemainingPercent);
  if (!well) return null;
  // `pull` is a named direction, not a vector: it is authored in SCREEN space so
  // a rotated map cannot change how it plays (see level.ts).
  return { ...PULL_VECTORS[well.pull ?? DEFAULT_PULL] };
}

/**
 * The turn rate of the live well a point is inside, or 0 outside every well.
 *
 * Separate from wellPullAt because the preview needs both and a well authored
 * with its own `turnRate` bends harder than the default: using the default here
 * would draw a gentler arc than the one the ball takes, which is the same class
 * of quiet wrongness this module exists to end.
 */
export function wellTurnRateAt(position: Vector2, world: SteerWorld): number {
  const well = liveWellAt(
    position.x, position.y, world.gravityWells, world.spaceRemainingPercent);
  if (!well) return 0;
  return Number.isFinite(well.turnRate) && (well.turnRate as number) > 0
    ? (well.turnRate as number)
    : DEFAULT_WELL_TURN_RATE;
}
