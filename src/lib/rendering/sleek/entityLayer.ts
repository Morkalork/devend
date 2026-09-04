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
import type { Polygon, Vector2 } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { BOUNCER_FLASH_MS, bouncerCharge, type BouncerSpec } from "@/lib/physics/bouncer";
import { bouncerRings } from "./bouncerRings";
import { deformPlies } from "./deformSkin";
import { deformWear, type DeformState } from "@/lib/physics/deformable";
import type { PortalSpec } from "@/lib/physics/portal";
import { ambientAt, contactFor, facing, shadowFor, slabHeight, type LightScope } from "./light";
import { anyObstacleImpactsActive, obstacleBulgeAt } from "@/lib/wallImpactEffects";
import { snapContour, hairline, type Pt } from "./pixelGrid";
import { dashedLine } from "./dashedLine";
import { BEARING_VECTOR, type ObstacleRule } from "@/lib/physics/obstacleRules";
import { getBallType } from "@/lib/ballTypes";

type W2S = (x: number, y: number) => Pt;

/**
 * Hazard bars across a disc, as chords, so no clipping is needed: a chord at
 * signed distance d from the centre has half-length sqrt(r^2 - d^2), and its
 * ends therefore sit exactly ON the circle.
 *
 * `roll` rotates them with the mover's travel, so the thing visibly turns as it
 * patrols. A ball spins invisibly (it is a smooth sphere); this reads as a
 * roller, which is the whole point.
 */
function hazardBars(g: Graphics, cx: number, cy: number, r: number, roll: number): void {
  const ca = Math.cos(roll), sa = Math.sin(roll);
  const width = r * 0.26;
  for (const d of [-r * 0.45, r * 0.05, r * 0.55]) {
    const halfLen = Math.sqrt(Math.max(0, r * r - d * d));
    if (halfLen < 0.5) continue;
    // Bar corners in the disc's own frame, then rotated by `roll`.
    const corners: Array<[number, number]> = [
      [-halfLen, d - width / 2], [halfLen, d - width / 2],
      [halfLen, d + width / 2], [-halfLen, d + width / 2],
    ];
    g.poly(corners.map(([x, y]) => ({ x: cx + x * ca - y * sa, y: cy + x * sa + y * ca })));
  }
}

/**
 * Longest edge piece, in world units, when an obstacle is taking a hit.
 *
 * A slab is four corners. A dent is a local thing, so pushing four corners
 * around moves the whole shape instead of denting it: the edge has to be cut
 * into enough pieces for the falloff to have somewhere to land.
 */
const DENT_STEP = 22;

/**
 * An obstacle's outline, dented where balls have struck it.
 *
 * The ordinary path is untouched: snapContour over the four transformed
 * corners, which is every obstacle on every frame. Only while an impact is
 * live does the outline get subdivided and displaced, and only then does it
 * stop being pixel-snapped, because snapping a curve quantises the dent into a
 * staircase.
 *
 * Displaced in WORLD space before transforming, for the same reason the wall
 * bulge is: the displacement is a world-space direction, and adding it to
 * screen coordinates would push the dent sideways once the board is tilted.
 */
function dentedContour(vertices: Vector2[], w2s: W2S): Pt[] {
  if (!anyObstacleImpactsActive()) {
    return snapContour(vertices.map(v => w2s(v.x, v.y)));
  }
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

export class EntityLayer {
  readonly container = new Container();

  /** The renderer's shared floor plane, set each frame in sync(). */
  private shadows!: Graphics;
  /** Patrol rails, under everything: a mover is a machine on a track. */
  private rails = new Graphics();
  private bodies = new Graphics();
  private rims = new Graphics();

  constructor() {
    // No shadow child: cast shadows go to the shared floor plane.
    this.container.addChild(this.rails, this.bodies, this.rims);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    shadows: Graphics,
    w2s: W2S,
    scale: number,
  ): void {
    this.shadows = shadows;
    this.rails.clear();
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
      // A deformable is made of different stuff, so it is not painted in the
      // furniture colour. Same value as an ordinary slab (it stands in the same
      // light and is furniture too); the hue is what says the material differs,
      // exactly as the breakable's warmth does.
      const deform = game.deformables?.get(poly as Polygon);
      this.drawSlab(
        poly as Polygon, light, w2s, scale,
        deform ? mix(PALETTE.deformable, PALETTE.deformableWorn, deformWear(deform)) : undefined,
      );
      if (deform) this.drawDeformSkin(poly as Polygon, deform, w2s, scale);
      // A membrane or a gate that looks exactly like a wall is not a mechanic,
      // it is a bug the player has to reverse-engineer by dying. Drawn after
      // the slab so the cue sits on top of its own face.
      const rule = game.obstacleRules?.get(poly as Polygon);
      if (rule) this.drawPassCue(poly as Polygon, rule, w2s, scale);
      // Same argument as the pass cue above: a bumper that looks like a pillar
      // is a pillar the player finds out about by being surprised. Concentric
      // rings and a lit core, so it reads as sprung rather than solid, and it
      // flares for a moment after it fires.
      const bouncer = game.bouncers?.get(poly as Polygon);
      if (bouncer) this.drawBouncer(poly as Polygon, bouncer, game, w2s, scale);
      // A portal is the one obstacle balls go THROUGH, so it must not read as
      // solid at all. Drawn as an open mouth over the slab rather than beside
      // it: a player who reads it as a pillar will aim to bounce off it.
      const portal = game.portals?.get(poly as Polygon);
      if (portal) this.drawPortal(portal, w2s, scale);
    }

    for (const m of game.movers) {
      this.drawRail(m, w2s, scale);
      this.drawMover(m, light, w2s, scale);
    }
  }

  /**
   * The cue that says a wall is not solid to everything.
   *
   * ONE-WAY gets chevrons pointing the way balls may travel, repeated along the
   * face so the direction reads from any part of it. An arrow at the centre
   * would be invisible on the long walls where this mechanic is most useful.
   *
   * A GATE gets a dashed rim in the colour of the ball type it admits, which
   * ties it to the ball marks rather than inventing a second vocabulary: the
   * player already learned that colour on the ball, and a gate that admits it
   * should look like it belongs to it. With more than one type admitted the rim
   * alternates between their colours.
   */
  /**
   * A deformable's face: padding you can see, and a record of what it has taken.
   *
   * Both cues come from deformSkin.ts, where a test can reach them. Drawn over
   * the slab rather than instead of it: this IS a solid - it never breaks and
   * it never opens - so it must keep the silhouette, the shadow and the contact
   * band every other solid has. Only the material differs.
   */
  private drawDeformSkin(
    poly: Polygon, state: DeformState, w2s: W2S, scale: number,
  ): void {
    const g = this.rims;
    const wear = deformWear(state);

    // The ghost of the shape as authored. Dashed, so it never competes with the
    // lit rim of the real edge beside it, and drawn unconditionally: while the
    // wall is pristine it lies exactly on that rim and is invisible, and the
    // gap that opens as it sinks is the whole point of drawing it.
    const ghost = state.original.map(v => w2s(v.x, v.y));
    for (let i = 0; i < ghost.length; i++) {
      const a = ghost[i], b = ghost[(i + 1) % ghost.length];
      dashedLine(g, a.x, a.y, b.x, b.y, 5 * scale, 4 * scale);
    }
    g.stroke({
      width: hairline(),
      color: PALETTE.deformableWorn,
      alpha: 0.2 + wear * 0.45,
    });

    // The padding, inside the LIVE face, so the plies sink with it.
    for (const ply of deformPlies(poly.vertices)) {
      const pts = ply.map(v => w2s(v.x, v.y));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
    }
    g.stroke({ width: hairline(), color: PALETTE.deformable, alpha: 0.55 });
  }

  /**
   * A pop bumper: concentric rings around a lit core, flaring on a hit.
   *
   * Deliberately not the slab treatment every other obstacle gets. The one
   * thing a player must be able to read before touching it is that this solid
   * gives energy back, and nothing about a flat face says that. Rings say
   * "sprung"; the flare is what connects a ball suddenly moving faster to the
   * thing that made it happen.
   */
  private drawBouncer(
    poly: Polygon, spec: BouncerSpec, game: CanvasGameState, w2s: W2S, scale: number,
  ): void {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of poly.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const c = w2s((minX + maxX) / 2, (minY + maxY) / 2);
    const r = (Math.min(maxX - minX, maxY - minY) / 2) * scale;
    if (!(r > 0)) return;

    // How recently it fired, 1 at the moment of the kick down to 0.
    const now = performance.now();
    let flare = 0;
    for (const f of game.bouncerFlashes ?? []) {
      if (f.id !== spec.id) continue;
      const t = 1 - (now - f.at) / BOUNCER_FLASH_MS;
      if (t > flare) flare = Math.min(1, t);
    }

    // GREEN while it still holds hours, RED once it is spent. The bank is the
    // reason to keep a ball in play rather than take the quick win, so whether
    // there is anything left in it has to be readable from across the board -
    // and readable at a glance, not by remembering how many times it has been
    // hit. Colour rather than a number for the same reason: at a phone's scale
    // a digit inside a 40-pixel ring is not information.
    const colour = spec.hours > 0 ? PALETTE.bouncerFull : PALETTE.bouncerSpent;
    const g = this.rims;

    // Which ring moves with the bank and which does not is the whole design,
    // and it lives in bouncerRings.ts where a test can reach it.
    const charge = bouncerCharge(spec);
    const ring = bouncerRings(charge, r, flare);

    // The rim: where the ball actually bounces, and fixed.
    g.circle(c.x, c.y, ring.rim)
      .stroke({ width: Math.max(1.5, (2.5 + flare * 3) * scale), color: colour, alpha: 0.75 + flare * 0.25 });
    // The gauge. Absent rather than a dot when the bank is empty.
    if (ring.charge > 0) {
      g.circle(c.x, c.y, ring.charge)
        .stroke({ width: Math.max(1, (1.8 + flare * 1.6) * scale), color: colour, alpha: 0.55 + flare * 0.4 });
    }
    // The core, which is what lights up on a hit.
    g.circle(c.x, c.y, ring.core)
      .fill({ color: colour, alpha: spec.hours > 0 ? 0.3 + charge * 0.15 + flare * 0.55 : 0.12 + flare * 0.3 });
  }

  /**
   * A portal mouth: nested rings with a dark middle, so it reads as a hole.
   *
   * Deliberately open in the centre. Every other object on this layer is drawn
   * as a lit solid, and the one fact a player has to know about this one before
   * they aim at it is that it is not one.
   */
  private drawPortal(spec: PortalSpec, w2s: W2S, scale: number): void {
    const c = w2s(spec.centre.x, spec.centre.y);
    const r = spec.radius * scale;
    if (!(r > 0)) return;
    const g = this.rims;
    // The dark middle first, so the slab beneath does not read through it.
    g.circle(c.x, c.y, r * 0.82).fill({ color: 0x05060a, alpha: 0.92 });
    for (const [k, a] of [[0.95, 0.85], [0.7, 0.55], [0.45, 0.35]] as const) {
      g.circle(c.x, c.y, r * k)
        .stroke({ width: Math.max(1, 1.8 * scale), color: PALETTE.portal, alpha: a });
    }
  }

  private drawPassCue(
    poly: Polygon, rule: ObstacleRule, w2s: W2S, scale: number,
  ): void {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of poly.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = maxX - minX, spanY = maxY - minY;

    if (rule.oneWay) {
      const [bx, by] = BEARING_VECTOR[rule.oneWay];
      // March along the LONG axis and point across it, which is the direction
      // balls actually cross a membrane.
      const alongX = spanX >= spanY;
      const runLength = alongX ? spanX : spanY;
      const count = Math.max(1, Math.min(9, Math.floor(runLength / 55)));
      const arm = Math.max(3, Math.min(spanX, spanY) * 0.3);

      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const wx = alongX ? minX + spanX * t : cx;
        const wy = alongX ? cy : minY + spanY * t;
        // Chevron: two arms swept back from a tip that points along the bearing.
        const tip = w2s(wx + bx * arm * 0.5, wy + by * arm * 0.5);
        const backA = w2s(wx - bx * arm * 0.5 - by * arm * 0.5, wy - by * arm * 0.5 + bx * arm * 0.5);
        const backB = w2s(wx - bx * arm * 0.5 + by * arm * 0.5, wy - by * arm * 0.5 - bx * arm * 0.5);
        this.rims.moveTo(backA.x, backA.y).lineTo(tip.x, tip.y).lineTo(backB.x, backB.y);
      }
      this.rims.stroke({
        width: Math.max(1.5, 2.2 * scale), color: 0x9fe8ff, alpha: 0.85,
        cap: "round", join: "round",
      });
    }

    if (rule.passTypes?.length) {
      const colors = rule.passTypes
        .map(id => getBallType(id)?.color)
        .filter((c): c is string => !!c)
        .map(c => Number.parseInt(c.replace("#", ""), 16));
      const palette = colors.length ? colors : [0xffffff];

      // A dashed rim, alternating through the admitted types' colours.
      const pts = poly.vertices.map(v => w2s(v.x, v.y));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        this.rims.moveTo(a.x, a.y).lineTo(b.x, b.y);
        this.rims.stroke({
          width: Math.max(1.5, 2.4 * scale),
          color: palette[i % palette.length],
          alpha: 0.9,
        });
      }
    }
  }

  /** A static obstacle: shadow, lit fill, contact band, rim on the lit edges. */
  private drawSlab(
    poly: Polygon, light: LightScope, w2s: W2S, scale: number, body: number = PALETTE.obstacle,
  ): void {
    const pts = dentedContour(poly.vertices, w2s);
    if (pts.length < 3) return;

    // Centroid drives the shadow so the whole slab shares one offset; per-vertex
    // offsets would shear it.
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;

    // Offset comes from the slab's HEIGHT, never its footprint: a wide slab and
    // a narrow one stand equally proud, so their shadows hug them equally. Using
    // the footprint radius here threw the shadow clear of the object entirely.
    const cast = shadowFor(light, cx, cy, slabHeight(scale));
    const ox = cast.dx * cast.length;
    const oy = cast.dy * cast.length;

    // Shadow = the silhouette, translated. Drawing the union of body and
    // translated body would be more correct, but the offset is short enough
    // that the simple translate reads identically and costs one poly.
    this.shadows
      .poly(pts.map(p => ({ x: p.x + ox, y: p.y + oy })))
      .fill({ color: PALETTE.shadow, alpha: cast.alpha });

    // Contact band, the same one the movers, props and balls get. The static
    // slabs were the only things standing on this board without it, which is
    // most of why they read as painted on rather than placed.
    const contact = contactFor(light, cx, cy, slabHeight(scale));
    this.shadows
      .poly(pts.map(p => ({
        x: p.x + contact.dx * contact.length,
        y: p.y + contact.dy * contact.length,
      })))
      .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.5 });

    // Body, tinted by how much light reaches this part of the board.
    const amb = ambientAt(light, cx, cy);
    this.bodies
      .poly(pts)
      .fill({ color: mix(PALETTE.shadow, body, 0.55 + amb * 0.45), alpha: 1 });

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
        .stroke({ width: hairline(), color: PALETTE.obstacleEdge, alpha: Math.min(0.9, lit * 0.95 * light.level) });
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
      this.drawMoverSlab(m, light, w2s, scale);
      return;
    }

    const c = w2s(cxw, cyw);
    const r = Math.max(2, (m.radius ?? 18) * scale);

    const cast = shadowFor(light, c.x, c.y, slabHeight(scale));
    this.shadows
      .circle(c.x + cast.dx * cast.length, c.y + cast.dy * cast.length, r)
      .fill({ color: PALETTE.shadow, alpha: cast.alpha });

    // Contact band: short, dense, hard against the body. This is what stops the
    // mover looking like it hovers.
    const contact = contactFor(light, c.x, c.y, slabHeight(scale));
    this.shadows
      .circle(c.x + contact.dx * contact.length, c.y + contact.dy * contact.length, r * 0.96)
      .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.5 });

    const amb = ambientAt(light, c.x, c.y);
    this.bodies
      .circle(c.x, c.y, r)
      .fill({ color: mix(PALETTE.shadow, PALETTE.mover, 0.6 + amb * 0.4), alpha: 1 });

    // ── Not a ball ───────────────────────────────────────────────────────────
    // Testers read these as balls, and they were right to: a lit disc with a
    // rim highlight is exactly what a ball is here, and the lodestone ball is
    // orange too. Colour alone was never going to separate them.
    //
    // So the difference is made STRUCTURAL rather than tonal. A ball is round
    // all the way through and glows; this gets straight lines inside it, a hard
    // machined ring around it, and a rail underneath (drawn by drawRail). No
    // ball in the game has a straight edge anywhere on it, so the read is
    // immediate and survives any palette change.
    const roll = m.offset / Math.max(1, m.radius ?? 18);
    hazardBars(this.bodies, c.x, c.y, r, roll);
    this.bodies.fill({ color: 0x1a1206, alpha: 0.85 });

    // Hub: the thing a wheel turns on, and the strongest single "machine" cue.
    this.bodies.circle(c.x, c.y, Math.max(1, r * 0.22)).fill({ color: 0x1a1206, alpha: 0.9 });

    // Hard machined ring, whole circumference, not a soft lit arc. A ball's rim
    // fades away from the light; this one does not, because it is an edge, not
    // a highlight.
    this.rims
      .circle(c.x, c.y, r * 0.94)
      .stroke({ width: Math.max(1, r * 0.13), color: 0xffd9a0, alpha: 0.5 + 0.4 * light.level });
  }

  /**
   * The track a mover patrols, drawn under it.
   *
   * Half the confusion with balls was that a mover appeared to wander the board
   * freely, which is what a ball does. Showing the rail says the opposite in one
   * glance: this thing is bolted to a line, it will come back, and here is
   * exactly how far it goes. That is hazard telegraphing as well as
   * identification, so it earns its ink twice.
   */
  private drawRail(
    m: CanvasGameState["movers"][number],
    w2s: W2S,
    scale: number,
  ): void {
    // A ROTOR runs on a circle, not a track. Drawing its rail as a straight
    // line would state the one thing about it that is not true - that it
    // shuttles - and the rail is the only thing on the board that tells a
    // player where a moving object can reach before it goes there.
    if (m.motion === "rotate") {
      const pivot = w2s(m.homeX, m.homeY);
      let reach = 0;
      for (const p of m.rotorOutline ?? []) reach = Math.max(reach, Math.hypot(p.x, p.y));
      if (reach <= 0.5) return;
      const r = reach * scale;
      // The swept circle, dashed like every other rail.
      const steps = Math.max(24, Math.round(r / 3));
      for (let i = 0; i < steps; i += 2) {
        const a0 = (i / steps) * Math.PI * 2;
        const a1 = ((i + 1) / steps) * Math.PI * 2;
        this.rails
          .moveTo(pivot.x + Math.cos(a0) * r, pivot.y + Math.sin(a0) * r)
          .lineTo(pivot.x + Math.cos(a1) * r, pivot.y + Math.sin(a1) * r);
      }
      this.rails.stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.mover, alpha: 0.28 });
      // The hub, so the thing it turns about is visible even when the arm is
      // on the far side of it.
      this.rails.circle(pivot.x, pivot.y, Math.max(2, 3 * scale))
        .stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.mover, alpha: 0.45 });
      return;
    }

    const half = m.range / 2;
    if (half <= 0.5) return;
    const horizontal = m.axis === "horizontal";
    const a = w2s(m.homeX - (horizontal ? half : 0), m.homeY - (horizontal ? 0 : half));
    const b = w2s(m.homeX + (horizontal ? half : 0), m.homeY + (horizontal ? 0 : half));

    dashedLine(this.rails, a.x, a.y, b.x, b.y, 6 * scale, 5 * scale);
    this.rails.stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.mover, alpha: 0.28 });

    // End stops, so the range reads as a bounded track rather than a line that
    // happens to end where it was cropped.
    const cap = Math.max(2, 4 * scale);
    const nx = horizontal ? 0 : 1, ny = horizontal ? 1 : 0;
    for (const p of [a, b]) {
      this.rails
        .moveTo(p.x - nx * cap, p.y - ny * cap)
        .lineTo(p.x + nx * cap, p.y + ny * cap)
        .stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.mover, alpha: 0.4 });
    }
  }

  /** Rect mover: the physics-updated polygon, lit like a slab but hazard-coloured. */
  private drawMoverSlab(
    m: CanvasGameState["movers"][number],
    light: LightScope,
    w2s: W2S,
    scale: number,
  ): void {
    const pts = dentedContour(m.polygon.vertices, w2s);
    if (pts.length < 3) return;

    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;

    const cast = shadowFor(light, cx, cy, slabHeight(scale));
    this.shadows
      .poly(pts.map(p => ({ x: p.x + cast.dx * cast.length, y: p.y + cast.dy * cast.length })))
      .fill({ color: PALETTE.shadow, alpha: cast.alpha });

    const amb = ambientAt(light, cx, cy);
    this.bodies
      .poly(pts)
      .fill({ color: mix(PALETTE.shadow, PALETTE.mover, 0.6 + amb * 0.4), alpha: 1 });

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
        .stroke({ width: hairline(), color: 0xffd9a0, alpha: Math.min(0.9, lit * 0.9 * light.level) });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
