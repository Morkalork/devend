/**
 * The code a syntax highlighting area shows has to fit inside the zone, at
 * any size a map draws one, and stay a readable size either way.
 */
import { describe, it, expect } from "vitest";
import { areaSnippet } from "@/lib/coloredAreas";
import {
  snippetFontPx, MIN_FONT_PX, MAX_FONT_PX, MONO_ADVANCE, LINE_HEIGHT, TEXT_PAD,
} from "@/lib/rendering/sleek/areaSnippet";

const cols = (kind: "light" | "dark") =>
  Math.max(...areaSnippet(kind).map(l => l.reduce((n, t) => n + t.text.length, 0)));

describe("snippetFontPx", () => {
  it("fits the snippet and its padding inside a normal zone, both ways", () => {
    for (const kind of ["light", "dark"] as const) {
      for (const [w, h] of [[340, 340], [220, 220], [400, 120], [120, 400]]) {
        const px = snippetFontPx(areaSnippet(kind), w, h);
        expect((cols(kind) * MONO_ADVANCE + TEXT_PAD * 2) * px).toBeLessThanOrEqual(w);
        expect((areaSnippet(kind).length * LINE_HEIGHT + TEXT_PAD * 2) * px).toBeLessThanOrEqual(h);
      }
    }
  });

  it("never goes below the readable floor or above the cap", () => {
    expect(snippetFontPx(areaSnippet("dark"), 10, 10)).toBe(MIN_FONT_PX);
    expect(snippetFontPx(areaSnippet("light"), 5000, 5000)).toBe(MAX_FONT_PX);
  });

  it("grows with the zone", () => {
    const small = snippetFontPx(areaSnippet("light"), 150, 150);
    const big = snippetFontPx(areaSnippet("light"), 300, 300);
    expect(big).toBeGreaterThan(small);
  });
});
