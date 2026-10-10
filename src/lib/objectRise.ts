/**
 * How tall each object on the board stands, as a multiple of the standard slab.
 *
 * Rendering only: the physics is flat and nothing here may change it. What
 * height is FOR is the design card's "every object is a promise" said in a
 * third dimension, so it follows one rule across the ladder rather than
 * whatever looked good on one map:
 *
 *   SHARD      low (0.6). Glass a ball breaks on its way somewhere else; it
 *              sits under a ball's own height, so a run of them reads as
 *              something the balls are about to go through.
 *   MONOLITH   proud (1.25). Three deliberate drives: a plan, so it stands
 *              taller than the plain wall beside it.
 *   CHEST      squat (0.8). A box worth opening, not part of the building.
 *   MEMBRANE   a threshold (0.35). One-way walls and ball-type gates let some
 *              balls through, and a full-height wall a ball rolls straight
 *              through is the one thing height must never say.
 *   EVERYTHING ELSE 1, unless the map authors `rise` (LevelEntity.rise): the
 *              doorway that IS the map's idea stands taller than the lip that
 *              invites a seal (MAP_DESIGN_GUIDELINES.md, section 6.5).
 *
 * Bumpers and movers keep their own (heights3d.ts): a sprung bumper is lower,
 * a machine a little prouder, whatever the map.
 */
import type { LevelEntity } from "@/types/level";

export const RISE_MIN = 0.25;
export const RISE_MAX = 2.5;

export const ROLE_RISE = {
  shard: 0.6,
  monolith: 1.25,
  chest: 0.8,
  membrane: 0.35,
} as const;

/** The entity's authored rise, clamped, or undefined when it has none. */
export function entityRise(entity: Pick<LevelEntity, "rise">): number | undefined {
  const r = entity.rise;
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return undefined;
  return Math.min(RISE_MAX, Math.max(RISE_MIN, r));
}

/** Bumpers sit lower and movers prouder whatever the map (heights3d.ts). */
export const BOUNCER_RISE = 0.7;
export const MOVER_RISE = 1.15;

/**
 * What an entity stands at with no `rise` authored, and the role that sets it.
 * The 3D board reads the same rule off the live board (solids3d.roleRises);
 * this one is for the editor, which only has the entity.
 */
export function defaultRise(entity: LevelEntity): { rise: number; role: string } {
  if (entity.kind === "mover") return { rise: MOVER_RISE, role: "mover" };
  if (entity.kind !== "wall") return { rise: 1, role: "wall" };
  if (entity.oneWay || entity.passTypes?.length) return { rise: ROLE_RISE.membrane, role: "membrane" };
  if (entity.bouncer) return { rise: BOUNCER_RISE, role: "bumper" };
  if (entity.chest) return { rise: ROLE_RISE.chest, role: "chest" };
  if (entity.brittle) return { rise: ROLE_RISE.shard, role: "shard" };
  if (entity.breakable) return entity.fence ? { rise: 1, role: "breakable fence" } : { rise: ROLE_RISE.monolith, role: "monolith" };
  return { rise: 1, role: "wall" };
}
