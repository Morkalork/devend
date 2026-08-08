/**
 * Static obstacles and moving hazards, seated on the board by the shared light.
 *
 * These are the objects that sell the lighting, because they have real area:
 * a slab with a shadow stretching up-left, a lit bottom-right edge and a tight
 * contact band at its base reads as a physical thing on a surface. The old
 * renderer drew obstacles as a flat accent-coloured outline with a symmetric
 * blur, which is legible but reads as a sticker.
 *
 * Obstacle bodies are FILLED here rather than outlined. An outline-only slab
 * cannot be lit (there is no surface to catch the light), and the fill is what
 * lets the board's captured/live split read against solid geometry.
 */

import { Container, Graphics } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { Polygon } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { ambientAt, contactFor, facing, shadowFor, type LightScope } from "./light";
import { snapContour, type Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

const MOVER_SEGMENTS = 28;

export class EntityLayer {
  readonly container = new Container();

  private shadows = new Graphics();
  private bodies = new Graphics();
  private rims = new Graphics();

  constructor() {
    this.container.addChild(this.shadows, this.bodies, this.rims);
  }

  sync(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    this.shadows.clear();
    this.bodies.clear();
    this.rims.clear();

    // Mirrors, breakables and phasing objects own their own look; this layer is
    // the plain static furniture plus the movers.
    const skip = new Set<Polygon>([
      ...game.mirrorPolygons,
      ...game.destructibles.filter(d => d.obstaclePolygon).map(d => d.obstaclePolygon as Polygon),
      ...(game.phasingObjects ?? []).map(p => p.polygon),
    ]);

    for (const poly of game.obstaclePolygons) {
      if (skip.has(poly as Polygon)) continue;
      this.drawSlab(poly as Polygon, light, w2s);
    }

    for (const m of game.movers) {
      this.drawMover(m, light, w2s, scale);
    }
  }

  /** A static obstacle: shadow, lit fill, contact band, rim on the lit edges. */
  private drawSlab(poly: Polygon, light: LightScope, w2s: W2S): void {
    const pts = snapContour(poly.vertices.map(v => w2s(v.x, v.y)));
    if (pts.length < 3) return;

    // Centroid drives the shadow so the whole slab shares one offset; per-vertex
    // offsets would shear it.
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;

    let radius = 0;
    for (const p of pts) radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy));

    const cast = shadowFor(light, cx, cy, radius);
    const ox = cast.dx * cast.length;
    const oy = cast.dy * cast.length;

    // Shadow = the silhouette, translated. Drawing the union of body and
    // translated body would be more correct, but the offset is short enough
    // that the simple translate reads identically and costs one poly.
    this.shadows
      .poly(pts.map(p => ({ x: p.x + ox, y: p.y + oy })))
      .fill({ color: PALETTE.shadow, alpha: cast.alpha });

    // Body, tinted by how much light reaches this part of the board.
    const amb = ambientAt(light, cx, cy);
    this.bodies
      .poly(pts)
      .fill({ color: mix(PALETTE.shadow, PALETTE.obstacle, 0.35 + amb * 0.65), alpha: 1 });

    // Per-edge rim: only edges whose outward normal faces the monitor.
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      // Outward normal: away from the centroid.
      let nx = -dy / len;
      let ny = dx / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }

      const lit = facing(light, mx, my, nx, ny);
      if (lit <= 0.05) continue;
      this.rims
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 1, color: PALETTE.obstacleEdge, alpha: Math.min(0.9, lit * 0.95 * light.level) });
    }
  }

  /** A patrolling mover: same light treatment, full-chroma body (it's a hazard). */
  private drawMover(
    m: CanvasGameState["movers"][number],
    light: LightScope,
    w2s: W2S,
    scale: number,
  ): void {
    // A mover has no `position`: it oscillates `offset` along `axis` from its
    // home centre. The polygon is updated in place by the physics step, so for
    // rect movers that is the authoritative shape; circles get the exact centre.
    const cxw = m.homeX + (m.axis === "horizontal" ? m.offset : 0);
    const cyw = m.homeY + (m.axis === "vertical" ? m.offset : 0);

    if (m.shape === "rect") {
      this.drawMoverSlab(m, light, w2s);
      return;
    }

    const c = w2s(cxw, cyw);
    const r = Math.max(2, (m.radius ?? 18) * scale);

    const cast = shadowFor(light, c.x, c.y, r);
    this.shadows
      .circle(c.x + cast.dx * cast.length, c.y + cast.dy * cast.length, r)
      .fill({ color: PALETTE.shadow, alpha: cast.alpha });

    // Contact band: short, dense, hard against the body. This is what stops the
    // mover looking like it hovers.
    const contact = contactFor(light, c.x, c.y, r);
    this.shadows
      .circle(c.x + contact.dx * contact.length, c.y + contact.dy * contact.length, r * 0.96)
      .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.5 });

    const amb = ambientAt(light, c.x, c.y);
    this.bodies
      .circle(c.x, c.y, r)
      .fill({ color: mix(PALETTE.shadow, PALETTE.mover, 0.45 + amb * 0.55), alpha: 1 });

    // Rim arc on the lit side only: stroke the arc centred on the light bearing.
    const bearing = Math.atan2(light.y - c.y, light.x - c.x);
    const g = this.rims;
    const span = Math.PI * 0.62;
    for (let i = 0; i <= MOVER_SEGMENTS; i++) {
      const t = i / MOVER_SEGMENTS;
      const ang = bearing - span / 2 + span * t;
      const px = c.x + Math.cos(ang) * r;
      const py = c.y + Math.sin(ang) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke({ width: Math.max(1, r * 0.1), color: 0xffd9a0, alpha: 0.85 * light.level });
  }

  /** Rect mover: the physics-updated polygon, lit like a slab but hazard-coloured. */
  private drawMoverSlab(
    m: CanvasGameState["movers"][number],
    light: LightScope,
    w2s: W2S,
  ): void {
    const pts = snapContour(m.polygon.vertices.map(v => w2s(v.x, v.y)));
    if (pts.length < 3) return;

    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    let radius = 0;
    for (const p of pts) radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy));

    const cast = shadowFor(light, cx, cy, radius);
    this.shadows
      .poly(pts.map(p => ({ x: p.x + cast.dx * cast.length, y: p.y + cast.dy * cast.length })))
      .fill({ color: PALETTE.shadow, alpha: cast.alpha });

    const amb = ambientAt(light, cx, cy);
    this.bodies
      .poly(pts)
      .fill({ color: mix(PALETTE.shadow, PALETTE.mover, 0.45 + amb * 0.55), alpha: 1 });

    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      let nx = -dy / len, ny = dx / len;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const lit = facing(light, mx, my, nx, ny);
      if (lit <= 0.05) continue;
      this.rims
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 1, color: 0xffd9a0, alpha: Math.min(0.9, lit * 0.9 * light.level) });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
