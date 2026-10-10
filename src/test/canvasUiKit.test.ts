/**
 * The canvas interface's foundation (CANVAS_UI_PLAN.md stage 1): the colours
 * match the DOM interface's, the layout defaults behave like the DOM's block
 * flow, and the host's input wiring keeps the fixes that made taps work.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hsl, hex, COLOR } from "@/ui/theme";
import { tint, withAlpha } from "@/ui/kit/style";
import { HOLD_MS } from "@/ui/kit/press";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the theme", () => {
  it("converts hsl the way CSS does", () => {
    expect(hsl(0, 0, 100)).toBe(0xffffff);
    expect(hsl(0, 100, 50)).toBe(0xff0000);
    expect(hsl(120, 100, 25)).toBe(0x008000);
    // --primary: 145 100% 53%
    expect(COLOR.primary).toBe(hsl(145, 100, 53));
    expect(hex("#10ff73")).toBe(0x10ff73);
  });

  it("writes translucent colours as #rrggbbaa and flattens on demand", () => {
    expect(tint(0xff0000, 0.5)).toBe("#ff000080");
    expect(tint(0x00ff00, 0)).toBe("#00ff0000");
    expect(withAlpha(0xffffff, 1, 0x000000)).toBe(0xffffff);
    expect(withAlpha(0xffffff, 0, 0x000000)).toBe(0x000000);
  });

  it("holds for the game's standard explainer time", () => {
    expect(HOLD_MS).toBe(450);
  });
});

describe("layout defaults", () => {
  it("stack boxes like DOM blocks and never squeeze content", () => {
    const setup = read("src/ui/setup.ts");
    expect(setup).toMatch(/defaultStyle\.shared\.flexDirection = "column"/);
    expect(setup).toMatch(/defaultStyle\.shared\.flexShrink = 0/);
  });

  it("pin a wrapping label's width so the wrap cannot ratchet narrower", () => {
    expect(read("src/ui/kit/core.tsx")).toMatch(/layout=\{\{ width: wrapWidth/);
  });
});

describe("the host", () => {
  const host = read("src/ui/UiHost.tsx");

  it("waits for the app's init (Yoga) before rendering the tree", () => {
    expect(host).toMatch(/onInit=\{\(\) => setAppReady\(true\)\}/);
    expect(host).toMatch(/\{appReady && children\}/);
  });

  it("listens on the page, maps from its own canvas, and keeps taps from cancelling", () => {
    expect(host).toMatch(/setTargetElement\(target\)/);
    expect(host).toMatch(/mapPositionToPoint = \(point, x, y\)/);
    // Detached before the pointer-up handler is swapped, or both stay attached.
    expect(host.indexOf("setTargetElement(null")).toBeLessThan(host.indexOf("internal._onPointerUp = function"));
    expect(host).toMatch(/this\.domElement\.contains\(hit\)/);
  });

  it("locks the page while it is up and lets the board ask who owns a touch", () => {
    expect(host).toMatch(/classList\.add\("canvas-ui"\)/);
    expect(read("src/index.css")).toMatch(/html\.canvas-ui,\s*html\.canvas-ui body \{/);
    expect(host).toMatch(/setUiHitTester\(/);
  });

  it("is reachable from Admin", () => {
    expect(read("src/components/admin/AdminScreen.tsx")).toMatch(/id="admin-canvas-kit"/);
  });
});
