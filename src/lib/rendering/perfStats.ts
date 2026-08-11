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
/**
 * Frame time this loop cannot account for: frame - (phys + rend).
 *
 * The point is attribution, not a target. In a HEALTHY frame this is mostly idle
 * - the loop finishes in ~2ms and the browser waits ~14ms for vsync - so the
 * AVERAGE being large is normal and good. The PEAK is the diagnostic: when a
 * frame takes 50ms and only 2ms of it was ours, the other 48 went somewhere this
 * loop never sees. Browser layout, compositing the translucent board over the
 * animated background, GC, or a phase we simply are not timing.
 *
 * That distinction is the whole question behind a stutter with no cut nearby, and
 * it is exactly how the cut pass was caught: a frame peak with nothing to pin it
 * on means the work is happening outside the counters, not that it is absent.
 */
const _otherMs = new Ring();
/**
 * The background parallax tick, which runs at the TOP of the loop body - before
 * the physics timer starts and before render - so it was invisible to both and
 * landed silently in `other`. Exactly the blind spot that hid the cut pass.
 */
const _bgMs = new Ring();
/**
 * Long tasks, straight from the browser.
 *
 * The decisive question for a 65ms frame that this loop cannot account for is
 * whether the time was spent running JAVASCRIPT at all. A longtask entry means
 * some script blocked the main thread and the work is ours to find; NO entry
 * beside a 65ms frame means the time went to style, layout, paint or compositing
 * - work no amount of profiling our own functions will ever surface.
 *
 * Five suspects have already been eliminated by measurement here (native DPR,
 * the throat-gated flood, the parallax tick, the cut pass, the animated
 * background). This is the instrument that stops the sixth being a guess.
 */
let _taskMs = 0;
let _taskPeak = 0;
let _taskAt = 0;
let _taskCount = 0;
let _taskObserver: PerformanceObserver | null = null;

/** Idempotent; safe to call on every mount. */
export function startLongTaskWatch(): void {
  if (_taskObserver || typeof PerformanceObserver === "undefined") return;
  try {
    _taskObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        _taskMs = entry.duration;
        if (entry.duration > _taskPeak) _taskPeak = entry.duration;
        _taskAt = performance.now();
        _taskCount++;
      }
    });
    _taskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    _taskObserver = null; // unsupported (Safari): the line just reads zero
  }
}
let _balls = 0;
let _steps = 0;
/**
 * Time inside applyCut, which runs AFTER recordFrame in the loop and so was
 * counted by neither phys nor rend. It is also the heaviest thing the game does
 * - capture flood, region rebuild, contour traces, lock check, tint flood - and
 * it landed invisibly in the NEXT frame's delta. Measured separately because a
 * frame peak with a low render peak is otherwise unattributable.
 *
 * Peak-only: cuts are occasional, so an average over a frame window is
 * meaningless. `_cutAgo` keeps the reading honest about how stale it is.
 */
let _cutMs = 0;
let _cutPeak = 0;
let _cutAt = 0;

export function recordCut(ms: number): void {
  _cutMs = ms;
  if (ms > _cutPeak) _cutPeak = ms;
  _cutAt = performance.now();
}

/** Called once per active frame from the game loop. */
export function recordBg(ms: number): void {
  _bgMs.push(ms);
}

export function recordFrame(
  frameMs: number,
  physicsMs: number,
  renderMs: number,
  steps: number,
  ballCount: number,
): void {
  // All four rings take a sample or none do. They used to disagree - frame was
  // gated on the tab-switch guard while phys and rend were pushed regardless -
  // so the averages were over different frame sets and `frame - phys - rend`
  // did not equal `other`. A HUD whose own arithmetic does not add up teaches
  // you to distrust it, which defeats the point of having it.
  if (frameMs <= 0 || frameMs >= 1000) return; // tab-switch gap: not a real frame
  _frameMs.push(frameMs);
  _physicsMs.push(physicsMs);
  _renderMs.push(renderMs);
  // Clamped: the three are sampled at slightly different moments, so a fast
  // frame can round very slightly negative, and a negative "unaccounted" would
  // read as nonsense.
  _otherMs.push(Math.max(0, frameMs - physicsMs - renderMs));
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
/**
 * JS heap readout for the perf HUD (Chromium-only performance.memory; other
 * engines show "n/a"). Used to catch slow leaks live: watch this while the
 * game idles - a healthy session sawtooths in place, a leak climbs steadily.
 */
export function heapLine(): string {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!mem) return "n/a";
  return `${Math.round(mem.usedJSHeapSize / 1048576)}/${Math.round(mem.jsHeapSizeLimit / 1048576)}MB`;
}

/**
 * Persisted HUD toggle.
 *
 * The Playground's own switch is component state, and Index never passes the
 * prop, so the HUD could only ever appear in the admin sandbox - which is the
 * one place the numbers do not matter. The frame budget worth measuring is a
 * real map on a real phone, so the flag has to survive leaving the admin screen.
 */
export const PERF_HUD_KEY = "devend:perfHud";
let _hudEnabled: boolean | null = null;

export function isPerfHudEnabled(): boolean {
  if (_hudEnabled === null) {
    try {
      _hudEnabled = typeof localStorage !== "undefined" && localStorage.getItem(PERF_HUD_KEY) === "1";
    } catch {
      _hudEnabled = false; // blocked storage must never break the game loop
    }
  }
  return _hudEnabled;
}

export function setPerfHudEnabled(on: boolean): void {
  _hudEnabled = on;
  try {
    if (on) localStorage.setItem(PERF_HUD_KEY, "1");
    else localStorage.removeItem(PERF_HUD_KEY);
  } catch {
    /* blocked storage: the in-memory flag still holds for this session */
  }
}

/** Test seam: forget the cached flag so a fresh localStorage value is read. */
export function resetPerfHudCache(): void {
  _hudEnabled = null;
}

/**
 * Freeze the animated CRT background (admin).
 *
 * An A/B switch, not a feature. Everything this loop can measure has been ruled
 * out of the periodic stutter - render, physics, the cut pass and the parallax
 * tick are all accounted for and small - which leaves work the loop never sees:
 * compositing a translucent board over a full-screen animated DOM layer being
 * the obvious candidate. That has to be tested on a real phone, because a
 * desktop composites it for free.
 *
 * Flip this, watch `other`, and the question answers itself. If it drops, the
 * background is the cost and this toggle is already most of the fix.
 */
export const STATIC_BG_KEY = "devend:staticBg";
let _staticBg: boolean | null = null;

export function isStaticBgEnabled(): boolean {
  if (_staticBg === null) {
    try {
      _staticBg = typeof localStorage !== "undefined" && localStorage.getItem(STATIC_BG_KEY) === "1";
    } catch {
      _staticBg = false;
    }
  }
  return _staticBg;
}

export function setStaticBgEnabled(on: boolean): void {
  _staticBg = on;
  try {
    if (on) localStorage.setItem(STATIC_BG_KEY, "1");
    else localStorage.removeItem(STATIC_BG_KEY);
  } catch {
    /* blocked storage */
  }
}

/**
 * The surface actually being rasterised, recorded by whoever sizes the canvas.
 *
 * The renderer runs at `resolution: 1` over a physically-sized canvas, so on a
 * 3x phone it is filling ~9x the pixels of a 1x desktop. That is a deliberate
 * choice (pixel fidelity over frame rate) but it is invisible in a frame-time
 * number alone, so the HUD reports it: `rend` is only interpretable next to how
 * many pixels produced it.
 */
let _surfaceW = 0;
let _surfaceH = 0;

export function recordSurface(widthPx: number, heightPx: number): void {
  _surfaceW = widthPx;
  _surfaceH = heightPx;
}

/**
 * The HUD as text. Shared by the 2D painter below and the DOM overlay, so the
 * WebGL renderer (which has no 2D context to paint into) reports exactly the
 * same numbers rather than a second, drifting implementation.
 */
export function perfLines(): string[] {
  const frameAvg = _frameMs.avg();
  const framePeak = _frameMs.max();
  const fps = frameAvg > 0 ? 1000 / frameAvg : 0;
  const fpsMin = framePeak > 0 ? 1000 / framePeak : 0;
  const f1 = (n: number) => n.toFixed(1);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const mpx = (_surfaceW * _surfaceH) / 1e6;

  return [
    `FPS ${Math.round(fps)}  (min ${Math.round(fpsMin)})`,
    `frame ${f1(frameAvg)}ms  peak ${f1(framePeak)}`,
    `phys  ${f1(_physicsMs.avg())}  peak ${f1(_physicsMs.max())}`,
    `rend  ${f1(_renderMs.avg())}  peak ${f1(_renderMs.max())}`,
    // dpr is rounded: devicePixelRatio is often an ugly float (1.6500000000953
    // on this machine) and the raw value pushed the line off the HUD.
    `surf  ${_surfaceW}x${_surfaceH} @${dpr.toFixed(2)}x (${mpx.toFixed(1)}Mpx)`,
    `other ${f1(_otherMs.avg())}  peak ${f1(_otherMs.max())}`,
    `bg    ${f1(_bgMs.avg())}  peak ${f1(_bgMs.max())}`,
    `task  ${f1(_taskMs)}  peak ${f1(_taskPeak)}  n=${_taskCount}${_taskAt ? `  ${Math.round((performance.now() - _taskAt) / 1000)}s ago` : ""}`,
    `cut   ${f1(_cutMs)}  peak ${f1(_cutPeak)}${_cutAt ? `  ${Math.round((performance.now() - _cutAt) / 1000)}s ago` : ""}`,
    `balls ${_balls}   steps ${_steps}`,
    `heap  ${heapLine()}`,
  ];
}

/** Frame-health colour for the HUD's first line (peak-driven; stutter is peaks). */
export function perfColor(): string {
  return pick(_frameMs.max());
}

export function drawPerfOverlay(ctx: CanvasRenderingContext2D, game: CanvasGameState): void {
  const framePeak = _frameMs.max();
  const lines = perfLines();

  const { left, top, scale } = game.boardRect;
  const pad = 6;
  const lh = 15;
  const fontPx = 11;
  const x = left + 6 * scale;
  const y = top + 6 * scale;
  const boxW = 210;
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
