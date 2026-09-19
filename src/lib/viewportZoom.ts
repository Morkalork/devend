/**
 * When the zoom happens anyway: notice it, undo it, and stop the map killing
 * you while the view is wrong.
 *
 * zoomGuard.ts is the prevention side, and it has now been reported past three
 * times: a two-finger pinch, a double-tap, a one-finger drag near a recent tap.
 * Each round refused one more gesture and the next report arrived anyway, with
 * the same sentence attached - "it is breaking everything".
 *
 * That pattern is the finding. On iOS Safari a page CANNOT reliably refuse the
 * visual viewport's zoom: `user-scalable=no` has been ignored since iOS 10, and
 * `touch-action` does not govern the browser's own accessibility zoom either.
 * Android Chrome honours both until the reader turns on "Force enable zoom",
 * which is exactly the setting that exists to override pages like this one.
 * Those overrides are right - a page must not be able to trap someone who needs
 * to magnify it - and a fourth prevention round would be the third one's
 * argument again, louder.
 *
 * So this is the other half, and it assumes the zoom WILL get through:
 *
 *   NOTICE    `visualViewport` reports the scale and offset the reader is
 *             actually looking through, and fires on every change. Nothing in
 *             the game watched it, so a zoomed board was a state the code did
 *             not know it was in.
 *   UNDO      scroll the visual viewport back and re-assert the viewport meta,
 *             which is what snaps the scale back on the browsers that respond
 *             to it at all. Attempted only between gestures, never during one:
 *             fighting a finger that is still down is how a page feels broken
 *             rather than fixed.
 *   HOLD      if it is still zoomed after that, the map pauses (GameScreen,
 *             beside the pause for a hidden page). The board being wrong is not
 *             a reason to lose a life to it, and a player wrestling with a
 *             zoomed view is not playing.
 *
 * ── Why the undo is best-effort and the pause is not ───────────────────────
 *
 * There is no API to set the visual viewport's scale. The meta re-assertion
 * below is the standard workaround and it genuinely works on some versions and
 * does nothing on others, which is precisely why the pause exists underneath
 * it: the recovery a player can always count on is the game waiting for them.
 */

/** How far from 1 the scale may drift before it counts as zoomed. */
export const ZOOM_EPSILON = 0.02;

/**
 * How far the viewport may be scrolled, in CSS pixels, before it counts as
 * panned. Not zero: a zoomed-then-restored viewport can settle a fraction of a
 * pixel off, and a game that pauses over that is worse than one that zooms.
 */
export const PAN_EPSILON_PX = 1;

/**
 * How long a zoom has to survive the undo before the map pauses, in ms.
 *
 * Long enough for the meta re-assertion to take on a browser that honours it,
 * so the common case is a blink and nothing else; short enough that a zoom
 * which is NOT going away holds the board before the next ball does something
 * the player cannot see.
 */
export const ZOOM_GRACE_MS = 450;

/** The part of `window.visualViewport` this file needs, so a test can pass one. */
export interface ViewportReading {
  scale: number;
  offsetLeft: number;
  offsetTop: number;
}

/** Is the reader looking through a viewport that is not the page's own? */
export function isViewportZoomed(v: ViewportReading | null | undefined): boolean {
  if (!v) return false;
  if (Math.abs(v.scale - 1) > ZOOM_EPSILON) return true;
  return Math.abs(v.offsetLeft) > PAN_EPSILON_PX || Math.abs(v.offsetTop) > PAN_EPSILON_PX;
}

/**
 * The viewport meta as the page wants it, plus the one term it was missing.
 *
 * index.html has carried `maximum-scale=1.0, user-scalable=no` all along and
 * never said anything about the other direction, so every browser that honours
 * the meta at all was told it could scale DOWN as far as it liked - and zooming
 * OUT is the direction this keeps being reported in. `minimum-scale=1.0` closes
 * it. It is not a fix on iOS, which ignores the lot, and it is a fix everywhere
 * that reads the tag, which is the whole point of keeping the tag.
 */
export const VIEWPORT_META_CONTENT =
  "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, " +
  "user-scalable=no, viewport-fit=cover";

/**
 * The same viewport, written differently.
 *
 * A browser only re-reads the tag when it CHANGES, so re-asserting it means
 * writing a string that differs from the one already there - and it must not
 * differ in meaning, or the page's own viewport flickers along with the zoom.
 * `1.0` and `1` are the same scale and not the same characters, which is the
 * whole trick. Appending a term would leave a duplicate key behind; toggling
 * one that is already there cannot.
 */
export function toggledViewportContent(content: string): string {
  if (content.includes("initial-scale=1.0")) return content.replace("initial-scale=1.0", "initial-scale=1");
  if (/initial-scale=1(?![.\d])/.test(content)) return content.replace(/initial-scale=1(?![.\d])/, "initial-scale=1.0");
  return `${content}, initial-scale=1.0`;
}

/**
 * Ask the browser to go back to scale 1, and put the viewport back at the
 * origin.
 *
 * The meta is re-asserted by writing the same viewport in different characters
 * and putting the original back on the next frame (see above). A browser that
 * honours the tag snaps to scale 1 as it re-reads it; one that does not is
 * unaffected, which is why the caller has a pause behind this.
 *
 * Returns false when there is nothing to do, so a caller can tell "restored"
 * from "never zoomed" without reading the viewport twice.
 */
export function restoreViewportZoom(doc: Document): boolean {
  const win = doc.defaultView;
  if (!win) return false;
  if (!isViewportZoomed(win.visualViewport)) return false;

  const meta = doc.querySelector('meta[name="viewport"]');
  if (meta) {
    const wanted = meta.getAttribute("content") ?? VIEWPORT_META_CONTENT;
    meta.setAttribute("content", toggledViewportContent(wanted));
    // Back on the next frame. Immediately would be one attribute write as far
    // as the engine is concerned, and it would see no change at all.
    const restore = () => meta.setAttribute("content", wanted);
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(restore);
    else restore();
  }
  // The pan half. Independent of the scale: a viewport that snapped back to 1
  // can still be sitting somewhere other than the top-left.
  win.scrollTo?.(0, 0);
  return true;
}

export interface ZoomWatchCallbacks {
  /** The viewport has been zoomed or panned for longer than the grace window. */
  onStuck: () => void;
  /** It is back to normal (fires only after an onStuck). */
  onClear?: () => void;
}

/**
 * Watch the visual viewport, undo what can be undone, and report what cannot.
 *
 * The undo is attempted on every change and the callback waits out the grace
 * window, so a zoom the browser lets us take back never reaches the game at
 * all - the player sees the board jump back and nothing else happens.
 *
 * Returns a teardown. Safe to install where `visualViewport` does not exist
 * (older WebViews, jsdom): it simply never fires.
 */
export function watchViewportZoom(doc: Document, cb: ZoomWatchCallbacks): () => void {
  const win = doc.defaultView;
  const vv = win?.visualViewport;
  if (!win || !vv) return () => { /* nothing to watch */ };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stuck = false;
  let fingersDown = 0;
  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  /** Decide what to do about the viewport as it stands. */
  const settle = () => {
    if (!isViewportZoomed(vv)) {
      clearTimer();
      if (stuck) { stuck = false; cb.onClear?.(); }
      return;
    }
    restoreViewportZoom(doc);
    if (stuck || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      // Read again rather than trusting the reading that armed this: the whole
      // point of the wait is that the undo may have worked in the meantime.
      if (!isViewportZoomed(vv)) return;
      stuck = true;
      cb.onStuck();
    }, ZOOM_GRACE_MS);
  };

  // Nothing is undone while a finger is still on the glass. A pinch fires these
  // continuously, and a page that snapped back on every frame of a gesture the
  // reader is still making would feel broken in a new way rather than fixed -
  // and would be fighting the one person it is supposed to be helping, who may
  // be zooming on purpose. The lift is what asks the question.
  const onChange = () => { if (fingersDown === 0) settle(); };
  const onTouchStart = (e: Event) => { fingersDown = (e as TouchEvent).touches?.length ?? 1; };
  const onTouchEnd = (e: Event) => {
    fingersDown = (e as TouchEvent).touches?.length ?? 0;
    if (fingersDown === 0) settle();
  };

  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  doc.addEventListener("touchstart", onTouchStart, { passive: true });
  doc.addEventListener("touchend", onTouchEnd, { passive: true });
  doc.addEventListener("touchcancel", onTouchEnd, { passive: true });
  return () => {
    clearTimer();
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
    doc.removeEventListener("touchstart", onTouchStart);
    doc.removeEventListener("touchend", onTouchEnd);
    doc.removeEventListener("touchcancel", onTouchEnd);
  };
}
