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
import type { Polygon, Vector2 } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { ambientAt, facing, shadowFor, slabHeight, type LightScope } from "./light";
import { snapContour, hairline, type Pt } from "./pixelGrid";
import { anyObstacleImpactsActive, obstacleBulgeAt } from "@/lib/wallImpactEffects";
import type { ImpactDent } from "@/types/game";

type W2S = (x: number, y: number) => Pt;

/** Longest edge piece, in world units, while an object is taking a hit. */
const DENT_STEP = 22;

/**
 * How deep a single recorded hit bites into the hull, in world units.
 *
 * Bigger than the transient impact give (12) on purpose: that one is a wall
 * flexing and springing back, this one is material that is gone. If damage did
 * not read deeper than a bounce, the permanent thing would look like the
 * temporary one.
 */
export const CARVE_DEPTH = 16;
/** How far along the hull one bite is felt, in world units. */
export const CARVE_SIGMA = 26;

/**
 * Bite the recorded impact points OUT of an outline.
 *
 * The dents were drawn as radiating cracks and a small dark pit, which reads as
 * a mark ON the surface rather than material missing FROM it. A breakable that
 * has taken three of four hits should be visibly chewed at its silhouette, so
 * you can see how close it is to going without counting anything.
 *
 * Pulls the contour toward the object's centre with a Gaussian falloff, which
 * gives the rounded half-circle bite a ball would leave rather than a notch cut
 * with a knife. Depth rides the hit's own strength, so a graze scallops it and
 * a heavy strike takes a chunk.
 */
export function carveContour(pts: Pt[], w2s: W2S, dents?: ImpactDent[]): Pt[] {
  if (!dents || dents.length === 0) return pts;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;

  // Screen units per world unit, so the bite is the same physical size at any
  // zoom. Taken from the transform rather than assumed.
  const o = w2s(0, 0), u = w2s(1, 0);
  const k = Math.hypot(u.x - o.x, u.y - o.y) || 1;

  return pts.map(p => {
    let depth = 0;
    for (const d of dents) {
      const hit = w2s(d.x, d.y);
      const dist = Math.hypot(p.x - hit.x, p.y - hit.y) / k;
      if (dist > CARVE_SIGMA * 2.5) continue;
      depth += CARVE_DEPTH * (d.s ?? 1) * Math.exp(-(dist * dist) / (2 * CARVE_SIGMA * CARVE_SIGMA));
    }
    if (depth <= 0.01) return p;
    // Never past the centre: a bite deep enough to cross the middle would fold
    // the polygon inside out and render as a bow tie.
    const toX = cx - p.x, toY = cy - p.y;
    const reach = Math.hypot(toX, toY) || 1;
    const move = Math.min(depth * k, reach * 0.45);
    return { x: p.x + (toX / reach) * move, y: p.y + (toY / reach) * move };
  });
}

/**
 * An object's outline, dented where balls have struck it.
 *
 * Shares its shape and its constants with entityLayer's version on purpose: a
 * breakable slab and a solid one denting by different amounts would read as two
 * different materials rather than the same board furniture.
 *
 * Displaced in WORLD space before transforming, because the displacement is a
 * world-space direction and adding it to screen coordinates would push the dent
 * sideways once the board is tilted.
 */
function dentedContour(vertices: Vector2[], w2s: W2S): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / DENT_STEP));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const wx = a.x + (b.x - a.x) * t;
      const wy = a.y + (b.y - a.y) * t;
      const d = obstacleBulgeAt(wx, wy, 1);   // scale 1: world units in and out
      out.push(w2s(wx + d.dx, wy + d.dy));
    }
  }
  return out;
}

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
        this.drawMirror(poly, light, w2s, scale, 1, damage, d.dents);
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

  /**
   * Shared geometry prep: screen hull, centroid and bounding radius.
   *
   * The hull is DENTED where balls have struck, the same treatment the static
   * slabs get in entityLayer. Breakables used to be excluded from that on the
   * grounds that their cracks already told the story; they did not. A breakable
   * wall took a hit and sat there, so nothing separated it from the solid wall
   * beside it until the moment it shattered.
   *
   * The outline is subdivided first when an impact is live: a slab is four
   * corners, and pushing four corners around translates the shape rather than
   * denting it, so the falloff needs points between them to land on. When
   * nothing has hit anything the snapped four-corner path is untouched, which
   * is every object on almost every frame.
   */
  private prep(
    poly: Polygon, w2s: W2S, dents?: ImpactDent[],
  ): { pts: Pt[]; cx: number; cy: number } | null {
    // Detail is needed for a LIVE impact (the transient outward give) and for
    // RECORDED damage (the permanent inward bite). Both need points between the
    // corners to land on; a four-corner slab pushed at its corners just moves.
    const damaged = (dents?.length ?? 0) > 0;
    const pts = anyObstacleImpactsActive() || damaged
      ? carveContour(dentedContour(poly.vertices, w2s), w2s, dents)
      : snapContour(poly.vertices.map(v => w2s(v.x, v.y)));
    if (pts.length < 3) return null;
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    return { pts, cx, cy };
  }

  /**
   * A rim drawn in PIECES rather than as one line.
   *
   * The load-bearing "this is breakable" cue. A solid slab is outlined
   * continuously; break the outline into segments with gaps between them and
   * the silhouette reads as something already in pieces, held together. That
   * works at rest, at any damage level, at any zoom, and it does not compete
   * with the colours the board already uses for chests, objectives and mirrors.
   *
   * Segments are laid out by ARC LENGTH along each edge, not per vertex, so a
   * long face and a short one break up at the same rate instead of a small
   * object looking finely cracked and a big one barely marked.
   */
  private brokenRim(
    pts: Pt[], cx: number, cy: number, light: LightScope,
    color: number, strength: number, scale: number,
  ): void {
    const dash = Math.max(3, 7 * scale);
    const gap = Math.max(2, 5 * scale);
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
      const ux = dx / len, uy = dy / len;
      for (let d = 0; d < len; d += dash + gap) {
        const e = Math.min(d + dash, len);
        this.rims.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
      }
      this.rims.stroke({
        width: hairline(), color,
        alpha: Math.min(0.95, lit * strength * light.level),
      });
    }
  }

  /**
   * Fracture seams across the body: the piece lines the broken rim implies.
   *
   * Two of them, placed from the object's own centre so they are identical
   * every frame - a per-frame random would make them crawl and read as noise,
   * which is the same reason the impact cracks are seeded from their hit point.
   * They darken as damage lands, so an object about to go looks like it is
   * already coming apart rather than merely dirty.
   */
  private drawSeams(pts: Pt[], cx: number, cy: number, scale: number, damage: number): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX, h = maxY - minY;
    // Too small to carry a seam without becoming a smudge.
    if (Math.min(w, h) < 14 * scale) return;

    const seed = Math.abs(Math.round(cx * 73856093) ^ Math.round(cy * 19349663));
    for (let i = 0; i < 2; i++) {
      const hx = Math.sin(seed * 0.0001 + i * 1.7) * 43758.5453;
      const t = 0.3 + (hx - Math.floor(hx)) * 0.4;   // keep them off the edges
      // Seam the SHORT way across, so a long thin wall is cut into blocks
      // rather than sliced lengthwise into two long thin walls.
      if (w >= h) {
        const x = minX + w * t;
        this.rims.moveTo(x, minY).lineTo(x, maxY);
      } else {
        const y = minY + h * t;
        this.rims.moveTo(minX, y).lineTo(maxX, y);
      }
    }
    this.rims.stroke({
      width: hairline(), color: PALETTE.shadow,
      alpha: 0.35 + damage * 0.4,
    });
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
    const g = this.prep(poly, w2s, d.dents);
    if (!g) return;
    const { pts, cx, cy } = g;

    this.castShadow(pts, cx, cy, scale, light, 1 - damage * 0.4);

    const amb = ambientAt(light, cx, cy);
    // A chest is loot, not obstruction: amber body so it reads as a prize.
    //
    // An ordinary breakable gets a warm shift off the plain obstacle colour.
    // Small on purpose: colour alone is a weak signal here because the board
    // already carries several object types, and the LOAD-BEARING cue is the
    // broken rim below. This just stops a breakable being pixel-identical to
    // the wall beside it, which is what it was.
    const base = d.chest ? PALETTE.amber
      : d.objective ? 0x8a6a3a
      : mix(PALETTE.obstacle, PALETTE.amber, 0.18);
    const body = mix(PALETTE.shadow, base, (0.55 + amb * 0.45) * (1 - damage * 0.45));
    this.bodies.poly(pts).fill({ color: body, alpha: 1 });

    const rimColor = d.chest ? 0xffe9b0 : PALETTE.obstacleEdge;
    const rimStrength = 0.95 * (1 - damage * 0.7);
    if (d.chest) {
      this.rimEdges(pts, cx, cy, light, rimColor, rimStrength);
    } else {
      // A BROKEN rim, and this is the whole point of the change. A solid slab
      // is outlined continuously; this one is outlined in pieces, so the
      // silhouette itself says "this comes apart" before a ball has touched it.
      //
      // It used to be told apart only by DAMAGE, which is backwards: you had to
      // hit it to learn it was hittable, and a fresh breakable was the same
      // colour and the same outline as the wall next to it.
      this.brokenRim(pts, cx, cy, light, rimColor, rimStrength, scale);
      this.drawSeams(pts, cx, cy, scale, damage);
    }

    // Dents + cracks: each recorded impact notches the surface and throws a few
    // splits out from it. Placed at the real world hit point, so damage reads as
    // history - you can see WHERE it has been hit, not just how much.
    //
    // The crack geometry is seeded from the impact position rather than random,
    // so it is identical every frame; a per-frame random would make the cracks
    // crawl and read as noise.
    this.drawCracks(d.dents, w2s, scale, PALETTE.shadow, 0.7, true);
  }

  /**
   * Impact cracks radiating from each recorded hit point.
   *
   * Shared by breakables and mirrors: both are destructible, and a mirror one
   * hit from shattering used to look identical to a fresh one.
   */
  private drawCracks(
    dents: { x: number; y: number }[] | undefined,
    w2s: W2S,
    scale: number,
    color: number,
    alpha: number,
    withPit = false,
  ): void {
    if (!dents || dents.length === 0) return;
    for (const dent of dents) {
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
      if (withPit) {
        this.bodies
          .circle(p.x, p.y, Math.max(1.5, 4 * scale))
          .fill({ color: PALETTE.shadow, alpha: 0.55 });
      }
    }
    this.rims.stroke({ width: Math.max(hairline(), scale), color, alpha });
  }

  /** A mirror: hard specular edge, cool body, still a solid object with a shadow. */
  private drawMirror(
    poly: Polygon,
    light: LightScope,
    w2s: W2S,
    scale: number,
    alpha: number,
    damage = 0,
    dents?: { x: number; y: number }[],
  ): void {
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
    // Damage eats into it, because a cracked mirror stops returning the light -
    // which is also the honest cue that it is nearly broken.
    this.rimEdges(pts, cx, cy, light, 0xd8f4ff, 1.6 * alpha * (1 - damage * 0.7), 2);

    // Damage cracks. A mirror is destructible (the black ball smashes it), and
    // with no damage drawn at all a mirror one hit from shattering looked
    // identical to a fresh one.
    this.drawCracks(dents, w2s, scale, 0xd8f4ff, 0.75);
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
