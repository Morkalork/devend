/**
 * How tall everything standing on the 3D board is, in world units.
 *
 * Authored in one place for the reason SLAB_HEIGHT_WORLD was (light.ts): a
 * shadow's length is a function of its caster's height, so heights decide how
 * the whole board reads under the lights. The 2D model gave every piece of
 * furniture one height because it could only afford one; the 3D board can let
 * the enclosure stand taller than the player's fences and a sprung bumper sit
 * lower than a wall, which is a reading of the board in its own right.
 *
 * Every value is multiplied by the Admin height knob (render3dSettings.ts).
 * Obstacles further take their role's or their map's `rise` (objectRise.ts).
 */
import { SLAB_HEIGHT_WORLD } from "@/lib/rendering/sleek/light";
import { BOUNCER_RISE, MOVER_RISE } from "@/lib/objectRise";

export const HEIGHTS = {
  /** A fence the player drew. The slab height the 2D shadows were tuned to. */
  fence: SLAB_HEIGHT_WORLD,
  /** The board's outer frame: the enclosure, taller than anything inside it. */
  frame: SLAB_HEIGHT_WORLD * 1.6,
  /** Static obstacles, breakables, mirrors, deformables. */
  slab: SLAB_HEIGHT_WORLD,
  /** Movers: a machine, a little prouder than the furniture it patrols past. */
  mover: SLAB_HEIGHT_WORLD * MOVER_RISE,
  /** Pop bumpers: sprung, so lower and wider-looking. */
  bouncer: SLAB_HEIGHT_WORLD * BOUNCER_RISE,
} as const;
