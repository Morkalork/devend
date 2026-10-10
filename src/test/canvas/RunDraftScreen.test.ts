/**
 * The canvas Sprint Planning screen (RunDraftScreen), carried over from the
 * screen half of superiorHatch.test.ts ("Sprint Planning can be left"), plus
 * the grid and paragraph rules the draft screens share.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { draftColumns, gridRows, richWords } from "@/ui/screens/draftModel";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/screens/RunDraftScreen.tsx"), "utf8");

describe("Sprint Planning can be left", () => {
  it("offers a back button", () => {
    expect(SRC).toMatch(/onBack\?: \(\) => void;/);
    expect(SRC).toMatch(/onTap=\{onBack\}/);
  });

  it("can be skipped to play vanilla", () => {
    expect(SRC).toMatch(/onTap=\{\(\) => onConfirm\(null\)\}/);
  });
});

describe("the draft grid", () => {
  it("is one column on a phone", () => {
    expect(draftColumns(3, 390).columns).toBe(1);
  });

  it("centres a pair in a narrower two-wide grid instead of leaving a hole", () => {
    expect(draftColumns(2, 800)).toEqual({ columns: 2, maxWidth: 576 });
    expect(draftColumns(3, 800).columns).toBe(3);
    // The ascension draft was always three-wide.
    expect(draftColumns(2, 800, true).columns).toBe(3);
  });

  it("splits cards into rows", () => {
    expect(gridRows([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [4]]);
  });
});

describe("a paragraph with a bold word", () => {
  it("keeps punctuation glued to the bold word across the weight change", () => {
    const groups = richWords([{ text: "keep one " }, { text: "loadout", bold: true }, { text: ", per ascension." }]);
    expect(groups.map(g => g.map(w => w.text).join(""))).toEqual(["keep", "one", "loadout,", "per", "ascension."]);
    expect(groups[2][0].bold).toBe(true);
  });

  it("opens a space where the text had one", () => {
    const groups = richWords([{ text: "one " }, { text: "loadout", bold: true }, { text: " per" }]);
    expect(groups).toHaveLength(3);
  });
});
