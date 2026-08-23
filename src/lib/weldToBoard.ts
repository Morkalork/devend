/**
 * Keeping an obstacle attached to the wall it was authored against.
 *
 * A rect authored flush to the play boundary does not stay flush. Variety
 * jitters its width and height around the CENTRE (varietySystem), so an edge
 * placed deliberately on the wall drifts inward or outward by whatever the seed
 * draws, and the common result is a thin sliver of board between an obstacle
 * and the frame. It reads as a mistake because it is one: the author put that
 * edge on the wall on purpose, and the decoration had no way to know.
 *
 * Both edges of an axis get the same treatment, and the fix is to re-pin rather
 * than to widen a tolerance: an edge that was authored ON the boundary (or past
 * it) goes back exactly where it was, and the variation is absorbed entirely by
 * the opposite edge. The obstacle still varies, it just cannot come unstuck.
 *
 * Deliberately applied to the shared polygon before physics and rendering split
 * apart, so the ball bounces off exactly the surface that is drawn. Welding
 * only the drawn shape would leave a gap the ball still felt.
 */

/** How close an authored edge must be to count as placed against the wall. */
const WELD_EPSILON = 0.5;

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Re-pin any edge of `varied` whose AUTHORED counterpart sat on (or beyond) the
 * play boundary, so decoration cannot detach it.
 *
 * `lo`/`hi` are the play area's bounds on both axes; the board is square, so
 * one pair covers all four edges.
 */
export function weldRectToBoard(
  authored: Rect, varied: Rect, lo: number, hi: number,
): Rect {
  let { x, y, width, height } = varied;

  // Horizontal. Each edge is handled independently: a bar spanning the whole
  // board is pinned at both ends and simply keeps its authored width, which is
  // correct - there is nowhere left for the variation to go.
  const leftPinned = authored.x <= lo + WELD_EPSILON;
  const rightPinned = authored.x + authored.width >= hi - WELD_EPSILON;
  if (leftPinned && rightPinned) {
    x = authored.x;
    width = authored.width;
  } else if (leftPinned) {
    // Keep the far edge where variation put it, and put this one back.
    width = x + width - authored.x;
    x = authored.x;
  } else if (rightPinned) {
    width = (authored.x + authored.width) - x;
  }

  const topPinned = authored.y <= lo + WELD_EPSILON;
  const bottomPinned = authored.y + authored.height >= hi - WELD_EPSILON;
  if (topPinned && bottomPinned) {
    y = authored.y;
    height = authored.height;
  } else if (topPinned) {
    height = y + height - authored.y;
    y = authored.y;
  } else if (bottomPinned) {
    height = (authored.y + authored.height) - y;
  }

  // Variation can in principle shrink a side past its pinned edge, which would
  // invert the rect. Fall back to the authored span rather than emitting a
  // negative width that every downstream consumer would read as an empty shape.
  if (width <= 0) { x = authored.x; width = authored.width; }
  if (height <= 0) { y = authored.y; height = authored.height; }

  return { x, y, width, height };
}

/** Which sides of an obstacle were authored against the wall. */
export interface PinnedSides {
  left: boolean; right: boolean; top: boolean; bottom: boolean;
}

/** Which sides of this authored rect sit on (or past) the play boundary. */
export function pinnedSidesOf(authored: Rect, lo: number, hi: number): PinnedSides {
  return {
    left: authored.x <= lo + WELD_EPSILON,
    right: authored.x + authored.width >= hi - WELD_EPSILON,
    top: authored.y <= lo + WELD_EPSILON,
    bottom: authored.y + authored.height >= hi - WELD_EPSILON,
  };
}

/**
 * How far a decorated vertex may sit from a pinned edge and still be pulled
 * back onto it.
 *
 * Only ever applied to sides the AUTHOR placed against the wall, which is why
 * it can afford to be generous: an obstacle standing in open board is never
 * touched by this at all, however close its decoration wanders to the frame.
 */
const DECORATION_SLACK = 14;

/**
 * Pull a decorated outline back onto the walls it was authored against.
 *
 * Welding the rect is not enough. Obstacle decoration runs afterwards and
 * displaces the outline's vertices, which put a flush bar back off the wall by
 * about three units: small, and exactly the sliver that was reported.
 */
export function weldPolygonToBoard(
  vertices: { x: number; y: number }[],
  pinned: PinnedSides,
  lo: number, hi: number,
): { x: number; y: number }[] {
  if (!pinned.left && !pinned.right && !pinned.top && !pinned.bottom) return vertices;
  return vertices.map(v => {
    let { x, y } = v;
    if (pinned.left && x <= lo + DECORATION_SLACK) x = lo;
    if (pinned.right && x >= hi - DECORATION_SLACK) x = hi;
    if (pinned.top && y <= lo + DECORATION_SLACK) y = lo;
    if (pinned.bottom && y >= hi - DECORATION_SLACK) y = hi;
    return { x, y };
  });
}
