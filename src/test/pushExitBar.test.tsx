/**
 * The exit is findable, and it tells the truth about what you are banking.
 *
 * The previous exit was real, wired and rendered - and was reported as missing,
 * because it was a 10%-opacity outline strip sitting between the ability bar
 * and the countdown bars. "It exists in the DOM" was exactly the standard that
 * let that ship, so these check the things that made it invisible: that it is
 * filled rather than ghosted, and that it carries the number that makes the
 * decision worth making.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@/i18n";
import { PushExitBar } from "@/components/game/PushExitBar";
import { pushBonusEarned } from "@/lib/pushLuck";

afterEach(cleanup);

const ACCENT = "#00ff88";

describe("the way out of a push", () => {
  it("is a button the player can press", () => {
    let banked = 0;
    render(<PushExitBar bonusSoFar={3} onBank={() => { banked++; }} accentColor={ACCENT} />);
    fireEvent.click(screen.getByRole("button"));
    expect(banked).toBe(1);
  });

  it("is filled with the accent rather than ghosted over it", () => {
    // THE reason the old one was missed. An outline at 10% opacity in a stack
    // of other bars is not a call to action, it is texture.
    render(<PushExitBar bonusSoFar={0} onBank={() => {}} accentColor={ACCENT} />);
    const style = screen.getByRole("button").style;
    expect(style.backgroundColor).toBe("rgb(0, 255, 136)");
    // Dark ink on a bright accent: light text on this is the one combination
    // that disappears outdoors, which is where this game gets played.
    expect(style.color).toBe("rgb(4, 20, 11)");
  });

  it("says how many hours stopping now would bank", () => {
    render(<PushExitBar bonusSoFar={3} onBank={() => {}} accentColor={ACCENT} />);
    expect(screen.getByText(/\+3h/)).toBeTruthy();
  });

  it("shows the same number the payout will actually pay", () => {
    // The button must not do its own arithmetic. 40% left at the prompt, 15%
    // left now: two whole chunks of ten, so two hours - and the results screen
    // computes it through this same function.
    const earned = pushBonusEarned(40, 15, 1);
    render(<PushExitBar bonusSoFar={earned} onBank={() => {}} accentColor={ACCENT} />);
    expect(screen.getByText(new RegExp(`\\+${earned}h`))).toBeTruthy();
  });

  it("says nothing about hours before a chunk is complete", () => {
    // "+0h" reads as "this button pays nothing", which is the opposite of the
    // truth: the map's own score was already safe before the push began.
    render(<PushExitBar bonusSoFar={0} onBank={() => {}} accentColor={ACCENT} />);
    expect(screen.queryByText(/\+0h/)).toBeNull();
    // The button is still there and still the way out.
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("still names the action when there is no bonus to report", () => {
    render(<PushExitBar bonusSoFar={0} onBank={() => {}} accentColor={ACCENT} />);
    expect(screen.getByRole("button").textContent?.trim().length).toBeGreaterThan(0);
  });
});
