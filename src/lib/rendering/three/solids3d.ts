/**
 * The board's furniture as extruded solids: obstacles, breakables, mirrors,
 * deformables, bumpers, phasing pillars, movers and launcher shells.
 *
 * One merged mesh, rebuilt only when something about it changed. "Changed" is
 * a hash of every footprint vertex and height, so a static board builds once
 * per map, while a patrolling mover, a dented slab or a pillar fading out
 * rebuilds it for exactly as long as it is moving. A late board is a few dozen
 * polygons, so even a rebuild every frame is a fraction of a millisecond; the
 * hash is what makes the common case free.
 *
 * What is NOT a solid, on purpose:
 *   - a PORTAL: balls pass through it, and the one thing the 2D layer insists
 *     on is that it must not read as a pillar. It stays a mouth on the floor.
 *   - a phased-out pillar: intangible, so drawn flat (its 2D outline stays on
 *     the floor); while it fades its height fades with it, so a pillar visibly
 *     sinks out of the board rather than popping.
 */
import { BufferAttribute, BufferGeometry, Mesh, ShapeUtils, Vector2 as V2, type Material } from "three";
import type { CanvasGameState } from "@/types/gameState";
import type { Polygon, Vector2 } from "@/lib/polygon";
import { anyObstacleImpactsActive, obstacleBulgeAt } from "@/lib/wallImpactEffects";
import { simNow } from "@/lib/simClock";
import { HEIGHTS } from "./heights3d";
import { ROLE_RISE } from "@/lib/objectRise";

export interface Solid {
  vertices: Vector2[];
  height: number;
}

/** Longest edge piece when a slab is dented (entityLayer.DENT_STEP). */
const DENT_STEP = 22;
/** How far inside an edge a side face samples its colour, world units. */
const SIDE_INSET = 2.2;
/** Segments for a disc mover's footprint. */
const DISC_SEGMENTS = 28;

/** A slab's outline, dented where balls have struck it (entityLayer.dentedContour). */
function dented(vertices: Vector2[]): Vector2[] {
  if (!anyObstacleImpactsActive()) return vertices;
  const out: Vector2[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / DENT_STEP));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const wx = a.x + (b.x - a.x) * t;
      const wy = a.y + (b.y - a.y) * t;
      const d = obstacleBulgeAt(wx, wy, 1);
      out.push({ x: wx + d.dx, y: wy + d.dy });
    }
  }
  return out;
}

function disc(cx: number, cy: number, r: number): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < DISC_SEGMENTS; i++) {
    const a = (i / DISC_SEGMENTS) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/**
 * What each obstacle IS, as a height (objectRise.ts): shards, monoliths,
 * chests and membranes. Rebuilt per call - a few dozen entries at most.
 */
export function roleRises(game: CanvasGameState): Map<Polygon, number> {
  const out = new Map<Polygon, number>();
  for (const d of game.destructibles ?? []) {
    if (d.kind !== "breakable" || !d.obstaclePolygon || d.destroyed) continue;
    // A fence-style breakable is drawn as a barrier line, so it stands like one.
    const rise = d.chest ? ROLE_RISE.chest
      : d.brittle ? ROLE_RISE.shard
      : d.fenceStyle ? 1
      : ROLE_RISE.monolith;
    out.set(d.obstaclePolygon, rise);
  }
  for (const [poly, rule] of game.obstacleRules ?? []) {
    if (rule.oneWay || rule.passTypes?.length) out.set(poly, ROLE_RISE.membrane);
  }
  return out;
}

/** An obstacle's height as a multiple of the slab: authored, else its role's. */
export function obstacleRiseOf(
  game: CanvasGameState, poly: Polygon, roles: Map<Polygon, number>,
): number {
  const authored = game.obstacleRise?.get(poly);
  if (authored !== undefined) return authored;
  if (game.bouncers?.has(poly)) return HEIGHTS.bouncer / HEIGHTS.slab;
  return roles.get(poly) ?? 1;
}

/** Every solid standing on the board this frame, untilted world units. */
export function collectSolids(game: CanvasGameState, heightScale: number, now = simNow()): Solid[] {
  const out: Solid[] = [];
  const portals = new Set<Polygon>(game.portals ? [...game.portals.keys()] : []);
  const phasing = new Map<Polygon, number>();
  for (const p of game.phasingObjects ?? []) phasing.set(p.polygon, p.alpha);
  const roles = roleRises(game);

  for (const poly of game.obstaclePolygons) {
    if (portals.has(poly)) continue;
    const presence = phasing.get(poly) ?? 1;
    if (presence < 0.03) continue;
    const rise = obstacleRiseOf(game, poly, roles);
    out.push({ vertices: dented(poly.vertices), height: HEIGHTS.slab * rise * heightScale * presence });
  }

  // A launcher shell standing in for its slabs until each section lets go.
  for (const shatter of game.shellShatters ?? []) {
    for (const section of shatter.sections) {
      if (now < shatter.startTime + section.delay) {
        out.push({ vertices: section.vertices, height: HEIGHTS.slab * heightScale });
      }
    }
  }

  for (const m of game.movers) {
    const height = (m.rise !== undefined ? HEIGHTS.slab * m.rise : HEIGHTS.mover) * heightScale;
    if (m.shape === "rect") {
      out.push({ vertices: dented(m.polygon.vertices), height });
    } else {
      const cx = m.homeX + (m.axis === "horizontal" ? m.offset : 0);
      const cy = m.homeY + (m.axis === "vertical" ? m.offset : 0);
      out.push({ vertices: disc(cx, cy, m.radius ?? 18), height });
    }
  }
  return out;
}

/** A cheap fingerprint of every footprint and height. */
export function solidsHash(solids: Solid[]): number {
  let h = solids.length * 7919;
  for (const s of solids) {
    h = (h * 31 + Math.round(s.height * 100)) | 0;
    for (const v of s.vertices) {
      h = (h * 31 + Math.round(v.x * 64)) | 0;
      h = (h * 31 + Math.round(v.y * 64)) | 0;
    }
  }
  return h;
}

/**
 * Extrude solids into one indexed geometry: a triangulated top, a quad per
 * edge with an outward normal. Sides carry an inward sample offset so they
 * take their slab's colour, not the antialiased edge (surfaceMaterial.ts).
 */
export function extrude(solids: Solid[]): BufferGeometry {
  let nVerts = 0, nIdx = 0;
  for (const s of solids) {
    const n = s.vertices.length;
    if (n < 3 || s.height <= 0) continue;
    nVerts += n + n * 4;
    nIdx += (n - 2) * 3 + n * 6;
  }
  const pos = new Float32Array(nVerts * 3);
  const nrm = new Float32Array(nVerts * 3);
  const ins = new Float32Array(nVerts * 2);
  const idx = new Uint32Array(nIdx);
  let v = 0, i = 0;

  for (const s of solids) {
    const pts = s.vertices;
    const n = pts.length;
    if (n < 3 || s.height <= 0) continue;
    // Winding: ccw in (x, y) means area > 0; outward normal of edge a->b is
    // (dy, -dx) for ccw in a y-down plane... computed per edge from the
    // centroid instead, which is right for either winding.
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= n; cy /= n;
    let minExtent = Infinity;
    for (const p of pts) minExtent = Math.min(minExtent, Math.hypot(p.x - cx, p.y - cy));
    const inset = Math.min(SIDE_INSET, minExtent * 0.4);
    const h = s.height;

    // Top.
    const top0 = v;
    for (const p of pts) {
      pos[v * 3] = p.x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = p.y;
      nrm[v * 3 + 1] = 1;
      v++;
    }
    const tris = ShapeUtils.triangulateShape(pts.map(p => new V2(p.x, p.y)), []);
    // Triangles must face up (+Y). In x/z with y-up, a triangle (a,b,c) faces
    // up when its (x,z) winding is clockwise as seen from above.
    for (const [a, b, c] of tris) {
      const pa = pts[a], pb = pts[b], pc = pts[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (cross < 0) { idx[i++] = top0 + a; idx[i++] = top0 + b; idx[i++] = top0 + c; }
      else { idx[i++] = top0 + a; idx[i++] = top0 + c; idx[i++] = top0 + b; }
    }

    // Sides.
    for (let e = 0; e < n; e++) {
      const a = pts[e], b = pts[(e + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = dy / len, ny = -dx / len;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const base = v;
      for (const [p, y] of [[a, 0], [b, 0], [b, h], [a, h]] as const) {
        pos[v * 3] = p.x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = p.y;
        nrm[v * 3] = nx; nrm[v * 3 + 2] = ny;
        // In off the face, and in from the corner too: at a corner the face's
        // own normal alone still leaves the sample on the neighbouring edge.
        const tc = Math.hypot(cx - p.x, cy - p.y) || 1;
        ins[v * 2] = -nx * inset + ((cx - p.x) / tc) * inset * 0.5;
        ins[v * 2 + 1] = -ny * inset + ((cy - p.y) / tc) * inset * 0.5;
        v++;
      }
      // Facing outward: (a0, b0, b1) is front-facing when seen from outside
      // iff the normal agrees with the cross product of its edges.
      const ex = b.x - a.x, ez = b.y - a.y;
      // Face normal of (a0, b0, b1) = (b0 - a0) x (b1 - a0) = (ex,0,ez) x (ex,h,ez)
      // = (0*ez - ez*h, ez*ex - ex*ez, ex*h - 0*ex) = (-ez*h, 0, ex*h).
      const faceOut = (-ez * nx + ex * ny) > 0;
      if (faceOut) {
        idx[i++] = base; idx[i++] = base + 1; idx[i++] = base + 2;
        idx[i++] = base; idx[i++] = base + 2; idx[i++] = base + 3;
      } else {
        idx[i++] = base; idx[i++] = base + 2; idx[i++] = base + 1;
        idx[i++] = base; idx[i++] = base + 3; idx[i++] = base + 2;
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos.subarray(0, v * 3), 3));
  g.setAttribute("normal", new BufferAttribute(nrm.subarray(0, v * 3), 3));
  g.setAttribute("aSampleInset", new BufferAttribute(ins.subarray(0, v * 2), 2));
  g.setIndex(new BufferAttribute(idx.subarray(0, i), 1));
  return g;
}

/** The furniture mesh, rebuilt when its fingerprint changes. */
export class Solids3D {
  readonly mesh: Mesh;
  private hash = 0;

  constructor(material: Material) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  sync(game: CanvasGameState, heightScale: number): void {
    this.syncSolids(collectSolids(game, heightScale));
  }

  /** Lay out an explicit list of solids (the pillars' early shadows use this). */
  syncSolids(solids: Solid[]): void {
    const h = solidsHash(solids);
    if (h === this.hash && this.mesh.geometry.getIndex()) return;
    this.hash = h;
    this.mesh.geometry.dispose();
    this.mesh.geometry = extrude(solids);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
