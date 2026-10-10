/**
 * PushYourLuckOverlay's numbers and placement, apart from the drawing.
 */

/** Each 25% of the remaining area cleared is +1 OT; the text shows that chunk, rounded. */
export function pushChunkPercent(remainingPercent: number): string {
  return (remainingPercent * 0.25).toFixed(0);
}

/** Tailwind's `sm` breakpoint, where the card stops hugging the bottom. */
const SM = 640;

/**
 * Where the card sits. On a phone it spans the width 16px in and floats 96px
 * above the bottom, clear of the controls; from 640px it is a 384px card,
 * centred horizontally, with its top 140px above the middle.
 */
export function pushLuckBox(screen: { width: number; height: number }):
  { left: number; width: number; top?: number; bottom?: number } {
  if (screen.width >= SM) {
    return { left: screen.width / 2 - 192, width: 384, top: screen.height / 2 - 140 };
  }
  return { left: 16, width: Math.max(0, screen.width - 32), bottom: 96 };
}
