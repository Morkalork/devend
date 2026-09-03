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
 * There are several toolbars - one shown with a level loaded, one without, and
 * the phone's controls sheet - and adding a button to only the first is the
 * obvious miss: the toolbar you are looking at when you want to step BACK is
 * normally the one with a level already open.
 *
 * These count the DESKTOP pair, which are the two that carry `title` tooltips.
 * The sheet labels its arrows for screen readers instead, since a phone has no
 * hover to reveal a title; playgroundMobileMenu.test.ts checks that one.
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

/**
 * The bottom toolbar on a phone.
 *
 * Reported as two bugs and it was one: the no-level toolbar was a plain
 * non-wrapping flex row pinned to the right, so on a narrow screen it simply
 * ran off the side, taking the level button with it. That is also why "the
 * level label only appears after changing level" - the label existed the whole
 * time, it was off-screen until a selection swapped in the other toolbar, which
 * wrapped instead.
 *
 * Both failures are invisible to every other kind of test: the markup is valid,
 * nothing throws, and on a desktop viewport it all looks correct.
 */
describe("the playground toolbars fit on a phone", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/admin/PlaygroundScreen.tsx"), "utf8",
  );

  /**
   * Checked per toolbar rather than by counting scroll containers in the file.
   * A global count passed happily with the no-level toolbar's scrolling removed,
   * because an unrelated row elsewhere in the screen also scrolls: the sort of
   * assertion that is green for a reason that has nothing to do with the bug.
   */
  it("scrolls the with-a-level toolbar", () => {
    const i = SRC.indexOf("{selectedLevel && <div");
    expect(i, "the with-a-level toolbar is gone").toBeGreaterThan(-1);
    const container = SRC.slice(i, SRC.indexOf(">", SRC.indexOf("style={{", i)));
    expect(container).toMatch(/overflowX: 'auto'/);
    expect(container).toMatch(/position: 'absolute'/);
  });

  it("scrolls the no-level toolbar", () => {
    const i = SRC.indexOf("{!selectedLevel && (");
    expect(i, "the no-level toolbar is gone").toBeGreaterThan(-1);
    const container = SRC.slice(i, i + 260);
    expect(container).toMatch(/overflow-x-auto/);
    expect(container, "pinning it to the right edge is what pushed it off-screen")
      .not.toMatch(/fixed bottom-4 right-4 z-50 flex/);
  });

  it("stops the row wrapping onto a second line over the board", () => {
    expect(SRC).not.toMatch(/flexWrap: 'wrap'/);
  });

  it("pins every toolbar button against being squeezed", () => {
    // A flex row that is allowed to shrink its children will do that instead of
    // scrolling, and the buttons become unreadable slivers rather than
    // overflowing into the scroll area.
    const toolbarButtons = SRC.match(/className="flex items-center (?:justify-center )?[^"]*(?:w-9 h-9|px-3 py-2|px-4 py-2)[^"]*rounded-lg[^"]*shadow-lg[^"]*"/g) ?? [];
    expect(toolbarButtons.length, "no toolbar buttons matched").toBeGreaterThan(6);
    const unpinned = toolbarButtons.filter(c => !c.includes("flex-shrink-0"));
    expect(unpinned).toEqual([]);
  });

  it("right-aligns the row while leaving the overflow reachable", () => {
    // ml-auto collapses to zero once the content is wider than the rail, so the
    // row starts at the left edge and scrolls. Aligning with justify-end
    // instead would clip the leading buttons out of reach in some engines.
    expect(SRC).toMatch(/marginLeft: 'auto'/);
    expect(SRC).toMatch(/ml-auto/);
    expect(SRC).not.toMatch(/justifyContent: 'flex-end'/);
  });
});

/**
 * The label the Level button carries. It read the word "Level" from a string
 * literal in the no-level toolbar, so it could not name anything until a
 * selection existed.
 */
describe("the level label says what is loaded, from the start", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/admin/PlaygroundScreen.tsx"), "utf8",
  );

  it("derives one label and uses it on every level button", () => {
    // Counted against the level buttons rather than pinned at a number. It was
    // `toBe(2)`, which was only ever a stand-in for "both toolbars", and it
    // broke the moment a THIRD place needed the label - the phone's controls
    // sheet - reporting a passing feature as a failure. What actually matters
    // is that no level button names the level for itself.
    expect(SRC).toMatch(/const levelLabel = selectedLevel/);
    const uses = (SRC.match(/\{levelLabel\}/g) ?? []).length;
    const buttons = (SRC.match(/setLevelPickerOpen\(true\)/g) ?? []).length;
    expect(buttons, "no level button left to label").toBeGreaterThanOrEqual(2);
    expect(uses, "a level button is labelled from something other than levelLabel")
      .toBe(buttons);
  });

  /**
   * The half the first fix missed. Deriving the label was not enough, because
   * the Playground opened on the synthetic sandbox, so there was no level for
   * the button to name until you pressed next. Reported twice, which is what a
   * fix that addresses one of two causes feels like from the outside.
   */
  it("opens on a real level, so there is something to name", () => {
    const load = SRC.slice(SRC.indexOf("fetch('/map.yml')"), SRC.indexOf("loadBallTypes()"));
    expect(load, "the map load must select a level").toMatch(/setSelectedLevel\(/);
    expect(load, "and it must be the first one").toMatch(/levels\[0\]/);
  });

  it("does not clobber a selection that already exists", () => {
    const load = SRC.slice(SRC.indexOf("fetch('/map.yml')"), SRC.indexOf("loadBallTypes()"));
    expect(load).toMatch(/prev \?\? levels\[0\]/);
  });

  /** Auto-selecting must not make the blank tester unreachable. */
  it("leaves the sandbox reachable from the picker", () => {
    expect(SRC).toMatch(/Playground default/);
    expect(SRC).toMatch(/onClick=\{\(\) => \{ setSelectedLevel\(null\)/);
  });

  it("names the sandbox rather than the bare word Level", () => {
    expect(SRC).toMatch(/'Sandbox'/);
    // The hard-coded label is what made the button uninformative on open.
    expect(SRC).not.toMatch(/<Layers className="w-4 h-4" \/>\s*\n\s*Level\s*\n/);
  });

  it("still names a real level once one is selected", () => {
    expect(SRC).toMatch(/L\$\{selectedLevel\.level\}: \$\{selectedLevel\.id\}/);
  });
});
