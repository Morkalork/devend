/**
 * The browser's zoom must not reach a board that is being played on.
 *
 * Reported three times, three different gestures. First "you can accidentally
 * zoom out when playing": on a phone a fence is drawn by dragging across a
 * board that fills the screen, so a second finger anywhere near the first is a
 * pinch, and the page zooms out mid-cut. Then, after that shipped, "I still
 * accidentally zoom in sometimes when drawing a fence": two quick
 * single-finger taps near the same spot, which just playing fast produces on
 * its own, reads to the browser as a double-tap and zooms in. Then, after
 * THAT shipped, "I still managed to zoom out with just one finger as I tried
 * to draw a fence": a second single-finger touchdown near a recent tap,
 * followed by a drag instead of a lift, is Safari's continuous one-finger
 * zoom - the gesture a fence draw begun near a previous tap or release IS.
 *
 * What is worth testing is not "does preventDefault get called" but the ways
 * each fix could be wrong: it could break the one-finger drag the whole game
 * is made of, it could be registered passively and do nothing at all, it could
 * switch itself off on the wrong screen, or a tap-proximity guard could catch
 * two taps - or a tap and a drag - that were never the same gesture at all -
 * two different balls tapped in quick succession, say, or an ordinary fence
 * begun nowhere near the player's last touch - and eat real gameplay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  installZoomGuard, zoomAllowedOn, ZOOM_ALLOWED_SCREENS, GUARDED_TOUCH_ACTION,
  dragIsAlwaysGameplay, PAN_OPT_OUT_ATTR, touchStartsInAPanner,
} from "@/lib/zoomGuard";
import type { GameScreen } from "@/types/game";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSrc = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** A touchmove carrying `count` fingers, and whether anything blocked it. */
function touchMove(doc: Document, count: number): boolean {
  const e = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: new Array(count).fill({}) });
  doc.dispatchEvent(e);
  return e.defaultPrevented;
}

function wheel(doc: Document, ctrlKey: boolean): boolean {
  const e = new Event("wheel", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "ctrlKey", { value: ctrlKey });
  doc.dispatchEvent(e);
  return e.defaultPrevented;
}

function gesture(doc: Document, name: string): boolean {
  const e = new Event(name, { bubbles: true, cancelable: true });
  doc.dispatchEvent(e);
  return e.defaultPrevented;
}

/**
 * A single finger lifting off at (x, y), optionally with other fingers still
 * down (`touchesRemaining`) or lifting more than one at once
 * (`changedCount`) - the two shapes that must NOT read as a tap.
 */
function touchEnd(
  doc: Document, x: number, y: number,
  opts: { touchesRemaining?: number; changedCount?: number } = {},
): boolean {
  const e = new Event("touchend", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "changedTouches", {
    value: new Array(opts.changedCount ?? 1).fill({ clientX: x, clientY: y }),
  });
  Object.defineProperty(e, "touches", { value: new Array(opts.touchesRemaining ?? 0).fill({}) });
  doc.dispatchEvent(e);
  return e.defaultPrevented;
}

/**
 * A finger touching down at (x, y), as the `n`th finger currently on the
 * board (default 1: the ordinary single-finger case a fence draw begins with).
 */
function touchStart(doc: Document, x: number, y: number, touchesDown = 1): boolean {
  const e = new Event("touchstart", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "changedTouches", { value: [{ clientX: x, clientY: y }] });
  Object.defineProperty(e, "touches", { value: new Array(touchesDown).fill({}) });
  doc.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("which screens may zoom", () => {
  it("allows it only on the admin tools", () => {
    for (const s of ZOOM_ALLOWED_SCREENS) expect(zoomAllowedOn(s), s).toBe(true);
    // Spot-checked by name rather than by iterating the type, so ADDING a
    // screen defaults it to guarded and is a decision someone has to come here
    // and make.
    const played: GameScreen[] = [
      "welcome", "tutorial", "game", "upgradeShop", "result", "runDraft",
      "doorDraft", "tierDraft", "capstoneDraft", "ascensionDraft",
      "assignmentSummary", "tenureDraft", "certificateStore", "loadouts",
      "options", "achievements", "hallOfFame",
    ];
    for (const s of played) expect(zoomAllowedOn(s), s).toBe(false);
  });

  it("guards the screen the bug was reported on", () => {
    expect(zoomAllowedOn("game")).toBe(false);
  });
});

describe("the guard while it is installed", () => {
  let teardown: (() => void) | null = null;
  beforeEach(() => { teardown = installZoomGuard(document); });
  afterEach(() => { teardown?.(); teardown = null; });

  it("leaves a one-finger drag completely alone", () => {
    // The load-bearing one. Every fence in the game is a single-finger drag
    // across the board, and a guard that swallowed it would trade a rare
    // annoyance for an unplayable game.
    expect(touchMove(document, 1)).toBe(false);
  });

  it("leaves a fresh single-finger touchdown alone, with no prior tap", () => {
    expect(touchStart(document, 400, 400)).toBe(false);
  });

  it("blocks a pinch", () => {
    expect(touchMove(document, 2)).toBe(true);
    expect(touchMove(document, 3)).toBe(true);
  });

  it("blocks a trackpad pinch but not an ordinary scroll", () => {
    // A plain wheel has to survive or every scrollable panel in the game stops
    // scrolling; ctrl+wheel is the pinch and the desktop zoom shortcut.
    expect(wheel(document, true)).toBe(true);
    expect(wheel(document, false)).toBe(false);
  });

  it("blocks Safari's gesture events, which touch-action never sees", () => {
    for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
      expect(gesture(document, name), name).toBe(true);
    }
  });

  it("withholds pinch and double-tap zoom while permitting scroll", () => {
    // `pan-x pan-y` rather than `none`: `none` would also kill scrolling, and
    // rather than `manipulation`, which permits pinch-zoom by definition.
    const value = document.documentElement.style.touchAction;
    expect(value).toBe(GUARDED_TOUCH_ACTION);
    expect(value).not.toBe("none");
    expect(value).not.toContain("pinch-zoom");
  });

  describe("double-tap zoom", () => {
    // The CSS above is specified to cover this too, but only recent WebKit
    // actually honours touch-action for double-tap specifically - the reason
    // this guard exists is that a phone in the player's hand is not "recent
    // WebKit" on a schedule anyone controls, so the JS fallback is what has to
    // be right.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("lets a lone tap through", () => {
      expect(touchEnd(document, 100, 100)).toBe(false);
    });

    it("blocks the second tap of a real double-tap", () => {
      expect(touchEnd(document, 100, 100)).toBe(false);
      vi.advanceTimersByTime(150);
      expect(touchEnd(document, 104, 98)).toBe(true);
    });

    it("lets two taps through when they are too slow to be one double-tap", () => {
      expect(touchEnd(document, 100, 100)).toBe(false);
      vi.advanceTimersByTime(400);
      expect(touchEnd(document, 100, 100)).toBe(false);
    });

    it("lets two taps through when they land too far apart to be the same spot", () => {
      // Tap-freezing two different balls in quick succession must never read
      // as a double-tap on either one.
      expect(touchEnd(document, 100, 100)).toBe(false);
      vi.advanceTimersByTime(100);
      expect(touchEnd(document, 300, 300)).toBe(false);
    });

    it("ignores a drag's release, not a tap", () => {
      // Other fingers still down, or more than one lifting at once: neither is
      // the single-finger tap a double-tap-zoom is built from.
      expect(touchEnd(document, 100, 100, { touchesRemaining: 1 })).toBe(false);
      vi.advanceTimersByTime(50);
      expect(touchEnd(document, 100, 100, { changedCount: 2 })).toBe(false);
    });

    it("does not chain a stray third tap onto an already-suppressed pair", () => {
      expect(touchEnd(document, 100, 100)).toBe(false);
      vi.advanceTimersByTime(100);
      expect(touchEnd(document, 100, 100), "the suppressed second tap").toBe(true);
      vi.advanceTimersByTime(100);
      expect(touchEnd(document, 100, 100), "a fresh first tap, not a third of a triple").toBe(false);
    });
  });

  describe("one-finger drag-to-zoom", () => {
    // Reported after the pinch and the double-tap were both already fixed: "I
    // still managed to zoom out with just one finger as I tried to draw a
    // fence." Safari's own gesture - a second single-finger touchdown near a
    // recent tap, dragged instead of lifted, zooms continuously - and by the
    // time that finger's touchend fires the zoom has already happened, so the
    // double-tap fix above (which acts on touchend) is too late for it.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("refuses a touchdown that lands near a tap it just saw complete", () => {
      expect(touchEnd(document, 100, 100)).toBe(false);       // the first tap completes
      vi.advanceTimersByTime(100);
      expect(touchStart(document, 104, 98)).toBe(true);        // the second, close by
    });

    it("keeps refusing that finger's own move - the drag the touchend fix is too late for", () => {
      touchEnd(document, 100, 100);
      vi.advanceTimersByTime(100);
      touchStart(document, 100, 100);
      expect(touchMove(document, 1)).toBe(true);
    });

    it("stops refusing once every finger is up, even mid-gesture", () => {
      touchEnd(document, 100, 100);
      vi.advanceTimersByTime(100);
      touchStart(document, 100, 100);
      touchMove(document, 1);
      touchEnd(document, 130, 220);                             // the drag's own release
      expect(touchMove(document, 1), "a later, unrelated move").toBe(false);
    });

    it("never fires for a touchdown far from the last tap", () => {
      touchEnd(document, 100, 100);
      vi.advanceTimersByTime(100);
      expect(touchStart(document, 400, 400)).toBe(false);
      expect(touchMove(document, 1), "an ordinary drag started elsewhere").toBe(false);
    });

    it("never fires for a touchdown too long after the last tap", () => {
      touchEnd(document, 100, 100);
      vi.advanceTimersByTime(400);
      expect(touchStart(document, 100, 100)).toBe(false);
      expect(touchMove(document, 1)).toBe(false);
    });

    it("never fires when it is a second finger joining, not the whole gesture", () => {
      // The multi-touch (pinch) handling is onTouchMove's job; this candidate
      // is specifically for a touch that is alone on the board.
      touchEnd(document, 100, 100);
      vi.advanceTimersByTime(100);
      expect(touchStart(document, 100, 100, 2)).toBe(false);
    });

    it("with no prior tap at all, an ordinary fence drag is untouched start to finish", () => {
      expect(touchStart(document, 300, 300)).toBe(false);
      expect(touchMove(document, 1)).toBe(false);
      expect(touchEnd(document, 500, 500)).toBe(false);
    });
  });
});

describe("the guard registers itself so that it can actually block", () => {
  it("takes every listener non-passively", () => {
    // The failure this catches is silent and looks exactly like the original
    // bug: a passive listener's preventDefault is ignored with no error, so the
    // guard would be installed, correct, and do nothing.
    const add = vi.spyOn(document, "addEventListener");
    const off = installZoomGuard(document);
    const guarded = add.mock.calls.filter(([name]) =>
      ["touchstart", "touchmove", "wheel", "touchend", "gesturestart", "gesturechange", "gestureend"]
        .includes(String(name)));
    expect(guarded.length).toBe(7);
    for (const [name, , opts] of guarded) {
      expect(opts, `${String(name)} was registered with no options`).toBeTypeOf("object");
      expect((opts as AddEventListenerOptions).passive, `${String(name)} is passive`).toBe(false);
    }
    off();
    add.mockRestore();
  });
});

describe("taking the guard off again", () => {
  it("stops blocking and restores the previous touch-action", () => {
    document.documentElement.style.touchAction = "pan-y";
    const off = installZoomGuard(document);
    expect(touchMove(document, 2)).toBe(true);
    off();
    expect(touchMove(document, 2), "still blocking after teardown").toBe(false);
    expect(wheel(document, true)).toBe(false);
    expect(touchEnd(document, 100, 100)).toBe(false);
    expect(touchStart(document, 100, 100)).toBe(false);
    // Restored, not cleared: something else may own this property, and setting
    // it to "" on the way out would break whatever ran first.
    expect(document.documentElement.style.touchAction).toBe("pan-y");
    document.documentElement.style.touchAction = "";
  });

  it("stops refusing a drag-to-zoom candidate's own move too", () => {
    vi.useFakeTimers();
    const off = installZoomGuard(document);
    touchEnd(document, 100, 100);
    vi.advanceTimersByTime(100);
    expect(touchStart(document, 100, 100)).toBe(true);   // set up as a candidate
    off();
    expect(touchMove(document, 1), "still refusing after teardown").toBe(false);
    vi.useRealTimers();
  });
});

describe("the guard is wired in, not just written", () => {
  const INDEX = readFileSync(resolve(process.cwd(), "src/pages/Index.tsx"), "utf8");

  it("is mounted once, high up, and told the current screen", () => {
    // A guard nobody calls is indistinguishable from the bug. This session has
    // shipped that mistake four times in the other direction - state built in
    // GameCanvas that the headless harness never saw - so the wiring gets the
    // same check the geometry does.
    expect(INDEX).toMatch(/useZoomGuard\(navigation\.currentScreen\)/);
  });

  it("is not scoped to the game screen alone", () => {
    // It has to be the DEFAULT. A pinch that lands on the shop or a draft card
    // is the same accident with the same result, and scoping the guard to one
    // screen is how the next screen ships unprotected.
    const call = INDEX.slice(INDEX.indexOf("useZoomGuard("));
    expect(call.slice(0, 60)).not.toMatch(/=== ['"]game['"]/);
  });
});

describe("a fence begun outside the board", () => {
  /**
   * The fifth zoom report, and the first that says WHERE the gesture starts:
   * "seems to be when you start creating a fence from outside of the gameboard,
   * then swipe into it."
   *
   * That is a boundary, not a gesture, and it is why four rounds of refusing
   * gestures never touched it. The canvas carries `touch-action: none`, so a
   * drag that BEGINS on the board is the game's and the browser never competes.
   * Everything around it inherited the root's `pan-x pan-y`, which says a drag
   * here is a page pan - and a browser decides what a touch is at TOUCHDOWN,
   * from the element under the finger at that moment. It does not hand the
   * gesture back when the finger crosses onto the canvas. So the whole swipe
   * belonged to the browser: no fence, and the page moved instead.
   *
   * Two halves, because neither reaches the whole screen alone. `touch-none`
   * on the play region is the compositor's copy and needs no handler to run.
   * The refusal below covers the rest of the screen, where `touch-action`
   * could not be used: it intersects down the tree, so a root set to `none`
   * would silence the fence-slot row along with everything else.
   */
  function touchAt(name: string, target: EventTarget, count: number): Event {
    const e = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "touches", { value: new Array(count).fill({ clientX: 0, clientY: 0 }) });
    Object.defineProperty(e, "changedTouches", { value: [{ clientX: 0, clientY: 0 }] });
    Object.defineProperty(e, "target", { value: target });
    return e;
  }

  /** A bit of chrome beside the board, and a row that pans on purpose. */
  function layout() {
    const hud = document.createElement("div");
    const bar = document.createElement("div");
    bar.setAttribute(PAN_OPT_OUT_ATTR, "");
    const slot = document.createElement("button");
    bar.appendChild(slot);
    document.body.append(hud, bar);
    return { hud, slot, clean: () => { hud.remove(); bar.remove(); } };
  }

  it("refuses the browser's pan when the drag starts beside the board", () => {
    const { hud, clean } = layout();
    const stop = installZoomGuard(document, true);

    document.dispatchEvent(touchAt("touchstart", hud, 1));
    const move = touchAt("touchmove", hud, 1);
    document.dispatchEvent(move);
    expect(move.defaultPrevented, "the swipe was still the browser's to pan with")
      .toBe(true);

    stop(); clean();
  });

  it("leaves that same drag alone on a screen that scrolls", () => {
    // The shop, the manual, the map list. Refusing the pan there would be the
    // `touch-action: none` mistake the guard has always declined to make.
    const { hud, clean } = layout();
    const stop = installZoomGuard(document, false);

    document.dispatchEvent(touchAt("touchstart", hud, 1));
    const move = touchAt("touchmove", hud, 1);
    document.dispatchEvent(move);
    expect(move.defaultPrevented, "an ordinary screen lost its scrolling").toBe(false);

    stop(); clean();
  });

  it("still lets the fence-slot row pan, which is the one exception", () => {
    const { slot, clean } = layout();
    const stop = installZoomGuard(document, true);

    document.dispatchEvent(touchAt("touchstart", slot, 1));
    const move = touchAt("touchmove", slot, 1);
    document.dispatchEvent(move);
    expect(move.defaultPrevented, "the types past the row's edge are unreachable now")
      .toBe(false);

    stop(); clean();
  });

  it("holds the verdict for the life of the contact, not per move", () => {
    // The bug from the other side: a fence drawn FROM the board onto the slot
    // bar must not become a pan halfway through. The answer is taken at
    // touchdown, which is the same moment the browser takes its own.
    const { hud, slot, clean } = layout();
    const stop = installZoomGuard(document, true);

    document.dispatchEvent(touchAt("touchstart", hud, 1));
    const overBar = touchAt("touchmove", slot, 1);
    document.dispatchEvent(overBar);
    expect(overBar.defaultPrevented, "the drag changed its mind mid-swipe").toBe(true);

    stop(); clean();
  });

  it("clears the verdict when the next touch starts somewhere else", () => {
    const { hud, slot, clean } = layout();
    const stop = installZoomGuard(document, true);

    document.dispatchEvent(touchAt("touchstart", slot, 1));
    document.dispatchEvent(touchAt("touchend", slot, 0));
    document.dispatchEvent(touchAt("touchstart", hud, 1));
    const move = touchAt("touchmove", hud, 1);
    document.dispatchEvent(move);
    expect(move.defaultPrevented, "a drag beside the board inherited the bar's pass")
      .toBe(true);

    stop(); clean();
  });

  it("still refuses a pinch on a scrolling screen, as it always did", () => {
    // The drag hold is an addition, not a replacement.
    const { hud, clean } = layout();
    const stop = installZoomGuard(document, false);

    document.dispatchEvent(touchAt("touchstart", hud, 2));
    const pinch = touchAt("touchmove", hud, 2);
    document.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);

    stop(); clean();
  });
});

describe("which screens hold every drag", () => {
  it("holds them where the board is, and nowhere that scrolls", () => {
    for (const s of ["game", "tutorial"] as GameScreen[]) {
      expect(dragIsAlwaysGameplay(s), `${s} still lets the browser pan`).toBe(true);
    }
    for (const s of ["upgradeShop", "loadouts", "achievements", "hallOfFame",
                     "options", "jukebox", "welcome"] as GameScreen[]) {
      expect(dragIsAlwaysGameplay(s), `${s} scrolls and must keep panning`).toBe(false);
    }
  });

  it("never holds a drag on the screens that zoom on purpose", () => {
    // The map builder implements its own pan and pinch. Both mechanisms have
    // to agree about that or the guard would fight it from one side.
    for (const s of ZOOM_ALLOWED_SCREENS) {
      expect(dragIsAlwaysGameplay(s), `${s} zooms itself and must not be held`)
        .toBe(false);
    }
  });
});

describe("the play region declares itself", () => {
  it("puts touch-none on the whole region, not only the canvas", () => {
    // The compositor half. It needs no handler to run, which is what makes it
    // hold while a frame is busy - the reason this file's header gives for
    // preferring touch-action wherever it can express the rule.
    const canvas = readSrc("src/components/game/GameCanvas.tsx");
    const root = canvas.slice(canvas.indexOf("flex flex-col w-full h-full"));
    expect(root.slice(0, 120), "the play region can still be panned")
      .toContain("touch-none");
  });
});

describe("a scrolling panel that nobody marked", () => {
  /**
   * The regression this refusal could easily have shipped with. The
   * level-complete sheet scrolls, and it comes up while the screen is still
   * `game` - so a rule keyed only on an attribute would have taken its
   * scrolling away the first time it appeared, and the next scrolling overlay
   * anyone added would have broken the same way with no clue pointing here.
   *
   * So the question asked is "can this actually be scrolled", measured on the
   * element, and the attribute is only the override for a panel that wants the
   * drag while it happens to fit.
   */
  function scroller(scrollable: boolean) {
    const box = document.createElement("div");
    const inner = document.createElement("p");
    box.appendChild(inner);
    document.body.appendChild(box);
    // jsdom does not lay out, so the measurements are declared.
    Object.defineProperty(box, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(box, "scrollHeight", { value: scrollable ? 400 : 100, configurable: true });
    Object.defineProperty(box, "clientWidth", { value: 100, configurable: true });
    Object.defineProperty(box, "scrollWidth", { value: 100, configurable: true });
    return { box, inner, clean: () => box.remove() };
  }

  it("lets a drag inside it scroll, marked or not", () => {
    const { inner, clean } = scroller(true);
    expect(touchStartsInAPanner(inner), "a scrolling overlay lost its scrolling")
      .toBe(true);
    clean();
  });

  it("holds a drag inside a panel that does not scroll", () => {
    const { inner, clean } = scroller(false);
    expect(touchStartsInAPanner(inner)).toBe(false);
    clean();
  });

  it("finds the scroller from deep inside it, not just on it", () => {
    const { box, clean } = scroller(true);
    const deep = document.createElement("span");
    box.firstElementChild!.appendChild(deep);
    expect(touchStartsInAPanner(deep)).toBe(true);
    clean();
  });

  it("never calls the document itself a panner", () => {
    // The walk stops at body on purpose: treat the root as scrollable and
    // every drag goes straight back to the browser, which is the bug.
    expect(touchStartsInAPanner(document.body)).toBe(false);
    const bare = document.createElement("div");
    document.body.appendChild(bare);
    expect(touchStartsInAPanner(bare)).toBe(false);
    bare.remove();
  });

  it("says nothing about a target that is not an element", () => {
    expect(touchStartsInAPanner(null)).toBe(false);
    expect(touchStartsInAPanner(document)).toBe(false);
  });
});
