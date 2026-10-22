/**
 * Compatibility switches for the interface canvas, per device.
 *
 * Reported on Opera for Android (PowerVR, WebGL through ANGLE on Vulkan):
 * after "Tap to start", only the code background. The on-device report showed
 * the canvas drawing the menu, every pixel of a frame read back and the menu
 * on screen at full opacity, so the browser was not putting the canvas on
 * screen. Chrome on the same phone does. The usual suspects on such a driver
 * are the multisampled buffer the canvas is resolved from and the canvas's
 * transparency, and each of these turns one of them off, so a phone can show
 * which one it is (the report and Admin both have them) before any default
 * changes for everyone.
 */
const KEY = "devend:uiCanvasCompat";

export type CanvasCompatFlag = "noAntialias" | "preserveBuffer" | "opaque";

export const CANVAS_COMPAT_FLAGS: ReadonlyArray<{ flag: CanvasCompatFlag; label: string; hint: string }> = [
  { flag: "noAntialias", label: "Antialias off", hint: "no multisampled buffer to resolve" },
  { flag: "preserveBuffer", label: "Keep drawing buffer", hint: "the browser shows the buffer as drawn, never a cleared one" },
  { flag: "opaque", label: "Opaque canvas (test only)", hint: "no transparency; hides the board in a map" },
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
    preserveBuffer: stored.includes("preserveBuffer"),
    opaque: stored.includes("opaque"),
  };
}

export function setCanvasCompat(flag: CanvasCompatFlag, on: boolean): void {
  const next = { ...getCanvasCompat(), [flag]: on };
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
