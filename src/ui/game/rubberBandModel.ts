/**
 * The Rubber Band overlay's decisions, pure: where a pointer is in the world,
 * what a release does, what the band would catch, and the one-time tutorial
 * flag. RubberBandOverlay draws these; the tests read them without a canvas.
 */
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { bandShape, inBandSweep, BAND_MAX_POWER, BAND_MIN_POWER, type BandShape } from "@/lib/rubberBand";
import type { Vector2 } from "@/types/game";
import type { BandTarget } from "@/components/game/RubberBandOverlay";

/** Board box in the container's CSS px, as GameCanvas hands it over. */
export interface BoardBox {
  canvasWidth: number;
  canvasHeight: number;
  canvasOffsetTop: number;
  canvasOffsetLeft: number;
}

/** What the band could catch: the DOM overlay's own type, so GameCanvas builds one list for either. */
export type { BandTarget };

/** CSS px per world unit. */
export function boardScale(b: BoardBox): number {
  return b.canvasWidth > 0 ? b.canvasWidth / BOARD_WIDTH : 1;
}

/** World point to the container's CSS px. */
export function worldToContainer(b: BoardBox, w: Vector2): Vector2 {
  return {
    x: b.canvasOffsetLeft + (w.x / BOARD_WIDTH) * b.canvasWidth,
    y: b.canvasOffsetTop + (w.y / BOARD_HEIGHT) * b.canvasHeight,
  };
}

/**
 * A point in the container's CSS px (a screen point minus the container's
 * origin) in WORLD units, so the dead zone and full pull mean the same thing on
 * a phone and on a desktop.
 */
export function containerToWorld(b: BoardBox, p: Vector2): Vector2 {
  const scale = boardScale(b);
  return { x: (p.x - b.canvasOffsetLeft) / scale, y: (p.y - b.canvasOffsetTop) / scale };
}

/**
 * What letting go does. A tap is not a band: the charge cannot be taken back,
 * so a stray touch while reading the board must disarm rather than spend it.
 */
export function bandRelease(start: Vector2 | null, end: Vector2): { fire: BandShape } | { cancel: true } {
  const shape = start ? bandShape(start, end) : null;
  return shape ? { fire: shape } : { cancel: true };
}

/** Everything the band would catch, ringed LIVE so letting go is a confirmation. */
export function bandCatches(shape: BandShape | null, targets: readonly BandTarget[]): BandTarget[] {
  return shape ? targets.filter(tg => inBandSweep({ x: tg.x, y: tg.y }, shape)) : [];
}

/**
 * Teal at rest through to a hot amber at full stretch: the colour IS the power
 * reading, so the player is not asked to watch a bar while aiming.
 */
export function bandColour(powerT: number): number {
  return powerT >= 1 ? 0xffb347 : 0x7fe3d4;
}

/** The power read-out's number. */
export function bandPowerLabel(powerT: number): string {
  return (BAND_MIN_POWER + powerT * (BAND_MAX_POWER - BAND_MIN_POWER)).toFixed(1);
}

/** One-time flag, same shape as the lock and creep explainers. */
export const BAND_TUTORIAL_KEY = "devend_rubberband_tutorial_seen";

export function bandTutorialSeen(): boolean {
  try { return localStorage.getItem(BAND_TUTORIAL_KEY) === "1"; } catch { return true; }
}

export function markBandTutorialSeen(): void {
  try { localStorage.setItem(BAND_TUTORIAL_KEY, "1"); } catch { /* private mode */ }
}
