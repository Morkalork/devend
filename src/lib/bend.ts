/**
 * Bending walls and objects.
 *
 * Two authoring gestures, one primitive underneath.
 *
 *   BEND  bows a whole object along an arc. A long straight wall becomes a
 *         banana. One signed number on the entity.
 *   CURVE bows a single edge of a polygon outline, the way a path tool lets you
 *         pull a straight segment into a curve. One signed number per edge.
 *
 * Both come out as ordinary polygon vertices, which is the entire reason this
 * is cheap: every shape in the game is already reduced to `Polygon { vertices }`
 * before physics or rendering sees it, and a circle is a 64-sided one. Nothing
 * downstream needs to learn what a curve is.
 *
 * -- Why an arc warp and not a shear ----------------------------------------
 *
 * The obvious way to bow a shape is to push each vertex sideways by a parabola
 * of its position along the axis. It is three lines and it is wrong for walls:
 * the displacement is purely perpendicular, so a bar's thickness stays measured
 * along the ORIGINAL perpendicular rather than the curve's. The ends, where the
 * curve is steepest, come out visibly thinner than the middle - on a wall bent
 * hard enough to be worth bending, the taper is the first thing you see.
 *
 * So this maps each point through a true bend deformer instead: a point at
 * distance v from the axis lands at radius (R - v) about a bend centre. Two
 * points either side of the axis stay exactly their original distance apart, so
 * a wall keeps its thickness all the way round the arc, and the end caps rotate
 * to face along the curve rather than staying stubbornly axis-aligned.
 */
import type { Vector2 } from "./polygon";

/**
 * Turning an object on the spot.
 *
 * Stored in DEGREES, and stored as a parameter for the same reason a bend is:
 * baking a turned rect into four rotated points would cost it its width and
 * height, so it could never be resized, re-turned, or read in map.yml as the
 * rect it still is. Positive turns clockwise on screen, matching how every
 * other angle in this codebase reads with y pointing down.
 *
 * Applied LAST, after the bend, and that order matters. A bend runs along the
 * shape's own long axis, so bending first and turning after gives "a bent bar,
 * turned" - which is what a designer means. Turning first would make the bend
 * axis follow the new orientation and the two controls would fight: nudging the
 * angle would silently re-aim the bow.
 */
export function turnOutline(vertices: Vector2[], degrees: number | undefined): Vector2[] {
  if (!degrees || vertices.length === 0) return vertices.map(v => ({ ...v }));
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  // About the bounds centre, so an object turns on the spot rather than
  // swinging away from wherever the origin happens to be.
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  return vertices.map(p => {
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

/** True when an angle would actually turn something. */
export function hasAngle(degrees: number | undefined | null): boolean {
  return !!degrees && Math.abs(degrees % 360) > 1e-6;
}

/** Which way the object bows. "auto" reads the longer side of its bounds. */
export type BendAxis = "auto" | "x" | "y";

/** Fields an entity carries to describe its bending. All optional, all absent = straight. */
export interface BendFields {
  /**
   * Whole-object bow, signed. 1 wraps the object through a half circle, so the
   * useful range is well inside +/-0.6 and the editor clamps there.
   */
  bend?: number;
  /** Axis the bow runs along. Defaults to the longer side of the bounds. */
  bendAxis?: BendAxis;
  /**
   * Per-edge bows, parallel to a polygon's `points`: entry i bows the edge from
   * point i to point i+1, as a fraction of that edge's length. Shorter arrays
   * are fine; missing entries are 0.
   */
  curves?: number[];
  /** Whole-object turn in degrees, clockwise. Applied after the bend. */
  angle?: number;
}

/** Below this the arc is indistinguishable from a straight line, and R explodes. */
const STRAIGHT_EPSILON = 1e-4;

/** World units per tessellated segment. Fine enough to read as a curve at any zoom. */
const SEGMENT_WORLD = 9;
/** Guards against a huge edge turning into thousands of vertices. */
const MAX_SEGMENTS = 48;

const sub = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vector2, b: Vector2): number => a.x * b.x + a.y * b.y;

/**
 * How many pieces an edge of this length becomes.
 *
 * Density is ours to choose precisely because the bend is stored as a parameter
 * and resolved at load: nothing is baked into map.yml, so this can change later
 * without rewriting a single map.
 */
export function segmentsFor(length: number): number {
  if (!(length > 0)) return 1;
  return Math.max(1, Math.min(MAX_SEGMENTS, Math.round(length / SEGMENT_WORLD)));
}

/** True when this shape's bow should run along x. Reads the bounds when told "auto". */
export function bendsAlongX(vertices: Vector2[], axis: BendAxis = "auto"): boolean {
  if (axis === "x") return true;
  if (axis === "y") return false;
  if (vertices.length === 0) return true;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  // Ties go to x, so a square is never ambiguous and never flips between runs.
  return (maxX - minX) >= (maxY - minY);
}

/**
 * One edge, bowed into a quadratic arc and tessellated.
 *
 * Returns the points from `a` up to but NOT including `b`, so edges can be
 * concatenated around an outline without every shared corner appearing twice.
 * `bow` is a fraction of the edge's own length, which keeps a curve looking the
 * same on a short edge and a long one.
 */
export function curveEdge(a: Vector2, b: Vector2, bow: number): Vector2[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!bow || len <= 0) return [{ ...a }];

  // Control point pushed off the midpoint along the edge's left normal. A
  // quadratic reaches half its control offset at the midpoint, hence the 2x.
  const cx = (a.x + b.x) / 2 + -dy * bow * 2;
  const cy = (a.y + b.y) / 2 + dx * bow * 2;

  // Rounded up to even so t = 0.5 is always sampled. The apex is the whole
  // point of a bowed edge, and an odd count straddles it: at 11 segments the
  // nearest samples sit at 5/11 and 6/11 and the curve visibly flattens where
  // it should be most pronounced.
  const n = segmentsFor(len) + (segmentsFor(len) % 2);
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, s = 1 - t;
    out.push({
      x: s * s * a.x + 2 * s * t * cx + t * t * b.x,
      y: s * s * a.y + 2 * s * t * cy + t * t * b.y,
    });
  }
  return out;
}

/**
 * Walk an outline, bowing whichever edges have a curve and splitting the rest.
 *
 * The straight edges get subdivided too, and that is not waste: a whole-object
 * bend can only bow an outline it has points to bow. Four rect corners warped
 * through an arc give a trapezoid, not a banana.
 */
export function applyEdgeCurves(
  vertices: Vector2[], curves: number[] | undefined, subdivideStraight: boolean,
): Vector2[] {
  if (vertices.length < 2) return vertices.map(v => ({ ...v }));
  const out: Vector2[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const bow = curves?.[i] ?? 0;
    if (bow) {
      out.push(...curveEdge(a, b, bow));
    } else if (subdivideStraight) {
      const n = segmentsFor(Math.hypot(b.x - a.x, b.y - a.y));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    } else {
      out.push({ ...a });
    }
  }
  return out;
}

/**
 * Bow every vertex around an arc.
 *
 * Local frame: `a` runs along the bend axis, `n` is a quarter turn from it, and
 * both u (along) and v (across) are measured from the bounds centre. A point at
 * (u, v) lands on the circle of radius (R - v) at angle u/R, which is what
 * preserves thickness - see the note at the top of the file.
 */
export function bendVertices(
  vertices: Vector2[], bend: number, axis: BendAxis = "auto",
): Vector2[] {
  if (!bend || Math.abs(bend) < STRAIGHT_EPSILON || vertices.length === 0) {
    return vertices.map(v => ({ ...v }));
  }
  const alongX = bendsAlongX(vertices, axis);
  const a: Vector2 = alongX ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const n: Vector2 = { x: -a.y, y: a.x };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const centre: Vector2 = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const span = alongX ? maxX - minX : maxY - minY;
  if (span <= 0) return vertices.map(v => ({ ...v }));

  // bend 1 == a half turn, so the arc's total sweep is bend * PI. Negated so
  // that a positive bend bellies toward +n; see the re-anchoring below, which
  // flips which end of the shape does the moving.
  const theta = -bend * Math.PI;
  const R = span / theta;

  /**
   * Where the ENDS would land without re-anchoring, and the whole reason this
   * subtraction exists.
   *
   * The bare arc map holds the middle of the shape fixed and swings both ends
   * round it. That is a correct bend and completely wrong for authoring a
   * level: a wall placed to span a gap, given a bend, pulls both its ends away
   * from the gap while its middle sits where it was. You cannot aim it, and a
   * handle on the middle would have nothing to drag, because the middle is the
   * one point that does not move.
   *
   * Subtracting the endpoint offset re-anchors the arc onto its own chord:
   * the ends stay on the line the shape was authored along and the belly bows
   * out, which is what bending a bar held at both ends looks like and what a
   * designer means by "bend this wall". It also makes the handle honest, since
   * the belly is now a point that actually tracks the cursor.
   *
   * The chord is shorter than the original span, and that is not a bug: the
   * arc keeps its length, so it spans less. A bent wall is a shorter wall.
   */
  const endOffset = R * (1 - Math.cos(theta / 2));

  return vertices.map(p => {
    const d = sub(p, centre);
    const u = dot(d, a);
    const v = dot(d, n);
    const th = u / R;
    const r = R - v;
    const nu = r * Math.sin(th);
    const nv = R - r * Math.cos(th) - endOffset;
    return {
      x: centre.x + nu * a.x + nv * n.x,
      y: centre.y + nu * a.y + nv * n.y,
    };
  });
}

/**
 * Split every edge down to SEGMENT_WORLD, leaving the outline where it is.
 *
 * A bow can only curve an outline it has points to curve: four rect corners
 * warped through an arc give a trapezoid, not a banana.
 */
export function subdivideOutline(vertices: Vector2[]): Vector2[] {
  return applyEdgeCurves(vertices, undefined, true);
}

/**
 * Step one of two: shape the silhouette, in the object's own straight frame.
 *
 * `curves` is indexed against the AUTHORED points, so this has to run before
 * anything else adds vertices - which is why it is separate from the bow rather
 * than one call. Cheap no-op when nothing is curved.
 */
export function shapeOutline(vertices: Vector2[], curves: number[] | undefined): Vector2[] {
  if (!curves?.some(c => !!c)) return vertices.map(v => ({ ...v }));
  return applyEdgeCurves(vertices, curves, false);
}

/**
 * Step two of two: carry the finished silhouette round the arc.
 *
 * Subdivides first, so it does not care how many vertices its input happens to
 * have. That matters because variety decoration runs in between: it adds a few
 * bumps per edge, nowhere near enough to bow smoothly, and it SKIPS any edge
 * under 20 units - so bowing before it would leave every bent wall silently
 * undecorated while every straight one kept its texture.
 */
export function bowOutline(
  vertices: Vector2[], bend: number | undefined, axis: BendAxis = "auto",
): Vector2[] {
  if (!bend || Math.abs(bend) < STRAIGHT_EPSILON) return vertices.map(v => ({ ...v }));
  return bendVertices(subdivideOutline(vertices), bend, axis);
}

/**
 * Both steps back to back, for previews and tests.
 *
 * The load path deliberately does NOT use this - it needs to run decoration
 * between the two halves. Kept so the editor can show what a bend will look
 * like without reimplementing the order and getting it subtly different.
 */
export function bendOutline(vertices: Vector2[], fields: BendFields): Vector2[] {
  const { bend = 0, bendAxis = "auto", curves, angle } = fields;
  return turnOutline(bowOutline(shapeOutline(vertices, curves), bend, bendAxis), angle);
}

/** True when an entity carries any bending at all - the cheap early-out. */
export function hasBend(fields: BendFields | undefined | null): boolean {
  if (!fields) return false;
  const bending = !!fields.bend && Math.abs(fields.bend) >= STRAIGHT_EPSILON;
  return bending || !!fields.curves?.some(c => !!c) || hasAngle(fields.angle);
}
