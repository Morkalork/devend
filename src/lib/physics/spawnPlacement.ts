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

/**
 * Two same-size balls TOUCH when their centres are 2 radii apart.
 *
 * Every distance in this module is CENTRE TO CENTRE, and that is the one thing
 * the earlier versions of this file got wrong. They reasoned in radii as though
 * the number described the air between the two surfaces ("below ~1 the two
 * still visually merge"), so the gap was set to 1.25 - which for radius-18
 * balls is 22.5 units apart when 36 is merely touching. Every Fork clone, every
 * rainbow spit and every degraded beat add was therefore born overlapping its
 * parent by 13.5 units, i.e. drawn as a single blob that then separates. That
 * is exactly the "the ball split / duplicated" report this module was created
 * to end, and it survived two rounds of fixes because the number moved in the
 * right direction without ever crossing 2.
 *
 * Anything below this constant is an overlap, not a gap.
 */
const TOUCHING_RADII = 2;
/** Wanted separation: a full radius of clear air between the two surfaces. */
const DEFAULT_GAP_RADII = TOUCHING_RADII + 1;
/**
 * The floor. Nothing may return a position inside this, including the
 * last-resort fallback: a quarter radius of daylight is thin, but the pair
 * still reads as two balls rather than one splitting.
 *
 * A cramped pocket is precisely where a spawn is most likely to happen, so the
 * degraded path is not rare and must stay above the overlap threshold.
 */
const MIN_GAP_RADII = TOUCHING_RADII + 0.25;


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
  const wanted = parent.radius * (opts.gapRadii ?? DEFAULT_GAP_RADII);
  const floor = parent.radius * MIN_GAP_RADII;
  const grid = game.spaceGrid;
  // Random start so repeated spawns don't all fire off in the same direction.
  const start = Math.random() * Math.PI * 2;

  if (grid) {
    // The PARENT is excluded from the proximity test: it is inherently close -
    // being a known gap from it is the whole point - so including it makes every
    // heading fail and silently drops us to the fallback offset. Separation from
    // the parent is controlled by `gapRadii`, not by this check.
    const live = opts.clearOfOtherBalls
      ? game.balls.filter(b => b.state === "active" && b.id !== parent.id)
      : [];

    // Give up the NICE-to-haves before giving up the separation. Distance from
    // the parent is the one thing the player actually sees, so it is surrendered
    // last: first the elbow room from other balls, then the extra distance, and
    // never below the floor.
    const gaps = [wanted, (wanted + floor) / 2, floor].filter((g, i, a) => a.indexOf(g) === i);
    const passes: { gap: number; minDist: number }[] = [];
    for (const gap of gaps) passes.push({ gap, minDist: parent.radius * 3 });
    for (const gap of gaps) passes.push({ gap, minDist: 0 });

    for (const pass of passes) {
      if (pass.minDist > 0 && live.length === 0) continue; // same as the later pass
      for (let i = 0; i < HEADINGS; i++) {
        const angle = start + (i / HEADINGS) * Math.PI * 2;
        const x = parent.position.x + Math.cos(angle) * pass.gap;
        const y = parent.position.y + Math.sin(angle) * pass.gap;
        if (!isPositionActive(grid, { x, y })) continue;
        if (pass.minDist > 0
          && !live.every(b => Math.hypot(b.position.x - x, b.position.y - y) >= pass.minDist)) {
          continue;
        }
        return { x, y, angle };
      }
    }
  }

  // Last resort: still a visible gap. Landing a hair outside live space for a
  // frame is recoverable and self-corrects; being born inside the parent is the
  // bug this module exists to prevent, and it is what players report.
  return {
    x: parent.position.x + Math.cos(start) * floor,
    y: parent.position.y + Math.sin(start) * floor,
    angle: start,
  };
}
