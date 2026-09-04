/**
 * The deformable: a wall that never breaks and never forgets.
 *
 * Every other solid on the board is one of two things. A wall is permanent and
 * unchanging; a breakable is permanent until it is gone. Nothing keeps a RECORD
 * of what has happened to it, and nothing charges a ball for the privilege of
 * bouncing.
 *
 * This does both, and the two halves are the same event. A ball strikes it, the
 * surface takes a dent it keeps for the rest of the map, and the ball leaves 3%
 * slower. So the object is a speed sink whose face is its own meter: a wall
 * covered in dents is a wall that has already drunk a lot of somebody's pace,
 * and one still smooth is one that has not been used.
 *
 * ── Why the dent is real geometry ───────────────────────────────────────────
 *
 * It would be far cheaper to dent the drawing and leave the collision alone.
 * That is the one thing this must not do: an accumulated dimple that balls
 * bounce off the ghost of is the same lie as a bumper whose rim shrinks away
 * from its hitbox. So the polygon itself moves, and the edge walls move with
 * it - the two collision systems are updated from ONE call, because a property
 * honoured in only one of them gives a wall that dents at its face and is
 * pristine at its edges.
 *
 * ── Why it is bounded, and at this bound ────────────────────────────────────
 *
 * The space grid is baked once, at load, from the ORIGINAL outline, and a dent
 * pushes the surface inward - so a dented wall has receded from ground the grid
 * still calls solid. That ground was never part of the capture target (obstacle
 * cells start REMOVED and are excluded from activeCount), so nothing the player
 * is scored on moves, and no ball can be stranded in the sliver either: a ball
 * centre sits a radius clear of the face it is touching, which is 18 units
 * against a gap the cap holds under 15.
 *
 * That cap is MAX_DENT, under one grid cell, so the discrepancy stays a sliver
 * rather than becoming a visible channel behind a wall the map draws as sealed.
 * It is still plainly visible as a dent: the game's own fences are 6 units
 * thick, so a full dent is more than one wall deep.
 */
import type { Ball } from "@/types/game";
import type { Polygon, Vector2 } from "@/lib/polygon";
import type { Wall } from "@/lib/wallGeometry";
import { ballImpactDamage } from "@/lib/physics/destructibles";

/** Speed a ball keeps after one contact. The tax, and the whole mechanic. */
export const DEFORM_SLOW = 0.97;

/**
 * Deepest any one point of the surface may sink, in world units.
 *
 * Under the grid's 15-unit cell (see the header), and well above the 6-unit
 * thickness of the game's own fences, so the dent reads as a dent rather than
 * as a rendering wobble.
 */
export const MAX_DENT = 7;

/** How far along the surface one impact spreads, in world units. */
export const DENT_RADIUS = 46;

/**
 * How long one deformable ignores the same ball after taking a hit, in ms.
 *
 * Exactly the bouncer's problem and the same answer: a ball resting in the
 * collision band is resolved every step, so without this a wall takes 120 dents
 * a second and drinks a ball to a standstill in under a second.
 */
export const DEFORM_COOLDOWN_MS = 90;

/**
 * Longest edge a deformable's outline may have, in world units.
 *
 * A dent is a displacement of VERTICES, so a wall can only give where it has
 * one. An authored slab is a rectangle: four corners, and a ball striking the
 * middle of a 300-unit bar is nowhere near any of them, so it would pay its 3%
 * and leave no mark at all - the mechanic's whole promise broken on the one
 * shape a level designer reaches for most. So the outline is resampled at load
 * into short edges, and only then are the collision walls built from it.
 *
 * Well under DENT_RADIUS, so one impact always moves several vertices and the
 * result is a dimple rather than a single pulled tooth.
 */
export const DENT_RESOLUTION = 18;

/**
 * Ceiling on the resampled vertex count.
 *
 * Every vertex is also a collision wall in the broad-phase index, so a big
 * deformable resampled blindly would quietly cost more than the rest of the
 * map's furniture put together. Past this the spacing is stretched instead:
 * a very large pad dents more coarsely, which is a look, not a fault.
 */
export const MAX_DEFORM_VERTICES = 96;

/**
 * Resample an outline so no edge is longer than `maxSegment`.
 *
 * Corners are preserved exactly - the added points are interior to edges - so
 * the shape is unchanged, only its resolution. Run at load, before the edge
 * walls are built, so both collision systems are built from the same outline.
 */
export function subdivideOutline(vertices: Vector2[], maxSegment = DENT_RESOLUTION): Vector2[] {
  const n = vertices.length;
  if (n < 3) return vertices.map(v => ({ x: v.x, y: v.y }));

  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const step = Math.max(maxSegment, perimeter / MAX_DEFORM_VERTICES);

  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n];
    out.push({ x: a.x, y: a.y });
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const cuts = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k < cuts; k++) {
      const t = k / cuts;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Unit normal of edge a->b pointed toward `inside`, or null on a zero edge. */
function edgeNormal(a: Vector2, b: Vector2, inside: Vector2): Vector2 | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  let nx = -dy / len, ny = dx / len;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  if ((inside.x - mx) * nx + (inside.y - my) * ny < 0) { nx = -nx; ny = -ny; }
  return { x: nx, y: ny };
}

/** A vertex's inward direction: the unit bisector of its two edge normals,
 *  plus `run`, how far along it the two offset edges meet (the mitre). */
export interface Mitre { x: number; y: number; run: number }

/**
 * Which way is INTO the material, at every vertex.
 *
 * The local edge normal, not the direction of the shape's middle. On a square
 * the two agree; on a 26x240 bar they do not agree at all - the middle is
 * almost exactly along the bar, so a centre-based dent would SHORTEN it rather
 * than push its face in, and the player would watch a wall they hit head-on
 * shrink sideways. Every elongated slab on the ladder is that bar.
 *
 * Null when the outline is degenerate (a zero-length edge, or two edges
 * doubling back), which is a shape nothing sensible can be done with.
 */
export function inwardMitres(vertices: Vector2[]): Mitre[] | null {
  const n = vertices.length;
  if (n < 3) return null;
  const inside = { x: 0, y: 0 };
  for (const v of vertices) { inside.x += v.x; inside.y += v.y; }
  inside.x /= n; inside.y /= n;

  const out: Mitre[] = [];
  for (let i = 0; i < n; i++) {
    const np = edgeNormal(vertices[(i - 1 + n) % n], vertices[i], inside);
    const nn = edgeNormal(vertices[i], vertices[(i + 1) % n], inside);
    if (!np || !nn) return null;
    let mx = np.x + nn.x, my = np.y + nn.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) return null;
    mx /= ml; my /= ml;
    const cos = mx * nn.x + my * nn.y;
    out.push({ x: mx, y: my, run: cos > 1e-6 ? 1 / cos : 1 });
  }
  return out;
}

/** One remembered impact: where it landed and how deep it pushed. */
export interface Dent {
  at: Vector2;
  depth: number;
}

export interface DeformState {
  id: string;
  /** The shape as authored. Dents are measured FROM here, never accumulated
   *  onto the live vertices - see applyDent for why that matters. */
  original: Vector2[];
  /** The live polygon, shared with game.obstaclePolygons. Mutated in place. */
  polygon: Polygon;
  /** Its edge walls, in vertex order, so both collision systems move together. */
  walls: Wall[];
  /**
   * Which way is "in" at each vertex of `original`, one per vertex.
   *
   * Precomputed rather than derived per hit: it depends only on the authored
   * outline, which never changes, and deriving it from the LIVE outline would
   * make the dent direction drift as the wall sank - a wall that curls.
   */
  inward: Vector2[];
  dents: Dent[];
  /** Total depth taken, for the renderer's wear cue and for the info modal. */
  totalDepth: number;
}

/**
 * How deep one impact pushes, from the ball's mass and its closing speed.
 *
 * Deliberately the SAME force model breakables use (ballImpactDamage: k · mass
 * · vn^1.6, where mass is density x radius squared). A heavy ball at speed
 * should dent a soft wall and chip a brittle one by the same reasoning, and two
 * force models on one board would eventually disagree about which hit was
 * harder.
 */
export function dentDepth(ball: Ball, normalSpeed: number): number {
  // ballImpactDamage is calibrated so a standard head-on hit is ~1.0 and it is
  // clamped to 2.0, so this maps the same range onto a third of the budget: a
  // nominal hit sinks about 2.3 units and the hardest possible one about 4.7.
  return ballImpactDamage(ball, normalSpeed) * (MAX_DENT / 3);
}

/** Whether this wall is allowed to take a dent from this ball right now. */
export function deformReady(ball: Ball, state: DeformState, now: number): boolean {
  if (ball.lastDeformId !== state.id) return true;
  return now - (ball.lastDeformAt ?? -Infinity) >= DEFORM_COOLDOWN_MS;
}

/**
 * The shape after every dent it has taken.
 *
 * Recomputed from `original` on every hit rather than nudged in place, and that
 * is the difference between a dent and a drift. Nudging accumulates floating
 * point and, worse, lets a vertex be pushed by the same dent twice - a wall hit
 * repeatedly in one spot would keep sinking past any cap, because the cap would
 * be applied to each step rather than to the total.
 */
export function deformedOutline(state: DeformState): Vector2[] {
  return state.original.map((v, i) => {
    const dir = state.inward[i] ?? { x: 0, y: 0 };
    let sink = 0;
    for (const d of state.dents) {
      const dist = Math.hypot(v.x - d.at.x, v.y - d.at.y);
      if (dist >= DENT_RADIUS) continue;
      // Smooth falloff, so a dent is a dimple rather than a spike: full depth
      // at the impact and easing to nothing at DENT_RADIUS.
      const t = 1 - dist / DENT_RADIUS;
      sink += d.depth * t * t;
    }
    const capped = Math.min(MAX_DENT, sink);
    return { x: v.x + dir.x * capped, y: v.y + dir.y * capped };
  });
}

/**
 * Record an impact and move BOTH collision systems onto the new shape.
 *
 * One call, deliberately. The polygon and the edge walls are two descriptions
 * of one surface, and updateBall consults both: a dent written to only one of
 * them is a wall that dents at its face and is pristine at its edges, which is
 * the exact trap the bouncer's own comment warns about.
 */
export function applyDent(state: DeformState, at: Vector2, depth: number): void {
  state.dents.push({ at: { x: at.x, y: at.y }, depth });
  state.totalDepth += depth;

  const next = deformedOutline(state);
  for (let i = 0; i < next.length; i++) {
    state.polygon.vertices[i].x = next[i].x;
    state.polygon.vertices[i].y = next[i].y;
  }
  // The walls were built one per edge, in vertex order, from copies of those
  // vertices - so they have to be walked, not merely re-read.
  for (let i = 0; i < state.walls.length && i < next.length; i++) {
    const w = state.walls[i];
    const a = next[i], b = next[(i + 1) % next.length];
    w.start.x = a.x; w.start.y = a.y;
    w.end.x = b.x;   w.end.y = b.y;
    // Drop the lazily-cached segment AABB. updateBall builds it once and
    // comments that it may, because "walls never move once created" - and this
    // is the one wall in the game for which that is false. The cache is used as
    // a REJECT, so a box that no longer describes its segment is a wall balls
    // are never tested against.
    //
    // On a convex slab the stale box happens to be safe (a dent moves the face
    // AWAY from anything outside, so the old box always covers the ball's side
    // of it). That is a property of the shape, not of the cache, and it stops
    // holding the moment a bowed or bent outline puts a vertex where the local
    // normal points outward. Recomputing costs four assignments per dent.
    w.aabbMinX = undefined; w.aabbMaxX = undefined;
    w.aabbMinY = undefined; w.aabbMaxY = undefined;
  }
}

/**
 * Total depth at which the wall looks fully worn, in world units.
 *
 * A budget in the same units as `totalDepth`, deliberately NOT scaled by the
 * vertex count: dents are counted per IMPACT, and the resampling that gives a
 * long bar forty vertices does not make it forty times harder to wear out.
 * Fifteen or so nominal hits, so a wall a ball has been rattling around in for
 * a while looks like it.
 */
export const WEAR_BUDGET = 36;

/** How worn the wall is, 0..1, for the renderer. Saturates rather than ends:
 *  a deformable never breaks, so this is a look, not a countdown. */
export function deformWear(state: DeformState): number {
  return Math.max(0, Math.min(1, state.totalDepth / WEAR_BUDGET));
}

/**
 * The velocity a ball leaves with: 3% off, and nothing else.
 *
 * No redirect. A deformable has already reflected the ball like any other wall
 * by the time this runs, and that is the point of it - it is a wall you can aim
 * off, that happens to charge you for the bounce. A kick or a scatter here
 * would make it a bouncer with a different paint job.
 *
 * The floor is the ball's own minimumSpeed rather than the universal one at the
 * end of updateBall, for the bouncer's reason: both would stop a ball crawling,
 * but only this one makes the returned speed true, and that is what the caller
 * writes onto the ball.
 */
export function deformSlow(ball: Ball): { velocity: Vector2; speed: number } {
  const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (!(speed > 0)) return { velocity: { x: ball.velocity.x, y: ball.velocity.y }, speed: 0 };
  const floor = Math.max(0, ball.minimumSpeed ?? 0);
  const next = Math.max(floor, speed * DEFORM_SLOW);
  const k = next / speed;
  return { velocity: { x: ball.velocity.x * k, y: ball.velocity.y * k }, speed: next };
}
