/**
 * One line under the board, and the alarm over it.
 *
 * Phase 2 of the HUD revamp. Three readouts - the refusal message, the Ship
 * Early countdown, the ability timers - used to have a separately positioned
 * bar each. None is on most of the time, so the stack was usually mostly empty,
 * but each appeared and disappeared independently, which moved the whole bottom
 * of the screen whenever any of them changed. The ability buttons sit directly
 * underneath, so the thing that moved was the thing being reached for.
 *
 * And the deadline, which is the most urgent state in the game, had its only
 * visual signal at the very bottom edge: the furthest point on a phone from
 * where the player is actually looking. (The alarm over the board that fixed
 * that is checked in canvas/BoardAlert.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pickContext, type ContextState } from "@/lib/hudContext";

const state = (over: Partial<ContextState> = {}): ContextState => ({
  mapComplete: false, hasMessage: false, shipEarlyVisible: false, timerCount: 0, ...over,
});

describe("who gets the slot", () => {
  it("gives it to the refusal message first", () => {
    // Shortest-lived and least recoverable: it expires on its own in four
    // seconds, and it is the answer to something the player just tried and got
    // nothing from. Lose the slot and it is simply never seen.
    expect(pickContext(state({ hasMessage: true, shipEarlyVisible: true, timerCount: 2 })))
      .toBe("message");
  });

  it("falls to the countdown, then the timers", () => {
    expect(pickContext(state({ shipEarlyVisible: true, timerCount: 2 }))).toBe("shipEarly");
    expect(pickContext(state({ timerCount: 2 }))).toBe("abilityTimers");
  });

  it("is empty when nothing has anything to say", () => {
    expect(pickContext(state())).toBeNull();
  });

  it("empties the moment the map is over", () => {
    // Nothing down there may outlive the board. A readout still on screen while
    // the results come up reads as the game having got stuck.
    expect(pickContext(state({
      mapComplete: true, hasMessage: true, shipEarlyVisible: true, timerCount: 3,
    }))).toBeNull();
  });

  it("never returns two lanes", () => {
    // The whole point. Sweeping every combination because "one at a time" is
    // the property, not an implementation detail of the current if-chain.
    for (const hasMessage of [true, false]) {
      for (const shipEarlyVisible of [true, false]) {
        for (const timerCount of [0, 3]) {
          const lane = pickContext(state({ hasMessage, shipEarlyVisible, timerCount }));
          expect(typeof lane === "string" || lane === null).toBe(true);
        }
      }
    }
  });
});

describe("the slot's height", () => {
  it("is reserved even when no lane is using it", () => {
    // THE fix. Without a reserved height the row collapses when the slot
    // empties, the ability buttons jump up into the gap, and the control the
    // player is reaching for moves out from under the thumb. A control that
    // shifts while you reach for it is worse than one slightly too small.
    const screenSrc = readFileSync(
      resolve(process.cwd(), "src/components/game/GameScreen.tsx"), "utf8");
    const stack = screenSrc.slice(screenSrc.indexOf("bottom={"), screenSrc.indexOf("over={"));
    // The empty lane is a spacer of the lane's own height (ui/game/hudMetrics)...
    expect(stack, "the context slot lost its reserved height")
      .toContain("<View layout={{ height: HUD.contextLane }} />");
    // ...and the stack the board is laid out around always counts the lane.
    const metrics = readFileSync(resolve(process.cwd(), "src/ui/game/hudMetrics.ts"), "utf8");
    const fn = metrics.slice(metrics.indexOf("export function bottomStackHeight"));
    expect(fn.slice(0, fn.indexOf("\n}")), "the board no longer leaves room for the lane")
      .toMatch(/HUD\.contextLane/);
  });

  it("keeps the push exit out of the queue", () => {
    // It is an ACTION, not a readout, and it was reported missing once while it
    // was on screen. Putting it behind a four-second transient message would
    // undo that on exactly the maps where it matters.
    const screenSrc = readFileSync(
      resolve(process.cwd(), "src/components/game/GameScreen.tsx"), "utf8");
    const stack = screenSrc.slice(screenSrc.indexOf("bottom={"), screenSrc.indexOf("over={"));
    const slotEnd = stack.indexOf("<View layout={{ height: HUD.contextLane }} />");
    const pushAt = stack.indexOf("<PushExitBar");
    expect(pushAt, "the push exit is gone").toBeGreaterThan(-1);
    expect(pushAt, "the push exit was folded into the shared slot")
      .toBeGreaterThan(slotEnd);
  });
});
