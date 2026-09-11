/**
 * Keep the browser's own zoom off the board while the game is running.
 *
 * Reported from play: "you can accidentally zoom out when playing". On a phone
 * the board fills the screen, a fence is drawn by dragging across it, and a
 * second finger landing anywhere near the first is a pinch as far as the
 * browser is concerned. The page zooms out mid-cut, the board stops matching
 * where the fingers are, and nothing in the game can put it back.
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
 * Two mechanisms, because neither covers the whole field alone:
 *
 *   touch-action    `pan-x pan-y` on the root element permits scrolling and
 *                   withholds BOTH pinch-zoom and double-tap-zoom. This is the
 *                   one the compositor honours without waiting for a handler,
 *                   so it is the one that works while a frame is busy.
 *   preventDefault  on a non-passive multi-touch `touchmove`, on Safari's
 *                   `gesture*` events, and on ctrl+wheel (a trackpad pinch and
 *                   the desktop zoom shortcut). Covers what touch-action does
 *                   not, including the gesture events touch-action never sees.
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

  // Capture, so this runs before anything in the app can mark the event handled
  // and before a scrolling panel's own listener sees it. Non-passive on every
  // one of them: a passive listener's preventDefault is ignored, silently, and
  // that failure looks exactly like the bug this fixes.
  const opts: AddEventListenerOptions = { passive: false, capture: true };
  doc.addEventListener("touchmove", onTouchMove, opts);
  doc.addEventListener("wheel", onWheel, opts);
  for (const name of GESTURE_EVENTS) doc.addEventListener(name, onGesture, opts);

  return () => {
    doc.removeEventListener("touchmove", onTouchMove, opts);
    doc.removeEventListener("wheel", onWheel, opts);
    for (const name of GESTURE_EVENTS) doc.removeEventListener(name, onGesture, opts);
    root.style.touchAction = previousTouchAction;
  };
}
