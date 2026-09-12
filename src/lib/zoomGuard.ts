/**
 * Keep the browser's own zoom off the board while the game is running.
 *
 * Reported from play twice, in both directions: first "you can accidentally
 * zoom out when playing", then, after that was fixed, "I still accidentally
 * zoom in sometimes when drawing a fence". Two different gestures, both with
 * the same result. On a phone the board fills the screen, a fence is drawn by
 * dragging across it, and a second finger landing anywhere near the first is a
 * pinch as far as the browser is concerned - that one zooms out. Two quick taps
 * near the same spot, which happens just from playing quickly, reads as a
 * double-tap - that one zooms in. Either way the board stops matching where the
 * fingers are, and nothing in the game can put it back.
 *
 * ── Why the viewport meta was not enough ────────────────────────────────────
 *
 * index.html has carried `user-scalable=no, maximum-scale=1.0` all along, and
 * it is still there: it is the cheapest line of defence and it works on the
 * browsers that honour it. Two do not, deliberately, and both are the ones this
 * game is played on:
 *
 *   - iOS Safari has ignored `user-scalable=no` since iOS 10.
 *   - Android Chrome honours it until the reader turns on "Force enable zoom"
 *     in accessibility settings, which overrides the page.
 *
 * Those overrides exist so a page cannot trap someone who needs to magnify it,
 * and that is the right default for a document. A game board is not a document:
 * it is sized to the viewport every frame and there is nothing to magnify, so a
 * zoom here is never what the player meant.
 *
 * ── What actually stops it ──────────────────────────────────────────────────
 *
 * Three mechanisms, because none of them covers the whole field alone:
 *
 *   touch-action    `pan-x pan-y` on the root element permits scrolling and
 *                   withholds pinch-zoom. This is the one the compositor
 *                   honours without waiting for a handler, so it is the one
 *                   that works while a frame is busy.
 *   preventDefault  on a non-passive multi-touch `touchmove`, on Safari's
 *                   `gesture*` events, and on ctrl+wheel (a trackpad pinch and
 *                   the desktop zoom shortcut). Covers what touch-action does
 *                   not, including the gesture events touch-action never sees.
 *   double-tap      reported separately ("you can accidentally zoom IN"),
 *                   because it is a different gesture with a different cause:
 *                   two quick single-finger taps, never more than one touch
 *                   point at once, so the multi-touch handling above never
 *                   sees it. `touch-action` is SPECIFIED to suppress this too,
 *                   but only recent WebKit honours that for double-tap
 *                   specifically - the same gap this file already documents
 *                   for `user-scalable=no` - so a tap-and-hold on a board that
 *                   is all rapid single-finger contact needed its own fix:
 *                   preventDefault on the second `touchend` of a pair that
 *                   land close together in both time and space, the standard
 *                   technique for this exact gap. It targets `touchend` and
 *                   not the pointer events the game itself reads
 *                   (useGameInput), and pointerup for a contact always fires
 *                   and is handled before its paired touchend does, so every
 *                   tap-driven mechanic - freeze, tap-to-remove, targeted
 *                   abilities - still fires even when the double-tap window
 *                   catches its browser-side echo.
 *
 * ── Why it is safe to swallow a second finger ───────────────────────────────
 *
 * The game reads POINTER events and tracks exactly one id at a time: every
 * handler in useGameInput opens by discarding a pointer that is not the one it
 * started with. So a second finger is already inert, and taking its browser
 * default away removes a gesture the game never offered rather than one it did.
 *
 * ── Admin keeps its own zoom ────────────────────────────────────────────────
 *
 * The map builder implements zoom itself - wheel-to-zoom anchored on the
 * cursor, two-finger pan-and-pinch, `touch-action: none` on its canvas - and
 * its own comments record that PAGE zoom stealing the gesture is exactly why
 * zooming there once appeared not to work. So the admin screens are left
 * untouched: nothing there wants the browser's zoom, and nothing there needs
 * this guard to tell it so.
 */
import type { GameScreen } from "@/types/game";

/**
 * The screens that manage zoom themselves. All four sit behind `adminUnlocked`.
 *
 * A list rather than a `screen === 'admin'` check, because the builder's tools
 * are separate screens reached from admin and a player can never open any of
 * them. Adding a screen here is the decision to let the browser zoom on it.
 */
export const ZOOM_ALLOWED_SCREENS: readonly GameScreen[] = [
  "admin", "mapBuilder", "animationTest", "upgradeAtlas",
];

/** Is the browser's own zoom allowed on this screen? */
export function zoomAllowedOn(screen: GameScreen): boolean {
  return ZOOM_ALLOWED_SCREENS.includes(screen);
}

/** Panning yes, pinch-zoom and double-tap-zoom no. */
export const GUARDED_TOUCH_ACTION = "pan-x pan-y";

/** Safari's pinch events, which touch-action does not reach. */
const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

/**
 * How close together, in time, two taps must land to read as one double-tap.
 * Matches the window browsers themselves use to decide the same thing, so this
 * catches exactly the taps that would otherwise zoom and nothing slower.
 */
const DOUBLE_TAP_WINDOW_MS = 350;

/**
 * How close together, in screen pixels, two taps must land to read as the same
 * spot. Generous enough for a real double-tap on a touchscreen, but tight
 * enough that two quick, unrelated taps in different places on the board -
 * tap-freezing two different balls, say - are never mistaken for one.
 */
const DOUBLE_TAP_MAX_DISTANCE_PX = 40;

/**
 * Block browser zoom on `doc` until the returned function is called.
 *
 * Takes the document rather than reaching for the global so a test can drive it
 * without a live page, and returns a teardown that restores the previous
 * `touch-action` rather than assuming it was unset: the caller may be one of
 * several things adjusting it, and clobbering it to "" on the way out would be
 * a bug that only shows up on whatever ran first.
 */
export function installZoomGuard(doc: Document): () => void {
  const root = doc.documentElement;
  const previousTouchAction = root.style.touchAction;
  root.style.touchAction = GUARDED_TOUCH_ACTION;

  // A pinch is the only multi-touch this game has a use for stopping, and the
  // check is on the EVENT rather than on a remembered "are we pinching" flag: a
  // finger can arrive or leave mid-gesture, and a flag would have to be right
  // about every one of those transitions to stay correct.
  const onTouchMove = (e: Event) => {
    const touch = e as TouchEvent;
    if (touch.touches && touch.touches.length > 1 && e.cancelable) e.preventDefault();
  };

  // ctrl+wheel is a trackpad pinch and the desktop zoom shortcut. A plain wheel
  // is left alone, or every scrollable panel in the game would stop scrolling.
  const onWheel = (e: Event) => {
    const wheel = e as WheelEvent;
    if (wheel.ctrlKey && e.cancelable) e.preventDefault();
  };

  const onGesture = (e: Event) => { if (e.cancelable) e.preventDefault(); };

  // Double-tap-zoom: two single-finger taps, never two touches at once, so the
  // pinch handling above never sees it. Tracked on `touchend` because that is
  // the event whose default action IS the zoom, and only for the last finger
  // lifting off a genuine single-touch tap: `changedTouches` other than 1, or
  // any touch still down, means this was a drag or a multi-finger release, not
  // a tap. The pointer events the game itself reads (useGameInput) fire and
  // are handled before this ever runs, so gameplay taps are never affected -
  // only the browser's own zoom is suppressed. Reset on a hit so a stray third
  // tap in the same spot does not chain onto a suppressed second one and start
  // reading as an endless double-tap.
  let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
  const onTouchEnd = (e: Event) => {
    const touch = e as TouchEvent;
    if (touch.changedTouches?.length !== 1 || (touch.touches?.length ?? 0) > 0) return;
    const [t] = touch.changedTouches;
    const now = Date.now();
    const closeInTime = now - lastTapAt <= DOUBLE_TAP_WINDOW_MS;
    const closeInSpace = Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) <= DOUBLE_TAP_MAX_DISTANCE_PX;
    if (closeInTime && closeInSpace) {
      if (e.cancelable) e.preventDefault();
      lastTapAt = 0;
      return;
    }
    lastTapAt = now;
    lastTapX = t.clientX;
    lastTapY = t.clientY;
  };

  // Capture, so this runs before anything in the app can mark the event handled
  // and before a scrolling panel's own listener sees it. Non-passive on every
  // one of them: a passive listener's preventDefault is ignored, silently, and
  // that failure looks exactly like the bug this fixes.
  const opts: AddEventListenerOptions = { passive: false, capture: true };
  doc.addEventListener("touchmove", onTouchMove, opts);
  doc.addEventListener("wheel", onWheel, opts);
  doc.addEventListener("touchend", onTouchEnd, opts);
  for (const name of GESTURE_EVENTS) doc.addEventListener(name, onGesture, opts);

  return () => {
    doc.removeEventListener("touchmove", onTouchMove, opts);
    doc.removeEventListener("wheel", onWheel, opts);
    doc.removeEventListener("touchend", onTouchEnd, opts);
    for (const name of GESTURE_EVENTS) doc.removeEventListener(name, onGesture, opts);
    root.style.touchAction = previousTouchAction;
  };
}
