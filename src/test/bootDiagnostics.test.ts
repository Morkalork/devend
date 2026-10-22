/**
 * The on-device report (lib/bootDiagnostics.ts), for a phone where the game
 * does not show and there is no console: reported as "after Tap to start, only
 * the code background", in a browser this sandbox cannot run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnosticsText, installBootDiagnostics, showDiagnostics } from "@/lib/bootDiagnostics";
import {
  CANVAS_COMPAT_FLAGS, canvasAntialias, canvasCompatText, getCanvasCompat, msaaHidesCanvas, setCanvasCompat,
} from "@/lib/rendering/canvasCompat";

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
    expect(buttons).toEqual([
      "Copy", "Draw every frame + reload", "Close",
      "[off] Antialias off + reload", "[off] Antialias on past the GPU rule + reload",
      "[off] Keep drawing buffer + reload", "[off] Opaque canvas (test only) + reload",
    ]);
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

describe("the interface canvas's compatibility switches", () => {
  // Opera for Android on a PowerVR phone drew the menu (every pixel read back)
  // and never showed it; Chrome on the same phone did.
  beforeEach(() => {
    localStorage.removeItem("devend:uiCanvasCompat");
  });

  it("are all off as shipped, and each one sticks on its own", () => {
    expect(getCanvasCompat()).toEqual({ noAntialias: false, forceAntialias: false, preserveBuffer: false, opaque: false });
    expect(canvasCompatText()).toBe("none");
    setCanvasCompat("noAntialias", true);
    setCanvasCompat("opaque", true);
    expect(getCanvasCompat()).toEqual({ noAntialias: true, forceAntialias: false, preserveBuffer: false, opaque: true });
    expect(canvasCompatText()).toBe("noAntialias, opaque");
    setCanvasCompat("noAntialias", false);
    setCanvasCompat("opaque", false);
    expect(localStorage.getItem("devend:uiCanvasCompat")).toBeNull();
  });

  it("are what the interface canvas is made with", () => {
    const host = read("src/ui/UiHost.tsx");
    expect(host).toContain("backgroundAlpha={compat.opaque ? 1 : 0}");
    expect(host).toContain("antialias={canvasAntialias(compat)}");
    expect(host).toContain("preserveDrawingBuffer={compat.preserveBuffer}");
  });

  it("are in the report, which says which are on, and in Admin", () => {
    setCanvasCompat("preserveBuffer", true);
    expect(diagnosticsText()).toContain("canvas switches on: preserveBuffer");
    setCanvasCompat("preserveBuffer", false);
    const admin = read("src/components/admin/AdminScreen.tsx");
    expect(admin).toContain("CANVAS_COMPAT_FLAGS.map(");
    expect(CANVAS_COMPAT_FLAGS.map(f => f.flag)).toEqual(["noAntialias", "forceAntialias", "preserveBuffer", "opaque"]);
    expect(diagnosticsText()).toMatch(/antialias: (on|off) \(/);
  });

  // The phone's own GPU line, from its report: antialias off was what made it show.
  const OPERA_POWERVR = "ANGLE (Google Inc. (Imagination Technologies), ANGLE (Imagination Technologies Vulkan 1.4.317 "
    + "(PowerVR C-Series CXTP-48-1536 MC1 (0x70061042)) PowerVR C-Series Vulkan Driver-1.662.3024), OpenGL ES 3.2)";
  const off = { noAntialias: false, forceAntialias: false, preserveBuffer: false, opaque: false };

  it("turn MSAA off by themselves on PowerVR through Vulkan, and only there", () => {
    expect(msaaHidesCanvas(OPERA_POWERVR)).toBe(true);
    expect(canvasAntialias(off, OPERA_POWERVR)).toBe(false);
    // The same chip on OpenGL ES, other GPUs, and no WebGL: as shipped.
    expect(msaaHidesCanvas("ANGLE (Imagination Technologies, PowerVR C-Series, OpenGL ES 3.2)")).toBe(false);
    expect(msaaHidesCanvas("ANGLE (Qualcomm, Adreno (TM) 642L, OpenGL ES 3.2)")).toBe(false);
    expect(msaaHidesCanvas("ANGLE (ARM, Mali-G68 MC4, Vulkan 1.1)")).toBe(false);
    expect(msaaHidesCanvas(null)).toBe(false);
    expect(canvasAntialias(off, "ANGLE (ARM, Mali-G68 MC4, Vulkan 1.1)")).toBe(true);
  });

  it("let a tester force it either way past the rule, the newer switch winning", () => {
    expect(canvasAntialias({ ...off, forceAntialias: true }, OPERA_POWERVR)).toBe(true);
    expect(canvasAntialias({ ...off, noAntialias: true }, "ANGLE (ARM, Mali-G68 MC4, Vulkan 1.1)")).toBe(false);
    setCanvasCompat("forceAntialias", true);
    setCanvasCompat("noAntialias", true);
    expect(getCanvasCompat()).toMatchObject({ noAntialias: true, forceAntialias: false });
    setCanvasCompat("forceAntialias", true);
    expect(getCanvasCompat()).toMatchObject({ noAntialias: false, forceAntialias: true });
  });

  it("decide MSAA for every game canvas: the interface and both boards", () => {
    expect(read("src/lib/rendering/three/ThreeRenderer.ts")).toContain("canvas, antialias: canvasAntialias(),");
    expect(read("src/lib/rendering/sleek/SleekRenderer.ts")).toContain("antialias: canvasAntialias(),");
    expect(read("src/lib/rendering/rendererDiag.ts")).toContain("antialias: canvasAntialias() }");
  });
});
