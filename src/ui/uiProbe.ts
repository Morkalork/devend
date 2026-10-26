/**
 * What the interface canvas actually holds, for the on-device report
 * (lib/bootDiagnostics.ts).
 *
 * Reported on Opera for Android: after "Tap to start", only the code
 * background, while the report says the canvas is full-screen, visible, has a
 * live GPU context and is drawing, with every layer mounted and no error.
 * Either it draws nothing (the scene is transparent, empty or off screen) or
 * it draws and the browser never shows it. These two tell them apart: the
 * scene's layers with where they land and how opaque they end up, and the
 * pixels of a frame read back the moment it is drawn, before the browser can
 * take the buffer away.
 */
import type { Application, Container } from "pixi.js";

let app: Application | null = null;

/** UiHost hands its application over while it is mounted. */
export function setUiProbeApp(next: Application | null): void {
  app = next;
}

/** Alpha as drawn: its own, times every parent's. */
function effectiveAlpha(c: Container): number {
  let a = 1;
  for (let n: Container | null = c; n; n = n.parent) {
    a *= n.alpha;
  }
  return a;
}

/** One container as a line: where it lands on screen, and whether it can be seen. */
function describe(c: Container, depth: number): string {
  let bounds = "bounds ?";
  try {
    const b = c.getBounds();
    bounds = `bounds ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;
  } catch (e) {
    bounds = `bounds threw ${String(e)}`;
  }
  const name = c.label || c.constructor.name;
  return `${"  ".repeat(depth)}${name} at ${Math.round(c.x)},${Math.round(c.y)} ${bounds}`
    + ` visible=${c.visible} renderable=${c.renderable} alpha=${effectiveAlpha(c).toFixed(2)} children=${c.children.length}`;
}

/** How deep the walk goes: the menu's layer further than the rest, where it matters. */
const DEPTH = 3;
const MENU_DEPTH = 11;

/** The stage, its root, each layer, and into the layers (CanvasUiRoot's tree). */
function sceneLines(stage: Container): string[] {
  const lines: string[] = [];
  const walk = (c: Container, depth: number, limit: number) => {
    // The layout library's empty helpers (an unset background, a stroke) say nothing.
    const b = c.getBounds();
    if (c.children.length === 0 && b.width === 0 && b.height === 0) {
      return;
    }
    lines.push(describe(c, depth));
    const inner = c.label?.startsWith("layer:screen-WelcomeScreen") ? MENU_DEPTH : limit;
    if (depth >= inner) {
      return;
    }
    for (const child of c.children.slice(0, 10)) {
      walk(child as Container, depth + 1, inner);
    }
  };
  walk(stage, 0, DEPTH);
  return lines.slice(0, 80);
}

/** Draw a frame and read it straight back: how much of it has any pixel in it. */
function pixelLines(a: Application): string[] {
  const renderer = a.renderer as unknown as { gl?: WebGLRenderingContext; name?: string };
  const gl = renderer.gl;
  if (!gl) {
    return [`pixels: renderer ${renderer.name ?? "?"} has no gl`];
  }
  const lines: string[] = [];
  const attrs = gl.getContextAttributes();
  lines.push(`context: alpha=${attrs?.alpha} premultiplied=${attrs?.premultipliedAlpha} preserve=${attrs?.preserveDrawingBuffer} antialias=${attrs?.antialias}`);
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  if (info) {
    lines.push(`gpu: ${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)} / ${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)}`);
  }
  a.render();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  const grid = 16;
  let lit = 0;
  let brightest = [0, 0, 0, 0];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      gl.readPixels(Math.floor((i + 0.5) * w / grid), Math.floor((j + 0.5) * h / grid), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[3] > 0) {
        lit++;
      }
      if (px[0] + px[1] + px[2] > brightest[0] + brightest[1] + brightest[2]) {
        brightest = [px[0], px[1], px[2], px[3]];
      }
    }
  }
  lines.push(`pixels: ${lit} of ${grid * grid} sampled have something, drawing buffer ${w}x${h}, brightest rgba(${brightest.join(",")}), gl error ${gl.getError()}`);
  return lines;
}

/**
 * The interface canvas's pixels on a frame drawn now, for the device check
 * (lib/deviceCheck): null when there is no interface or it cannot be read.
 */
export function uiCanvasLit(): { lit: number; total: number } | null {
  if (!app) {
    return null;
  }
  const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
  if (!gl) {
    return null;
  }
  app.render();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  const grid = 16;
  let lit = 0;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      gl.readPixels(Math.floor((i + 0.5) * w / grid), Math.floor((j + 0.5) * h / grid), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[3] > 0) {
        lit++;
      }
    }
  }
  return { lit, total: grid * grid };
}

/** Everything above, as lines for the report. */
export function uiProbeLines(): string[] {
  if (!app) {
    return ["probe: no interface application"];
  }
  const lines: string[] = [];
  try {
    lines.push(`stage: screen ${app.screen.width}x${app.screen.height}, renderer resolution ${app.renderer.resolution}`);
  } catch (e) {
    lines.push(`stage threw ${String(e)}`);
  }
  try {
    lines.push(...pixelLines(app));
  } catch (e) {
    lines.push(`pixels threw ${String(e)}`);
  }
  try {
    lines.push(...sceneLines(app.stage));
  } catch (e) {
    lines.push(`scene threw ${String(e)}`);
  }
  return lines;
}
