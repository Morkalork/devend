/**
 * The level picker, and the two ways it stopped working on a phone.
 *
 * Reported as two bugs and it was one: "the admin doesn't seem to get maps from
 * the configuration file, nor can I add a new map."
 *
 * Measured in a real browser at 448x997, before:
 *
 *   level-1 .. level-4   on screen
 *   level-5 .. level-10  past the right edge, behind a hidden scrollbar
 *   Add Level            x=774, i.e. 326px off-screen
 *
 * The strip was one `overflow-x-auto` row holding the chips AND the level
 * actions, with the actions last. So four maps were visible with nothing to say
 * the other six existed - which reads as a file that did not load - and the one
 * control that starts a new map sat behind a horizontal scroll of every chip.
 * `map.yml` was being fetched correctly the whole time.
 *
 * Two rules come out of that, and this file pins both, because neither can be
 * checked by rendering: jsdom lays nothing out, so it reports 0x0 for every box
 * here and would pass against the broken version exactly as it passes against
 * this one. The real measurement was done in Chromium at both viewports; what is
 * committed is the structure that measurement is a consequence of.
 *
 *   1. The level ACTIONS live outside the scroller, at every width. Being its
 *      last children is what put them off-screen, and the ladder is growing back
 *      towards 35 maps - at which point the desktop strip hides them the same
 *      way.
 *   2. A narrow screen gets a select, not a strip. It opens the OS picker,
 *      scrolls to any length, and names the count, so "did it load?" is answered
 *      on the face of the control.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "src/components/admin/MapBuilder.tsx"), "utf8");

/** The selector block, from its comment to the main content below it. */
const BLOCK = SRC.slice(SRC.indexOf("{/* Level Selector"), SRC.indexOf("{/* Main Content */}"));

/**
 * Is `needle` nested inside the element that opens at `openIdx`?
 *
 * Counts `<div` against `</div>` from the opening tag: while the depth is above
 * zero we are still inside it, and the first time it returns to zero the element
 * has closed. Self-closing tags are not divs here, so the count is exact.
 */
function nestedInside(source: string, openIdx: number, needleIdx: number): boolean {
  let depth = 0;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = openIdx;
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    // Read the depth BEFORE consuming a tag at or past the needle: the closing
    // tag that ends the element sits after it, and counting that one first
    // reports every direct child as being outside its own parent.
    if (m.index >= needleIdx) return depth > 0;
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return false;
  }
  return false;
}

describe("the level actions are reachable at any width", () => {
  it("found the selector block, so the rest is checking something", () => {
    expect(BLOCK.length, "the Level Selector block moved or was renamed")
      .toBeGreaterThan(200);
    expect(BLOCK).toContain('title="Add Level"');
  });

  it("keeps Add, Delete and Duplicate out of the horizontal scroller", () => {
    const scroller = BLOCK.indexOf("overflow-x-auto");
    expect(scroller, "the chip strip no longer scrolls: has it been rewritten?")
      .toBeGreaterThan(-1);
    // Back up from the class to the tag that carries it.
    const open = BLOCK.lastIndexOf("<div", scroller);

    for (const title of ["Add Level", "Delete Level", "Duplicate level"]) {
      const at = BLOCK.indexOf(`title="${title}"`);
      expect(at, `${title} is gone from the selector`).toBeGreaterThan(-1);
      expect(nestedInside(BLOCK, open, at),
        `${title} is inside the scroller, so it goes off-screen once the chips fill the row`)
        .toBe(false);
    }
  });

  it("puts the actions in a row that cannot be squeezed", () => {
    // A flex child with no `flex-shrink-0` collapses before it scrolls, which
    // is the same bug wearing different CSS.
    const at = BLOCK.indexOf('title="Add Level"');
    const open = BLOCK.lastIndexOf('<div className="flex-shrink-0', at);
    expect(open, "the action row is not marked flex-shrink-0").toBeGreaterThan(-1);
    expect(nestedInside(BLOCK, open, at)).toBe(true);
  });
});

describe("a narrow screen gets a picker, not a strip", () => {
  it("offers a select that the phone sees and the desktop does not", () => {
    expect(BLOCK).toMatch(/<select[\s\S]*?aria-label="Level"/);
    const sel = BLOCK.slice(BLOCK.indexOf("<select"), BLOCK.indexOf("</select>"));
    expect(sel, "the select is not hidden on desktop, so both pickers show at once")
      .toContain("lg:hidden");
  });

  it("hides the chip strip on the width where it does not fit", () => {
    const scroller = BLOCK.indexOf("overflow-x-auto");
    const open = BLOCK.lastIndexOf("<div", scroller);
    const tag = BLOCK.slice(open, BLOCK.indexOf(">", scroller));
    expect(tag, "the chip strip still renders on a phone").toContain("hidden lg:flex");
  });

  it("names how many maps loaded, which is the question that was actually asked", () => {
    // "It doesn't seem to get maps from the configuration file" was four chips
    // and no scrollbar. A count on every option answers it without scrolling.
    const sel = BLOCK.slice(BLOCK.indexOf("<select"), BLOCK.indexOf("</select>"));
    expect(sel).toMatch(/\{index \+ 1\} of \{levels\.length\}/);
  });

  it("drives one selection path from both controls", () => {
    // Two pickers reading the same state and writing it differently is how one
    // of them ends up leaving a stale entity selected on the previous map.
    const calls = BLOCK.match(/selectLevel\(/g) ?? [];
    expect(calls.length, "a picker sets the index without going through selectLevel")
      .toBe(2);
    expect(SRC).toMatch(/const selectLevel = useCallback\(/);
    const fn = SRC.slice(SRC.indexOf("const selectLevel = useCallback("));
    const body = fn.slice(0, fn.indexOf("}, ["));
    for (const clear of ["setSelectedEntityId(null)", "setSelectedBallId(null)",
                         "setSelectedAreaIndex(null)"]) {
      expect(body, `selectLevel leaves ${clear} undone, so the panel edits a stale object`)
        .toContain(clear);
    }
  });
});
