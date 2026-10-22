/**
 * Compatibility switches for the game's WebGL canvases, per device, and the
 * one GPU rule they found.
 *
 * Reported on Opera for Android (PowerVR, WebGL through ANGLE on Vulkan):
 * after "Tap to start", only the code background. The on-device report showed
 * the interface canvas drawing the menu (every pixel of a frame read back,
 * the menu on screen at full opacity) and the phone not showing it, while
 * Chrome on the same phone did. Of the switches below, antialias off made it
 * show: the browser never presented a multisampled, transparent canvas. So on
 * PowerVR through Vulkan every game canvas (the interface, the 3D board and
 * the 2D board) is made without MSAA, by itself (msaaHidesCanvas).
 *
 * The switches stay, in Admin and in the on-device report, for the next
 * device like it: one forces antialias off anywhere, one forces it back on
 * past the rule (to see the bug again), and two are further tests for the
 * interface canvas. Each applies on reload: a canvas is made once.
 */
const KEY = "devend:uiCanvasCompat";

export type CanvasCompatFlag = "noAntialias" | "forceAntialias" | "preserveBuffer" | "opaque";

export const CANVAS_COMPAT_FLAGS: ReadonlyArray<{ flag: CanvasCompatFlag; label: string; hint: string }> = [
  { flag: "noAntialias", label: "Antialias off", hint: "every game canvas, on any GPU: no multisampled buffer to resolve" },
  { flag: "forceAntialias", label: "Antialias on past the GPU rule", hint: "brings back what PowerVR on Vulkan cannot show (test)" },
  { flag: "preserveBuffer", label: "Keep drawing buffer", hint: "interface: the browser shows the buffer as drawn, never a cleared one" },
  { flag: "opaque", label: "Opaque canvas (test only)", hint: "interface: no transparency; hides the board in a map" },
];

export type CanvasCompat = Record<CanvasCompatFlag, boolean>;

export function getCanvasCompat(): CanvasCompat {
  let stored: string[] = [];
  try {
    stored = (localStorage.getItem(KEY) ?? "").split(",");
  } catch {
    // Storage blocked: every switch off.
  }
  return {
    noAntialias: stored.includes("noAntialias"),
    forceAntialias: stored.includes("forceAntialias"),
    preserveBuffer: stored.includes("preserveBuffer"),
    opaque: stored.includes("opaque"),
  };
}

export function setCanvasCompat(flag: CanvasCompatFlag, on: boolean): void {
  const next = { ...getCanvasCompat(), [flag]: on };
  // The two antialias switches contradict each other: the newer one wins.
  if (on && flag === "noAntialias") {
    next.forceAntialias = false;
  }
  if (on && flag === "forceAntialias") {
    next.noAntialias = false;
  }
  const list = CANVAS_COMPAT_FLAGS.map(f => f.flag).filter(f => next[f]);
  try {
    if (list.length) {
      localStorage.setItem(KEY, list.join(","));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // Storage blocked: the switch does not stick.
  }
}

/** The switches that are on, for the report: "none" when it runs as shipped. */
export function canvasCompatText(): string {
  const c = getCanvasCompat();
  const on = CANVAS_COMPAT_FLAGS.filter(f => c[f.flag]).map(f => f.flag);
  return on.length ? on.join(", ") : "none";
}

let gpu: string | null | undefined;

/** The GPU as WebGL names it, read once from a throwaway context. Null where there is no WebGL. */
export function gpuRenderer(): string | null {
  if (gpu !== undefined) {
    return gpu;
  }
  gpu = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // No WebGL to ask: no rule applies.
  }
  return gpu;
}

/** PowerVR through Vulkan draws a multisampled canvas and never shows it. */
export function msaaHidesCanvas(renderer: string | null): boolean {
  return !!renderer && /PowerVR|Imagination/i.test(renderer) && /Vulkan/i.test(renderer);
}

/** Whether a game canvas is made with MSAA: the switches first, then the GPU rule. */
export function canvasAntialias(compat: CanvasCompat = getCanvasCompat(), renderer: string | null = gpuRenderer()): boolean {
  if (compat.noAntialias) {
    return false;
  }
  if (compat.forceAntialias) {
    return true;
  }
  return !msaaHidesCanvas(renderer);
}

/** For the report: on or off, and why. */
export function canvasAntialiasText(): string {
  const c = getCanvasCompat();
  const on = canvasAntialias(c);
  const why = c.noAntialias ? "switched off" : c.forceAntialias ? "forced on" : msaaHidesCanvas(gpuRenderer()) ? "off by the PowerVR-on-Vulkan rule" : "default";
  return `${on ? "on" : "off"} (${why})`;
}
