/**
 * Drawing helpers for the board overlays: the pieces SVG and CSS gave the DOM
 * for free and Pixi's Graphics does not have - dashed strokes, and the soft
 * box-shadow glows the frames use to read against a busy board.
 */
import type { Graphics } from "pixi.js";

export interface Pt {
  x: number;
  y: number;
}

export interface StrokeLook {
  width: number;
  color: number;
  alpha?: number;
  cap?: "butt" | "round" | "square";
}

/** A polyline stroked with an SVG-style dash pattern (`stroke-dasharray`). */
export function dashedPolyline(g: Graphics, pts: readonly Pt[], dash: number, gap: number, look: StrokeLook, closed = false): void {
  if (pts.length < 2) return;
  const path = closed ? [...pts, pts[0]] : pts;
  let on = true;
  let left = dash;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    let s = 0;
    while (s < len) {
      const step = Math.min(left, len - s);
      if (on) {
        g.moveTo(a.x + ux * s, a.y + uy * s).lineTo(a.x + ux * (s + step), a.y + uy * (s + step));
      }
      s += step;
      left -= step;
      if (left <= 1e-6) {
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
  g.stroke({ width: look.width, color: look.color, alpha: look.alpha ?? 1, cap: look.cap ?? "butt" });
}

/** A dashed straight line. */
export function dashedLine(g: Graphics, a: Pt, b: Pt, dash: number, gap: number, look: StrokeLook): void {
  dashedPolyline(g, [a, b], dash, gap, look);
}

/** A dashed circle outline, as a polygon fine enough to read as round. */
export function dashedCircle(g: Graphics, c: Pt, r: number, dash: number, gap: number, look: StrokeLook): void {
  const n = Math.max(24, Math.ceil((2 * Math.PI * r) / 3));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  dashedPolyline(g, pts, dash, gap, look, true);
}

/**
 * A soft glow hugging the inside of a rectangle: CSS
 * `box-shadow: inset 0 0 <blur> <spread> <color>`. Drawn as thin nested
 * strokes whose alpha falls from `alpha` at the edge to nothing `spread + blur/2`
 * in, roughly the gaussian the browser draws.
 */
export function insetGlow(g: Graphics, w: number, h: number, color: number, alpha: number, blur: number, spread = 0): void {
  const reach = Math.min(spread + blur / 2 + blur / 4, Math.min(w, h) / 2);
  const step = 2;
  for (let d = 0; d < reach; d += step) {
    const a = alpha * glowFalloff(d, spread, blur);
    if (a < 0.004) continue;
    g.rect(d + step / 2, d + step / 2, Math.max(0, w - 2 * d - step), Math.max(0, h - 2 * d - step))
      .stroke({ width: step, color, alpha: a });
  }
}

/**
 * The same glow outside a rectangle: CSS `box-shadow: 0 0 <blur> <spread>`.
 * `x, y, w, h` is the box the glow surrounds.
 */
export function outerGlow(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number, blur: number, spread = 0): void {
  const reach = spread + blur / 2 + blur / 4;
  const step = 2;
  for (let d = 0; d < reach; d += step) {
    const a = alpha * glowFalloff(d, spread, blur);
    if (a < 0.004) continue;
    const o = d + step / 2;
    g.rect(x - o, y - o, w + 2 * o, h + 2 * o).stroke({ width: step, color, alpha: a });
  }
}

/** Shadow strength at `d` px from the box edge: full inside the spread, then a smooth fall over the blur. */
export function glowFalloff(d: number, spread: number, blur: number): number {
  if (blur <= 0) return d < spread ? 1 : 0;
  const t = (d - spread + blur / 2) / blur; // 0 at the start of the fall, 1 at its end
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}
