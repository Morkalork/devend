/**
 * The LAST life gets a reason too.
 *
 * Reported as: "I lost a map with no lives and was sent to the game over screen
 * unsure why my second lock caused me to fail. I know, but someone who missed
 * the acceptance criteria would be confused."
 *
 * The explanation existed and never showed. MapFailedOverlay hangs off the
 * RETRY path (`onMapTimedOut`), which by construction only fires while a life
 * remains, so the deaths that ended a run - the ones with twenty minutes behind
 * them - were the only ones delivered as a red flash and a screen change. The
 * reason did reach the results screen, folded into a panel below the score and
 * the level, which is not the same as being told.
 *
 * Two halves, checked separately because they fail differently: that the
 * overlay can say "the run is over" rather than promising a retry it cannot
 * give (a rendering question), and that the run is actually HELD until it has
 * been dismissed (a wiring question, checked at the source since GameScreen
 * mounts a canvas and a whole game loop).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import {
  MapFailedOverlay, MAP_FAILED_MS, MAP_FAILED_RUN_OVER_MS,
} from "@/components/game/MapFailedOverlay";
import type { MapFailure } from "@/lib/mapFailure";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** The exact failure from the report: the last ball sealed, the job unfinished. */
const LOCKED_OUT: MapFailure = {
  kind: "lockedOut",
  unmet: [{
    condition: { kind: "smashed", count: 2 },
    current: 0, target: 2, met: false, mode: "accumulate",
  }],
};

afterEach(cleanup);

describe("the overlay on the last life", () => {
  it("names what ended the map and what was still missing", () => {
    render(<MapFailedOverlay failure={LOCKED_OUT} livesLeft={0} runOver onDismiss={() => {}} />);
    expect(screen.getByText(/nothing on the board can change/i)).toBeTruthy();
    expect(screen.getByText(/Smash 2 breakables/i)).toBeTruthy();
  });

  it("says the run is over instead of promising a retry it cannot give", () => {
    render(<MapFailedOverlay failure={LOCKED_OUT} livesLeft={0} runOver onDismiss={() => {}} />);
    expect(screen.getByText(/No lives left/i)).toBeTruthy();
    expect(screen.queryByText(/try again/i), "offered a retry on a finished run").toBeNull();
  });

  it("still promises the retry when a life remains", () => {
    // The mild case is unchanged: same two lines, different promise.
    render(<MapFailedOverlay failure={LOCKED_OUT} livesLeft={2} onDismiss={() => {}} />);
    expect(screen.getByText(/try again/i)).toBeTruthy();
    expect(screen.getByText(/2 lives left/i)).toBeTruthy();
    expect(screen.queryByText(/No lives left/i)).toBeNull();
  });

  it("does not hurry the run away at the between-attempts speed", () => {
    // 4.2s is paced for a retry loop, where the player wants to be back on the
    // board. A run ending is not a loop, and there is nothing to hurry to.
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(<MapFailedOverlay failure={LOCKED_OUT} livesLeft={0} runOver onDismiss={onDismiss} />);
      act(() => { vi.advanceTimersByTime(MAP_FAILED_MS + 100); });
      expect(onDismiss, "the run was taken away at retry speed").not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(MAP_FAILED_RUN_OVER_MS); });
      // The backstop exists so a tap that never lands cannot strand the run.
      expect(onDismiss).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the run on a tap, which is the ordinary way out", () => {
    const onDismiss = vi.fn();
    render(<MapFailedOverlay failure={LOCKED_OUT} livesLeft={0} runOver onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("alertdialog"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the backstop far longer than the retry timer, not merely different", () => {
    expect(MAP_FAILED_RUN_OVER_MS).toBeGreaterThan(MAP_FAILED_MS * 4);
  });
});

describe("the wiring", () => {
  const src = read("src/components/game/GameScreen.tsx");

  it("HOLDS the run rather than ending it the moment the loss lands", () => {
    // The failure this file exists for: handleGameEnd used to forward straight
    // to onGameEnd, so the screen changed before anything had been said.
    expect(src).toMatch(/if \(!result\.isWin && result\.failure\) \{\s*\n\s*setRunEndingLoss\(result\);\s*\n\s*return;/);
  });

  it("ends it from the DISMISS, and from nowhere else", () => {
    // Two call sites only: the win/no-reason passthrough in handleGameEnd, and
    // the overlay's dismiss. A third would be a path that skips the sentence.
    const calls = src.match(/onGameEnd\(/g) ?? [];
    expect(calls.length, "an extra onGameEnd path appeared").toBe(2);
    expect(src).toMatch(/const dismissRunEndingLoss = useCallback\(\(\) => \{[\s\S]*?onGameEnd\(prev\)/);
  });

  it("draws it in run-over mode, not as another lost life", () => {
    expect(src).toMatch(/runEndingLoss\?\.failure \?/);
    expect(src).toMatch(/runOver\n/);
  });
});
