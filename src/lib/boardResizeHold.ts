/**
 * Do not re-lay out the board while someone is drawing on it.
 *
 * ── The bug, traced end to end ─────────────────────────────────────────────
 *
 * Reported four times as "the gameboard is zooming out", and the fourth report
 * asked the question that cracked it: "can it be a reaction between the canvas
 * and the react part of the game?" It can, and it is. Nothing here is the
 * browser's page zoom, which is what the first three rounds went after.
 *
 *   1. Index.tsx sizes every screen `height: 100dvh`. The DYNAMIC viewport
 *      height is defined to change as the mobile URL bar collapses and expands.
 *   2. A drag that starts on the chrome BESIDE the board is a scroll gesture to
 *      the browser, because only the canvas carries `touch-action: none`. A
 *      scroll gesture is exactly what collapses the URL bar.
 *   3. The bar collapses, `100dvh` grows, `window` fires `resize`.
 *   4. GameCanvas's resize handler re-measures the container and rebuilds
 *      `game.boardRect` from it - mid-fence.
 *
 * So the board really does change size under the finger, and it happens only
 * when the drag begins off the canvas, which is precisely the correlation that
 * was reported twice and that no amount of gesture-refusing was going to fix:
 * suppressing the pan removes one CAUSE of a mid-play reflow, and the board
 * would still jump for an orientation change, a keyboard, or the bar moving on
 * its own.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * A resize that arrives while a fence is growing is remembered, not applied,
 * and applied the moment the board is idle again. The same shape the renderer
 * already uses for `nativeDevicePixelRatio`, and for the same reason: the last
 * reading taken AT REST is the one that describes the board the player is
 * actually playing on.
 *
 * Holding is safe in a way that re-laying out is not. The canvas keeps the
 * size it was drawn at, so its own coordinate mapping stays exact and the fence
 * lands where the finger is; at worst a strip of container goes unpainted for
 * the length of one cut. Re-laying out mid-cut moves the board, the walls and
 * the aim all at once, which is the thing being reported.
 */

/** What the board is doing, as far as this decision is concerned. */
export interface BoardBusy {
  /** A fence is being dragged out right now. */
  dragging: boolean;
  /** Fences already released and still growing towards their walls. */
  growingWalls: number;
}

/**
 * May a resize be applied right now?
 *
 * Growing walls count, not just the finger. A fence keeps extending after
 * release and lands on coordinates decided when it started, so moving the board
 * out from under one in flight is the same bug arriving a second later.
 */
export function mayResizeNow(busy: BoardBusy): boolean {
  return !busy.dragging && busy.growingWalls === 0;
}

/**
 * A resize that has been deferred and is still owed.
 *
 * Deliberately a flag and not a queue of sizes: the handler re-measures the
 * container when it finally runs, so ten deferred resizes and one are the same
 * instruction. Keeping the measurements would mean replaying a stale one.
 */
export class PendingResize {
  private owed = false;

  /**
   * Offer a resize. Returns true when the caller should do it now; false when
   * it has been remembered for later.
   */
  offer(busy: BoardBusy): boolean {
    if (mayResizeNow(busy)) return true;
    this.owed = true;
    return false;
  }

  /**
   * The board went idle. Returns true when a resize was owed, and forgets it.
   *
   * Cleared as it is reported so a single idle moment cannot run the handler
   * twice, and so a later idle with nothing owed does no work at all - this is
   * called on every drag release, most of which deferred nothing.
   */
  claim(): boolean {
    const owed = this.owed;
    this.owed = false;
    return owed;
  }

  /** Is one still owed? For a test, and for a caller that wants to look. */
  get isOwed(): boolean { return this.owed; }
}
