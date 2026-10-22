/**
 * An on-device report, for when the game does not show up on someone's phone.
 *
 * Reported: after "Tap to start", only the code background and nothing else,
 * on a phone, in a browser this sandbox cannot run, and not reproducible in
 * Chromium. A phone has no console to read, so this collects what one would
 * show: errors caught from the page's first moment (index.html starts the
 * list before any script loads), the interface canvas's size, style and GPU
 * state, which interface layers are mounted, what the startup is still
 * waiting on, and the browser itself. It is plain DOM, so it shows even when
 * the canvas shows nothing.
 *
 * Open it with two fingers held still for two seconds, or five quick taps in
 * the top-left corner (index.html listens), or from Admin. Copy sends the text
 * to the clipboard, to paste into a message. The on-demand switch is Admin's
 * "Interface draws on demand", here too because a phone that shows nothing
 * cannot reach Admin: flipping it reloads, and tells "the canvas draws too
 * rarely" apart from "the canvas draws and still shows nothing".
 */
import { isUiOnDemandEnabled, setUiOnDemandEnabled, uiRenderStats } from "@/ui/onDemand";
import { uiLayerIds } from "@/ui/layerStore";
import { pendingStartupParts } from "@/lib/startupReadiness";
import { uiProbeLines } from "@/ui/uiProbe";

interface BootRecord {
  start: number;
  errors: string[];
}

declare global {
  interface Window {
    __devendBoot?: BootRecord;
    __devendDiag?: () => void;
  }
}

const OVERLAY_ID = "devend-diagnostics";
/** Button taps ignored this long after opening. */
const OPENING_TAP_MS = 500;

function boot(): BootRecord {
  if (!window.__devendBoot) {
    window.__devendBoot = { start: performance.now(), errors: [] };
  }
  return window.__devendBoot;
}

/** Keep the last few console errors too: a caught error still says what broke. */
function hookConsoleErrors(): void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const record = boot();
    const text = args.map(a => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" ");
    record.errors.push(`console: ${text.slice(0, 400)}`);
    if (record.errors.length > 30) record.errors.splice(0, record.errors.length - 30);
    original(...args);
  };
}

function describeCanvas(c: HTMLCanvasElement): string {
  const r = c.getBoundingClientRect();
  const cs = getComputedStyle(c);
  let gl = "no gl";
  // Only the interface canvas: asking any other canvas for a WebGL context
  // could CREATE one, which is the last thing a report should do.
  if (c.classList.contains("canvas-ui-surface")) {
    try {
      const ctx = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
      gl = ctx ? `gl ${ctx.isContextLost() ? "LOST" : "ok"}` : "gl null";
    } catch (e) {
      gl = `gl threw ${String(e)}`;
    }
  }
  return `canvas.${c.className || "(no class)"} css ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}`
    + ` buffer ${c.width}x${c.height} display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity} z=${cs.zIndex} ${gl}`;
}

/** Everything above, as text. */
export function diagnosticsText(): string {
  const record = boot();
  const stats = uiRenderStats();
  const vv = window.visualViewport;
  const lines = [
    `time since load: ${Math.round((performance.now() - record.start) / 1000)}s`,
    `browser: ${navigator.userAgent}`,
    `screen: ${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio}`
      + (vv ? ` visual ${Math.round(vv.width)}x${Math.round(vv.height)} scale ${vv.scale}` : ""),
    `language: ${document.documentElement.lang || "?"} / ${navigator.language}`,
    `interface: drawn ${stats.draws} frames, on demand ${stats.onDemand}, context lost ${stats.contextLosses}x, restored ${stats.contextRestores}x`,
    `layers: ${uiLayerIds().join(", ") || "none"}`,
    `startup still waiting on: ${pendingStartupParts().join(", ") || "nothing"}`,
    `splash: ${document.getElementById("boot-splash") ? "still up" : "gone"}`,
    `html class: ${document.documentElement.className}`,
    ...[...document.querySelectorAll("canvas")].map(c => describeCanvas(c)),
    ...uiProbeLines(),
    `errors (${record.errors.length}):`,
    ...record.errors.map(e => `  ${e}`),
  ];
  return lines.join("\n");
}

/** Show the report over everything, with Copy and Close. */
export function showDiagnostics(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  const text = diagnosticsText();
  const wrap = document.createElement("div");
  wrap.id = OVERLAY_ID;
  wrap.setAttribute("style", [
    "position:fixed", "inset:0", "z-index:2147483647", "background:rgba(5,8,10,0.96)", "color:#c8ffd8",
    "font:12px/1.4 monospace", "padding:16px", "overflow:auto", "pointer-events:auto", "touch-action:auto",
    "-webkit-user-select:text", "user-select:text",
  ].join(";"));
  const bar = document.createElement("div");
  bar.setAttribute("style", "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px");
  // The tap that opened it (the fifth in the corner) lands on Copy as a click.
  const openedAt = performance.now();
  const button = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("style", "padding:8px 14px;border:1px solid #00ff88;background:#0d1012;color:#00ff88;font:14px monospace;border-radius:6px");
    b.addEventListener("click", e => {
      e.stopPropagation();
      if (performance.now() - openedAt < OPENING_TAP_MS) {
        return;
      }
      onClick();
    });
    return b;
  };
  const pre = document.createElement("pre");
  pre.textContent = text;
  pre.setAttribute("style", "white-space:pre-wrap;word-break:break-word;margin:0");
  const copy = button("Copy", () => {
    navigator.clipboard?.writeText(text).then(() => { copy.textContent = "Copied"; }, () => window.prompt("Copy this", text));
  });
  const onDemand = isUiOnDemandEnabled();
  const toggle = button(onDemand ? "Draw every frame + reload" : "Draw on demand + reload", () => {
    setUiOnDemandEnabled(!onDemand);
    window.location.reload();
  });
  bar.append(copy, toggle, button("Close", () => wrap.remove()));
  wrap.append(bar, pre);
  document.body.appendChild(wrap);
}

/** Called once from main.tsx, before the app renders. */
export function installBootDiagnostics(): void {
  boot();
  hookConsoleErrors();
  window.__devendDiag = showDiagnostics;
}
