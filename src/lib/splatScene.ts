/**
 * What a stuck ball is stuck TO: the solids around the contact point, captured
 * once at the moment of the splat and carried on the ball while it is held.
 *
 * ── Why the ball has to know ────────────────────────────────────────────────
 *
 * The droplet (splatShape.ts) assumes the wall is an infinite flat line along
 * the impact tangent. Wherever that is false the splat is drawn over nothing:
 * past the end of a fence, into the wall beside it, or around a corner the
 * ball bounced off. The liquid model (rendering/liquidSplat.ts) fixes that by
 * wetting whatever surface is within reach, and for that it needs the surfaces.
 *
 * ── Why it is captured rather than looked up ────────────────────────────────
 *
 * The renderer draws balls, not game state, and it draws them every frame. The
 * solids near a stuck ball do not change for the second or two it is stuck (a
 * fence drawn beside it is the one exception, and it is a cosmetic one), so
 * the physics side, which has the game and the contact normal in hand, gathers
 * them ONCE and hands the renderer a small list in CONTACT SPACE - the same
 * frame the droplet uses: origin on the contact point, +x along the wall, +y
 * into it. The per-frame work is then geometry-free.
 *
 * The geodesic distances are computed here too, for the same reason: they
 * depend only on the solids and the contact point, and the film's reach along
 * a surface is what makes the liquid pour round a corner rather than stop at
 * it (see liquidSplat.ts).
 *
 * Everything here is a polygon. A wall is a thick segment, so a rectangle; an
 * obstacle is its own outline; the outside of the board is four slabs. One
 * representation means one inside test and one boundary walk.
 */
import type { Vector2, Polygon } from "@/lib/polygon";
import type { Wall } from "@/lib/wallGeometry";

/** A solid in contact space, as a closed polygon. */
export type SplatSolid = { x: number; y: number }[];

/** A point on a solid's boundary, tagged with its surface distance from the contact. */
export interface SurfaceSample {
  x: number;
  y: number;
  /** Distance travelled ALONG the solids' boundaries from the contact point. */
  s: number;
  /**
   * The surface's outward unit normal here. A film sits on the OUTSIDE of the
   * surface it wets, and this is what keeps its kernel from bleeding through a
   * six-unit fence to the far side.
   */
  nx: number;
  ny: number;
}

export interface SplatScene {
  /** Every solid within reach, in contact space. */
  solids: SplatSolid[];
  /** Boundary samples of those solids, with geodesic distance from the contact. */
  samples: SurfaceSample[];
}

/**
 * How far out from the contact point solids are gathered, in radii. The liquid
 * never reaches further than about 2.2 times the film reach (1.2 R) plus its own
 * thickness, so anything past this cannot be wetted and is not worth carrying.
 */
export const SCENE_REACH_RADII = 3.6;

/** Boundary sample spacing, in radii. The film kernel is 0.28 R wide, so this resolves it. */
const SAMPLE_SPACING_RADII = 1 / 12;

/** Samples this close (as a multiple of the spacing) are neighbours in the surface walk. */
const NEIGHBOUR_FACTOR = 1.55;

/** How thick the board's outside is made, in radii. Only its inner face matters. */
const BOARD_SLAB_RADII = 3;

/**
 * Even-odd point-in-polygon. General rather than convex-only because obstacle
 * outlines can be anything the map author drew.
 */
export function insideSolid(px: number, py: number, poly: SplatSolid): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Covered by some OTHER solid: the point, nudged a hair OUTWARD from its own
 * solid, lands inside another one.
 *
 * The nudge is what makes shared faces come out right. Where a fence stands on
 * the board edge, the strip of floor under its foot and the foot itself lie on
 * the same line; both are on the other's boundary, and a plain inside test
 * says whatever floating point feels like. Stepping off the face first asks
 * the real question - is there solid material on the OUTSIDE of this point -
 * and answers it the same way for both: yes, so neither is surface, and the
 * film cannot run under the fence's foot and out the other side.
 */
function coveredAt(px: number, py: number, ox: number, oy: number, solids: SplatSolid[], own: SplatSolid): boolean {
  for (const s of solids) {
    if (s === own) continue;
    if (insideSolid(px + ox, py + oy, s)) return true;
  }
  return false;
}

/** Twice the signed area: positive when the vertices run counter-clockwise (y up). */
function orientation(poly: SplatSolid): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return a;
}

/**
 * A solid the contact point is buried in is pushed back until its face sits ON
 * the contact point.
 *
 * Walls are thick segments centred on their line, and the collision that
 * parked the ball did not always honour that thickness: a ball on a board
 * edge rests on the board POLYGON, whose edge is the wall's centreline, so the
 * wall's inner half overlaps the ball's contact face by half a thickness.
 * Left alone, the field would be zeroed through the base of the ball and the
 * splat would sit three units short of the wall it is glued to.
 */
function exposeContact(poly: SplatSolid): SplatSolid {
  if (!insideSolid(0, 0, poly)) return poly;
  // Where the ray from the contact toward the ball (-y) first leaves the solid.
  let t = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if ((a.x > 0) === (b.x > 0)) continue;
    const y = a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x);
    if (y < 0 && -y < t) t = -y;
  }
  if (!Number.isFinite(t)) return poly;
  return poly.map(p => ({ x: p.x, y: p.y + t }));
}

/**
 * Walk every solid's boundary, dropping points buried inside another solid,
 * then tag each survivor with its distance from the contact point travelling
 * along the surfaces (Dijkstra over the samples, so the path bends round
 * corners and steps from one solid onto the next where they touch).
 */
export function surfaceSamples(
  solids: SplatSolid[], radius: number, reach = radius * SCENE_REACH_RADII,
): SurfaceSample[] {
  const spacing = radius * SAMPLE_SPACING_RADII;
  const nudge = spacing * 0.35;
  const dedupe2 = (spacing * 0.5) ** 2;
  const pts: { x: number; y: number; s: number; nx: number; ny: number; done: boolean }[] = [];
  for (const poly of solids) {
    const ccw = orientation(poly) > 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      // The edge's outward normal, from the polygon's winding.
      const ox = ((ccw ? 1 : -1) * (b.y - a.y) * nudge) / len;
      const oy = ((ccw ? -1 : 1) * (b.x - a.x) * nudge) / len;
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
        // Outside the reach: can never be wetted, and it would only slow the walk.
        if (x * x + y * y > reach * reach) continue;
        if (coveredAt(x, y, ox, oy, solids, poly)) continue;
        // Two solids sharing a face (a board edge wall on the board's outside)
        // both offer the same points; one copy is enough, and a second would
        // double the film there.
        let dup = false;
        for (const q of pts) {
          const dx = q.x - x, dy = q.y - y;
          if (dx * dx + dy * dy < dedupe2) { dup = true; break; }
        }
        if (dup) continue;
        pts.push({ x, y, s: Infinity, nx: ox / nudge, ny: oy / nudge, done: false });
      }
    }
  }
  if (pts.length === 0) return [];

  // Start at the sample nearest the contact point (the origin).
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x * pts[i].x + pts[i].y * pts[i].y < pts[start].x * pts[start].x + pts[start].y * pts[start].y) start = i;
  }
  pts[start].s = 0;
  const link = spacing * NEIGHBOUR_FACTOR;
  const link2 = link * link;
  // Plain O(n^2) Dijkstra: a few hundred samples, once per splat.
  for (let round = 0; round < pts.length; round++) {
    let u = -1;
    for (let i = 0; i < pts.length; i++) {
      if (!pts[i].done && (u < 0 || pts[i].s < pts[u].s)) u = i;
    }
    if (u < 0 || pts[u].s === Infinity) break;
    const p = pts[u];
    p.done = true;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (q.done) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > link2) continue;
      const s = p.s + Math.sqrt(d2);
      if (s < q.s) q.s = s;
    }
  }
  const out: SurfaceSample[] = [];
  for (const p of pts) if (p.s < Infinity) out.push({ x: p.x, y: p.y, s: p.s, nx: p.nx, ny: p.ny });
  return out;
}

/** The game-state slice the capture reads. Narrow on purpose: it is called from physics. */
export interface SceneSource {
  walls: Wall[];
  obstaclePolygons: Polygon[];
  boardPolygon: Polygon | null;
  portals?: { has(p: Polygon): boolean };
}

/**
 * Gather the solids around a contact and express them in contact space.
 *
 * `contact` is the point on the surface, `n` the unit normal pointing OFF the
 * surface (the impact normal ballEffects records). Contact space is x along
 * the tangent t = (-n.y, n.x) and y = -(distance along n), so +y is INTO the
 * wall, matching splatShape.ts and the renderer's mapping.
 */
export function captureSplatScene(
  source: SceneSource, contact: Vector2, n: Vector2, radius: number,
): SplatScene {
  const reach = radius * SCENE_REACH_RADII;
  const tx = -n.y, ty = n.x;
  const toLocal = (wx: number, wy: number) => {
    const dx = wx - contact.x, dy = wy - contact.y;
    return { x: dx * tx + dy * ty, y: -(dx * n.x + dy * n.y) };
  };
  const near = (pts: { x: number; y: number }[]) => {
    // AABB against the reach square, in world space.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return maxX >= contact.x - reach && minX <= contact.x + reach
      && maxY >= contact.y - reach && minY <= contact.y + reach;
  };
  const solids: SplatSolid[] = [];

  // Walls: board edges, obstacle edges, fences. Each is a thick segment.
  for (const w of source.walls) {
    // Balls pass straight through a portal's rim; the liquid must not cling to it.
    if (w.portal) continue;
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const h = Math.max(0.5, w.thickness / 2);
    const mx = (-dy / len) * h, my = (dx / len) * h;
    const rect = [
      { x: w.start.x + mx, y: w.start.y + my }, { x: w.end.x + mx, y: w.end.y + my },
      { x: w.end.x - mx, y: w.end.y - my }, { x: w.start.x - mx, y: w.start.y - my },
    ];
    if (!near(rect)) continue;
    solids.push(exposeContact(rect.map(p => toLocal(p.x, p.y))));
  }

  // Obstacle interiors: their edges are already walls, but the bulk of the
  // liquid is wider than a wall is thick and would otherwise show through the
  // face of a slab as if the slab were hollow.
  for (const poly of source.obstaclePolygons) {
    if (source.portals?.has(poly)) continue;
    if (poly.vertices.length < 3 || !near(poly.vertices)) continue;
    solids.push(exposeContact(poly.vertices.map(p => toLocal(p.x, p.y))));
  }

  // Outside the board: four slabs around its bounding box. The board edge walls
  // are thin; without these the liquid would pour off the edge of the world.
  if (source.boardPolygon && source.boardPolygon.vertices.length >= 3) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of source.boardPolygon.vertices) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const d = radius * BOARD_SLAB_RADII;
    const slabs = [
      [{ x: minX - d, y: minY - d }, { x: maxX + d, y: minY - d }, { x: maxX + d, y: minY }, { x: minX - d, y: minY }],
      [{ x: minX - d, y: maxY }, { x: maxX + d, y: maxY }, { x: maxX + d, y: maxY + d }, { x: minX - d, y: maxY + d }],
      [{ x: minX - d, y: minY }, { x: minX, y: minY }, { x: minX, y: maxY }, { x: minX - d, y: maxY }],
      [{ x: maxX, y: minY }, { x: maxX + d, y: minY }, { x: maxX + d, y: maxY }, { x: maxX, y: maxY }],
    ];
    for (const slab of slabs) if (near(slab)) solids.push(exposeContact(slab.map(p => toLocal(p.x, p.y))));
  }

  return { solids, samples: surfaceSamples(solids, radius, reach) };
}
