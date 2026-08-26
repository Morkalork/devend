/**
 * A cache key for "the transform these points were baked through".
 *
 * Several layers bake expensive geometry - traced contours, clip masks - in
 * SCREEN space and guard the bake behind a key, so it only runs when something
 * relevant changed. The trap is deciding what "relevant" means by listing the
 * inputs: board rect, scale, obstacle count, and so on. That list was written
 * before the board could TURN, and nobody went back and added the angle, so on
 * a gravity map two layers kept serving geometry baked at an angle the board
 * had since rotated away from. The captured/live split and the lock tints sat
 * frozen while the walls and balls swung round, and the fence mask clipped
 * fences against a board outline that was no longer where the board was.
 *
 * So this does not enumerate anything. It ASKS THE TRANSFORM where three
 * corners of the board land, and keys on the answer. A world-to-screen is a
 * similarity (rotate, uniform scale, translate); three points pin one down
 * completely, so no change to it can slip past this the way the tilt did.
 *
 * Rounded to whole pixels deliberately. Sub-pixel drift is not worth re-tracing
 * a contour set for, and the drawing itself always uses the exact transform -
 * this only decides when the bake is stale.
 */
import { BOARD_WIDTH } from "@/lib/boardConstants";
import type { W2S } from "./quad";

export function transformKey(w2s: W2S): string {
  const a = w2s(0, 0);
  const b = w2s(BOARD_WIDTH, 0);
  const c = w2s(0, BOARD_WIDTH);
  return `${Math.round(a.x)},${Math.round(a.y)}`
    + `:${Math.round(b.x)},${Math.round(b.y)}`
    + `:${Math.round(c.x)},${Math.round(c.y)}`;
}
