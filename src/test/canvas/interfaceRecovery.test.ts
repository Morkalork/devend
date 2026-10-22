/**
 * The interface canvas recovers from what its change marks cannot see.
 *
 * Reported: "after the loading splash all I see is the code background,
 * nothing happens", on a phone, the day the interface started drawing only
 * when something on it changed (ui/onDemand.ts). The exact cause could not be
 * reproduced headless; what could be is the class of failure: a canvas
 * cleared under a scene that has not changed stays blank until something on
 * it moves, and after a GPU context restore every label was missing for good.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HEARTBEAT_MS, REDRAW_EVENTS, shouldDraw } from "@/ui/onDemand";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("when the interface draws", () => {
  it("on a change, a forced frame, or the heartbeat, and otherwise not", () => {
    expect(shouldDraw(true, 0, 1000, 990)).toBe(true);
    expect(shouldDraw(false, 1, 1000, 990)).toBe(true);
    expect(shouldDraw(false, 0, 1000, 990)).toBe(false);
    expect(shouldDraw(false, 0, 1000 + HEARTBEAT_MS, 1000)).toBe(true);
  });

  it("keeps the heartbeat slow: a few frames a second, against the old sixty", () => {
    expect(HEARTBEAT_MS).toBeGreaterThanOrEqual(200);
    expect(HEARTBEAT_MS).toBeLessThanOrEqual(500);
  });

  it("draws at once when the page is shown, focused, resized or turned", () => {
    expect([...REDRAW_EVENTS]).toEqual(expect.arrayContaining(["pageshow", "focus", "resize", "orientationchange"]));
    const src = read("src/ui/onDemand.ts");
    expect(src).toContain('document.addEventListener("visibilitychange", onVisible);');
    expect(src).toContain("for (const type of REDRAW_EVENTS) window.addEventListener(type, onResize);");
  });
});

describe("a GPU context lost and restored", () => {
  const host = read("src/ui/UiHost.tsx");

  it("rebuilds every layer, so the text Pixi cannot restore is drawn again", () => {
    expect(host).toContain('canvas.addEventListener("webglcontextrestored", onRestored);');
    expect(host).toContain("setEpoch(e => e + 1);");
    expect(host).toContain("<Fragment key={epoch}>{children}</Fragment>");
  });

  it("is counted, for Admin", () => {
    expect(host).toContain("noteUiContextLost()");
    expect(read("src/components/admin/AdminScreen.tsx")).toContain("uiRenderStats()");
  });

  it("does not bring the startup splash back with the rebuild", () => {
    const gate = read("src/ui/screens/TapToStartGate.tsx");
    expect(gate).toContain("const [alreadyDone] = useState(() => splashDone && !preview);");
    expect(gate).toMatch(/splashDone = true;\s*requestUiRender\(\);/);
  });
});
