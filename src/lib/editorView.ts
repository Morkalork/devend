/**
 * How the Map Builder is looking at the board.
 *
 * Its own module rather than living in MapCanvas: exporting non-components from
 * a component file breaks Fast Refresh, and the view maths is the part worth
 * testing on its own anyway. Anchoring a zoom on the cursor is easy to get
 * subtly wrong and impossible to notice from a screenshot.
 */
import { BOARD_WIDTH, BoardRect } from "@/lib/boardConstants";

/** How the editor is looking at the board: a zoom about the fitted size, plus a pan. */
export interface EditorView { zoom: number; panX: number; panY: number }

export const FIT_VIEW: EditorView = { zoom: 1, panX: 0, panY: 0 };

/**
 * Zoom limits.
 *
 * Out to 0.4 so the whole board still fits on a container shorter than the
 * board wants to be, which is the case that started this: the fit is the
 * largest square the CANVAS can hold, and when the canvas itself overflows the
 * viewport, "fitted" is still bigger than what you can actually see.
 */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 8;

export const clampZoom = (z: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : 1));

/**
 * The board rect for the Map Builder, under the current view.
 *
 * Everything downstream - drawing, hit-testing, drag maths - already goes
 * through this rect, so zoom and pan need to exist in exactly one place and the
 * rest of the editor follows for free.
 */
export function computeEditorBoardRect(
  containerWidth: number, containerHeight: number, view: EditorView = FIT_VIEW,
): BoardRect {
  const padding = 20;
  const fitted = Math.min(containerWidth - padding * 2, containerHeight - padding * 2);
  const boardSize = fitted * clampZoom(view.zoom);

  return {
    left: (containerWidth - boardSize) / 2 + view.panX,
    top: (containerHeight - boardSize) / 2 + view.panY,
    width: boardSize,
    height: boardSize,
    scale: boardSize / BOARD_WIDTH,
  };
}

/**
 * The view that keeps the world point currently under the cursor under it after
 * a zoom change.
 *
 * Zooming about the centre is the easy version and the wrong one: to inspect a
 * corner you would zoom in, lose it off-screen, and pan it back every time.
 * Anchoring on the cursor means the thing you are pointing at is the thing you
 * get, which is the whole point of zooming in an editor.
 */
export function zoomAboutPoint(
  view: EditorView, nextZoom: number,
  sx: number, sy: number,
  containerWidth: number, containerHeight: number,
): EditorView {
  const before = computeEditorBoardRect(containerWidth, containerHeight, view);
  if (!(before.scale > 0)) return view;
  const wx = (sx - before.left) / before.scale;
  const wy = (sy - before.top) / before.scale;

  const zoom = clampZoom(nextZoom);
  const after = computeEditorBoardRect(containerWidth, containerHeight, { ...view, zoom });
  // after.left already carries the old pan, so correct by the difference.
  return {
    zoom,
    panX: view.panX + (sx - (after.left + wx * after.scale)),
    panY: view.panY + (sy - (after.top + wy * after.scale)),
  };
}

