/**
 * The zoom that got through anyway.
 *
 * Three rounds of prevention have shipped (zoomGuard.ts, and zoomGuard.test.ts
 * for what each one refuses), and the fourth report is "I still accidentally
 * zoom out some times and it is breaking everything". Both halves of that
 * sentence are the finding:
 *
 *   IT STILL HAPPENS     iOS Safari has ignored `user-scalable=no` since iOS
 *                        10 and does not let `touch-action` govern its own
 *                        accessibility zoom, and Android Chrome's "Force
 *                        enable zoom" exists to override pages exactly like
 *                        this one. A page cannot win this, and a fourth
 *                        prevention round would be the third one's argument
 *                        again, louder.
 *   IT BREAKS EVERYTHING and nothing in the game had ever been told. The board
 *                        stopped fitting the screen, the HUD went off the edge,
 *                        and the balls carried on.
 *
 * So what is tested here is the RECOVERY: noticing, undoing what can be undone,
 * and holding the map when it cannot. The things that could go wrong with it
 * are the things worth pinning - it could pause a game nobody zoomed, it could
 * fight the map builder's own zoom, it could write the viewport meta in a way
 * that means something different, or it could pause on a wobble that was going
 * to settle by itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isViewportZoomed, restoreViewportZoom, watchViewportZoom, toggledViewportContent,
  VIEWPORT_META_CONTENT, ZOOM_GRACE_MS, ZOOM_EPSILON,
} from "@/lib/viewportZoom";
import { shouldPauseForZoom, shouldAutoPause } from "@/lib/autoPause";
import { nativeDevicePixelRatio, resetNativeDevicePixelRatio } from "@/lib/boardConstants";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** A stand-in visual viewport whose readings a test can move. */
function fakeViewport(): {
  vv: { scale: number; offsetLeft: number; offsetTop: number;
        addEventListener: (n: string, f: () => void) => void;
        removeEventListener: (n: string, f: () => void) => void };
  fire: () => void;
  listeners: number;
} {
  const handlers: Record<string, Set<() => void>> = { resize: new Set(), scroll: new Set() };
  const vv = {
    scale: 1, offsetLeft: 0, offsetTop: 0,
    addEventListener: (n: string, f: () => void) => { handlers[n]?.add(f); },
    removeEventListener: (n: string, f: () => void) => { handlers[n]?.delete(f); },
  };
  return {
    vv,
    fire: () => { for (const set of Object.values(handlers)) for (const f of [...set]) f(); },
    get listeners() { return handlers.resize.size + handlers.scroll.size; },
  };
}

/**
 * jsdom has no scrolling, and the restore always asks for some. Stubbed once
 * here so every test below reads as the page's own behaviour rather than as a
 * stack trace about a method jsdom declined to implement.
 */
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => { /* no scrolling in jsdom */ });
});
afterEach(() => { vi.restoreAllMocks(); });

/** Put a fake viewport (and a viewport meta) on the real jsdom document. */
function install(vv: ReturnType<typeof fakeViewport>["vv"] | null): void {
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  document.head.querySelector('meta[name="viewport"]')?.remove();
  const meta = document.createElement("meta");
  meta.setAttribute("name", "viewport");
  meta.setAttribute("content", VIEWPORT_META_CONTENT);
  document.head.appendChild(meta);
}

const metaContent = () =>
  document.head.querySelector('meta[name="viewport"]')!.getAttribute("content")!;

describe("reading the viewport the player is actually looking through", () => {
  it("calls a page at rest unzoomed", () => {
    expect(isViewportZoomed({ scale: 1, offsetLeft: 0, offsetTop: 0 })).toBe(false);
  });

  it("notices a zoom in either direction", () => {
    // Out is the direction reported, in is the one the double-tap produces.
    expect(isViewportZoomed({ scale: 0.7, offsetLeft: 0, offsetTop: 0 })).toBe(true);
    expect(isViewportZoomed({ scale: 2.3, offsetLeft: 0, offsetTop: 0 })).toBe(true);
  });

  it("notices a viewport that is merely shoved off the origin", () => {
    // A pinch that snapped back to 1 can leave the board scrolled half off the
    // screen, which is the same broken view by a different route.
    expect(isViewportZoomed({ scale: 1, offsetLeft: 140, offsetTop: 0 })).toBe(true);
  });

  it("ignores the float noise a restored viewport settles on", () => {
    // Pausing the game over a thousandth of a scale would be worse than the
    // zoom it is guarding against.
    expect(isViewportZoomed({ scale: 1 + ZOOM_EPSILON / 2, offsetLeft: 0.4, offsetTop: 0.4 }))
      .toBe(false);
  });

  it("says nothing about a browser that has no visual viewport", () => {
    // Older WebViews and jsdom. No reading is not a zoom.
    expect(isViewportZoomed(null)).toBe(false);
    expect(isViewportZoomed(undefined)).toBe(false);
  });
});

describe("asking for the zoom back", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does nothing at all when nothing is wrong", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const before = metaContent();
    expect(restoreViewportZoom(document)).toBe(false);
    expect(metaContent(), "it rewrote a viewport that was already right").toBe(before);
  });

  it("re-asserts the viewport meta, then puts it back", () => {
    // The tag is only re-read when it CHANGES, so the write has to differ -
    // and it has to end up back where it started, or every later restore is
    // comparing against something the page never authored.
    const fake = fakeViewport();
    install(fake.vv);
    const original = metaContent();
    fake.vv.scale = 0.6;
    const raf = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => { cb(0); return 1; });

    expect(restoreViewportZoom(document)).toBe(true);
    expect(metaContent(), "the meta was left in the transient form").toBe(original);
    raf.mockRestore();
  });

  it("writes a meta that differs in text and not in meaning", () => {
    const toggled = toggledViewportContent(VIEWPORT_META_CONTENT);
    expect(toggled, "the browser would not re-read an identical tag")
      .not.toBe(VIEWPORT_META_CONTENT);
    // Every term the page cares about survives, and no term appears twice.
    for (const term of ["width=device-width", "minimum-scale=1.0", "maximum-scale=1.0",
                        "user-scalable=no", "viewport-fit=cover"]) {
      expect(toggled, `${term} was lost in the toggle`).toContain(term);
    }
    expect(toggled.match(/initial-scale=/g), "the toggle left a duplicate scale behind")
      .toHaveLength(1);
    expect(toggledViewportContent(toggled), "the toggle does not come back")
      .toBe(VIEWPORT_META_CONTENT);
  });

  it("puts the viewport back at the origin as well as back to scale", () => {
    const fake = fakeViewport();
    install(fake.vv);
    fake.vv.offsetLeft = 120;
    restoreViewportZoom(document);
    expect(window.scrollTo, "a panned viewport was left where it was").toHaveBeenCalled();
  });
});

describe("holding the map when the zoom will not go back", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("says nothing about a zoom that the undo fixed", () => {
    // THE false positive to avoid: on a browser that honours the meta the
    // player gets a blink and keeps playing, and a pause there would be the
    // interruption this feature exists to prevent.
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    fake.vv.scale = 0.6;
    fake.fire();
    fake.vv.scale = 1;          // the undo took
    vi.advanceTimersByTime(ZOOM_GRACE_MS * 2);
    expect(onStuck).not.toHaveBeenCalled();
    stop();
  });

  it("reports one that is still there after the grace window", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    fake.vv.scale = 0.6;
    fake.fire();
    vi.advanceTimersByTime(ZOOM_GRACE_MS - 1);
    expect(onStuck, "it gave up before the undo had its chance").not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onStuck).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reports it once, however much the fingers move", () => {
    // A pinch fires these continuously. Re-pausing an already-paused game on
    // every frame of it would stack nothing useful.
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    fake.vv.scale = 0.6;
    for (let i = 0; i < 20; i++) { fake.fire(); vi.advanceTimersByTime(ZOOM_GRACE_MS); }
    expect(onStuck).toHaveBeenCalledTimes(1);
    stop();
  });

  it("says when it is over, so the game can stop saying it is zoomed", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onClear = vi.fn();
    const stop = watchViewportZoom(document, { onStuck: () => {}, onClear });

    fake.vv.scale = 0.6;
    fake.fire();
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    fake.vv.scale = 1;
    fake.fire();
    expect(onClear).toHaveBeenCalledTimes(1);
    stop();
  });

  it("lets go of the viewport when it is torn down", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const stop = watchViewportZoom(document, { onStuck: () => {} });
    expect(fake.listeners).toBe(2);
    stop();
    expect(fake.listeners, "a screen change leaks a watcher").toBe(0);
  });

  it("installs nothing where there is no visual viewport to watch", () => {
    install(null);
    expect(() => watchViewportZoom(document, { onStuck: () => {} })()).not.toThrow();
  });
});

describe("what the pause is allowed to interrupt", () => {
  const state = {
    zoomStuck: true, hidden: false, alreadyPaused: false,
    modalActive: false, levelEnded: false,
  };

  it("holds a live map whose view went wrong", () => {
    expect(shouldPauseForZoom(state)).toBe(true);
  });

  it("stays out of the way of a map that is already held", () => {
    expect(shouldPauseForZoom({ ...state, alreadyPaused: true })).toBe(false);
    expect(shouldPauseForZoom({ ...state, modalActive: true })).toBe(false);
  });

  it("never drops a pause sheet over a finished map", () => {
    // The results overlay belongs to the screen above this one and stays
    // mounted over a live GameScreen: pausing there covers the player's score.
    expect(shouldPauseForZoom({ ...state, levelEnded: true })).toBe(false);
  });

  it("does nothing while the view is fine", () => {
    expect(shouldPauseForZoom({ ...state, zoomStuck: false })).toBe(false);
  });

  it("leaves the hidden-page pause exactly as it was", () => {
    expect(shouldAutoPause({ hidden: true, alreadyPaused: false, modalActive: false, levelEnded: false }))
      .toBe(true);
    expect(shouldAutoPause({ hidden: false, alreadyPaused: false, modalActive: false, levelEnded: false }))
      .toBe(false);
  });
});

describe("a zoom does not re-scale the board underneath itself", () => {
  afterEach(() => { resetNativeDevicePixelRatio(); });

  it("keeps the ratio it read at rest while the page is zoomed", () => {
    // On iOS devicePixelRatio moves with the zoom, so a resize mid-pinch would
    // rebuild the canvas, the board rect and every scale-keyed bake around the
    // gesture, then rebuild them again on the way out.
    const fake = fakeViewport();
    install(fake.vv);
    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
    expect(nativeDevicePixelRatio()).toBe(3);

    fake.vv.scale = 0.5;
    Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
    expect(nativeDevicePixelRatio(), "the board re-sized itself around a pinch").toBe(3);

    fake.vv.scale = 1;
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    expect(nativeDevicePixelRatio(), "a real ratio change was ignored").toBe(2);
  });

  it("takes the first reading it can get on a page that opens zoomed", () => {
    const fake = fakeViewport();
    install(fake.vv);
    fake.vv.scale = 0.5;
    Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
    expect(nativeDevicePixelRatio()).toBe(1.5);
  });
});

describe("the recovery is wired to the page and to the game", () => {
  it("states minimum-scale in the shipped viewport meta", () => {
    // The direction that keeps being reported. Without it every browser that
    // reads the tag at all was told it could scale DOWN as far as it liked.
    const html = read("index.html");
    expect(html, "the page can still be zoomed out by any browser that reads the tag")
      .toContain("minimum-scale=1.0");
    expect(html, "the page and the string that re-asserts it have drifted")
      .toContain(VIEWPORT_META_CONTENT);
  });

  it("watches the viewport from the same hook that refuses the gesture", () => {
    // One install point, so a screen added later gets both halves or neither.
    const hook = read("src/hooks/useZoomGuard.ts");
    expect(hook).toContain("installZoomGuard(document)");
    expect(hook).toContain("watchViewportZoom(document");
  });

  it("leaves the admin tools to their own zoom", () => {
    // The map builder implements zoom itself, and its own comments record that
    // page zoom stealing the gesture is why zooming there once looked broken.
    const hook = read("src/hooks/useZoomGuard.ts");
    const guarded = hook.slice(hook.indexOf("zoomAllowedOn(screen)"));
    expect(guarded.indexOf("return;"), "the watcher is installed before the admin check")
      .toBeLessThan(guarded.indexOf("watchViewportZoom"));
  });

  it("pauses the map on it, and says why", () => {
    const screen = read("src/components/game/GameScreen.tsx");
    expect(screen).toContain("shouldPauseForZoom({");
    expect(screen, "a pause nobody asked for with nothing to explain it")
      .toContain("game.pausedZoom");
    for (const lang of ["en", "es", "sv"]) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      expect(locale.game.pausedZoom, `${lang} has no words for it`).toBeTruthy();
    }
  });
});

describe("it never fights a finger that is still down", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** A touch event carrying `remaining` fingers still on the glass. */
  function touch(name: string, remaining: number): void {
    const e = new Event(name, { bubbles: true });
    Object.defineProperty(e, "touches", { value: new Array(remaining).fill({}) });
    document.dispatchEvent(e);
  }

  it("leaves the viewport alone mid-gesture", () => {
    // The reader may be zooming on purpose, and a page that snapped back on
    // every frame of a live pinch would feel broken in a new way.
    const fake = fakeViewport();
    install(fake.vv);
    const stop = watchViewportZoom(document, { onStuck: () => {} });

    touch("touchstart", 2);
    fake.vv.scale = 0.6;
    fake.fire();
    expect(window.scrollTo, "it undid a zoom the fingers were still making")
      .not.toHaveBeenCalled();
    stop();
  });

  it("acts the moment the last finger lifts", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    touch("touchstart", 2);
    fake.vv.scale = 0.6;
    fake.fire();
    touch("touchend", 1);          // one finger still down: still their gesture
    expect(window.scrollTo).not.toHaveBeenCalled();
    touch("touchend", 0);
    expect(window.scrollTo, "the lift did not ask the question").toHaveBeenCalled();
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    expect(onStuck).toHaveBeenCalledTimes(1);
    stop();
  });

  it("lets go of the touch listeners too", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });
    stop();

    touch("touchstart", 1);
    fake.vv.scale = 0.6;
    touch("touchend", 0);
    vi.advanceTimersByTime(ZOOM_GRACE_MS * 2);
    expect(onStuck, "a torn-down watcher still reports").not.toHaveBeenCalled();
  });
});

describe("the zoom that happens mid-fence", () => {
  /**
   * The fifth report, and the first that says WHEN: "I accidentally zoomed out
   * again while drawing a fence."
   *
   * That when is the whole finding. A fence is drawn by putting a finger down
   * and dragging, so the finger is down for the entire cut - and the recovery
   * above gated BOTH of its halves on the last finger lifting. The undo being
   * gated is right and stays. The hold being gated meant the grace timer was
   * never even armed while a cut was in progress, so in the one situation this
   * module was written for the game was never told anything at all: the board
   * went on bouncing balls and taking lives behind a view the player could not
   * read, for as long as they kept drawing.
   *
   * So the two halves are now separate. Undo waits for the hands; noticing and
   * holding do not.
   */
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function touch(name: string, remaining: number): void {
    const e = new Event(name, { bubbles: true });
    Object.defineProperty(e, "touches", { value: new Array(remaining).fill({}) });
    document.dispatchEvent(e);
  }

  /** A finger goes down to draw, a second lands, the page zooms out. */
  function pinchMidDrag(fake: ReturnType<typeof fakeViewport>): void {
    touch("touchstart", 1);
    touch("touchstart", 2);
    fake.vv.scale = 0.55;
    fake.fire();
  }

  it("holds the map while the finger is still on the board", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    pinchMidDrag(fake);
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    expect(onStuck, "the board ran on, zoomed, for the rest of the cut")
      .toHaveBeenCalledTimes(1);
    stop();
  });

  it("still does not fight the fingers that are making it", () => {
    // The half that was right all along. Separating the two must not quietly
    // turn the undo back on mid-pinch, which is the behaviour the reader who
    // is magnifying on purpose would experience as a page tearing itself away.
    const fake = fakeViewport();
    install(fake.vv);
    const stop = watchViewportZoom(document, { onStuck: () => {} });

    pinchMidDrag(fake);
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    expect(window.scrollTo, "it undid a zoom the fingers were still making")
      .not.toHaveBeenCalled();
    expect(metaContent(), "it rewrote the viewport mid-gesture")
      .toBe(VIEWPORT_META_CONTENT);
    stop();
  });

  it("says nothing about a wobble that settles before the grace is up", () => {
    // The reason holding mid-gesture is safe: the timer re-reads the viewport
    // rather than trusting the reading that armed it. A pinch the browser
    // snaps back on its own never reaches the game, fingers down or not.
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    pinchMidDrag(fake);
    fake.vv.scale = 1;
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    expect(onStuck, "a zoom that fixed itself paused the map").not.toHaveBeenCalled();
    stop();
  });

  it("undoes it the moment the cut ends, as it always did", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    pinchMidDrag(fake);
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    expect(onStuck).toHaveBeenCalledTimes(1);

    touch("touchend", 1);
    touch("touchend", 0);
    expect(window.scrollTo, "the lift did not ask the question").toHaveBeenCalled();
    stop();
  });

  it("reports the hold once, not once per frame of the pinch", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const stop = watchViewportZoom(document, { onStuck });

    pinchMidDrag(fake);
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    for (let i = 0; i < 20; i++) { fake.vv.scale -= 0.01; fake.fire(); }
    vi.advanceTimersByTime(ZOOM_GRACE_MS * 3);
    expect(onStuck).toHaveBeenCalledTimes(1);
    stop();
  });

  it("clears when the view comes back, even with a finger still down", () => {
    const fake = fakeViewport();
    install(fake.vv);
    const onStuck = vi.fn();
    const onClear = vi.fn();
    const stop = watchViewportZoom(document, { onStuck, onClear });

    pinchMidDrag(fake);
    vi.advanceTimersByTime(ZOOM_GRACE_MS + 1);
    expect(onStuck).toHaveBeenCalledTimes(1);

    fake.vv.scale = 1;
    fake.fire();
    expect(onClear, "the page was straight again and nothing said so")
      .toHaveBeenCalledTimes(1);
    // Not a resume: autoPause never resumes by itself (shouldPauseForZoom), so
    // clearing only means the NEXT zoom can pause again.
    stop();
  });
});
