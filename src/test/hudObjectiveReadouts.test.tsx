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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/**
 * The half of the thread-lock bug that the tests above cannot see.
 *
 * Everything above renders TopBarDetailsPanel with props handed to it, which
 * pins how the panel DISPLAYS a number. But the thread-lock bug was never in
 * the panel - the panel rendered exactly what it was given. It was in
 * GameScreen deciding WHICH number to give it, and that line has no test at
 * all: swapping `gameState.lockedBalls` back to `cumulativeLockedBalls +
 * gameState.lockedBalls` leaves every assertion above green, because the panel
 * still faithfully renders the wrong tally it was passed.
 *
 * Verified by doing exactly that. So the fix needs a guard on the wiring, not
 * just on the rendering.
 *
 * This reads the source rather than rendering GameScreen, which is the weaker
 * kind of test and is a deliberate trade: GameScreen wants a live canvas, a
 * level, modifiers and a run, and a render harness for it would be a large
 * fragile thing guarding one assignment. The repo already takes this trade in
 * botSoak.test.ts for the same reason. It is pinned to the exact shape rather
 * than a loose "no cumulative anywhere" search so it fails with a readable
 * message when someone edits the line, and does not fire on the legitimate
 * cumulative prop passed elsewhere for the Micro Manager speed cap.
 */
describe("GameScreen hands the HUD the per-map count", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/components/game/GameScreen.tsx"), "utf8");

  it("measures the HUD's lock count in the same thing the gate does", () => {
    // checkSpaceWin gates on the per-map count, so the readout beside a
    // per-map requirement must be the per-map count and nothing added to it.
    expect(src, "mapLockedBalls is no longer the per-map count")
      .toContain("const mapLockedBalls = gameState.lockedBalls;");
  });

  it("passes that count to every HUD readout, not the run-long tally", () => {
    // `cumulativeLockedBalls={...}` is a different prop and stays legal: the
    // Micro Manager speed cap genuinely wants the run tally.
    const passed = [...src.matchAll(/[^A-Za-z]lockedBalls=\{([^}]*)\}/g)]
      .map(m => m[1].trim());
    expect(passed.length, "no lockedBalls prop is passed at all any more")
      .toBeGreaterThan(0);
    expect([...new Set(passed)], "a HUD readout is being fed something other than the per-map count")
      .toEqual(["mapLockedBalls"]);
  });
});
