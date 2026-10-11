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
 * The maths was never wrong: `spaceRemaining - spaceRequired` was right all
 * along and is still right. What was wrong was which number went under which
 * label. The Specs panel's cards (and which prop feeds which card) are checked
 * in canvas/TopBarDetailsPanel.test.ts; this file keeps the half that lives in
 * GameScreen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The half of the thread-lock bug that the panel tests cannot see.
 *
 * The panel tests (canvas/TopBarDetailsPanel.test.ts) take props as handed,
 * which pins how the panel DISPLAYS a number. But the thread-lock bug was never in
 * the panel - the panel rendered exactly what it was given. It was in
 * GameScreen deciding WHICH number to give it, and that line has no test at
 * all: swapping `gameState.lockedBalls` back to `cumulativeLockedBalls +
 * gameState.lockedBalls` leaves every panel assertion green, because the panel
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
