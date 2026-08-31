/**
 * Carrying a bend through the four map orientations.
 *
 * A map is dealt in one of four rotations, and a bent wall has to come out
 * looking like the same wall, just turned. The vertices take care of themselves
 * - rotatePoint moves them - but `bend` is not a coordinate. It is a signed
 * amount measured against an axis the shape derives from its OWN bounds, and
 * both the axis and the sign move underneath it when the map turns.
 *
 * The convention this has to preserve, from bend.ts:
 *
 *   axis a = +x when the shape is wider than tall, else +y
 *   normal n = a turned a quarter turn: (0,+1) for a = +x, (-1,0) for a = +y
 *   a positive bend bows toward n
 *
 * So the rule is: rotate the bow vector, work out the rotated shape's new
 * canonical normal, and take the sign of one against the other. Doing that by
 * hand for all eight cases is where this went wrong the first time - a table
 * derived only for wide shapes looked consistent until two 90-degree turns
 * disagreed with one 180. It depends on the shape's orientation as well as the
 * rotation, so both are arguments here, and the commutation test in
 * bendRotation.test.ts is what actually holds it honest.
 */
import type { MapRotation } from "./mapRotation";
import type { BendAxis } from "./bend";

/**
 * How `bend` changes when the map turns.
 *
 * `alongX` describes the bend BEFORE rotation: true when the bow runs along x.
 * That is what bendsAlongX reports, which means an explicit bendAxis decides it
 * and only "auto" falls back to "are the bounds wider than tall". Keying this
 * on the bounds alone is a bug the commutation test catches: bendAxis "y" on a
 * wide bar is precisely the case the two disagree about.
 *
 * Read the rows as [r=0, r=1, r=2, r=3] where r=1 is a left turn and r=3 a
 * right turn, matching rotatePoint.
 */
const SIGN: Record<"alongX" | "alongY", readonly [1 | -1, 1 | -1, 1 | -1, 1 | -1]> = {
  //       r0  r1  r2  r3
  alongX: [+1, -1, -1, +1],
  alongY: [+1, +1, -1, -1],
};

/** The bend a rotated copy of this shape should carry. */
export function rotateBend(
  bend: number | undefined, alongX: boolean, r: MapRotation,
): number | undefined {
  if (bend === undefined || bend === 0 || r === 0) return bend;
  return bend * SIGN[alongX ? "alongX" : "alongY"][r];
}

/**
 * The axis a rotated copy should carry.
 *
 * "auto" stays "auto": it re-reads the rotated shape's own bounds and is
 * therefore already correct. An explicit axis is a direction, so a quarter turn
 * in either direction swaps it.
 */
export function rotateBendAxis(
  axis: BendAxis | undefined, r: MapRotation,
): BendAxis | undefined {
  if (axis === undefined || axis === "auto" || r === 0 || r === 2) return axis;
  return axis === "x" ? "y" : "x";
}

/**
 * Per-edge curves under rotation: unchanged, and that is a result, not an
 * oversight.
 *
 * curveEdge offsets its control point along the edge's left normal,
 * perp(d) = (-d.y, d.x). perp is itself a quarter turn, and rotations commute,
 * so perp(R d) = R perp(d): the normal turns with its edge and the bow keeps
 * both its magnitude and its sign. All four of rotatePoint's orientations are
 * proper rotations (determinant +1, no reflection), which is what that argument
 * needs and is worth stating because it is the whole reason this is identity.
 *
 * The first version negated on the quarter turns by analogy with `bend`, and
 * the commutation test rejected it immediately. Kept as a named function rather
 * than dropped: if a mirrored orientation is ever added, its determinant is -1,
 * perp anti-commutes, and this is where the negation would belong.
 */
export function rotateCurves(
  curves: number[] | undefined, _r: MapRotation,
): number[] | undefined {
  return curves;
}
