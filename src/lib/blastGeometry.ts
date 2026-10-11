/**
 * The geometry of a bomb blast taking a bite out of the board (lib/blastCarve.ts
 * does the board side). Pure, so the shapes can be tested on their own.
 *
 * The blast is a circle, drawn as a regular polygon. Two cuts:
 *
 *   a fence    segment minus circle: the pieces outside it (clipLineAgainstPolygons)
 *   a wall     polygon minus circle: what is left of a solid, as one or more
 *              simple polygons (polygonMinusConvex)
 *
 * Nothing on this board has holes - not the collision, not the 2D slab drawing,
 * not the 3D extrusion - so a blast wholly inside a wall never makes one: the
 * wall is first split in two through the blast's centre, and each half then
 * loses a bite from its edge.
 */
import type { Polygon, Vector2 } from "@/lib/polygon";
import { clipLineAgainstPolygons, pointInPolygon, polygonArea } from "@/lib/polygon";

/** The blast as a polygon: `sides` vertices on the circle, starting at `phase`. */
export function circlePolygon(c: Vector2, r: number, sides = 40, phase = 0): Polygon {
  const vertices: Vector2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    vertices.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return { vertices };
}

/** The pieces of a fence segment left standing outside the blast. */
export function segmentMinusCircle(start: Vector2, end: Vector2, blast: Polygon, minLength = 4): { start: Vector2; end: Vector2 }[] {
  return clipLineAgainstPolygons(start, end, [blast])
    .filter(s => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) >= minLength);
}

/** Does the segment come within the blast at all? */
export function segmentTouchesCircle(start: Vector2, end: Vector2, c: Vector2, r: number): boolean {
  const ex = end.x - start.x, ey = end.y - start.y;
  const len2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((c.x - start.x) * ex + (c.y - start.y) * ey) / len2));
  return Math.hypot(start.x + ex * t - c.x, start.y + ey * t - c.y) < r;
}

/** Does any part of the polygon lie within the circle? */
export function polygonTouchesCircle(poly: Polygon, c: Vector2, r: number): boolean {
  if (pointInPolygon(c, poly)) return true;
  const v = poly.vertices;
  for (let i = 0; i < v.length; i++) {
    if (segmentTouchesCircle(v[i], v[(i + 1) % v.length], c, r)) return true;
  }
  return false;
}

// ── Polygon difference (Greiner-Hormann, subject minus a convex clip) ────────

interface Node {
  x: number; y: number;
  next: Node; prev: Node;
  isect: boolean; entry: boolean; visited: boolean;
  other: Node | null;
  alpha: number;
}

function ring(points: readonly Vector2[]): Node {
  let first: Node | null = null;
  let last: Node | null = null;
  for (const p of points) {
    const n = { x: p.x, y: p.y, isect: false, entry: false, visited: false, other: null, alpha: 0 } as unknown as Node;
    if (!first) { first = n; n.next = n; n.prev = n; }
    else { n.prev = last!; n.next = first; last!.next = n; first.prev = n; }
    last = n;
  }
  return first!;
}

function nextVertex(n: Node): Node {
  let m = n.next;
  while (m.isect) m = m.next;
  return m;
}

/** Insert an intersection node between `a` and the next original vertex, ordered by alpha. */
function insertBetween(node: Node, a: Node, b: Node): void {
  let cur = a.next;
  while (cur !== b && cur.alpha < node.alpha) cur = cur.next;
  node.next = cur;
  node.prev = cur.prev;
  cur.prev.next = node;
  cur.prev = node;
}

const EPS = 1e-9;

function intersect(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2): { ta: number; tb: number } | null {
  const dax = a2.x - a1.x, day = a2.y - a1.y;
  const dbx = b2.x - b1.x, dby = b2.y - b1.y;
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return null;
  const ta = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / den;
  const tb = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / den;
  if (ta < -EPS || ta > 1 + EPS || tb < -EPS || tb > 1 + EPS) return null;
  return { ta, tb };
}

/** Thrown when an intersection lands on a vertex: the caller nudges the clip and tries again. */
class Degenerate extends Error {}

function originals(first: Node): Node[] {
  const out: Node[] = [];
  let n = first;
  do { if (!n.isect) out.push(n); n = n.next; } while (n !== first);
  return out;
}

function greinerHormannDifference(subject: Polygon, clip: Polygon): Polygon[] | null {
  const s = ring(subject.vertices);
  const c = ring(clip.vertices);
  const sv = originals(s), cv = originals(c);
  let found = 0;
  for (const a of sv) {
    const a2 = nextVertex(a);
    for (const b of cv) {
      const b2 = nextVertex(b);
      const hit = intersect(a, a2, b, b2);
      if (!hit) continue;
      if (hit.ta < 1e-7 || hit.ta > 1 - 1e-7 || hit.tb < 1e-7 || hit.tb > 1 - 1e-7) throw new Degenerate();
      const x = a.x + (a2.x - a.x) * hit.ta, y = a.y + (a2.y - a.y) * hit.ta;
      const ns = { x, y, isect: true, entry: false, visited: false, other: null, alpha: hit.ta } as unknown as Node;
      const nc = { x, y, isect: true, entry: false, visited: false, other: null, alpha: hit.tb } as unknown as Node;
      ns.other = nc; nc.other = ns;
      insertBetween(ns, a, a2);
      insertBetween(nc, b, b2);
      found++;
    }
  }
  if (found === 0) return null;

  // Entry/exit flags. Difference = subject traversed forwards outside the clip,
  // the clip traversed backwards inside the subject.
  let sForward = !pointInPolygon(sv[0], clip);
  let cForward = pointInPolygon(cv[0], subject);
  // Flip so the first flag set is "entering": the standard parity walk.
  sForward = !sForward ? true : false;
  let n = s;
  do { if (n.isect) { n.entry = sForward; sForward = !sForward; } n = n.next; } while (n !== s);
  cForward = !cForward;
  n = c;
  do { if (n.isect) { n.entry = cForward; cForward = !cForward; } n = n.next; } while (n !== c);

  const out: Polygon[] = [];
  const firstUnvisited = (): Node | null => {
    let m = s;
    do { if (m.isect && !m.visited) return m; m = m.next; } while (m !== s);
    return null;
  };
  let cur = firstUnvisited();
  let guard = 0;
  while (cur) {
    const pts: Vector2[] = [{ x: cur.x, y: cur.y }];
    do {
      cur.visited = true;
      if (cur.other) cur.other.visited = true;
      if (cur.entry) {
        do { cur = cur.next; pts.push({ x: cur.x, y: cur.y }); } while (!cur.isect);
      } else {
        do { cur = cur.prev; pts.push({ x: cur.x, y: cur.y }); } while (!cur.isect);
      }
      cur = cur.other!;
      if (++guard > 100000) throw new Degenerate();
    } while (!cur.visited);
    const last = pts[pts.length - 1];
    if (Math.abs(last.x - pts[0].x) < 1e-6 && Math.abs(last.y - pts[0].y) < 1e-6) pts.pop();
    if (pts.length >= 3) out.push({ vertices: pts });
    cur = firstUnvisited();
  }
  return out;
}

/** Clip a polygon to one side of the vertical line x = cx (Sutherland-Hodgman). */
function clipToSide(poly: Polygon, cx: number, keepLeft: boolean): Polygon | null {
  const inside = (p: Vector2) => (keepLeft ? p.x <= cx : p.x >= cx);
  const v = poly.vertices;
  const out: Vector2[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (cx - a.x) / (b.x - a.x);
      out.push({ x: cx, y: a.y + (b.y - a.y) * t });
    }
  }
  return out.length >= 3 ? { vertices: out } : null;
}

/** Drop slivers and specks a blast leaves behind: too small to be a wall. */
function solid(p: Polygon, minArea: number): boolean {
  return Math.abs(polygonArea(p)) >= minArea;
}

/**
 * A wall minus the blast, as simple polygons with no holes. `clip` must be
 * convex (a circlePolygon). Returns `[subject]` when they do not meet and `[]`
 * when the blast swallows the wall whole.
 */
export function polygonMinusConvex(subject: Polygon, clip: Polygon, minArea = 30): Polygon[] {
  // The clip nudged round by a fraction of a side when an intersection lands
  // exactly on a vertex, which the walk cannot classify. A few tries always
  // clear it; the nudge is far below anything a player could see.
  let k = clip;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = greinerHormannDifference(subject, k);
      if (res) return res.filter(p => solid(p, minArea));
      break;
    } catch (e) {
      if (!(e instanceof Degenerate)) throw e;
      const c = centreOf(clip);
      const rot = 0.0137 * (attempt + 1);
      k = { vertices: clip.vertices.map(v => rotate(v, c, rot)) };
    }
  }
  // No crossings: apart, swallowed whole, or the blast wholly inside the wall.
  const sv = subject.vertices;
  if (sv.every(p => pointInPolygon(p, k))) return [];
  const c = centreOf(k);
  if (!pointInPolygon(c, subject) || !k.vertices.every(p => pointInPolygon(p, subject))) return [subject];
  // A hole: split the wall through the blast's centre, then bite each half.
  const out: Polygon[] = [];
  for (const left of [true, false]) {
    const half = clipToSide(subject, c.x, left);
    if (!half || !solid(half, minArea)) continue;
    const bitten = greinerHormannSafe(half, k);
    for (const p of bitten) if (solid(p, minArea)) out.push(p);
  }
  return out;
}

function greinerHormannSafe(subject: Polygon, clip: Polygon): Polygon[] {
  let k = clip;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return greinerHormannDifference(subject, k) ?? [subject];
    } catch (e) {
      if (!(e instanceof Degenerate)) throw e;
      k = { vertices: clip.vertices.map(v => rotate(v, centreOf(clip), 0.0137 * (attempt + 1))) };
    }
  }
  return [subject];
}

function centreOf(p: Polygon): Vector2 {
  let x = 0, y = 0;
  for (const v of p.vertices) { x += v.x; y += v.y; }
  return { x: x / p.vertices.length, y: y / p.vertices.length };
}

function rotate(v: Vector2, c: Vector2, a: number): Vector2 {
  const dx = v.x - c.x, dy = v.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}
