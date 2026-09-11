/**
 * The browser's zoom must not reach a board that is being played on.
 *
 * Reported as "you can accidentally zoom out when playing": on a phone a fence
 * is drawn by dragging across a board that fills the screen, so a second finger
 * anywhere near the first is a pinch, the page zooms out mid-cut, and nothing
 * in the game can put it back.
 *
 * What is worth testing is not "does preventDefault get called" but the three
 * ways this fix could be wrong: it could break the one-finger drag the whole
 * game is made of, it could be registered passively and do nothing at all, or
 * it could switch itself off on the wrong screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  installZoomGuard, zoomAllowedOn, ZOOM_ALLOWED_SCREENS, GUARDED_TOUCH_ACTION,
} from "@/lib/zoomGuard";
import type { GameScreen } from "@/types/game";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
});

describe("the guard registers itself so that it can actually block", () => {
  it("takes every listener non-passively", () => {
    // The failure this catches is silent and looks exactly like the original
    // bug: a passive listener's preventDefault is ignored with no error, so the
    // guard would be installed, correct, and do nothing.
    const add = vi.spyOn(document, "addEventListener");
    const off = installZoomGuard(document);
    const guarded = add.mock.calls.filter(([name]) =>
      ["touchmove", "wheel", "gesturestart", "gesturechange", "gestureend"].includes(String(name)));
    expect(guarded.length).toBe(5);
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
    // Restored, not cleared: something else may own this property, and setting
    // it to "" on the way out would break whatever ran first.
    expect(document.documentElement.style.touchAction).toBe("pan-y");
    document.documentElement.style.touchAction = "";
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
