/**
 * What happened the last time this device tried to start the 3D board.
 *
 * The 3D board falls back to the 2D one when it cannot start (GameCanvas), and
 * by design the fallback is silent: a player should get a working board, not
 * an error. The cost of that showed on the first real phone - "it is still the
 * old 2D design" - with nothing anywhere saying whether 3D had failed, why, or
 * whether the device had simply been switched to 2D in Admin. So every start
 * is recorded here, and Admin shows it (RendererDiagCard), with a probe of the
 * device's WebGL that can be copied and sent.
 *
 * Device-local, in localStorage, like the renderer setting itself.
 */
import { canvasAntialias } from "@/lib/rendering/canvasCompat";
export const DIAG_KEY = "devend:render3d:diag";

export interface RendererDiag {
  /** ISO time of the attempt. */
  at: string;
  outcome: "ok" | "failed";
  /** The error, for a failed start. */
  message?: string;
  /** The first lines of its stack. */
  stack?: string;
  /** Shader compile or link errors seen after a start (the board then draws without that material). */
  shaderErrors?: string[];
  /** The build that made the attempt. */
  build?: string;
}

function read(): RendererDiag | null {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    return raw ? (JSON.parse(raw) as RendererDiag) : null;
  } catch {
    return null;
  }
}

function write(d: RendererDiag): void {
  try { localStorage.setItem(DIAG_KEY, JSON.stringify(d)); } catch { /* private mode */ }
}

export function getRendererDiag(): RendererDiag | null {
  return read();
}

export function recordRendererStart(outcome: "ok" | "failed", err?: unknown, build?: string): void {
  const e = err instanceof Error ? err : null;
  write({
    at: new Date().toISOString(),
    outcome,
    ...(err !== undefined ? { message: e ? `${e.name}: ${e.message}` : String(err) } : {}),
    ...(e?.stack ? { stack: e.stack.split("\n").slice(0, 6).join("\n") } : {}),
    ...(build ? { build } : {}),
  });
}

/** Add a shader error to the current record, keeping at most a handful. */
export function recordShaderError(text: string): void {
  const d = read() ?? { at: new Date().toISOString(), outcome: "ok" as const };
  const list = d.shaderErrors ?? [];
  if (list.length >= 4) return;
  write({ ...d, shaderErrors: [...list, text.slice(0, 600)] });
}

export function clearRendererDiag(): void {
  try { localStorage.removeItem(DIAG_KEY); } catch { /* private mode */ }
}

/**
 * Every time `auto` quality stepped down on this device, and why: the median
 * frame gap it measured. Its own key, because a board start rewrites the
 * record above, and the steps are exactly the history worth keeping across
 * boards ("it lagged on her phone": did auto notice, and how far did it go?).
 */
export const STEPS_KEY = "devend:render3d:steps";
const MAX_STEPS = 8;

export interface QualityStep {
  /** ISO time. */
  at: string;
  from: string;
  /** A cheaper tier, "2d" for the 2D board, or "res" for the in-map resolution drop. */
  to: string;
  /** The median frame gap that triggered it (ms). */
  medianMs: number;
}

export function getQualitySteps(): QualityStep[] {
  try {
    const raw = localStorage.getItem(STEPS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list as QualityStep[] : [];
  } catch {
    return [];
  }
}

export function recordQualityStep(from: string, to: string, medianMs: number): void {
  const list = [...getQualitySteps(), { at: new Date().toISOString(), from, to, medianMs: Math.round(medianMs * 10) / 10 }];
  try { localStorage.setItem(STEPS_KEY, JSON.stringify(list.slice(-MAX_STEPS))); } catch { /* private mode */ }
}

export function clearQualitySteps(): void {
  try { localStorage.removeItem(STEPS_KEY); } catch { /* private mode */ }
}

/** "medium -> low at 41.2ms (24 fps)": one step, readable. */
export function qualityStepText(step: QualityStep): string {
  const fps = step.medianMs > 0 ? Math.round(1000 / step.medianMs) : 0;
  return `${step.from} -> ${step.to} at ${step.medianMs}ms (${fps} fps), ${step.at}`;
}

/** What this device's WebGL can do, read from a throwaway context. */
export interface WebGLProbe {
  webgl2: boolean;
  webgl1: boolean;
  gpu?: string;
  vendor?: string;
  version?: string;
  maxTextureUnits?: number;
  maxSamples?: number;
  maxTextureSize?: number;
  floatTargets?: boolean;
  halfFloatTargets?: boolean;
  /** Whether a context with the 3D board's exact attributes can be made. */
  boardAttributes?: boolean;
  userAgent: string;
}

/** The context attributes the 3D board asks for (ThreeRenderer.init); antialias as canvasAntialias() decides. */
export const BOARD_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: true, alpha: true, premultipliedAlpha: true, stencil: true, depth: true,
  powerPreference: "high-performance", preserveDrawingBuffer: false,
};

function lose(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
  try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* already gone */ }
}

export function probeWebGL(): WebGLProbe {
  const out: WebGLProbe = {
    webgl2: false, webgl1: false,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
  if (typeof document === "undefined") return out;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl) {
      out.webgl2 = true;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      out.gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      out.vendor = String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
      out.version = String(gl.getParameter(gl.VERSION));
      out.maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
      out.maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
      out.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      out.floatTargets = !!gl.getExtension("EXT_color_buffer_float");
      out.halfFloatTargets = !!gl.getExtension("EXT_color_buffer_half_float") || out.floatTargets;
    }
    lose(gl);
    const board = document.createElement("canvas").getContext("webgl2", { ...BOARD_CONTEXT_ATTRIBUTES, antialias: canvasAntialias() });
    out.boardAttributes = !!board;
    lose(board);
    if (!out.webgl2) {
      const gl1 = document.createElement("canvas").getContext("webgl");
      out.webgl1 = !!gl1;
      lose(gl1);
    } else {
      out.webgl1 = true;
    }
  } catch {
    /* a probe must never throw into Admin */
  }
  return out;
}

/** Everything above as plain text, for pasting into a message. */
export function diagText(
  choice: string, diag: RendererDiag | null, probe: WebGLProbe | null,
  steps: readonly QualityStep[] = [], learned: string | null = null,
): string {
  const lines = [`renderer setting: ${choice}`, `auto has learned: ${learned ?? "nothing yet"}`];
  for (const s of steps) lines.push(`quality step: ${qualityStepText(s)}`);
  if (diag) {
    lines.push(`last 3D start: ${diag.outcome} at ${diag.at}${diag.build ? ` (build ${diag.build})` : ""}`);
    if (diag.message) lines.push(`error: ${diag.message}`);
    if (diag.stack) lines.push(diag.stack);
    for (const s of diag.shaderErrors ?? []) lines.push(`shader: ${s}`);
  } else {
    lines.push("last 3D start: none recorded");
  }
  if (probe) {
    lines.push(
      `webgl2: ${probe.webgl2}, board attributes: ${probe.boardAttributes}, gpu: ${probe.gpu ?? "?"}`,
      `texture units: ${probe.maxTextureUnits ?? "?"}, samples: ${probe.maxSamples ?? "?"}, `
        + `float targets: ${probe.floatTargets}, half float: ${probe.halfFloatTargets}`,
      `ua: ${probe.userAgent}`,
    );
  }
  return lines.join("\n");
}
