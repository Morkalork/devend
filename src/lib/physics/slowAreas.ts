/**
 * Slow Areas: player-placed patches of the board where balls crawl.
 *
 * Unlike Slow All, which is a few seconds of global relief, a Slow Area is
 * PERMANENT and LOCAL: you spend a charge to decide that one part of the board
 * is treacle for the rest of the map. That makes it the first ability that is a
 * placement decision rather than a timing one, and it pays off in exactly the
 * way locking does, by making a pocket sealable before the ball can leave it.
 *
 * ── Why this scales displacement, not velocity ─────────────────────────────
 *
 * The obvious implementation, halving `ball.velocity` on entry and restoring it
 * on exit, cannot work here. updateBall rewrites velocity to ABSOLUTE
 * magnitudes from three separate places every frame (the universal minimum-speed
 * floor, grey's wind-down, yellow's variable speed), so a halved velocity is
 * erased within a frame, and the restore-on-exit would then be restoring a
 * number that no longer means anything. Worse, the minimum-speed floor would
 * fight the slow directly: it exists to guarantee no active ball ever moves
 * below its floor, which is precisely what a slow zone wants to do.
 *
 * So a Slow Area scales the ball's DISPLACEMENT for the frame, the same way
 * Scope Creep and the boss split beat already do. The stored velocity is never
 * touched, which means:
 *   - every speed rescaler keeps working, with no special cases;
 *   - the factor cannot compound frame over frame;
 *   - collisions still resolve at the ball's real velocity, so it bounces off
 *     walls normally instead of mushing into them;
 *   - leaving the area restores full speed instantly and for free, because
 *     nothing was ever taken away.
 */
import type { SlowArea } from "@/types/game";

/** How much a ball is slowed inside an area that does not state its own factor. */
export const DEFAULT_SLOW_AREA_FACTOR = 0.5;

/** Side length of a placed area, in world units, when the ability omits one. */
export const DEFAULT_SLOW_AREA_SIZE = 230;

/** Is this point inside the area? Mirrors pointInWell / pointInArea. */
export function pointInSlowArea(x: number, y: number, a: SlowArea): boolean {
  return x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height;
}

/**
 * The displacement multiplier for a ball at this point: the STRONGEST area
 * containing it, or 1 when it is in none.
 *
 * Strongest rather than the product of all of them, deliberately. Two
 * overlapping halvings would multiply to a quarter and three to an eighth,
 * which is a ball that has effectively stopped: not a slow zone any more but a
 * free lock, and one a player would build on purpose by stacking every charge
 * on one pocket. Taking the minimum means a second area placed over a first is
 * wasted, which is the feedback that teaches spreading them out.
 */
export function slowFactorAt(
  x: number, y: number, areas: readonly SlowArea[] | undefined,
): number {
  if (!areas || areas.length === 0) return 1;
  let factor = 1;
  for (const a of areas) {
    if (!pointInSlowArea(x, y, a)) continue;
    const f = Number.isFinite(a.factor) && a.factor > 0 ? a.factor : DEFAULT_SLOW_AREA_FACTOR;
    if (f < factor) factor = f;
  }
  return factor;
}

/**
 * An area of `size` centred on (x, y), clamped so it stays wholly on the board.
 *
 * Clamped rather than allowed to hang off the edge, because a player tapping
 * near a corner is asking for a slow pocket in that corner, and half of one
 * would be a worse version of what they asked for. Clamping keeps the area they
 * paid a charge for at full strength; it just slides it inboard.
 */
export function placeSlowArea(
  x: number, y: number, boardSize: number,
  size = DEFAULT_SLOW_AREA_SIZE,
  factor = DEFAULT_SLOW_AREA_FACTOR,
): SlowArea {
  // A size larger than the board would clamp to a negative span, so cap it
  // first: an absurd YAML value should degrade to "the whole board", not to an
  // inside-out rect that contains nothing.
  const side = Math.max(1, Math.min(size, boardSize));
  const half = side / 2;
  const cx = Math.min(boardSize - half, Math.max(half, x));
  const cy = Math.min(boardSize - half, Math.max(half, y));
  return {
    x: cx - half,
    y: cy - half,
    width: side,
    height: side,
    factor: Number.isFinite(factor) && factor > 0 ? Math.min(1, factor) : DEFAULT_SLOW_AREA_FACTOR,
  };
}
