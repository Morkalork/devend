/**
 * Bent fences (issue #66): a cut whose SHAPE is the line you drew.
 *
 * A straight cut is a point and a direction, and the fence is that direction
 * cast to the walls in both senses. A bent cut keeps the whole drag: the path
 * you traced becomes fence exactly as drawn, and the two loose ends are
 * extended along the tangents of the first and last strokes until they anchor.
 * That is what the sketch on the issue shows - a black line the player drew and
 * a grey continuation the game projected off both ends.
 *
 * The bent path plugs straight into the EXISTING growth model, which is why
 * this is a small file. A GrowingWall already carries `startWaypoints` and
 * `endWaypoints`, multi-segment paths built for mirror reflections; growth,
 * rendering, rasterisation, circuits and charge all walk those arrays and do
 * not care where the bends came from. A bend the player drew and a bounce off
 * a mirror are the same object downstream.
 *
 * The whole path must stay inside the region the cut started in. A drag that
 * wanders across a boundary describes a fence that is partly somewhere it could
 * never have been drawn, so it is rejected here and the caller falls back to
 * the straight cut between the same two fingers.
 */
import type { Vector2 } from "@/types/game";
import { vec2Distance, vec2Normalize, vec2Sub, pointToSegmentDistance } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";
import { isPositionActive } from "@/lib/spaceGrid";
import { findRegionContainingPoint } from "@/lib/gameUtils";

/**
 * How far a sample must sit off the straight line before it counts as a bend,
 * in world units. Below this a wobbly finger is a straight cut, which is what
 * the player meant: nobody draws a perfect line and nobody wants a fence with
 * fourteen 2-degree kinks in it.
 */
export const BEND_TOLERANCE = 26;

/**
 * Shortest a drawn segment may be. Two vertices closer than this describe a
 * corner rather than a stroke; the shorter one is dropped so a bend is always
 * something the player can see and aim.
 */
export const MIN_SEGMENT_LENGTH = 40;

/**
 * Sharpest corner the fence will take, in degrees of turn (180 = doubling back).
 * A fence that folds onto itself does not enclose anything and rasterises into
 * a smear, so an over-sharp corner is refused rather than clamped: clamping
 * would silently draw a shape the player did not trace.
 */
export const MAX_TURN_DEGREES = 100;

/**
 * Ramer-Douglas-Peucker: the smallest subset of `points` that stays within
 * `tolerance` of the original path. Endpoints are always kept.
 */
export function simplifyPath(points: Vector2[], tolerance: number): Vector2[] {
  if (points.length <= 2) return [...points];

  const first = points[0];
  const last = points[points.length - 1];
  let worst = 0;
  let worstIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i], first, last);
    if (d > worst) { worst = d; worstIndex = i; }
  }
  if (worst <= tolerance) return [first, last];

  const left = simplifyPath(points.slice(0, worstIndex + 1), tolerance);
  const right = simplifyPath(points.slice(worstIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Turn at vertex `i`, in degrees. 0 = straight on, 180 = doubling back. */
function turnDegrees(a: Vector2, b: Vector2, c: Vector2): number {
  const inDir = vec2Normalize(vec2Sub(b, a));
  const outDir = vec2Normalize(vec2Sub(c, b));
  const dot = Math.max(-1, Math.min(1, inDir.x * outDir.x + inDir.y * outDir.y));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Reduce a raw drag to the polyline the fence will be drawn as: at most
 * `maxBends` corners, no segment shorter than MIN_SEGMENT_LENGTH.
 *
 * Returns null when the drag does not describe a usable path at all (too few
 * samples, no length, or a corner sharper than MAX_TURN_DEGREES). A null is the
 * caller's cue to fall back to the straight cut, never to refuse the gesture:
 * a player who drew something the fence cannot follow still swiped, and still
 * gets the fence a swipe has always given.
 */
export function drawnFencePath(raw: Vector2[], maxBends: number): Vector2[] | null {
  if (maxBends <= 0 || raw.length < 2) return null;

  let path = simplifyPath(raw, BEND_TOLERANCE);
  if (path.length < 2) return null;

  // Drop runt segments by removing the vertex that creates them, working from
  // the inside out so the two endpoints (which anchor the projection tangents)
  // always survive.
  for (let i = 1; i < path.length - 1; ) {
    const tooShort =
      vec2Distance(path[i - 1], path[i]) < MIN_SEGMENT_LENGTH ||
      vec2Distance(path[i], path[i + 1]) < MIN_SEGMENT_LENGTH;
    if (tooShort) path.splice(i, 1);
    else i++;
  }
  // A whole path shorter than one segment is a tap, not a stroke.
  if (path.length === 2 && vec2Distance(path[0], path[1]) < MIN_SEGMENT_LENGTH) return null;

  // Budget: keep the corners that bend the most, since those are the ones the
  // player was aiming. Removing the flattest first leaves the drawn intent
  // recognisable at any budget.
  while (path.length - 2 > maxBends) {
    let flattest = 1;
    let flattestTurn = Infinity;
    for (let i = 1; i < path.length - 1; i++) {
      const turn = turnDegrees(path[i - 1], path[i], path[i + 1]);
      if (turn < flattestTurn) { flattestTurn = turn; flattest = i; }
    }
    path.splice(flattest, 1);
  }

  // Straight after all that: not a bent cut, let the caller do what it always did.
  if (path.length < 3) return null;

  for (let i = 1; i < path.length - 1; i++) {
    if (turnDegrees(path[i - 1], path[i], path[i + 1]) > MAX_TURN_DEGREES) return null;
  }

  path = path.map((p) => ({ x: p.x, y: p.y }));
  return path;
}

/**
 * Join a drawn path to the projection cast off its far end.
 *
 * `cast[0]` is the drawn path's last point (castRayWithReflections always
 * starts its waypoints at the origin it was given), so it is dropped rather
 * than repeated: a duplicated waypoint is a zero-length segment, and the growth
 * loop reads a zero-length segment as "already arrived".
 */
export function joinProjection(drawn: Vector2[], cast: Vector2[]): Vector2[] {
  return [...drawn.map((p) => ({ x: p.x, y: p.y })), ...cast.slice(1).map((p) => ({ x: p.x, y: p.y }))];
}

/** Direction the fence leaves the far end of the drawn path in. */
export function outgoingDirection(path: Vector2[]): Vector2 {
  return vec2Normalize(vec2Sub(path[path.length - 1], path[path.length - 2]));
}

/** Direction the fence leaves the near end of the drawn path in (backwards). */
export function incomingDirection(path: Vector2[]): Vector2 {
  return vec2Normalize(vec2Sub(path[0], path[1]));
}

/**
 * The polyline the cut in progress should follow, or null for the straight cut.
 *
 * Null covers four cases that all mean the same thing to the player - the swipe
 * does what a swipe has always done - so none of them refuses the gesture: no
 * bent-fence loadout, a drag that was straight after all, a drag the fence
 * cannot follow (see MAX_TURN_DEGREES), and a drag that wandered out of the
 * region it started in.
 *
 * That last one is the only check that needs the board. A cut may only START in
 * live space inside one region; a bent one is DRAWN across whatever the finger
 * passed over, so a path that leaves the region describes a fence in a place no
 * cut could have been started, and the region maths downstream has no meaning
 * for it.
 *
 * Takes the whole game state rather than a path and a budget because BOTH the
 * input handler and the cut preview call it, and those two disagreeing is the
 * one bug this feature could not survive: a preview drawing a straight line for
 * a fence that lands bent is worse than no preview at all.
 */
export function bentDrawnPath(game: CanvasGameState): Vector2[] | null {
  const budget = Math.max(0, Math.round(game.bentFenceBends ?? 0));
  if (budget <= 0) return null;

  const samples = [...(game.swipePath ?? [])];
  const tip = game.currentSwipePos;
  const last = samples[samples.length - 1];
  if (tip && (!last || last.x !== tip.x || last.y !== tip.y)) samples.push({ x: tip.x, y: tip.y });

  const path = drawnFencePath(samples, budget);
  if (!path) return null;

  for (const point of path) {
    if (!isPositionActive(game.spaceGrid, point)) return null;
    if (findRegionContainingPoint(game.regions, point.x, point.y)?.id !== game.swipeRegionId) return null;
  }
  return path;
}
