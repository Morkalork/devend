/**
 * The on-device report (lib/bootDiagnostics.ts), for a phone where the game
 * does not show and there is no console: reported as "after Tap to start, only
 * the code background", in a browser this sandbox cannot run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnosticsText, installBootDiagnostics, showDiagnostics } from "@/lib/bootDiagnostics";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the report", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.__devendBoot = { start: performance.now(), errors: ["error: boom @ chunk.js:1:2"] };
  });

  it("says what a console would: errors, the interface, the layers, the browser", () => {
    const text = diagnosticsText();
    expect(text).toContain("browser: ");
    expect(text).toContain("interface: drawn ");
    expect(text).toContain("layers: ");
    expect(text).toContain("startup still waiting on: ");
    expect(text).toContain("errors (1):");
    expect(text).toContain("error: boom @ chunk.js:1:2");
    // The canvas's own contents, or why they cannot be read.
    expect(text).toContain("probe: no interface application");
  });

  it("shows itself as plain DOM, over everything, with Copy, the on-demand switch and Close", () => {
    localStorage.removeItem("devend:uiOnDemand");
    vi.useFakeTimers();
    showDiagnostics();
    const overlay = document.getElementById("devend-diagnostics")!;
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector("pre")!.textContent).toContain("errors (1):");
    const buttons = [...overlay.querySelectorAll("button")].map(b => b.textContent);
    expect(buttons).toEqual(["Copy", "Draw every frame + reload", "Close"]);
    // The tap that opened it is not taken as a press on a button.
    overlay.querySelectorAll("button")[2].dispatchEvent(new MouseEvent("click"));
    expect(document.getElementById("devend-diagnostics")).not.toBeNull();
    vi.advanceTimersByTime(600);
    overlay.querySelectorAll("button")[2].dispatchEvent(new MouseEvent("click"));
    vi.useRealTimers();
    expect(document.getElementById("devend-diagnostics")).toBeNull();
  });

  it("offers the way back once on-demand drawing is off", () => {
    localStorage.setItem("devend:uiOnDemand", "0");
    showDiagnostics();
    const buttons = [...document.querySelectorAll("#devend-diagnostics button")].map(b => b.textContent);
    expect(buttons[1]).toBe("Draw on demand + reload");
    localStorage.removeItem("devend:uiOnDemand");
  });

  it("keeps console errors too, and is reachable from the page", () => {
    installBootDiagnostics();
    console.error(new Error("caught but broken"));
    expect(window.__devendBoot!.errors.some(e => e.includes("Error: caught but broken"))).toBe(true);
    expect(window.__devendDiag).toBe(showDiagnostics);
  });
});

describe("the wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collects errors from the page's first moment, before the game's scripts", () => {
    const html = read("index.html");
    const early = html.indexOf("var rec = window.__devendBoot");
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
    expect(html).toContain("push('failed to load: '");
    expect(html).toContain("window.addEventListener('unhandledrejection'");
  });

  it("opens on the gestures index.html listens for", () => {
    const html = read("index.html");
    const from = html.indexOf("(function () {\n        var rec = window.__devendBoot");
    const script = html.slice(from, html.indexOf("})();", from) + "})();".length);
    const opened = vi.fn();
    window.__devendDiag = opened;
    new Function(script)();
    const touch = (type: string, points: Array<[number, number]>) => {
      const e = new Event(type);
      Object.defineProperty(e, "touches", { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
      window.dispatchEvent(e);
    };
    const pointer = (x: number, y: number) => {
      const e = new Event("pointerdown");
      Object.assign(e, { clientX: x, clientY: y });
      window.dispatchEvent(e);
    };

    // One finger held: the game's own hold, never the report.
    touch("touchstart", [[100, 100]]);
    vi.advanceTimersByTime(5000);
    expect(opened).not.toHaveBeenCalled();
    // Two fingers that move (a pinch): no report.
    touch("touchstart", [[100, 100], [200, 200]]);
    touch("touchmove", [[150, 150], [250, 250]]);
    vi.advanceTimersByTime(2500);
    expect(opened).not.toHaveBeenCalled();
    touch("touchend", []);
    // Two fingers held still, even where the browser cancels the pointers.
    touch("touchstart", [[100, 100], [200, 200]]);
    window.dispatchEvent(new Event("pointercancel"));
    vi.advanceTimersByTime(2000);
    expect(opened).toHaveBeenCalledTimes(1);
    touch("touchend", []);

    // Five quick taps in the top-left corner; a tap elsewhere starts the count over.
    for (let i = 0; i < 4; i++) {
      pointer(20, 20);
    }
    pointer(300, 300);
    for (let i = 0; i < 4; i++) {
      pointer(20, 20);
    }
    expect(opened).toHaveBeenCalledTimes(1);
    pointer(20, 20);
    expect(opened).toHaveBeenCalledTimes(2);
    // Taps a few seconds apart are not "quick": the count starts over.
    for (let i = 0; i < 5; i++) {
      pointer(20, 20);
      vi.advanceTimersByTime(2500);
    }
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("reads the interface canvas through the application UiHost hands over", () => {
    const host = read("src/ui/UiHost.tsx");
    expect(host).toContain("setUiProbeApp(app);");
    expect(host).toContain("setUiProbeApp(null);");
    const probe = read("src/ui/uiProbe.ts");
    // Drawn and read back in one go, before the browser can clear the buffer.
    expect(probe).toMatch(/a\.render\(\);[\s\S]*gl\.readPixels\(/);
  });

  it("is installed first in main.tsx, and has an Admin button", () => {
    const main = read("src/main.tsx");
    expect(main.indexOf("installBootDiagnostics();")).toBeLessThan(main.indexOf("loadSoundSettings();"));
    expect(read("src/components/admin/AdminScreen.tsx")).toContain("onClick={() => showDiagnostics()}");
  });
});
