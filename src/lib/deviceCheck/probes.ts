/**
 * The device check's instruments (model.ts says what they feed): frame
 * intervals as the browser delivers them, a WebGL canvas's pixels read back
 * the frame they were drawn, and a fence drawn across the board the way a
 * finger would.
 */
import type { LitSample } from "./model";
import { onNextBoardFrame } from "@/lib/rendering/boardFrameHook";

/** Every frame interval (ms) the browser delivers for `ms`, as requestAnimationFrame sees them. */
export function sampleFrames(ms: number): Promise<number[]> {
  return new Promise(resolve => {
    const out: number[] = [];
    let last = 0;
    let start = 0;
    const tick = (t: number) => {
      if (start === 0) {
        start = t;
      } else {
        out.push(t - last);
      }
      last = t;
      if (t - start < ms) {
        requestAnimationFrame(tick);
      } else {
        resolve(out);
      }
    };
    requestAnimationFrame(tick);
  });
}

const GRID = 16;

/**
 * Sample a canvas's pixels on a grid, now. A WebGL canvas that does not keep
 * its drawing buffer is cleared once the browser has shown it, so this has to
 * run inside a frame, after the canvas drew (readAfterDraw).
 */
export function litNow(canvas: HTMLCanvasElement): LitSample | null {
  // Asking for a context of a type the canvas does not have returns null and
  // creates nothing; asking for the one it has returns that one.
  const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
  if (gl) {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w === 0 || h === 0) {
      return { lit: 0, total: GRID * GRID };
    }
    // The canvas itself, not whatever target the renderer left bound, and
    // that binding put back after: three and Pixi cache it and trust the cache.
    const gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? gl : null;
    const readWas = gl2 ? gl2.getParameter(gl2.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null : null;
    const drawWas = gl.getParameter(gl2 ? gl2.DRAW_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const px = new Uint8Array(4);
    let lit = 0;
    try {
      for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
          gl.readPixels(Math.floor((i + 0.5) * w / GRID), Math.floor((j + 0.5) * h / GRID), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          if (px[3] > 0) {
            lit++;
          }
        }
      }
    } finally {
      if (gl2) {
        gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, readWas);
        gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, drawWas);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, drawWas);
      }
    }
    return { lit, total: GRID * GRID };
  }
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0 || canvas.height === 0) {
    return null;
  }
  let lit = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const d = ctx.getImageData(Math.floor((i + 0.5) * canvas.width / GRID), Math.floor((j + 0.5) * canvas.height / GRID), 1, 1).data;
      if (d[3] > 0) {
        lit++;
      }
    }
  }
  return { lit, total: GRID * GRID };
}

/**
 * The board's pixels, read in the frame it drew them: right after the game
 * loop's render (boardFrameHook.ts), before the browser can clear them. The
 * best of a few frames is kept, and a board that renders nothing within
 * `waitMs` reads as null.
 */
export function readAfterDraw(canvas: HTMLCanvasElement, frames = 3, waitMs = 10000): Promise<LitSample | null> {
  return new Promise(resolve => {
    let best: LitSample | null = null;
    let left = frames;
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(best);
      }
    };
    const read = () => {
      let s: LitSample | null = null;
      try {
        s = litNow(canvas);
      } catch {
        s = null;
      }
      if (s && (!best || s.lit > best.lit)) {
        best = s;
      }
      left--;
      if (left > 0 && !settled) {
        onNextBoardFrame(read);
      } else {
        finish();
      }
    };
    onNextBoardFrame(read);
    setTimeout(finish, waitMs);
  });
}

/** The board's canvas (GameCanvas marks it). */
export function boardCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>("canvas[data-board-canvas]");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * A fence across the board: a touch pressed at one point, dragged in steps to
 * another and lifted, as pointer events on the board canvas, which is where
 * the game listens (useGameInput). From 20% to 80% of the width, at `y` (0 to
 * 1) of its height.
 */
export async function drawFence(canvas: HTMLCanvasElement, y = 0.5): Promise<void> {
  const r = canvas.getBoundingClientRect();
  const at = (fx: number) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * y });
  const base = { pointerId: 4242, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...base, ...at(0.2), buttons: 1 }));
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await sleep(16);
    canvas.dispatchEvent(new PointerEvent("pointermove", { ...base, ...at(0.2 + 0.6 * (i / steps)), buttons: 1 }));
  }
  await sleep(16);
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...base, ...at(0.8), buttons: 0 }));
}
