/**
 * Stepping between levels in the Playground.
 *
 * A two-button toolbar looks too small to test, and the backwards half has a
 * genuine trap in it: JavaScript's `%` keeps the sign of the dividend, so the
 * obvious `(idx - 1) % length` returns -1 at the first level and indexes
 * `undefined`. That does not throw. It sets the selected level to undefined and
 * shows a blank board, which reads as "the editor broke" rather than as an
 * off-by-one, and only ever happens on the first level so it survives casual
 * use of the button.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stepLevelIndex } from "@/lib/levelStep";

describe("stepping forward", () => {
  it("advances one at a time", () => {
    expect(stepLevelIndex(0, 5, 1)).toBe(1);
    expect(stepLevelIndex(3, 5, 1)).toBe(4);
  });

  it("wraps past the end back to the first", () => {
    expect(stepLevelIndex(4, 5, 1)).toBe(0);
  });

  it("opens the first level when none is loaded", () => {
    expect(stepLevelIndex(-1, 5, 1)).toBe(0);
  });
});

describe("stepping back", () => {
  it("goes back one at a time", () => {
    expect(stepLevelIndex(4, 5, -1)).toBe(3);
    expect(stepLevelIndex(1, 5, -1)).toBe(0);
  });

  /** The trap: a plain modulo returns -1 here and the board goes blank. */
  it("wraps from the first level round to the last", () => {
    expect(stepLevelIndex(0, 5, -1)).toBe(4);
    expect(stepLevelIndex(0, 40, -1)).toBe(39);
  });

  /**
   * Backwards from nothing opens the LAST level, which is the useful mirror of
   * forwards-from-nothing: the back button is most often reached for when the
   * end of the ladder is what you want.
   */
  it("opens the last level when none is loaded", () => {
    expect(stepLevelIndex(-1, 5, -1)).toBe(4);
  });
});

describe("degenerate input", () => {
  it("never returns an index outside the list, in either direction", () => {
    for (const length of [1, 2, 5, 40]) {
      for (let i = -1; i < length; i++) {
        for (const d of [1, -1] as const) {
          const out = stepLevelIndex(i, length, d);
          expect(out, `from ${i} of ${length} by ${d}`).toBeGreaterThanOrEqual(0);
          expect(out, `from ${i} of ${length} by ${d}`).toBeLessThan(length);
          expect(Number.isInteger(out)).toBe(true);
        }
      }
    }
  });

  it("stays put on a single-level list", () => {
    expect(stepLevelIndex(0, 1, 1)).toBe(0);
    expect(stepLevelIndex(0, 1, -1)).toBe(0);
  });

  it("survives an empty list rather than producing NaN", () => {
    expect(stepLevelIndex(0, 0, 1)).toBe(0);
    expect(stepLevelIndex(-1, 0, -1)).toBe(0);
  });

  it("is reversible: a step back undoes a step forward", () => {
    for (let i = 0; i < 40; i++) {
      expect(stepLevelIndex(stepLevelIndex(i, 40, 1), 40, -1)).toBe(i);
    }
  });
});

/**
 * There are TWO toolbars, one shown with a level loaded and one without, and
 * adding the button to only the first is the obvious miss: the toolbar you are
 * looking at when you want to step BACK is normally the one with a level
 * already open.
 */
describe("both toolbars carry both buttons", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/admin/PlaygroundScreen.tsx"), "utf8",
  );

  it("has as many previous buttons as next buttons", () => {
    const next = SRC.match(/title="Next level"/g)?.length ?? 0;
    const prev = SRC.match(/title="Previous level"/g)?.length ?? 0;
    expect(next, "the next-level button should still exist").toBeGreaterThan(0);
    expect(prev).toBe(next);
  });

  it("puts each previous button immediately before its next button", () => {
    // Asked for explicitly: the pair reads as one stepper only if they adjoin.
    const pairs = SRC.match(/title="Previous level"[\s\S]{0,400}?title="Next level"/g) ?? [];
    expect(pairs.length).toBe(SRC.match(/title="Next level"/g)?.length ?? 0);
  });

  it("wires them to opposite directions", () => {
    expect(SRC).toMatch(/onClick=\{goToPreviousLevel\}/);
    expect(SRC).toMatch(/onClick=\{goToNextLevel\}/);
    expect(SRC).toMatch(/goToPreviousLevel = useCallback\(\(\) => stepLevel\(-1\)/);
    expect(SRC).toMatch(/goToNextLevel = useCallback\(\(\) => stepLevel\(1\)/);
  });
});
