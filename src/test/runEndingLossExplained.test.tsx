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
 * give (a rendering question, checked against the canvas overlay in
 * canvas/MapFailedOverlay.test.ts), and that the run is actually HELD until it
 * has been dismissed (a wiring question, checked here at the source since
 * GameScreen mounts a canvas and a whole game loop).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

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
