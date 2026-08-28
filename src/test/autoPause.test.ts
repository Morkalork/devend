/**
 * The game pauses when the player stops looking.
 *
 * This is a game for a commute and a sofa, and nothing in it paused when the
 * phone did. A call, a notification, a lock screen: the map carried on. The
 * loop clamps its delta to 50ms so it never produced a catch-up spiral, and
 * browser rAF throttling limited the rest - but both of those are side effects,
 * not decisions, and the balls still crept while nobody was watching.
 *
 * Pausing is one line. Knowing when NOT to is the feature, so that is what is
 * tested here: three situations where hiding the page must leave the game
 * alone, and the asymmetry that keeps coming back from a lock screen safe.
 */
import { describe, it, expect } from "vitest";
import { shouldAutoPause, type AutoPauseState } from "@/lib/autoPause";

const state = (over: Partial<AutoPauseState> = {}): AutoPauseState => ({
  hidden: true,
  alreadyPaused: false,
  modalActive: false,
  levelEnded: false,
  ...over,
});

describe("leaving the game", () => {
  it("pauses a running map when the page is hidden", () => {
    expect(shouldAutoPause(state())).toBe(true);
  });

  it("does nothing while the page is visible", () => {
    // The event fires on both edges. Acting on the visible one would pause the
    // game at the moment the player came back to it.
    expect(shouldAutoPause(state({ hidden: false }))).toBe(false);
  });
});

describe("what hiding the page must not disturb", () => {
  it("leaves a hand-paused game alone", () => {
    // Not a no-op: pausing an already-paused game would re-arm whatever the
    // pause sheet does on entry, and the player chose that state themselves.
    expect(shouldAutoPause(state({ alreadyPaused: true }))).toBe(false);
  });

  it("leaves a game held by a modal alone", () => {
    // Specs, the map-rule explainer, the shop: these already hold the loop.
    // Pausing behind one means the player dismisses it and finds a second
    // sheet underneath, which reads as the game having got stuck.
    expect(shouldAutoPause(state({ modalActive: true }))).toBe(false);
  });

  it("never drops a pause sheet over the results screen", () => {
    // THE one that only shows up on a device. GameScreen stays mounted under
    // the results overlay, which is owned by the screen above it - so a map
    // that has ended is still a live GameScreen listening to visibilitychange.
    // Backgrounding the phone while reading your score would bury it.
    expect(shouldAutoPause(state({ levelEnded: true }))).toBe(false);
  });
});

describe("coming back", () => {
  it("never resumes on its own, whatever else is true", () => {
    // Deliberately asymmetric. Auto-resume would set the board moving during
    // the half second it takes to re-orient on a screen you just unlocked -
    // exactly the moment the player has no idea what is happening. Returning
    // has to be a tap.
    for (const alreadyPaused of [true, false]) {
      for (const modalActive of [true, false]) {
        for (const levelEnded of [true, false]) {
          expect(
            shouldAutoPause(state({ hidden: false, alreadyPaused, modalActive, levelEnded })),
            `resumed with ${JSON.stringify({ alreadyPaused, modalActive, levelEnded })}`,
          ).toBe(false);
        }
      }
    }
  });
});
