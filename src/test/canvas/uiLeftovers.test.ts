/**
 * The last of the interface that was still DOM (CANVAS_UI_PLAN.md: everything
 * but Admin draws on the canvas): the screen slide, the 404 page, the board's
 * dev readout, and framer-motion in the game's code.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCREEN_SLIDE_MS, currentScreenSlide, slideEase, slideOffset, startScreenSlide } from "@/ui/screenSlide";

const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("framer-motion is Admin's alone", () => {
  it("is imported nowhere in the game's code", () => {
    const offenders = walk("src")
      .filter(p => !p.startsWith("src/components/admin") && !p.startsWith("src/test"))
      .filter(p => /from ["']framer-motion["']/.test(read(p)));
    expect(offenders).toEqual([]);
  });

  it("the canvas reads the reduced-motion setting from its own hook", () => {
    for (const f of ["ScoreDebrief", "boardParts", "BoardAlert", "DeadlineFrame", "BoardBoot"]) {
      expect(read(`src/ui/game/${f}.tsx`)).toContain('from "../reducedMotion"');
    }
  });
});

describe("the slide between screens is the canvas's", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("moves no DOM: Index's wrapper is a plain keyed div", () => {
    const index = read("src/pages/Index.tsx");
    expect(index).not.toMatch(/AnimatePresence|motion\.div/);
    expect(index).toContain("startScreenSlide(currOrder >= prevOrder ? 1 : -1);");
    // Not to or from a board screen: the board is a DOM canvas the slide cannot carry.
    expect(index).toContain("if (BOARD_SCREENS.includes(prev) || BOARD_SCREENS.includes(next)) return;");
    expect(read("src/ui/CanvasUiRoot.tsx")).toContain("left: slideX");
  });

  it("carries the new screen in from the side, on the old slide's curve and time", () => {
    expect(SCREEN_SLIDE_MS).toBe(280);
    expect(slideOffset(0, 1, 400)).toBe(400);
    expect(slideOffset(0, -1, 400)).toBe(-400);
    expect(slideOffset(SCREEN_SLIDE_MS, 1, 400)).toBe(0);
    // Eased: most of the way there by half time.
    expect(slideEase(0.5)).toBeGreaterThan(0.75);
    expect(slideEase(0)).toBe(0);
    expect(slideEase(1)).toBe(1);
  });

  it("does not slide at all for a player who asks for less motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const before = currentScreenSlide();
    startScreenSlide(1, 123456);
    expect(currentScreenSlide()).toBe(before);
  });
});

describe("the rest", () => {
  it("the 404 page draws on the canvas", () => {
    const page = read("src/pages/NotFound.tsx");
    expect(page).toContain("<NotFoundScreen");
    expect(page).toContain("<CanvasUiRoot />");
    expect(page).not.toContain("className=");
    expect(read("src/ui/dev/gallery/meta.tsx")).toContain('id: "NotFoundScreen"');
  });

  it("the board's dev readout is on the canvas", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("<BoardSizeReadout");
    expect(canvas).not.toMatch(/<div className="absolute top-2 right-2/);
  });

  it("the crash card stays DOM, on purpose: it has to show when the canvas is what broke", () => {
    expect(read("src/components/GameErrorBoundary.tsx")).toContain("className=");
  });
});
