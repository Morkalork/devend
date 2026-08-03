// Wall chain builder
//
// Fences commit as many small independent `wall-` segments (a fence grows from
// a free centre point out to a wall in each direction, so each arm is a run of
// segments). Stroked one-by-one with round caps, every shared vertex shows a
// little cap "dot" and the board reads as a pile of segments. Joining segments
// that share an endpoint into a single ordered polyline lets the renderer
// stroke each run as ONE path, turning those caps into clean round joins.

import { Vector2, Polygon, pointToSegmentDistance } from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";

export interface WallChain {
  points: Vector2[];
  /** Newest member segment's createdAt, for the fresh-draw bloom. */
  createdAt?: number;
  /** Member thickness (uniform within a fence run). */
  thickness: number;
}

/**
 * Group all fence (`wall-`) segments into continuous polylines by shared
 * endpoints. A simple fence yields one chain (its two arms joined through the
 * centre); chains also merge where one fence terminates on another.
 */
export function buildFenceChains(walls: Wall[]): WallChain[] {
  // Quantise endpoints (~0.5 world unit) so coincident points merge.
  const key = (p: Vector2) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;

  interface Seg { a: string; b: string; used: boolean; createdAt?: number; thickness: number }
  const segs: Seg[] = [];
  const adj = new Map<string, number[]>();
  const nodePt = new Map<string, Vector2>();

  const link = (node: string, idx: number, pt: Vector2) => {
    let list = adj.get(node);
    if (!list) { list = []; adj.set(node, list); }
    list.push(idx);
    if (!nodePt.has(node)) nodePt.set(node, pt);
  };

  for (const w of walls) {
    if (!w.id.startsWith("wall-")) continue;
    const a = key(w.start), b = key(w.end);
    if (a === b) continue; // degenerate
    const idx = segs.length;
    segs.push({ a, b, used: false, createdAt: w.createdAt, thickness: w.thickness });
    link(a, idx, w.start);
    link(b, idx, w.end);
  }
  if (segs.length === 0) return [];

  const chains: WallChain[] = [];
  const otherEnd = (seg: Seg, node: string) => (seg.a === node ? seg.b : seg.a);
  const nextUnused = (node: string): number => {
    const list = adj.get(node);
    if (list) for (const i of list) if (!segs[i].used) return i;
    return -1;
  };

  const walkFrom = (startNode: string, startSeg: number) => {
    const points: Vector2[] = [nodePt.get(startNode)!];
    let createdAt: number | undefined;
    let thickness = segs[startSeg].thickness;
    let node = startNode;
    let si = startSeg;
    while (si >= 0) {
      const seg = segs[si];
      seg.used = true;
      thickness = seg.thickness;
      if (seg.createdAt !== undefined) {
        createdAt = createdAt === undefined ? seg.createdAt : Math.max(createdAt, seg.createdAt);
      }
      const end = otherEnd(seg, node);
      points.push(nodePt.get(end)!);
      node = end;
      si = nextUnused(node);
    }
    if (points.length >= 2) chains.push({ points, createdAt, thickness });
  };

  // Start at open ends (degree 1) so linear runs trace cleanly end to end.
  for (const [node, list] of adj) {
    if (list.length === 1 && !segs[list[0]].used) walkFrom(node, list[0]);
  }
  // Anything left (loops / higher-degree tangles) — trace from any unused seg.
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i].used) walkFrom(segs[i].a, i);
  }

  return chains;
}

// ── Wall-join flare ─────────────────────────────────────────────────────────
// A fence should look like it SPLASHED onto the wall and merged, not butted a
// point against it: near each end (which lands on a wall) the fence flares
// WIDER, widest right at the contact and easing back to normal width over the
// join distance. It stays fully solid (no fade) so it reads as attached. The
// flare is a function of arc-distance from the nearest end.

/** Width enlargement right at the wall contact (the "splash"). 1 = off: the
 *  fence keeps a constant width into the wall; the merge is carried purely by
 *  the white border fading out and the green filling in near the junction. */
const TAPER_FLARE = 1.0;

/**
 * Shape of the wall join at `distFromEnd` along the run (0 = at the wall):
 *  - `w`: width multiplier, widest at the contact (the splash), back to 1 inside.
 *  - `a`: intensity scale, kept at 1 so the fence keeps its FULL green core and
 *    white border right up to the junction — it looks like the wall simply
 *    forked, not like the fence fades in. Only the width flares.
 */
export function taperFactor(distFromEnd: number, taperLen: number): { w: number; a: number } {
  if (taperLen <= 0 || distFromEnd >= taperLen) return { w: 1, a: 1 };
  const t = Math.max(0, distFromEnd) / taperLen;
  const e = t * t * (3 - 2 * t); // smoothstep 0..1 (0 at wall, 1 in interior)
  return { w: 1 + (TAPER_FLARE - 1) * (1 - e), a: 1 };
}

export interface TaperPiece {
  x1: number; y1: number; x2: number; y2: number;
  /** width scale (flare) and alpha scale for this piece. */
  w: number; a: number;
  /** Arc distance to the wall contact: >0 interior, 0 at the wall, <0 past it.
   *  Lets the renderer stop the white core short of the wall while the green
   *  centerline runs all the way in. */
  dw: number;
  /** Terminal piece at a non-flared (fence-to-fence / free) end — draw it with a
   *  butt cap so the core doesn't poke past the fence it meets. */
  butt?: boolean;
}

/** Push a polyline's endpoints outward along their terminal directions (per end). */
function withExtendedEnds(pts: { x: number; y: number }[], os0: number, os1: number): { x: number; y: number }[] {
  if ((os0 <= 0 && os1 <= 0) || pts.length < 2) return pts;
  const out = pts.map(p => ({ x: p.x, y: p.y }));
  const push = (tip: number, prev: number, amt: number) => {
    if (amt <= 0) return;
    const dx = out[tip].x - out[prev].x, dy = out[tip].y - out[prev].y;
    const l = Math.hypot(dx, dy) || 1;
    out[tip] = { x: out[tip].x + (dx / l) * amt, y: out[tip].y + (dy / l) * amt };
  };
  push(0, 1, os0);
  push(out.length - 1, out.length - 2, os1);
  return out;
}

/**
 * Which of a chain's two ends land on a wall (board edge or obstacle boundary),
 * and so should flare/overshoot. Ends that land on another fence (or nowhere)
 * return false, so they render as a plain end and don't overflow past it.
 */
export function chainFlareEnds(
  points: Vector2[],
  boardPolygon: Polygon | undefined,
  eps = 2,
): [boolean, boolean] {
  const onBoundary = (p: Vector2, verts: Vector2[]) => {
    for (let i = 0; i < verts.length; i++) {
      if (pointToSegmentDistance(p, verts[i], verts[(i + 1) % verts.length]) <= eps) return true;
    }
    return false;
  };
  // ONLY flare into the board edge: its outward overshoot lands in the clipped
  // border margin, so the fence reads as merged. An interior OBSTACLE has no
  // such margin, so flaring there pushes the overshoot INTO the visible object
  // (the fence looks like it pokes past the surface). Obstacle-terminating ends
  // therefore butt cleanly at the surface (flare = false) instead.
  const onBoardEdge = (p: Vector2) => !!boardPolygon && onBoundary(p, boardPolygon.vertices);
  return [onBoardEdge(points[0]), onBoardEdge(points[points.length - 1])];
}

/**
 * Split a screen-space polyline into short pieces carrying the wall-join flare
 * width near both ends (interior stays a single full-scale piece per segment).
 * Renderers stroke the core + centerline per piece.
 *
 * `overshoot` extends both ends outward by that many px (past the wall contact)
 * so the bright core runs flush into the wall and its end cap lands in the
 * clipped margin / under the wall's own core, reading as merged, not attached.
 * The flare still peaks at the true wall contact (`overshoot` in from the tip).
 */
export function buildFenceTaper(
  pts: { x: number; y: number }[],
  taperLen: number,
  overshoot = 0,
  flareEnds: [boolean, boolean] = [true, true],
): TaperPiece[] {
  const out: TaperPiece[] = [];
  // Only overshoot/flare the ends that land on a wall; a fence-to-fence end
  // gets neither, so it can't overflow past the fence it meets.
  const os0 = flareEnds[0] ? overshoot : 0;
  const os1 = flareEnds[1] ? overshoot : 0;
  const src = withExtendedEnds(pts, os0, os1);
  const n = src.length;
  if (n < 2) return out;

  const cum = [0];
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
  const T = cum[n - 1];
  if (T < 1e-3) return out;

  // Signed distance to the nearest FLARED wall contact (0 at the wall, negative
  // in the overshoot past it). Non-flared ends are excluded, so no flare there.
  const cs = os0, ce = T - os1;
  const distToWall = (pos: number) => {
    let d = Infinity;
    if (flareEnds[0]) d = Math.min(d, pos - cs);
    if (flareEnds[1]) d = Math.min(d, ce - pos);
    return d;
  };
  const STEP = 2.5; // px between samples inside a flare zone

  for (let i = 0; i < n - 1; i++) {
    const a = src[i], b = src[i + 1];
    const c0 = cum[i], c1 = cum[i + 1];
    const segLen = c1 - c0;
    if (segLen < 1e-4) continue;
    const at = (pos: number) => {
      const t = (pos - c0) / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    // Split at the flare-zone boundaries so the interior stays a single full
    // piece and only the flared near-end zones get subdivided.
    const breaks = [c0];
    const boundaries: number[] = [];
    if (flareEnds[0]) boundaries.push(cs + taperLen);
    if (flareEnds[1]) boundaries.push(ce - taperLen);
    for (const bp of boundaries) {
      if (bp > c0 + 1e-4 && bp < c1 - 1e-4) breaks.push(bp);
    }
    breaks.push(c1);
    breaks.sort((x, y) => x - y);
    for (let k = 0; k < breaks.length - 1; k++) {
      const p0 = breaks[k], p1 = breaks[k + 1];
      if (p1 - p0 < 1e-4) continue;
      if (distToWall((p0 + p1) / 2) >= taperLen) {
        const s = at(p0), e = at(p1);
        out.push({ x1: s.x, y1: s.y, x2: e.x, y2: e.y, w: 1, a: 1, dw: distToWall((p0 + p1) / 2) });
      } else {
        const steps = Math.max(1, Math.ceil((p1 - p0) / STEP));
        for (let s = 0; s < steps; s++) {
          const q0 = at(p0 + (p1 - p0) * (s / steps));
          const q1 = at(p0 + (p1 - p0) * ((s + 1) / steps));
          const dwMid = distToWall(p0 + (p1 - p0) * ((s + 0.5) / steps));
          const f = taperFactor(Math.max(0, dwMid), taperLen);
          out.push({ x1: q0.x, y1: q0.y, x2: q1.x, y2: q1.y, w: f.w, a: f.a, dw: dwMid });
        }
      }
    }
  }
  // Butt-cap the terminal piece(s) at non-flared ends so the core stops flat at
  // the fence it meets instead of poking past with a round cap.
  if (out.length) {
    if (!flareEnds[0]) out[0].butt = true;
    if (!flareEnds[1]) out[out.length - 1].butt = true;
  }
  return out;
}
