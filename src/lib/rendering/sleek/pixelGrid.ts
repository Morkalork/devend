/**
 * Pixel discipline: crisp on axis, smooth on the diagonal.
 *
 * THE SETUP. The Pixi surface is created with `resolution: 1` over a canvas
 * that GameCanvas already sized in PHYSICAL pixels, so this renderer's
 * coordinate space IS the device-pixel grid: `Math.round(x)` lands exactly on a
 * hardware pixel boundary. That is the whole reason this can be exact.
 *
 * THE RULE.
 * - AXIS-ALIGNED geometry (board edges, rect obstacles, straight fences, the
 *   grid lattice, panel borders) is snapped so its edges fall on integer device
 *   pixels. A 1px line then lights exactly one row of pixels: no 2px grey smear,
 *   no shimmer as it moves.
 * - DIAGONALS AND CURVES are deliberately NOT snapped. Rounding a diagonal's
 *   endpoints quantises its slope, which is what produces uneven runs and the
 *   visible breaks along a slanted fence. Left alone at native resolution with
 *   MSAA, the same edge resolves as one continuous line.
 *
 * The failure this replaces: the old board grid stamped every cell with its own
 * `Math.round`ed rect (GameCanvas.paintBoardGrid), so a diagonal boundary was a
 * staircase of independently-rounded squares - adjacent cells rounding opposite
 * ways is exactly the "clear pixel break" in a diagonal line.
 */

/** Anything within this many pixels of axis-aligned counts as axis-aligned. */
const AXIS_EPSILON = 0.35;

/** True when a segment is (near enough) horizontal or vertical to snap. */
export function isAxisAligned(x1: number, y1: number, x2: number, y2: number): boolean {
  return Math.abs(x1 - x2) <= AXIS_EPSILON || Math.abs(y1 - y2) <= AXIS_EPSILON;
}

/** Snap a fill boundary to the nearest device-pixel edge. */
export function snapEdge(v: number): number {
  return Math.round(v);
}

/**
 * Place a stroke's CENTRELINE so its painted edges land on pixel boundaries.
 * An odd-width stroke must sit on a half-pixel (its 1px straddles one row); an
 * even-width stroke must sit on a whole one. Getting this backwards is the
 * classic cause of a "1px" line rendering as two grey rows.
 */
export function snapStroke(v: number, width: number): number {
  const w = Math.max(1, Math.round(width));
  return w % 2 === 1 ? Math.round(v - 0.5) + 0.5 : Math.round(v);
}

/** Round a stroke width to a whole number of device pixels (never below 1). */
export function snapWidth(width: number): number {
  return Math.max(1, Math.round(width));
}

export interface SnappedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Snap a rect so all four edges land on pixel boundaries. Snapping the far
 * edges (rather than rounding x/y then w/h independently) keeps the rect from
 * drifting a pixel wider or narrower as it moves.
 */
export function snapRect(x: number, y: number, w: number, h: number): SnappedRect {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + w);
  const y1 = Math.round(y + h);
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Snap a segment for stroking IF it is axis-aligned, otherwise hand it back
 * untouched for the antialiaser. This is the one function every layer should
 * call before stroking a line, so the crisp/smooth split is applied uniformly
 * instead of being re-decided (and re-fumbled) per layer.
 */
export function snapSegment(a: Pt, b: Pt, strokeWidth: number): { a: Pt; b: Pt } {
  if (!isAxisAligned(a.x, a.y, b.x, b.y)) return { a, b };
  const horizontal = Math.abs(a.y - b.y) <= AXIS_EPSILON;
  if (horizontal) {
    const y = snapStroke((a.y + b.y) / 2, strokeWidth);
    return { a: { x: Math.round(a.x), y }, b: { x: Math.round(b.x), y } };
  }
  const x = snapStroke((a.x + b.x) / 2, strokeWidth);
  return { a: { x, y: Math.round(a.y) }, b: { x, y: Math.round(b.y) } };
}

/**
 * Snap a polygon's axis-aligned RUNS while leaving diagonal ones alone.
 *
 * Traced contours (region boundaries, lock pockets) are mostly long axis runs
 * with occasional diagonal joins. Snapping a vertex only when BOTH its edges
 * agree on an axis keeps the straight stretches razor sharp without quantising
 * the slopes that connect them.
 */
export function snapContour(points: Pt[]): Pt[] {
  const n = points.length;
  if (n < 3) return points;
  const out: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const inH = Math.abs(prev.y - cur.y) <= AXIS_EPSILON;
    const inV = Math.abs(prev.x - cur.x) <= AXIS_EPSILON;
    const outH = Math.abs(next.y - cur.y) <= AXIS_EPSILON;
    const outV = Math.abs(next.x - cur.x) <= AXIS_EPSILON;
    out[i] = {
      // Snap an axis only when the vertex is a corner between two runs that
      // both respect it; a vertex on a diagonal keeps its exact position.
      x: (inV && outH) || (inH && outV) || (inV && outV) ? Math.round(cur.x) : cur.x,
      y: (inH && outV) || (inV && outH) || (inH && outH) ? Math.round(cur.y) : cur.y,
    };
  }
  return out;
}
