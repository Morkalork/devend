/**
 * The geometry behind the two bend gestures in the map editor.
 *
 * Kept out of MapCanvas because none of it is drawing: it is "where does the
 * handle sit for this bend" and "what bend does a handle dropped here mean",
 * which are a pair of inverse functions and are worth being able to test
 * without a canvas, a pointer event or a React tree.
 *
 * The rule both gestures follow is that the handle sits ON the thing it
 * controls - at the apex of the curve it produces, not at some fixed offset
 * with a slider feel. Grab the middle of a wall, pull, and the wall's middle
 * follows the cursor. That makes the gesture self-describing, and it makes the
 * round trip exact: drop a handle, read the bend back, and the handle is where
 * you left it.
 */
import { bendsAlongX, bendOutline, type BendAxis, type BendFields } from "../bend";
import { normaliseDegrees } from "../bendRotation";
import type { Vector2 } from "../polygon";

/** Anything the editor can bend, reduced to what these functions need. */
export interface BendTarget extends BendFields {
  /** The authored outline, straight, before any bending. */
  points: Vector2[];
}

/** Hard stop on the slider and the drag. Past this a wall folds back through itself. */
export const MAX_BEND = 0.95;

const clampBend = (b: number) => Math.max(-MAX_BEND, Math.min(MAX_BEND, b));

function bounds(points: Vector2[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** The along-axis unit vector and its normal, matching bendVertices exactly. */
export function bendFrame(points: Vector2[], axis: BendAxis = "auto"): { a: Vector2; n: Vector2 } {
  const alongX = bendsAlongX(points, axis);
  const a: Vector2 = alongX ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return { a, n: { x: -a.y, y: a.x } };
}

/**
 * How far the centre of the bar moves, along the normal, at this bend.
 *
 * The centreline becomes an arc of radius R = span / (bend * PI) sweeping
 * bend * PI, so its midpoint stands off the chord by R (1 - cos(sweep / 2)).
 * Monotonic in bend over the usable range, which is what lets the inverse
 * below be a plain bisection.
 */
export function apexOffset(bend: number, span: number): number {
  if (!bend || span <= 0) return 0;
  const theta = bend * Math.PI;
  const R = span / theta;
  return R * (1 - Math.cos(theta / 2));
}

/** Where the whole-object bend handle sits for the bend this target carries. */
export function bendHandlePos(target: BendTarget): Vector2 {
  const { points, bend = 0, bendAxis = "auto" } = target;
  if (points.length === 0) return { x: 0, y: 0 };
  const { cx, cy, minX, maxX, minY, maxY } = bounds(points);
  const { n } = bendFrame(points, bendAxis);
  const span = bendsAlongX(points, bendAxis) ? maxX - minX : maxY - minY;
  const off = apexOffset(bend, span);
  return { x: cx + n.x * off, y: cy + n.y * off };
}

/**
 * The bend a handle dropped at `world` means.
 *
 * Bisection rather than algebra: apexOffset has no clean inverse, and a
 * closed-form approximation would put the handle somewhere other than where the
 * cursor was let go, which is exactly the sort of small lie that makes an
 * editor feel unreliable. Fifty halvings of [-MAX, MAX] is far below a pixel
 * and costs nothing at pointer-move rates.
 */
export function bendFromHandle(target: BendTarget, world: Vector2): number {
  const { points, bendAxis = "auto" } = target;
  if (points.length === 0) return 0;
  const { cx, cy, minX, maxX, minY, maxY } = bounds(points);
  const { n } = bendFrame(points, bendAxis);
  const span = bendsAlongX(points, bendAxis) ? maxX - minX : maxY - minY;
  if (span <= 0) return 0;

  // Signed distance the cursor sits along the normal from the object's centre.
  const want = (world.x - cx) * n.x + (world.y - cy) * n.y;

  // apexOffset is odd in bend, so solve on the magnitude and put the sign back.
  const sign = want < 0 ? -1 : 1;
  const goal = Math.abs(want);
  let lo = 0, hi = MAX_BEND;
  if (apexOffset(hi, span) <= goal) return sign * MAX_BEND;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (apexOffset(mid, span) < goal) lo = mid; else hi = mid;
  }
  return clampBend(sign * (lo + hi) / 2);
}

/** The edge from point i to point i+1, wrapping. */
function edgeOf(points: Vector2[], i: number): { a: Vector2; b: Vector2 } {
  return { a: points[i], b: points[(i + 1) % points.length] };
}

/**
 * Where edge i's curve handle sits.
 *
 * curveEdge pushes its control point 2 * bow * len along the edge's left
 * normal, and a quadratic reaches half its control offset at the midpoint, so
 * the curve's apex lands exactly bow * len out. Putting the handle there makes
 * this pair exact rather than approximate.
 */
export function curveHandlePos(points: Vector2[], i: number, curve: number): Vector2 {
  const { a, b } = edgeOf(points, i);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Left normal, unnormalised: multiplying by `curve` already scales by length.
  return { x: mid.x + -(b.y - a.y) * curve, y: mid.y + (b.x - a.x) * curve };
}

/** The curve value for edge i implied by a handle dropped at `world`. Exact inverse. */
export function curveFromHandle(points: Vector2[], i: number, world: Vector2): number {
  const { a, b } = edgeOf(points, i);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return 0;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return ((world.x - mid.x) * -dy + (world.y - mid.y) * dx) / len2;
}

/**
 * A curves array with entry i replaced, padded to the polygon's edge count.
 *
 * Returns undefined when everything lands back on zero, so an edge curved and
 * then straightened again leaves no trace in map.yml rather than a row of
 * zeroes on every polygon anyone ever touched.
 */
export function withCurve(
  curves: number[] | undefined, edgeCount: number, i: number, value: number,
): number[] | undefined {
  const next = Array.from({ length: edgeCount }, (_, k) => curves?.[k] ?? 0);
  next[i] = value;
  return next.some(c => Math.abs(c) > 1e-6) ? next : undefined;
}

/** The outline the editor should draw: what the game will actually build. */
export function previewOutline(target: BendTarget): Vector2[] {
  return bendOutline(target.points, target);
}

// ── Turning ────────────────────────────────────────────────────────────────

/**
 * How far the turn knob sits outside the shape, as a fraction of its half-size.
 *
 * Outside rather than on it, because a turn handle ON the object competes with
 * the move handle, the resize handles and the bend handle, all of which already
 * live inside its footprint. A knob on a stalk is how every editor draws this
 * and it is what makes the gesture obvious without a label.
 */
const KNOB_STANDOFF = 1.45;
/** Never closer than this to the centre, so a tiny object still gets a usable arm. */
const KNOB_MIN_ARM = 46;

/** Where the turn knob sits for a shape at this angle. */
export function anglePivot(points: Vector2[]): Vector2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function angleHandlePos(points: Vector2[], angleDegrees = 0): Vector2 {
  const c = anglePivot(points);
  if (points.length === 0) return c;
  let maxY = -Infinity, minY = Infinity;
  for (const p of points) {
    if (p.y > maxY) maxY = p.y;
    if (p.y < minY) minY = p.y;
  }
  // Straight up from the centre at angle 0, then carried round by the angle -
  // so the knob is always on the same corner of the object, and its position
  // reads the current rotation at a glance.
  const arm = Math.max(KNOB_MIN_ARM, ((maxY - minY) / 2) * KNOB_STANDOFF);
  const rad = (angleDegrees * Math.PI) / 180;
  return { x: c.x + Math.sin(rad) * arm, y: c.y - Math.cos(rad) * arm };
}

/**
 * The angle a knob dropped at `world` means, in degrees clockwise.
 *
 * Measured from straight up, matching angleHandlePos, so the pair round-trips.
 * `snapDegrees` quantises it - the editor passes 15 while snap-to-grid is on,
 * which is what makes a deliberate right angle actually land on 90 instead of
 * 89.6.
 */
export function angleFromHandle(
  points: Vector2[], world: Vector2, snapDegrees = 0,
): number {
  // No shape, no angle. Without this the pivot defaults to the origin and a
  // drop anywhere returns a confident bearing from (0, 0).
  if (points.length === 0) return 0;
  const c = anglePivot(points);
  const dx = world.x - c.x, dy = world.y - c.y;
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const snapped = snapDegrees > 0 ? Math.round(deg / snapDegrees) * snapDegrees : deg;
  return normaliseDegrees(Math.round(snapped * 10) / 10);
}
