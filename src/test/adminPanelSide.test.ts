/**
 * The map builder's panel can live on either side, and remembers which.
 *
 * A workspace preference rather than a game setting, and the interesting parts
 * are all about it failing quietly:
 *
 *   THE DEFAULT MUST NOT MOVE ANYTHING. Right is where the panel has always
 *     been. A default of "left" would silently rearrange the workspace of
 *     someone who never asked for the option.
 *   THE BORDER MOVES WITH THE PANEL. Kept on the left while the panel sits on
 *     the left, it draws on the outside edge of the screen and the seam between
 *     map and tools vanishes. Nothing errors; it just looks wrong.
 *   THE PHONE LAYOUT IS NOT REVERSED. Below `lg` the builder stacks, map above
 *     tools. Reversing that would put the tools above the thing they edit,
 *     which is not what "put it on the left" ever meant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  readPanelSide, writePanelSide, otherSide, parsePanelSide, panelSideClasses,
  PANEL_SIDE_KEY, DEFAULT_PANEL_SIDE,
} from "@/lib/admin/panelSide";

beforeEach(() => localStorage.clear());
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("remembering the side", () => {
  it("starts where the panel has always been", () => {
    // Anything else rearranges the workspace of someone who never asked.
    expect(DEFAULT_PANEL_SIDE).toBe("right");
    expect(readPanelSide()).toBe("right");
  });

  it("keeps what was chosen", () => {
    writePanelSide("left");
    expect(readPanelSide()).toBe("left");
    writePanelSide("right");
    expect(readPanelSide()).toBe("right");
  });

  it("falls back rather than trusting whatever is in storage", () => {
    // Storage is shared with every other tab and version of this app.
    for (const junk of ["", "LEFT", "top", "null", "{}"]) {
      localStorage.setItem(PANEL_SIDE_KEY, junk);
      expect(readPanelSide(), `accepted ${JSON.stringify(junk)}`).toBe("right");
    }
    expect(parsePanelSide(null)).toBe("right");
    expect(parsePanelSide(undefined)).toBe("right");
  });

  it("survives a browser that refuses storage", () => {
    // Private mode. A layout preference is never worth an error.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => readPanelSide()).not.toThrow();
    expect(readPanelSide()).toBe("right");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writePanelSide("left")).not.toThrow();
  });

  it("toggles to the other one", () => {
    expect(otherSide("left")).toBe("right");
    expect(otherSide("right")).toBe("left");
  });
});

describe("the classes it produces", () => {
  it("reverses the row for the left, and not for the right", () => {
    expect(panelSideClasses("left").row).toBe("lg:flex-row-reverse");
    expect(panelSideClasses("right").row).toBe("lg:flex-row");
  });

  it("moves the border to the edge facing the map", () => {
    // Otherwise the seam between map and tools is drawn against the outside of
    // the screen, where there is nothing to separate.
    expect(panelSideClasses("left").panel).toBe("lg:border-r");
    expect(panelSideClasses("right").panel).toBe("lg:border-l");
  });

  it("never touches the stacked phone layout", () => {
    // THE thing that must not leak. `flex-row-reverse` without the `lg:` prefix
    // would put the tools above the map on a phone.
    for (const side of ["left", "right"] as const) {
      const c = panelSideClasses(side);
      for (const cls of [c.row, c.panel]) {
        expect(cls, `${side}: "${cls}" applies at every width`).toMatch(/^lg:/);
      }
    }
  });
});

describe("the wiring", () => {
  const BUILDER = readFileSync(
    resolve(process.cwd(), "src/components/admin/MapBuilder.tsx"), "utf8");
  const RESET = readFileSync(
    resolve(process.cwd(), "src/lib/totalReset.ts"), "utf8");

  it("uses the derived classes rather than hardcoding a side", () => {
    // A literal lg:flex-row left in the markup would pin the layout while the
    // button and the stored preference both went on working.
    expect(BUILDER).toContain("panelSideClasses");
    expect(BUILDER).toContain("sideClasses.row");
    expect(BUILDER).toContain("sideClasses.panel");
  });

  it("writes the choice down, not just into React state", () => {
    // Without this the button works perfectly and forgets on every reload.
    //
    // Checked as a CALL, not as a mention. Both this and the Total Reset check
    // below first asserted the bare identifier, and both passed with the real
    // line deleted, because the import at the top of the file still contained
    // the word. A source check that a rename would satisfy is not a check.
    expect(BUILDER, "the chosen side is never persisted")
      .toMatch(/writePanelSide\(/);
  });

  it("survives a Total Reset", () => {
    // It is a workspace layout, not progress. Total Reset wipes everything
    // outside an allowlist, so a preference missing from it is one that
    // silently resets when a player clears their game.
    //
    // Read out of the allowlist itself rather than the whole file, for the
    // same reason: the import line mentions the key too.
    const start = RESET.indexOf("const PRESERVED_KEYS");
    expect(start, "PRESERVED_KEYS not found: has it been renamed?").toBeGreaterThan(-1);
    const allowlist = RESET.slice(start, RESET.indexOf("]);", start));
    expect(allowlist, "the panel side is wiped by a Total Reset")
      .toContain("PANEL_SIDE_KEY");
  });
});
