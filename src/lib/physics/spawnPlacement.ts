/**
 * Where a newly-spawned ball is placed relative to the ball it came from.
 *
 * This exists because the same mistake was made independently in three
 * spawners. Each had a comment like "a small offset off the parent avoids a
 * zero-distance collision solve", and each used `parent.radius * 0.75` - i.e.
 * LESS THAN ONE RADIUS. That solves the physics problem and creates a
 * presentation one: the newcomer is the same size as its parent, its type is
 * picked at random so it frequently shares the parent's colour, and it is born
 * essentially on top of it. Players read that as the ball duplicating itself,
 * and reported it as a bug repeatedly - correctly, in the sense that nothing on
 * screen distinguished it from one.
 *
 * The fix is to push the newcomer a clear gap away along a heading that still
 * lands in live playable space, so the pair separates from the very first
 * frame. Living in one module means the next spawner added gets it for free
 * rather than re-deriving the same near-zero offset.
 *
 * Boss minions deliberately do NOT use this: they are half-size, start tiny and
 * grow, and are attached to the boss with a birth splash, so budding out of the
 * rim is exactly the read that mechanic wants.
 */

import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";
import { isPositionActive } from "@/lib/spaceGrid";

/** Headings tried before giving up and using the fallback offset. */
const HEADINGS = 8;
/** Gap from the parent, in parent radii. Below ~1 the two still visually merge. */
const DEFAULT_GAP_RADII = 1.25;
/**
 * Fallback separation when no heading works (a nearly-sealed pocket). Being
 * briefly coincident is much better than being posted inside geometry.
 */
const FALLBACK_GAP = 2;

export interface SpawnPlacement {
  x: number;
  y: number;
  /** The chosen heading, so callers can send the newcomer off along it. */
  angle: number;
}

/**
 * A spawn point a clear gap from `parent`, preferring one that is still live
 * playable space.
 *
 * `clearOfOtherBalls` additionally requires the point to be well away from
 * every live ball, which is what a map beat wants: its "anchor" is an ordinary
 * ball, so the newcomer should read as arriving rather than splitting off.
 */
export function spawnClearOfParent(
  game: CanvasGameState,
  parent: Ball,
  opts: { gapRadii?: number; clearOfOtherBalls?: boolean } = {},
): SpawnPlacement {
  const gap = parent.radius * (opts.gapRadii ?? DEFAULT_GAP_RADII);
  const grid = game.spaceGrid;
  // Random start so repeated spawns don't all fire off in the same direction.
  const start = Math.random() * Math.PI * 2;

  if (grid) {
    // The PARENT is excluded from the proximity test: it is inherently close -
    // being a known gap from it is the whole point - so including it makes every
    // heading fail and silently drops us to the fallback offset. Separation from
    // the parent is controlled by `gapRadii`, not by this check.
    const minDist = opts.clearOfOtherBalls ? parent.radius * 3 : 0;
    const live = opts.clearOfOtherBalls
      ? game.balls.filter(b => b.state === "active" && b.id !== parent.id)
      : [];

    for (let i = 0; i < HEADINGS; i++) {
      const angle = start + (i / HEADINGS) * Math.PI * 2;
      const x = parent.position.x + Math.cos(angle) * gap;
      const y = parent.position.y + Math.sin(angle) * gap;
      if (!isPositionActive(grid, { x, y })) continue;
      if (minDist > 0 && !live.every(b => Math.hypot(b.position.x - x, b.position.y - y) >= minDist)) {
        continue;
      }
      return { x, y, angle };
    }
  }

  return {
    x: parent.position.x + Math.cos(start) * FALLBACK_GAP,
    y: parent.position.y + Math.sin(start) * FALLBACK_GAP,
    angle: start,
  };
}
