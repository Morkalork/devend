/**
 * The geometry of TutorialOverlay's spotlight, kept apart from the drawing so
 * it can be checked without a canvas.
 */

export type SpotlightArea = "top" | "bottom";

export interface Rect { x: number; y: number; w: number; h: number }
export interface ScrimBand extends Rect { alpha: number }

/** How dark the scrim is (the DOM's rgba(0,0,0,0.82)). */
export const SCRIM_ALPHA = 0.82;
/** The DOM gradient ran from clear at the hole's edge to full scrim over 4px. */
const SCRIM_RAMP_PX = 4;

/**
 * Whether there is a hole at all, and which way the arrow points. The arrow
 * only shows with a spotlight, and then it points at the hole, so
 * `arrowDirection` decides nothing in practice; kept for parity with the DOM.
 */
export function tutorialSpotlight(
  spotlightArea: SpotlightArea | undefined,
  spotlightHeightPx: number,
  arrowDirection: "up" | "down" | "none",
): { hasSpotlight: boolean; isArrowUp: boolean } {
  const hasSpotlight = !!spotlightArea && spotlightHeightPx > 0;
  const isArrowUp = hasSpotlight ? spotlightArea === "top" : arrowDirection === "up";
  return { hasSpotlight, isArrowUp };
}

/**
 * The scrim as bands of black: the whole screen without a spotlight, or
 * everything but the hole over the top or bottom `h` px, with the DOM's 4px
 * soft edge at the hole's boundary as four 1px steps.
 */
export function scrimBands(
  screen: { width: number; height: number },
  spotlightArea: SpotlightArea | undefined,
  h: number,
): ScrimBand[] {
  const { width: W, height: H } = screen;
  if (!spotlightArea || h <= 0) return [{ x: 0, y: 0, w: W, h: H, alpha: SCRIM_ALPHA }];
  const bands: ScrimBand[] = [];
  for (let i = 0; i < SCRIM_RAMP_PX; i++) {
    const alpha = SCRIM_ALPHA * (i + 1) / (SCRIM_RAMP_PX + 1);
    const y = spotlightArea === "top" ? h + i : H - h - i - 1;
    bands.push({ x: 0, y, w: W, h: 1, alpha });
  }
  const solid = spotlightArea === "top"
    ? { x: 0, y: h + SCRIM_RAMP_PX, w: W, h: Math.max(0, H - h - SCRIM_RAMP_PX) }
    : { x: 0, y: 0, w: W, h: Math.max(0, H - h - SCRIM_RAMP_PX) };
  bands.push({ ...solid, alpha: SCRIM_ALPHA });
  return bands;
}

/** The lit area itself, framed by a glowing border. */
export function spotlightHole(screen: { width: number; height: number }, area: SpotlightArea, h: number): Rect {
  return area === "top"
    ? { x: 0, y: 0, w: screen.width, h }
    : { x: 0, y: screen.height - h, w: screen.width, h };
}

/** The 3px glowing separator line on the scrim side of the hole's edge. */
export function spotlightSeparator(screen: { width: number; height: number }, area: SpotlightArea, h: number): Rect {
  return area === "top"
    ? { x: 0, y: h, w: screen.width, h: 3 }
    : { x: 0, y: screen.height - h - 3, w: screen.width, h: 3 };
}

/** The arrow's bob: 14px toward the hole and back, `pulse` 0..1. */
export function arrowBob(pulse: number, up: boolean): number {
  return (up ? -14 : 14) * pulse;
}

/** The arrow's full size. */
export const ARROW_W = 60;
export const ARROW_H = 220;

/**
 * How far the arrow is scaled down to fit a box `boxHeight` tall (never up).
 * 1 until the box has been laid out.
 */
export function arrowScale(boxHeight: number): number {
  return boxHeight > 0 ? Math.min(1, boxHeight / ARROW_H) : 1;
}

/** The arrow (60x220): a shaft and a head pointing up or down, as fill polygons. */
export function arrowShape(up: boolean): { shaft: Rect; head: number[] } {
  return up
    ? { shaft: { x: 22, y: 90, w: 16, h: 130 }, head: [30, 0, 60, 90, 0, 90] }
    : { shaft: { x: 22, y: 0, w: 16, h: 130 }, head: [30, 220, 0, 130, 60, 130] };
}

/** `w-full max-w-md` inside `px-6`. */
export function tutorialCardWidth(screenWidth: number): number {
  return Math.max(0, Math.min(448, screenWidth - 48));
}
