/**
 * The code a syntax highlighting area shows has to fit inside the zone, at
 * any size a map draws one, and stay a readable size either way.
 */
import { describe, it, expect } from "vitest";
import { AREA_KINDS, areaSnippet, type SnippetToken } from "@/lib/coloredAreas";
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

describe("the snippet compiles when a ball is locked in", () => {
  const text = (kind: "light" | "dark", locked: boolean) =>
    areaSnippet(kind, locked).map(l => l.map(t => t.text).join("")).join("\n");

  it("is a block of HTML with the lock tag and payout while the zone waits", () => {
    for (const kind of ["light", "dark"] as const) {
      const html = text(kind, false);
      expect(html).toContain("<lock ball=\"1\">");
      expect(html).toContain(`<pts x="${AREA_KINDS[kind].multiplier}"/>`);
      expect(html.split("\n").length).toBeGreaterThanOrEqual(6);
      expect(areaSnippet(kind)).toEqual(areaSnippet(kind, false));
    }
  });

  it("is hacky assembly once a ball is locked, still quoting the payout", () => {
    expect(text("light", true)).toContain("imul pts,1.5");
    expect(text("dark", true)).toContain("imul pts,2");
    for (const kind of ["light", "dark"] as const) {
      const asm = text(kind, true);
      expect(asm).toContain("lock cmpxchg");
      expect(asm).toContain("jmp  0xDEADBEEF");
      expect(asm).not.toMatch(/[<>]/);
    }
  });

  it("looks different at a glance: other lines, other colours", () => {
    for (const kind of ["light", "dark"] as const) {
      const html = areaSnippet(kind, false).map(l => l.map(t => t.text).join(""));
      const asm = areaSnippet(kind, true).map(l => l.map(t => t.text).join(""));
      expect(asm.filter(l => html.includes(l))).toEqual([]);
      // The assembly leans on comments and hex the HTML barely uses.
      const share = (lines: SnippetToken[][], role: SnippetToken["role"]) => {
        const all = lines.flat();
        return all.filter(t => t.role === role).reduce((n, t) => n + t.text.length, 0)
          / all.reduce((n, t) => n + t.text.length, 0);
      };
      expect(share(areaSnippet(kind, true), "comment")).toBeGreaterThan(share(areaSnippet(kind, false), "comment"));
      expect(share(areaSnippet(kind, true), "string")).toBe(0);
      expect(share(areaSnippet(kind, false), "string")).toBeGreaterThan(0);
    }
  });

  it("keeps every line short, so a small zone's text stays readable", () => {
    for (const kind of ["light", "dark"] as const) {
      for (const locked of [false, true]) {
        for (const line of areaSnippet(kind, locked)) {
          expect(line.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(18);
        }
      }
    }
  });

  it("fits the locked zone as well as the waiting one", () => {
    const px = snippetFontPx(areaSnippet("dark", true), 220, 220);
    const cols = Math.max(...areaSnippet("dark", true).map(l => l.reduce((n, t) => n + t.text.length, 0)));
    expect((cols * MONO_ADVANCE + TEXT_PAD * 2) * px).toBeLessThanOrEqual(220);
  });
});
