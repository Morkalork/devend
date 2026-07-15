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

/**
 * Transform screen coordinates to world coordinates
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  boardRect: BoardRect
): { x: number; y: number } {
  return {
    x: (screenX - boardRect.left) / boardRect.scale,
    y: (screenY - boardRect.top) / boardRect.scale,
  };
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
