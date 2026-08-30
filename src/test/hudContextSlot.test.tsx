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
 * where the player is actually looking.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { pickContext, type ContextState } from "@/lib/hudContext";
import { BoardAlert } from "@/components/game/BoardAlert";

afterEach(cleanup);

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
    const stack = screenSrc.slice(screenSrc.indexOf("fixed bottom-0"));
    expect(stack, "the context slot lost its reserved height").toMatch(/min-h-\[\d+px\]/);
  });

  it("keeps the push exit out of the queue", () => {
    // It is an ACTION, not a readout, and it was reported missing once while it
    // was on screen. Putting it behind a four-second transient message would
    // undo that on exactly the maps where it matters.
    const screenSrc = readFileSync(
      resolve(process.cwd(), "src/components/game/GameScreen.tsx"), "utf8");
    const stack = screenSrc.slice(screenSrc.indexOf("fixed bottom-0"));
    const slotEnd = stack.indexOf("</div>", stack.indexOf("min-h-["));
    const pushAt = stack.indexOf("<PushExitBar");
    expect(pushAt, "the push exit is gone").toBeGreaterThan(-1);
    expect(pushAt, "the push exit was folded into the shared slot")
      .toBeGreaterThan(slotEnd);
  });
});

describe("the out-of-time alarm", () => {
  it("shows nothing while there is time", () => {
    const { container } = render(<BoardAlert urgent={false} seconds={30} />);
    expect(container.innerHTML).toBe("");
  });

  it("appears over the board when the deadline is close", () => {
    const { container } = render(<BoardAlert urgent seconds={7} />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("never takes a tap", () => {
    // The one absolute rule for anything drawn over the play area. An alert
    // that swallows the cut which would have saved the run is worse than no
    // alert at all.
    const { container } = render(<BoardAlert urgent seconds={3} />);
    expect((container.firstElementChild as HTMLElement).className)
      .toContain("pointer-events-none");
  });

  it("is red, not the win frame's amber", () => {
    // Both live on the board edge and a map can be unusual AND nearly out of
    // time. Two things in one place have to differ on two channels or they read
    // as one thing: this differs in hue and in motion.
    const { container } = render(<BoardAlert urgent seconds={5} />);
    const html = container.innerHTML.toLowerCase();
    expect(html).toContain("ff6b6b");
    expect(html, "the alarm took the win frame's colour").not.toContain("ffb347");
  });

  it("says the word through i18n rather than hardcoding it", () => {
    render(<BoardAlert urgent seconds={5} />);
    // Resolved through the locale files, so it is not the literal key.
    const label = screen.getByRole("status").textContent ?? "";
    expect(label.trim().length).toBeGreaterThan(0);
    expect(label).not.toContain("game.timeAlarm");
  });

  it("shows the count as a flash and drops it when there is none", () => {
    const withCount = render(<BoardAlert urgent seconds={4} />);
    expect(withCount.container.textContent).toContain("4");
    cleanup();
    // Null seconds leaves the edge and the word, and no numeral: the edge is
    // the signal, the numeral is only the moment of change.
    const without = render(<BoardAlert urgent seconds={null} />);
    expect(without.container.firstElementChild).toBeTruthy();
    expect(without.container.textContent).not.toMatch(/\d/);
  });
});
