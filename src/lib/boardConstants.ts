// Fixed-aspect-ratio game board constants
// All gameplay simulation runs in world coordinates

// Target board aspect ratio (square)
export const BOARD_ASPECT = 1;

// Logical world dimensions - all gameplay uses these coordinates
export const BOARD_WIDTH = 900;
export const BOARD_HEIGHT = 900;

// Layout percentages
export const TOP_UI_PERCENT = 0.05;
export const BOARD_BAND_PERCENT = 0.90;
export const BOTTOM_UI_PERCENT = 0.05;

// The square board spans this fraction of the shortest viewport side, so on a
// portrait phone it nearly fills the width. Applied uniformly to every device:
// computeBoardRect is fed physical (DPR-scaled) pixels, so the old CSS-pixel
// mobile/desktop breakpoint misfired on high-DPR phones and capped them at 50%.
export const BOARD_SIZE_PERCENT = 0.95;

// Cap the canvas backing-store resolution at 2× CSS pixels. Phones commonly
// report a native devicePixelRatio of 2.6–3.0; rendering at that means 2–2.5×
// more pixels per frame than 2×, and because boardRect.scale (and therefore
// every shadowBlur radius in renderFrame) grows with physical pixels, the cost
// climbs faster than linearly. Capping at 2 is visually imperceptible on a
// high-ppi screen but is the single biggest lever for smooth frame rates and
// thermal headroom inside the Android WebView. The canvas sizing and the
// pointer→world mapping MUST share this value or cuts land off-target.
export const MAX_DEVICE_PIXEL_RATIO = 2;

// Sharper ceiling we may ramp UP to once the device proves it renders the board
// with comfortable frame-time headroom at the safe 2x cap (see adaptiveDpr.ts).
// The ramp is one-shot and upward-only: a device that can't keep up never ramps,
// so it stays at the conservative default. 3x saturates every phone panel.
export const MAX_DEVICE_PIXEL_RATIO_HIGH = 3;

// Live ceiling. Starts conservative; adaptiveDpr may raise it toward native.
let dprCeiling = MAX_DEVICE_PIXEL_RATIO;

/** Raise (never lower) the DPR ceiling; clamped to the high cap. */
export function setDprCeiling(value: number): void {
  dprCeiling = Math.max(dprCeiling, Math.min(value, MAX_DEVICE_PIXEL_RATIO_HIGH));
}

export function getDprCeiling(): number {
  return dprCeiling;
}

/** Effective device pixel ratio, capped at the current (adaptive) DPR ceiling. */
export function getDevicePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, dprCeiling);
}

export interface BoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * Compute the board rectangle in screen pixels.
 * The square board spans BOARD_SIZE_PERCENT (~95%) of the shortest viewport
 * side, but is never taller than the board band reserved between the top/bottom
 * UI strips, so it can't overlap the HUD on short/wide screens.
 */
export function computeBoardRect(screenWidth: number, screenHeight: number): BoardRect {
  // Target: 95% of the shortest side (width on a portrait phone).
  const shortestSide = Math.min(screenWidth, screenHeight);
  let boardWidth = shortestSide * BOARD_SIZE_PERCENT;

  // Clamp so the board fits inside the vertical band reserved for it.
  const availableHeight = screenHeight * BOARD_BAND_PERCENT;
  boardWidth = Math.min(boardWidth, availableHeight * BOARD_ASPECT);

  const boardHeight = boardWidth / BOARD_ASPECT;

  // Calculate positions
  const topUIHeight = screenHeight * TOP_UI_PERCENT;
  const boardBandHeight = screenHeight * BOARD_BAND_PERCENT;

  // Center horizontally in screen
  const left = (screenWidth - boardWidth) / 2;

  // Center vertically within the board band
  const top = topUIHeight + (boardBandHeight - boardHeight) / 2;

  // Round to integer pixels so every world→screen coordinate lands on a
  // whole pixel boundary, preventing sub-pixel anti-aliasing on lines/walls.
  const rLeft   = Math.round(left);
  const rTop    = Math.round(top);
  const rWidth  = Math.round(boardWidth);
  const rHeight = Math.round(boardHeight);
  return {
    left:   rLeft,
    top:    rTop,
    width:  rWidth,
    height: rHeight,
    scale:  rWidth / BOARD_WIDTH,
  };
}

/**
 * Transform world coordinates to screen coordinates
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  boardRect: BoardRect
): { x: number; y: number } {
  return {
    x: boardRect.left + worldX * boardRect.scale,
    y: boardRect.top + worldY * boardRect.scale,
  };
}

// ── Board tilt geometry (issue #77) ─────────────────────────────────────────
// Lives HERE, beside BOARD_WIDTH, rather than in boardTilt.ts. boardTilt needs
// the board size and screenToWorld needs the inverse, so putting the geometry
// there and importing it back created a cycle: boardTilt read BOARD_WIDTH at
// module scope, so whichever side initialised second saw it uninitialised and
// the app failed to boot. Tests missed it because Vitest happened to resolve
// the graph in a working order. Geometry with the constants, schedule in
// boardTilt, and the dependency only ever points this way.

/** Half the board, the centre every rotation happens about. */
const TILT_CENTRE = BOARD_WIDTH / 2;

/**
 * How much to shrink so a board rotated by `angle` still fits its own square.
 * 1 at every 90 degree rest angle, about 0.707 at 45. Without it the corners
 * would leave the frame mid-turn.
 */
export function fitScale(angle: number): number {
  const s = Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle));
  return s > 1e-9 ? 1 / s : 1;
}

/** Rotate and shrink a world point about the board centre. */
export function tiltWorldPoint(x: number, y: number, angle: number): { x: number; y: number } {
  if (angle === 0) return { x, y };
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const k = fitScale(angle);
  const dx = x - TILT_CENTRE, dy = y - TILT_CENTRE;
  return {
    x: TILT_CENTRE + (dx * cos - dy * sin) * k,
    y: TILT_CENTRE + (dx * sin + dy * cos) * k,
  };
}

/** The exact inverse of tiltWorldPoint, for turning a tap back into world space. */
export function untiltWorldPoint(x: number, y: number, angle: number): { x: number; y: number } {
  if (angle === 0) return { x, y };
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const k = fitScale(angle);
  const dx = (x - TILT_CENTRE) / k, dy = (y - TILT_CENTRE) / k;
  return {
    x: TILT_CENTRE + dx * cos + dy * sin,   // rotate by -angle
    y: TILT_CENTRE - dx * sin + dy * cos,
  };
}

/**
 * Transform screen coordinates to world coordinates
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  boardRect: BoardRect,
  /**
   * Board tilt in radians (issue #77). While a gravity map is turning, the
   * board is drawn rotated about its centre, so a tap has to be turned BACK to
   * find the world point under the finger. Zero on every other map, where this
   * is exactly the arithmetic it always was.
   */
  tiltAngle = 0,
): { x: number; y: number } {
  const x = (screenX - boardRect.left) / boardRect.scale;
  const y = (screenY - boardRect.top) / boardRect.scale;
  return tiltAngle === 0 ? { x, y } : untiltWorldPoint(x, y, tiltAngle);
}

/**
 * Check if a screen point is inside the board rectangle
 */
export function isPointInBoard(
  screenX: number,
  screenY: number,
  boardRect: BoardRect
): boolean {
  return (
    screenX >= boardRect.left &&
    screenX <= boardRect.left + boardRect.width &&
    screenY >= boardRect.top &&
    screenY <= boardRect.top + boardRect.height
  );
}

/**
 * Check if a world point is within the world bounds
 */
export function isPointInWorldBounds(worldX: number, worldY: number): boolean {
  return (
    worldX >= 0 &&
    worldX <= BOARD_WIDTH &&
    worldY >= 0 &&
    worldY <= BOARD_HEIGHT
  );
}
