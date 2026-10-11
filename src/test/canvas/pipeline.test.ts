/**
 * The UI redo, phase 1: the display face and the pipeline kit pieces.
 *
 * Direction B (a run is a pipeline; every between-map moment is a stage on
 * one rail) with Oxanium as the display face. Michroma stays for the logo
 * only: it is what players know the game by, but at button and card sizes it
 * wrapped ("+7h Certificate Hours" took two lines on a phone).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FONT, ROLE } from "@/ui/theme";
import { textStyle } from "@/ui/kit/style";
import { formatHours, ledgerLook, splitLedger, stageMark } from "@/ui/kit/pipelineStyle";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the display face", () => {
  it("is Oxanium, with Michroma kept for the logo alone", () => {
    expect(FONT.display.startsWith("Oxanium")).toBe(true);
    expect(FONT.logo.startsWith("Michroma")).toBe(true);
    // The title is the one place still drawn in the logo face.
    expect(read("src/ui/screens/welcomeParts.tsx").match(/fontFamily: FONT\.logo/g)?.length).toBe(2);
  });

  it("defaults to semibold, since the lightest bundled weight reads thin", () => {
    expect(textStyle({ font: "display" }).fontWeight).toBe("600");
    expect(textStyle({ font: "display", weight: "700" }).fontWeight).toBe("700");
    expect(textStyle({}).fontWeight).toBe("400");
  });

  it("is bundled, declared and preloaded, so canvas text never rasterises in a fallback", () => {
    for (const w of [500, 600, 700]) {
      expect(existsSync(resolve(process.cwd(), `public/assets/fonts/Oxanium-${w}.woff2`)), `weight ${w} missing`).toBe(true);
      expect(read("src/index.css")).toContain(`url('/assets/fonts/Oxanium-${w}.woff2')`);
      expect(read("src/ui/fonts.ts")).toContain(`"${w} 16px Oxanium"`);
    }
    expect(existsSync(resolve(process.cwd(), "public/assets/fonts/Oxanium-OFL.txt")), "the font's licence ships with it").toBe(true);
  });
});

describe("the stage rail", () => {
  const ACCENT = 0x39e38a;
  it("marks only the current stage in gold, done stages in the band's accent", () => {
    expect(stageMark("now", ACCENT).ring).toBe(ROLE.hours);
    expect(stageMark("done", ACCENT)).toMatchObject({ ring: ACCENT, filled: true });
    expect(stageMark("todo", ACCENT)).toMatchObject({ ring: ROLE.edge, filled: false, title: ROLE.muted });
  });
});

describe("the ledger", () => {
  const ACCENT = 0x39e38a;
  it("puts totals below the rule, in the order given", () => {
    const { body, totals } = splitLedger([
      { label: "a", tone: "pass" }, { label: "Earned", tone: "total" },
      { label: "b", tone: "fail" }, { label: "Run total", tone: "total" },
    ]);
    expect(body.map(r => r.label)).toEqual(["a", "b"]);
    expect(totals.map(r => r.label)).toEqual(["Earned", "Run total"]);
  });

  it("says pass, fail and total in the colours that mean them", () => {
    expect(ledgerLook("pass", ACCENT)).toMatchObject({ mark: "✓", markColor: ACCENT });
    expect(ledgerLook("fail", ACCENT)).toMatchObject({ mark: "✗", markColor: ROLE.cost });
    expect(ledgerLook("total", ACCENT)).toMatchObject({ mark: "Σ", markColor: ROLE.hours });
    expect(ledgerLook("note", ACCENT).mark).toBe("");
  });
});

describe("formatHours", () => {
  it("groups thousands and signs when asked", () => {
    expect(formatHours(1284)).toBe("1 284h");
    expect(formatHours(96, true)).toBe("+96h");
    expect(formatHours(-6, true)).toBe("-6h");
    expect(formatHours(0, true)).toBe("+0h");
    expect(formatHours(1234567)).toBe("1 234 567h");
  });
});

describe("gold and red mean hours and cost", () => {
  it("are the only warm colours in the roles", () => {
    expect(ROLE.hours).toBe(0xf2bc55);
    expect(ROLE.cost).toBe(0xff6b6b);
  });
});

describe("the samples are in the Admin gallery", () => {
  it("lists the debrief and store stages", () => {
    const g = read("src/ui/dev/gallery/between.tsx");
    expect(g).toContain('id: "Pipeline-debrief"');
    expect(g).toContain('id: "Pipeline-store"');
  });
});
