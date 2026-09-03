/**
 * What shape a level entity actually IS, once its bend and turn are applied.
 *
 * An entity is authored as an axis-aligned rect (or a circle, or a point list)
 * and then deformed: `curves` bows its edges, `bend` arcs the whole body, and
 * `angle` turns it. Anything reasoning about where an obstacle sits has to ask
 * for the deformed outline, because the authored numbers stop describing the
 * object the moment any of those fields is set.
 *
 * ── Why this exists as a shared function ───────────────────────────────────
 *
 * It has been got wrong three times, in three places, the same way each time.
 * The launcher's runway read `facing` and missed that a canted barrel fires
 * somewhere else. The map editor's bumper rings were drawn on the authored
 * centre and sat off any obstacle that had been bowed. And a map guard compared
 * authored rectangles to decide whether one solid was buried inside another,
 * which failed a perfectly good level-6 layout: a wall bowed at 0.428 and a
 * barrel turned -120 degrees overlap as rectangles by 25x50 units and do not
 * touch at all as shapes.
 *
 * The runtime has never had this problem, because initGame builds a polygon and
 * measures THAT - "the polygon is what the ball actually hits". This is the same
 * idea for the design-time tools, in one place, so the fourth caller does not
 * have to rediscover it.
 */
import { bendOutline, hasBend, hasAngle } from "@/lib/bend";
import type { Vector2 } from "@/types/game";

/** Axis-aligned bounds. */
export interface OutlineBounds { x0: number; y0: number; x1: number; y1: number }

/** The authored fields any of these shapes may carry. */
export interface OutlineSource {
  shape?: string;
  x?: number; y?: number; width?: number; height?: number;
  cx?: number; cy?: number; radius?: number;
  points?: Array<[number, number]>;
  bend?: number;
  bendAxis?: "auto" | "x" | "y";
  curves?: number[];
  angle?: number;
}

/** Segments used to stand a circle in as a polygon. Matches the map editor. */
const CIRCLE_SEGMENTS = 64;

/** The entity's corner points BEFORE any deformation. */
export function authoredPoints(e: OutlineSource): Vector2[] {
  if (e.shape === "circle" && typeof e.cx === "number"
      && typeof e.cy === "number" && typeof e.radius === "number") {
    const { cx, cy, radius } = e;
    return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
    });
  }
  if (e.shape === "polygon" && e.points) {
    return e.points.map(([x, y]) => ({ x, y }));
  }
  if (typeof e.x === "number" && typeof e.y === "number"
      && typeof e.width === "number" && typeof e.height === "number") {
    const { x, y, width: w, height: h } = e;
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  }
  return [];
}

/**
 * The entity's outline as it will actually be built.
 *
 * Falls back to the authored points when nothing deforms the shape, which keeps
 * an unbent map measuring exactly as it always did.
 */
export function entityOutline(e: OutlineSource): Vector2[] {
  const points = authoredPoints(e);
  if (points.length === 0) return points;
  if (!hasBend(e) && !hasAngle(e.angle)) return points;
  return bendOutline(points, {
    bend: e.bend, bendAxis: e.bendAxis, curves: e.curves, angle: e.angle,
  });
}

/**
 * Axis-aligned bounds of the real outline, or null for a shape with no
 * geometry to measure.
 *
 * Still a bounding box, and that is a deliberate limit: it is the same model
 * the map guards already use, and it errs toward reporting a clash that is not
 * quite there rather than missing one that is. What it fixes is the far bigger
 * error of measuring a box the object left behind.
 */
export function entityOutlineBounds(e: OutlineSource): OutlineBounds | null {
  const pts = entityOutline(e);
  if (pts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}
