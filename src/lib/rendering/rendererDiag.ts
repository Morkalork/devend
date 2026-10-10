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

/** The context attributes the 3D board asks for (ThreeRenderer.init). */
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
    const board = document.createElement("canvas").getContext("webgl2", BOARD_CONTEXT_ATTRIBUTES);
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
export function diagText(choice: string, diag: RendererDiag | null, probe: WebGLProbe | null): string {
  const lines = [`renderer setting: ${choice}`];
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
