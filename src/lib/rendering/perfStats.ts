/**
 * perfStats — lightweight rolling frame-timing instrumentation for the on-device
 * performance overlay (Playground/admin only).
 *
 * The game loop feeds one sample per active frame (physics-ms, render-ms, frame
 * delta, sub-step count, ball count); `drawPerfOverlay` paints a compact HUD so
 * we can see, on the actual Android WebView, where the frame budget goes and
 * whether stutter tracks ball count (render-bound) or spikes irregularly
 * (GC/physics-bound). Kept allocation-free: fixed ring buffers, no per-frame
 * objects, so measuring can't itself cause the jank it's measuring.
 */

import { CanvasGameState } from "@/types/gameState";

const WINDOW = 90; // ~1.5s of samples at 60fps

/** Fixed-size ring buffer with allocation-free avg/max over the window. */
class Ring {
  private buf = new Float64Array(WINDOW);
  private i = 0;
  private count = 0;
  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
  }
  avg(): number {
    if (this.count === 0) return 0;
    let s = 0;
    for (let k = 0; k < this.count; k++) s += this.buf[k];
    return s / this.count;
  }
  max(): number {
    let m = 0;
    for (let k = 0; k < this.count; k++) if (this.buf[k] > m) m = this.buf[k];
    return m;
  }
  size(): number {
    return this.count;
  }
}

const _frameMs = new Ring();   // wall-clock between frames
const _physicsMs = new Ring(); // time inside the fixed-step physics loop
const _renderMs = new Ring();  // time inside callbacks.render()
let _balls = 0;
let _steps = 0;

/** Called once per active frame from the game loop. */
export function recordFrame(
  frameMs: number,
  physicsMs: number,
  renderMs: number,
  steps: number,
  ballCount: number,
): void {
  if (frameMs > 0 && frameMs < 1000) _frameMs.push(frameMs); // ignore tab-switch gaps
  _physicsMs.push(physicsMs);
  _renderMs.push(renderMs);
  _steps = steps;
  _balls = ballCount;
}

/**
 * Snapshot of the rolling window, consumed by the adaptive-DPR ramp to decide
 * whether the device has frame-time headroom to render at a higher resolution.
 */
export function getFrameStats(): {
  samples: number;
  physPeak: number;
  renderAvg: number;
  renderPeak: number;
} {
  return {
    samples: _renderMs.size(),
    physPeak: _physicsMs.max(),
    renderAvg: _renderMs.avg(),
    renderPeak: _renderMs.max(),
  };
}

// Reused across draws so the overlay itself never allocates.
function pick(msPeak: number): string {
  // Colour by the worst frame in the window (stutter is about peaks, not means).
  if (msPeak <= 18) return "#00ff88"; // ~55fps+
  if (msPeak <= 33) return "#ffcc00"; // 30-55fps
  return "#ff4466";                    // sub-30, visible jank
}

/**
 * Paint the perf HUD at the board's top-left. Drawn AFTER renderFrame (which
 * returns early on normal frames), so it sits on top and is independent of the
 * render function's control flow.
 */
export function drawPerfOverlay(ctx: CanvasRenderingContext2D, game: CanvasGameState): void {
  const frameAvg = _frameMs.avg();
  const framePeak = _frameMs.max();
  const fps = frameAvg > 0 ? 1000 / frameAvg : 0;
  const fpsMin = framePeak > 0 ? 1000 / framePeak : 0;
  const physAvg = _physicsMs.avg();
  const physPeak = _physicsMs.max();
  const rendAvg = _renderMs.avg();
  const rendPeak = _renderMs.max();

  const f1 = (n: number) => n.toFixed(1);
  const lines = [
    `FPS ${Math.round(fps)}  (min ${Math.round(fpsMin)})`,
    `frame ${f1(frameAvg)}ms  peak ${f1(framePeak)}`,
    `phys  ${f1(physAvg)}  peak ${f1(physPeak)}`,
    `rend  ${f1(rendAvg)}  peak ${f1(rendPeak)}`,
    `balls ${_balls}   steps ${_steps}`,
  ];

  const { left, top, scale } = game.boardRect;
  const pad = 6;
  const lh = 15;
  const fontPx = 11;
  const x = left + 6 * scale;
  const y = top + 6 * scale;
  const boxW = 150;
  const boxH = pad * 2 + lh * lines.length;

  ctx.save();
  ctx.font = `${fontPx}px 'JetBrains Mono', monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = pick(framePeak);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, boxW, boxH);

  // First line (FPS) coloured by health; the rest in muted white.
  ctx.fillStyle = pick(framePeak);
  ctx.fillText(lines[0], x + pad, y + pad);
  ctx.fillStyle = "rgba(230,235,245,0.92)";
  for (let i = 1; i < lines.length; i++) {
    ctx.fillText(lines[i], x + pad, y + pad + lh * i);
  }
  ctx.restore();
}
