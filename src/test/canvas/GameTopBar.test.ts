/**
 * The canvas top bar: a fixed height the board can be laid out against, the
 * free shortcuts to Specs, and the numbers behind its readouts. Carried over
 * from hudBudget.test.tsx and boardLayoutLatch.test.ts where they are about
 * behaviour rather than DOM markup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HUD, topBarHeight } from "@/ui/game/hudMetrics";
import {
  FLASH_REST, heartPulse, spaceDetail, statFlashAt,
} from "@/ui/game/topBarModel";
import { IDLE, SWIPE_EXPAND_PX, swipeDown, swipeMove, swipeUp } from "@/ui/game/topBarGestures";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const bar = read("src/ui/game/GameTopBar.tsx");

describe("the bar's height", () => {
  it("is the HUD's reserved height, row by row", () => {
    expect(topBarHeight()).toBe(HUD.topRow1 + HUD.topRow2);
  });

  it("gives the goal row its filled height from the first frame", () => {
    // The goals arrive a commit after mount; a content-sized row grew when
    // they did and pushed the placed board down 20px.
    expect(bar).toContain("height: HUD.topRow2");
    expect(bar).toContain("height: topBarHeight()");
    expect(bar).toContain("width: screen.width");
  });
});

describe("the shortcuts to Specs", () => {
  it("expands on a tap", () => {
    expect(swipeUp(swipeDown(100, 20, false), 20, true)).toBe("expand");
  });

  it("expands on a swipe down, even one that ends over the board", () => {
    const s = swipeMove(swipeDown(100, 20, false), 100, 20 + SWIPE_EXPAND_PX + 5);
    expect(swipeUp(s, 20 + SWIPE_EXPAND_PX + 5, false)).toBe("expand");
  });

  it("does not expand on a short or sideways drag (scrolling the goal row)", () => {
    const s = swipeMove(swipeDown(100, 20, false), 160, 25);
    expect(swipeUp(s, 25, true)).toBeNull();
  });

  it("leaves a goal chip's tap to the chip", () => {
    // A chip that opened two things at once would be worse than one that
    // opened nothing.
    expect(swipeUp(swipeDown(100, 20, true), 20, true)).toBeNull();
  });

  it("still lets a swipe that starts on a chip open Specs", () => {
    expect(swipeUp(swipeDown(100, 20, true), 20 + SWIPE_EXPAND_PX + 1, false)).toBe("expand");
  });

  it("ignores a release it never saw pressed", () => {
    expect(swipeUp(IDLE, 200, true)).toBeNull();
  });

  it("keeps the there-is-more-here hint and both row taps", () => {
    expect(bar).toContain("ChevronDown");
    expect(bar).toContain("useTapOrSwipeDown(onExpand)");
  });
});

describe("what the status bar is allowed to carry", () => {
  it("keeps certificate hours, the Specs button and the mutator chip off it", () => {
    expect(bar, "certificate hours are back on the permanent bar").not.toMatch(/<Icon icon=\{Hexagon\}/);
    expect(bar, "the Specs button is back in the status band").not.toContain("topBar.specs");
    expect(bar, "the top bar renders a mutator chip").not.toContain("mapMutator");
  });

  it("leaves the map's own numbers on it", () => {
    for (const kept of ["spaceRemaining", "lockedBalls", "goals"]) expect(bar).toContain(kept);
  });
});

describe("the space hold-detail", () => {
  it("gives the exact remaining and cleared numbers", () => {
    expect(spaceDetail(37.4, 20)).toEqual({ remaining: 37, cleared: 63, goalMet: false, toGo: 17 });
  });

  it("says the goal is reached at or under the requirement", () => {
    const d = spaceDetail(15, 20);
    expect(d.goalMet).toBe(true);
    expect(d.toGo).toBe(0);
  });

  it("clamps to 0..100", () => {
    expect(spaceDetail(140, 20).remaining).toBe(100);
    expect(spaceDetail(-3, 20).cleared).toBe(100);
  });
});

describe("the stat flash and the heart", () => {
  it("punches up and settles back to rest", () => {
    expect(statFlashAt(0)).toEqual({ scale: 1.3, brightness: 3.5 });
    expect(statFlashAt(0.55).scale).toBeCloseTo(1.06);
    expect(statFlashAt(1)).toEqual(FLASH_REST);
    expect(statFlashAt(0.3).scale).toBeLessThan(1.3);
    expect(statFlashAt(0.3).scale).toBeGreaterThan(1.06);
  });

  it("breathes between rest and 1.15x", () => {
    expect(heartPulse(0)).toEqual({ scale: 1, alpha: 1 });
    expect(heartPulse(1).scale).toBeCloseTo(1.15);
    expect(heartPulse(1).alpha).toBeCloseTo(0.85);
  });
});
