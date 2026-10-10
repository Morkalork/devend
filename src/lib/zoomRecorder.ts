/**
 * Stage 0 of CANVAS_UI_PLAN.md: when the board zooms or shrinks, record what
 * actually happened, so the next report says which mechanism it was.
 *
 * Eight fixes have each closed one way the board ends up the wrong size under
 * a finger (CANVAS_UI_PLAN.md section 1), and every report since has looked
 * the same from the outside: "it zoomed while I drew a fence". From the inside
 * they are different events - the visual viewport scaling (the browser's
 * zoom), the window resizing (the URL bar), the board being re-laid out (the
 * game reacting to either) - and each one starts from a touch that landed on
 * either the canvas or the DOM around it. This keeps a short log of all of
 * them, with whether a finger was down and where that touch began, on the
 * device, and Admin's ZoomRecorderCard shows it and copies it out.
 *
 * Installed once at startup on every screen. Cheap: a handful of passive
 * listeners and a capped ring of entries written to localStorage.
 */
export const ZOOM_LOG_KEY = "devend:zoom-log";
/** How many entries are kept. Enough for a few incidents with context. */
export const ZOOM_LOG_CAP = 60;

export type ZoomEventKind = "viewport" | "resize" | "board" | "touch";

export interface ZoomLogEntry {
  /** ms since the page loaded. */
  t: number;
  /** wall clock, ISO. */
  at: string;
  kind: ZoomEventKind;
  /** viewport: scale and offset; resize: window size; board: board rect; touch: start point. */
  detail: string;
  /** Fingers down when it happened. */
  fingers: number;
  /** What the current (or last) touch began on: "canvas" or a short DOM description. */
  startedOn: string;
}

let log: ZoomLogEntry[] | null = null;
let fingers = 0;
let startedOn = "none";

function load(): ZoomLogEntry[] {
  if (log) return log;
  try {
    const raw = localStorage.getItem(ZOOM_LOG_KEY);
    log = raw ? (JSON.parse(raw) as ZoomLogEntry[]) : [];
  } catch {
    log = [];
  }
  return log;
}

function save(): void {
  try { localStorage.setItem(ZOOM_LOG_KEY, JSON.stringify(log ?? [])); } catch { /* private mode */ }
}

function now(): number {
  return typeof performance !== "undefined" ? Math.round(performance.now()) : 0;
}

/** Add one entry. Exported for GameCanvas's board re-layout and for tests. */
export function recordZoomEvent(kind: ZoomEventKind, detail: string): void {
  const entries = load();
  entries.push({ t: now(), at: new Date().toISOString(), kind, detail, fingers, startedOn });
  if (entries.length > ZOOM_LOG_CAP) entries.splice(0, entries.length - ZOOM_LOG_CAP);
  save();
}

export function getZoomLog(): ZoomLogEntry[] {
  return [...load()];
}

export function clearZoomLog(): void {
  log = [];
  try { localStorage.removeItem(ZOOM_LOG_KEY); } catch { /* private mode */ }
}

/** A short, stable description of what a touch landed on. */
export function describeTarget(target: EventTarget | null): string {
  const el = target as Element | null;
  if (!el || typeof el.tagName !== "string") return "unknown";
  if (el.tagName === "CANVAS") return "canvas";
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className.trim()
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
}

/** Watch the page. Returns the uninstaller. */
export function installZoomRecorder(win: Window): () => void {
  const vv = win.visualViewport;
  let last = { scale: vv?.scale ?? 1, w: win.innerWidth, h: win.innerHeight };

  const onViewport = () => {
    if (!vv) return;
    // Only a real change of scale or a shove off the origin; the viewport
    // fires on every scroll pixel otherwise.
    const scaled = Math.abs(vv.scale - last.scale) > 0.01;
    const shoved = Math.abs(vv.offsetLeft) > 1 || Math.abs(vv.offsetTop) > 1;
    if (!scaled && !(shoved && vv.scale !== 1)) return;
    last = { ...last, scale: vv.scale };
    recordZoomEvent("viewport",
      `scale ${vv.scale.toFixed(3)} offset ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}`);
  };
  const onResize = () => {
    if (win.innerWidth === last.w && win.innerHeight === last.h) return;
    recordZoomEvent("resize", `${last.w}x${last.h} -> ${win.innerWidth}x${win.innerHeight}`);
    last = { ...last, w: win.innerWidth, h: win.innerHeight };
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    fingers++;
    if (fingers === 1) startedOn = describeTarget(e.target);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    fingers = Math.max(0, fingers - 1);
  };

  vv?.addEventListener("resize", onViewport);
  vv?.addEventListener("scroll", onViewport);
  win.addEventListener("resize", onResize);
  // Capture, so a handler that stops propagation cannot hide the touch.
  win.addEventListener("pointerdown", onDown, { capture: true, passive: true });
  win.addEventListener("pointerup", onUp, { capture: true, passive: true });
  win.addEventListener("pointercancel", onUp, { capture: true, passive: true });
  return () => {
    vv?.removeEventListener("resize", onViewport);
    vv?.removeEventListener("scroll", onViewport);
    win.removeEventListener("resize", onResize);
    win.removeEventListener("pointerdown", onDown, { capture: true });
    win.removeEventListener("pointerup", onUp, { capture: true });
    win.removeEventListener("pointercancel", onUp, { capture: true });
  };
}

/** The log as plain text, for pasting into a message. */
export function zoomLogText(entries: ZoomLogEntry[], userAgent = ""): string {
  const lines = entries.map(e =>
    `${e.at} +${e.t}ms ${e.kind}: ${e.detail} | fingers ${e.fingers} | started on ${e.startedOn}`);
  if (userAgent) lines.push(`ua: ${userAgent}`);
  return lines.join("\n") || "no zoom events recorded";
}
