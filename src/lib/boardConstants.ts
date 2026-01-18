// Fixed-aspect-ratio game board constants
// All gameplay simulation runs in world coordinates

// Target board aspect ratio (portrait)
export const BOARD_ASPECT = 9 / 16;

// Logical world dimensions - all gameplay uses these coordinates
export const BOARD_WIDTH = 900;
export const BOARD_HEIGHT = 1600;

// Layout percentages
export const TOP_UI_PERCENT = 0.15;
export const BOARD_BAND_PERCENT = 0.70;
export const BOTTOM_UI_PERCENT = 0.15;

// Board sizing constraints
export const MAX_WIDTH_PERCENT_MOBILE = 1.0;  // Full width on mobile
export const MAX_WIDTH_PERCENT_DESKTOP = 0.5; // 50vw on desktop
export const MAX_HEIGHT_PERCENT = 0.70;
export const MOBILE_BREAKPOINT = 768; // px

export interface BoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * Compute the board rectangle in screen pixels
 * The board aims to use 95% of screen width but must not exceed
 * 70% of screen height, while preserving BOARD_ASPECT
 */
export function computeBoardRect(screenWidth: number, screenHeight: number): BoardRect {
  // Determine if mobile based on screen width
  const isMobile = screenWidth < MOBILE_BREAKPOINT;
  const maxWidthPercent = isMobile ? MAX_WIDTH_PERCENT_MOBILE : MAX_WIDTH_PERCENT_DESKTOP;
  
  const availableWidth = screenWidth * maxWidthPercent;
  const availableHeight = screenHeight * MAX_HEIGHT_PERCENT;
  
  // Determine the largest rectangle with BOARD_ASPECT that fits
  let boardWidth = Math.min(availableWidth, availableHeight * BOARD_ASPECT);
  let boardHeight = boardWidth / BOARD_ASPECT;
  
  // Ensure we don't exceed available height
  if (boardHeight > availableHeight) {
    boardHeight = availableHeight;
    boardWidth = boardHeight * BOARD_ASPECT;
  }
  
  // Calculate positions
  const topUIHeight = screenHeight * TOP_UI_PERCENT;
  const boardBandHeight = screenHeight * BOARD_BAND_PERCENT;
  
  // Center horizontally in screen
  const left = (screenWidth - boardWidth) / 2;
  
  // Center vertically within the board band
  const top = topUIHeight + (boardBandHeight - boardHeight) / 2;
  
  // Scale factor: world units to screen pixels
  const scale = boardWidth / BOARD_WIDTH;
  
  return {
    left,
    top,
    width: boardWidth,
    height: boardHeight,
    scale,
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
