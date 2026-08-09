/**
 * Breakables, mirrors and phasing obstacles: the board furniture that has state.
 *
 * All three are polygon bodies lit by the shared scope, exactly like the static
 * slabs in entityLayer - what differs is what their state has to communicate,
 * and each gets ONE visual channel for it so they never read ambiguously:
 *
 *   BREAKABLE - damage. The body desaturates and its rim dims as hits land, and
 *     each impact leaves a dent notch on the hull. A chest is the same object
 *     with an amber body, because "smash this" is the same verb.
 *   MIRROR    - reflectivity. Mirrors are the one surface that should look like
 *     it RETURNS the monitor rather than absorbing it, so the lit edge is a
 *     hard bright specular line rather than the soft rim everything else gets.
 *   PHASING   - presence. Solid when in, a hollow outline when out, with the
 *     body and its shadow fading together. A phased-out object casting a solid
 *     shadow would be the single most confusing thing on the board.
 */

import { Container, Graphics } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { Polygon } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { ambientAt, facing, shadowFor, slabHeight, type LightScope } from "./light";
import { snapContour, hairline, type Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

export class ObjectLayer {
  readonly container = new Container();

  /** The renderer's shared floor plane, set each frame in sync(). */
  private shadows!: Graphics;
  private bodies = new Graphics();
  private rims = new Graphics();

  constructor() {
    // No shadow child: cast shadows go to the shared floor plane.
    this.container.addChild(this.bodies, this.rims);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    shadows: Graphics,
    w2s: W2S,
    scale: number,
  ): void {
    this.shadows = shadows;
    this.bodies.clear();
    this.rims.clear();

    const phasingPolys = new Set((game.phasingObjects ?? []).map(p => p.polygon));

    for (const d of game.destructibles) {
      if (d.destroyed) continue;
      const poly = d.obstaclePolygon ?? d.mirrorPolygon;
      if (!poly || phasingPolys.has(poly)) continue;
      const damage = d.maxHits > 0 ? Math.min(1, d.hits / d.maxHits) : 0;
      if (d.kind === "mirror") {
        this.drawMirror(poly, light, w2s, scale, 1);
      } else {
        this.drawBreakable(d, poly, damage, light, w2s, scale);
      }
    }

    // Mirrors with no destructible entry (indestructible ones) still need drawing.
    const destructibleMirrors = new Set(
      game.destructibles.filter(d => d.mirrorPolygon).map(d => d.mirrorPolygon as Polygon),
    );
    for (const poly of game.mirrorPolygons) {
      if (destructibleMirrors.has(poly)) continue;
      this.drawMirror(poly, light, w2s, scale, 1);
    }

    for (const p of game.phasingObjects ?? []) {
      if (p.alpha <= 0.02) continue;
      this.drawPhasing(p, light, w2s, scale);
    }
  }

  /** Shared geometry prep: screen hull, centroid and bounding radius. */
  private prep(poly: Polygon, w2s: W2S): { pts: Pt[]; cx: number; cy: number } | null {
    const pts = snapContour(poly.vertices.map(v => w2s(v.x, v.y)));
    if (pts.length < 3) return null;
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    return { pts, cx, cy };
  }

  /** Per-edge rim on the faces pointing at the monitor. */
  private rimEdges(
    pts: Pt[], cx: number, cy: number, light: LightScope,
    color: number, strength: number, width = hairline(),
  ): void {
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
        .stroke({ width, color, alpha: Math.min(0.95, lit * strength * light.level) });
    }
  }

  /**
   * `scale` (not the object's footprint) drives the offset: these all stand the
   * same slab height off the board, so their shadows hug them by the same
   * amount regardless of how big they are.
   */
  private castShadow(pts: Pt[], cx: number, cy: number, scale: number, light: LightScope, alphaScale = 1): void {
    const cast = shadowFor(light, cx, cy, slabHeight(scale));
    const ox = cast.dx * cast.length;
    const oy = cast.dy * cast.length;
    this.shadows
      .poly(pts.map(p => ({ x: p.x + ox, y: p.y + oy })))
      .fill({ color: PALETTE.shadow, alpha: cast.alpha * alphaScale });
  }

  /**
   * A breakable slab. Damage drains the body toward the shadow colour and eats
   * the rim, so a nearly-dead object visibly stops catching the light - the
   * player reads "one more hit" from the lighting itself rather than a HP bar.
   */
  private drawBreakable(
    d: CanvasGameState["destructibles"][number],
    poly: Polygon,
    damage: number,
    light: LightScope,
    w2s: W2S,
    scale: number,
  ): void {
    const g = this.prep(poly, w2s);
    if (!g) return;
    const { pts, cx, cy } = g;

    this.castShadow(pts, cx, cy, scale, light, 1 - damage * 0.4);

    const amb = ambientAt(light, cx, cy);
    // A chest is loot, not obstruction: amber body so it reads as a prize.
    const base = d.chest ? PALETTE.amber : d.objective ? 0x8a6a3a : PALETTE.obstacle;
    const body = mix(PALETTE.shadow, base, (0.55 + amb * 0.45) * (1 - damage * 0.45));
    this.bodies.poly(pts).fill({ color: body, alpha: 1 });

    this.rimEdges(pts, cx, cy, light, d.chest ? 0xffe9b0 : PALETTE.obstacleEdge, 0.95 * (1 - damage * 0.7));

    // Dents + cracks: each recorded impact notches the surface and throws a few
    // splits out from it. Placed at the real world hit point, so damage reads as
    // history - you can see WHERE it has been hit, not just how much.
    //
    // The crack geometry is seeded from the impact position rather than random,
    // so it is identical every frame; a per-frame random would make the cracks
    // crawl and read as noise.
    for (const dent of d.dents ?? []) {
      const p = w2s(dent.x, dent.y);
      const len = Math.max(3, 9 * scale);
      const seed = Math.abs(Math.round(dent.x * 73856093) ^ Math.round(dent.y * 19349663));
      for (let i = 0; i < 3; i++) {
        // Cheap deterministic hash -> angle, stable for this dent forever.
        const h = Math.sin(seed * 0.0001 + i * 2.399) * 43758.5453;
        const ang = (h - Math.floor(h)) * Math.PI * 2;
        const reach = len * (0.6 + ((h * 7) - Math.floor(h * 7)) * 0.8);
        this.rims
          .moveTo(p.x, p.y)
          .lineTo(p.x + Math.cos(ang) * reach, p.y + Math.sin(ang) * reach);
      }
      this.bodies
        .circle(p.x, p.y, Math.max(1.5, 4 * scale))
        .fill({ color: PALETTE.shadow, alpha: 0.55 });
    }
    if ((d.dents?.length ?? 0) > 0) {
      this.rims.stroke({ width: Math.max(hairline(), scale), color: PALETTE.shadow, alpha: 0.7 });
    }
  }

  /** A mirror: hard specular edge, cool body, still a solid object with a shadow. */
  private drawMirror(poly: Polygon, light: LightScope, w2s: W2S, scale: number, alpha: number): void {
    const g = this.prep(poly, w2s);
    if (!g) return;
    const { pts, cx, cy } = g;

    this.castShadow(pts, cx, cy, scale, light, alpha);

    const amb = ambientAt(light, cx, cy);
    this.bodies
      .poly(pts)
      .fill({ color: mix(PALETTE.shadow, PALETTE.mirror, 0.35 + amb * 0.4), alpha });

    // Specular, not rim: brighter, wider, and only on the faces actually
    // pointing at the monitor. This is the surface that returns the light.
    this.rimEdges(pts, cx, cy, light, 0xd8f4ff, 1.6 * alpha, 2);
  }

  /** A phasing obstacle: body, shadow and rim all fade together with `alpha`. */
  private drawPhasing(
    p: CanvasGameState["phasingObjects"][number],
    light: LightScope,
    w2s: W2S,
    scale: number,
  ): void {
    const g = this.prep(p.polygon, w2s);
    if (!g) return;
    const { pts, cx, cy } = g;
    const a = Math.max(0, Math.min(1, p.alpha));

    // Shadow fades WITH the body: a shadow from something you can walk through
    // is the most confusing thing the light model could say.
    this.castShadow(pts, cx, cy, scale, light, a);

    const amb = ambientAt(light, cx, cy);
    this.bodies
      .poly(pts)
      .fill({ color: mix(PALETTE.shadow, PALETTE.obstacle, 0.55 + amb * 0.45), alpha: a });

    // Even fully phased out it keeps a ghost outline, so the player can plan
    // around where it will come back.
    this.rims
      .poly(pts)
      .stroke({ width: hairline(), color: PALETTE.obstacleEdge, alpha: 0.25 + a * 0.5 });
    if (a > 0.5) this.rimEdges(pts, cx, cy, light, PALETTE.obstacleEdge, 0.95 * a);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
