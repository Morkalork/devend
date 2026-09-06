/**
 * The Redeploy fence: the one you throw with.
 *
 * Every other fence type changes what happens when a ball ARRIVES - ice takes
 * speed off it, flare puts speed on, tripwire breaks, the drill eats. This one
 * does nothing at all until the player grabs it: press on a finished Redeploy
 * fence, drag it back like a rubber band, aim, let go, and it snaps forward and
 * flings whatever was in front of it. Once. Then it is an ordinary fence.
 *
 * ── Why it reuses the Rubber Band's maths and not the launcher's ───────────
 *
 * There are two slingshots in this game already. The launcher is the MAP's: a
 * barrel with a fixed cone, fired once before anything moves. The Rubber Band
 * ability is the PLAYER's: a band placed anywhere, at any moment, aimed
 * anywhere. This fence is the second of those with one thing taken away - the
 * band is not placed by the gesture, it is a fence you built earlier - so it
 * takes the Rubber Band's dead zone, its full-pull length, its power curve and
 * its sweep, and supplies only the two things that are genuinely its own:
 *
 *   the SPAN     the fence's own length, not BAND_HALF_WIDTH. A short fence
 *                throws a narrow lane and a long one sweeps a corridor, which
 *                is what makes WHERE you built it the decision.
 *   the ANCHOR   the sweep is measured from the fence's resting line, because
 *                that is where the band snaps back to. The ability measures
 *                from the finger, since there is nothing else to measure from.
 *
 * ── What it deliberately does NOT do ───────────────────────────────────────
 *
 * It does not damage destructibles. The Rubber Band ability does, and copying
 * that here would make an unlimited fence type strictly better than a charged
 * ability, and would quietly hand every smash map a second answer that costs
 * nothing. This throws balls. The drill is the fence that breaks things.
 *
 * It also does not cost a charge or carry a meter. The price was already paid
 * when the fence was drawn: Redeploy builds 40% slower than standard, so every
 * cut with it is a longer stretch of unfinished fence for a ball to cross. A
 * spent one is drawn without its grip, which is the whole of the UI it needs.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Wall } from "@/lib/wallGeometry";
import { pointToSegmentDistance, type Vector2 } from "@/lib/polygon";
import { getFenceType } from "@/lib/fences";
import { wallBordersActiveSpaceAt } from "@/lib/physics/cutStart";
import {
  BAND_DEAD_PULL, BAND_FULL_PULL, BAND_MIN_POWER, BAND_MAX_POWER,
  bandVelocity, inBandSweep, type BandShape,
} from "@/lib/rubberBand";

/**
 * How far from a fence a press still counts as grabbing it, in world units.
 *
 * Generous, and on purpose: a fence is six units thick and a fingertip covers
 * far more of the board than that. Missing the grab does not merely fail, it
 * falls through to the cut path and gets refused as "wall in the way", so a
 * near miss reads as the game not understanding the gesture.
 */
export const SLING_GRAB_SLOP = 22;

/** True when this fence is a slingshot that has not been thrown yet. */
export function isLoadedSling(wall: Wall): boolean {
  return getFenceType(wall.fenceTypeId).slingshot && !wall.slingSpent;
}

/**
 * The loaded slingshot fence under a board point, or null.
 *
 * Nearest wins, so two Redeploy fences meeting at a corner grab the one the
 * finger is actually on rather than whichever was drawn first.
 *
 * A fence stranded in captured space is skipped, through the SAME sampling the
 * cut path uses. Player fences are never pruned from game.walls when their
 * region is locked, so an old cut can sit invisible in grey space - and a grab
 * that answered for one would swallow a legal cut the player was starting near
 * nothing they can see. That is the ghost-wall bug, re-entered through a new
 * door.
 */
export function loadedSlingAt(
  game: CanvasGameState, point: Vector2,
): Wall | null {
  let best: Wall | null = null;
  let bestDist = Infinity;
  for (const wall of game.walls) {
    if (!isLoadedSling(wall)) continue;
    const reach = wall.thickness / 2 + SLING_GRAB_SLOP;
    const d = pointToSegmentDistance(point, wall.start, wall.end);
    if (d > reach || d >= bestDist) continue;
    // No grid is not a ghost: unknown must not refuse a grab that is probably
    // legal, and every real board has one.
    if (game.spaceGrid && !wallBordersActiveSpaceAt(point, wall, game.spaceGrid)) continue;
    bestDist = d; best = wall;
  }
  return best;
}

/**
 * Read a pull on a fence into a band.
 *
 * `pull` is the vector from where the finger went down to where it is now, and
 * the throw goes along its REVERSE - the same reading the launcher and the
 * Rubber Band already use, so the third slingshot in the game does not ask the
 * player to learn a fourth gesture.
 *
 * Returns null below the dead zone, which the caller shows as "not a throw yet"
 * rather than as a weak one: a tap on a fence must not spend it.
 */
export function slingShape(wall: Wall, pull: Vector2): BandShape | null {
  const len = Math.hypot(pull.x, pull.y);
  if (!(len > BAND_DEAD_PULL)) return null;

  const heading = { x: -pull.x / len, y: -pull.y / len };
  const centre = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  };
  const t = Math.min(1, (len - BAND_DEAD_PULL) / (BAND_FULL_PULL - BAND_DEAD_PULL));

  return {
    // The band snaps back to the fence, so the sweep is measured from the
    // fence, not from the finger.
    centre,
    heading,
    a: { ...wall.start },
    b: { ...wall.end },
    // Its own length, halved. This is the whole reason halfWidth lives on the
    // shape: the fence IS the band, so the fence's span is the band's span.
    halfWidth: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / 2,
    powerT: t,
    power: BAND_MIN_POWER + t * (BAND_MAX_POWER - BAND_MIN_POWER),
  };
}

/** Every active ball this throw would catch. Drawn live, then thrown. */
export function slingCatches(game: CanvasGameState, shape: BandShape) {
  return game.balls.filter(b => b.state === "active" && inBandSweep(b.position, shape));
}

/**
 * Throw: fling everything the band caught, and spend the fence.
 *
 * Returns false when it caught nothing, and then the fence is NOT spent. The
 * player can see what it would catch while they drag, so an empty release is a
 * change of mind rather than a miss - the same courtesy the Rubber Band and
 * Descope already get, and the one rule that keeps a mis-grab from silently
 * costing a fence the player was saving.
 */
export function fireSlingFence(
  game: CanvasGameState, wall: Wall, shape: BandShape,
): boolean {
  const caught = slingCatches(game, shape);
  if (caught.length === 0) return false;

  for (const ball of caught) {
    ball.velocity = bandVelocity(shape, ball.baseSpeed || 250);
    ball.speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  }

  // The whole CUT is spent, not just the segment that was grabbed. A cut that
  // bounced off a mirror is several Wall segments and one fence; leaving the
  // other segments loaded would hand a bounced cut two throws for the price of
  // one, which is a reward for geometry the player did not choose.
  const cut = wall.cutId;
  for (const w of game.walls) {
    if (w === wall || (cut != null && w.cutId === cut)) w.slingSpent = true;
  }
  return true;
}
