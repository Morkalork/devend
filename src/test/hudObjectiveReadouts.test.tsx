/**
 * The HUD's objective readouts must agree with the gate that decides the map.
 *
 * Both bugs here were the same shape: a number displayed next to a requirement
 * it was not measured in.
 *
 *   - THREAD LOCKS compared a whole-RUN lock tally against a PER-MAP
 *     requirement, while checkSpaceWin gates on the per-map count. From level
 *     two onward the HUD announced an objective the map had not met and would
 *     not clear on ("47/1", "Lock objective met! 84 of 2 balls locked" on an
 *     untouched board). A HUD that says a map is winnable when it is not is
 *     worse than one that says nothing.
 *
 *   - TERRITORY CAPTURE printed REMAINING percent under a CAPTURE heading, so
 *     an untouched map read "100% / 5%" and "Capture at least 5% of the board.
 *     Currently at 100%", the exact inverse of the truth.
 *
 * Both are asserted on rendered output rather than on the maths, because the
 * maths was never wrong: `spaceRemaining - spaceRequired` was right all along
 * and is still right. What was wrong was which number went under which label,
 * and only rendering shows that.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBarDetailsPanel } from "@/components/game/TopBarDetailsPanel";
import "@/i18n";

const BASE = {
  visible: true,
  onClose: () => {},
  levelNumber: 34,
  cutsUsed: 0,
  parCuts: 10,
  lives: 6,
  continuesRemaining: 0,
  accentColor: "#00ff88",
  ownedUpgrades: [],
} as unknown as Parameters<typeof TopBarDetailsPanel>[0];

const panel = (over: Record<string, unknown>) =>
  render(<TopBarDetailsPanel {...BASE} {...over} />);

describe("thread locks count THIS map", () => {
  it("does not call a per-map objective met on an untouched board", () => {
    // The reported case: level 34 wants 2 locks, the run has banked plenty, and
    // the player has not cut yet.
    panel({ lockedBalls: 0, threadLockRequired: 2, spaceRemaining: 100, spaceRequired: 5 });

    expect(screen.getByText("0 / 2")).toBeTruthy();
    expect(
      screen.queryByText(/objective met/i),
      "the map is untouched and cannot be won yet",
    ).toBeNull();
  });

  it("calls it met once the map itself has the locks", () => {
    panel({ lockedBalls: 2, threadLockRequired: 2, spaceRemaining: 100, spaceRequired: 5 });
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText(/objective met/i)).toBeTruthy();
  });

  it("never shows a count above the requirement it is measured against", () => {
    // The signature of the old bug: a lifetime tally over a per-map target.
    // 84/2 is not a state the per-map counter can reach on a two-lock map.
    panel({ lockedBalls: 1, threadLockRequired: 2, spaceRemaining: 100, spaceRequired: 5 });
    expect(screen.queryByText(/8[0-9] \/ 2/)).toBeNull();
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });
});

describe("territory capture counts what was captured", () => {
  it("reads zero on an untouched board, not a hundred", () => {
    panel({ lockedBalls: 0, threadLockRequired: 2, spaceRemaining: 100, spaceRequired: 5 });

    // Captured 0 of the 95 the map asks for.
    expect(screen.getByText("0% / 95%")).toBeTruthy();
    expect(screen.getByText(/Capture at least 95% of the board/)).toBeTruthy();
    expect(screen.getByText(/Currently at 0%/)).toBeTruthy();
    expect(screen.getByText(/need 95% more/)).toBeTruthy();
  });

  it("counts up as the board is cleared", () => {
    panel({ lockedBalls: 0, threadLockRequired: 2, spaceRemaining: 40, spaceRequired: 5 });
    expect(screen.getByText("60% / 95%")).toBeTruthy();
    expect(screen.getByText(/need 35% more/)).toBeTruthy();
  });

  it("congratulates the capture, not the leftovers", () => {
    // At the threshold the old string said "you have captured 5%", which is the
    // one number on screen that was NOT captured.
    panel({ lockedBalls: 0, threadLockRequired: 2, spaceRemaining: 5, spaceRequired: 5 });
    expect(screen.getByText(/captured 95%/)).toBeTruthy();
    expect(screen.queryByText(/captured 5%/)).toBeNull();
  });
});
