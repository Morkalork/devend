/**
 * Fences and board edges, lit by the one shared scope.
 *
 * A wall is drawn as three passes, in this order, and the order is the point:
 *
 *   1. CAST SHADOW  - a quad thrown up-and-left, away from the monitor. Every
 *      wall's offset comes from `shadowFor()` at its own midpoint, so shadows
 *      fan consistently across the board instead of each wall inventing one.
 *      (The old renderer drew a symmetric gradient on BOTH sides of every wall,
 *      which cancelled any sense of direction and is why the board read flat.)
 *   2. BODY         - the wall itself, dark core with the accent riding on it.
 *   3. RIM          - a hairline on the edge that faces the light. This is the
 *      cue that makes a fence read as a raised object rather than a painted
 *      stripe, and it costs one extra stroke.
 *
 * Straight axis-aligned fences are snapped to whole device pixels; diagonals are
 * left exact for the antialiaser. A fence drawn at 45 degrees must be ONE clean
 * edge, and quantising its endpoints is what breaks it into visible steps.
 */

import { Container, Graphics } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { Wall } from "@/lib/wallGeometry";
import { clipLineAgainstPolygons, type Vector2 } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { ambientAt, facing, shadowFor, type LightScope } from "./light";
import { getEffectsAtPoint, hasNearbyImpacts, N_NODES } from "@/lib/wallImpactEffects";

/** How thick the board's outer frame is, in world units. Heavier than a
 *  fence (6) so the enclosure reads as structure rather than as a cut. */
const OUTER_WALL_THICKNESS = 14;
import { snapSegment, snapWidth, hairline, type Pt } from "./pixelGrid";
import { transformKey } from "./transformKey";

type W2S = (x: number, y: number) => Pt;

/**
 * Convex hull (monotone chain) of a small point set. Used to build a wall's
 * shadow silhouette from its quad plus the light-offset copy of that quad; at
 * 8 points the O(n log n) sort is irrelevant and the code stays obvious.
 */
function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((m, n) => (m.x - n.x) || (m.y - n.y));
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (src: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...build(p), ...build([...p].reverse())];
}

export class WallLayer {
  readonly container = new Container();

  /**
   * Fence content lives in a scope masked to the board polygon MINUS the
   * obstacle footprints, and every fence segment is additionally clipped against
   * those obstacles before drawing.
   *
   * Both are needed and neither is decorative. A fence Wall is a full-length
   * line across whatever it spans; drawing it raw paints it straight through
   * obstacles and out over areas that should hide it, which showed up in play as
   * stray diagonal lines wandering across the board. The classic renderer does
   * exactly this clip + mask pair; skipping it was the bug.
   */
  /**
   * The board's outer wall: a band sitting just OUTSIDE the play area.
   *
   * Unmasked, and that is the entire reason it exists as its own scope. The
   * fence mask is the board polygon, so a board-edge wall is already half
   * clipped and its bulge - which pushes AWAY from the ball, i.e. outward - was
   * clipped away completely. Board edges were registering impacts nobody could
   * ever see, which is why the effect looked like a fences-only feature.
   *
   * Drawing the rim of the board as a real wall outside that mask fixes the
   * clipping and gives the board a frame at the same time.
   */
  /**
   * Exposed so the renderer can hang it OUTSIDE the board scope.
   *
   * There are two masks between a board-edge bulge and the screen, and escaping
   * one is not enough. The inner `fenceMask` is the board polygon minus the
   * obstacles; the outer `boardScope.mask` is the board polygon again, applied
   * to every layer at once. A frame drawn outside the play area is clipped
   * flat by the second one however carefully it dodges the first, which reads
   * exactly like the effect happening UNDERNEATH the wall: all you see is the
   * sliver that happens to fall inside the boundary.
   */
  readonly outer = new Container();
  private fenceScope = new Container();
  private fenceMask = new Graphics();
  private fenceMaskKey = "";
  /** Per-wall clipped sub-segments; walls are immutable, so cache on identity. */
  private clipCache = new WeakMap<Wall, { start: Vector2; end: Vector2 }[]>();

  /** The renderer's shared floor plane, set each frame in sync(). */
  private shadows!: Graphics;
  private bodies = new Graphics();
  private rims = new Graphics();
  private outerBodies = new Graphics();
  private outerRims = new Graphics();

  constructor() {
    // Shadows first so every wall body sits on top of every shadow: a wall must
    // never be dimmed by its neighbour's shadow falling across it.
    // Shadows are NOT in the fence scope: they belong to the shared floor
    // plane, below everything that stands on the board.
    this.fenceScope.addChild(this.bodies, this.rims);
    this.fenceScope.mask = this.fenceMask;
    this.outer.addChild(this.outerBodies, this.outerRims);
    // The mask must be a sibling in the display list, not a detached Graphics.
    this.container.addChild(this.fenceScope, this.fenceMask);
  }

  /**
   * Board polygon with the obstacle footprints cut out of it.
   *
   * A PHASED-OUT obstacle is not cut. Balls, fences and chains all pass through
   * one while it is out (phasing.ts), and updateBall and chain.ts both honour
   * that - but this mask did not, so a fence drawn across a phased-out pillar
   * was clipped into an invisible gap on the two maps that have them. The mask
   * has to agree with the collision it is standing in for.
   */
  private syncMask(game: CanvasGameState, w2s: W2S, scale: number): void {
    // Intangible right now: cutting these would punch a hole where a fence is
    // legally allowed to be drawn.
    const intangible = new Set(
      (game.phasingObjects ?? []).filter(p => p.phase === "out").map(p => p.polygon),
    );
    // The phase count is part of the key, or the mask would keep whatever it
    // cut on the frame a pillar last changed state and never catch up.
    // The transform belongs in the key as much as the counts do: this mask is
    // cut in SCREEN space, and on a gravity map the board turns underneath it
    // while the rect, the scale and both counts stay put. Stale, it clips every
    // fence against a board outline and a set of obstacle holes that have since
    // rotated away, which plays exactly like an invisible object breaking fence
    // generation. See transformKey.
    const key = `${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 10000)}_${game.obstaclePolygons.length}_${intangible.size}`
      + `_${transformKey(w2s)}`;
    if (key === this.fenceMaskKey) return;
    this.fenceMaskKey = key;

    const m = this.fenceMask;
    m.clear();
    if (game.boardPolygon && game.boardPolygon.vertices.length >= 3) {
      m.poly(game.boardPolygon.vertices.map(v => w2s(v.x, v.y))).fill({ color: 0xffffff });
    } else {
      const { left, top, width, height } = game.boardRect;
      m.rect(left, top, width, height).fill({ color: 0xffffff });
    }
    for (const poly of game.obstaclePolygons) {
      if (intangible.has(poly)) continue;
      m.poly(poly.vertices.map(v => w2s(v.x, v.y))).cut();
    }
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
    this.outerBodies.clear();
    this.outerRims.clear();
    this.shadowRuns.clear();
    this.syncMask(game, w2s, scale);
    this.drawOuterWall(game, light, w2s, scale);

    for (const w of game.walls) {
      const isEdge = w.isBoardEdge ?? w.id.startsWith("board-");
      // Board edges are drawn by drawOuterWall, outside the mask that was
      // eating their bulge. Drawing them here as well would double the rim.
      if (isEdge) continue;
      const isObstacle = !!w.isObstacleBoundary;
      // Obstacle boundaries are drawn by the entity layer with their bodies;
      // drawing them here too would double their rim and shadow.
      if (isObstacle) continue;

      // Split the wall around any obstacle it passes through, so no fence is
      // ever painted across a slab it should be interrupted by.
      for (const seg of this.clippedSegments(w, game)) {
        this.drawSegment(seg.start, seg.end, w.thickness, isEdge, light, w2s, scale);
      }
    }

    for (const g of game.activeWalls) this.drawGrowing(g, light, w2s, scale);

    this.flushShadows();
  }

  /**
   * The board's frame, drawn from the board polygon pushed OUTWARD so its inner
   * face sits on the play boundary rather than straddling it.
   *
   * Thicker than a fence on purpose: this is the enclosure, and a frame the same
   * weight as the player's own marks reads as just another fence. It takes the
   * bulge and the hit flash like any other wall, which is what makes a ball
   * slamming into the edge of the board finally register.
   */
  private drawOuterWall(
    game: CanvasGameState, light: LightScope, w2s: W2S, scale: number,
  ): void {
    const poly = game.boardPolygon;
    if (!poly || poly.vertices.length < 3) return;

    const bodies = this.bodies, rims = this.rims;
    // Borrow drawSegment by pointing it at the unmasked graphics for the frame.
    this.bodies = this.outerBodies;
    this.rims = this.outerRims;
    try {
      const cx = poly.vertices.reduce((n, v) => n + v.x, 0) / poly.vertices.length;
      const cy = poly.vertices.reduce((n, v) => n + v.y, 0) / poly.vertices.length;
      const push = OUTER_WALL_THICKNESS / 2;
      const n = poly.vertices.length;
      // Offset each EDGE along its own outward normal, rather than pushing the
      // vertices away from the centroid. A radial push is a scale-out: on a
      // rectangle it moves corners further than edge midpoints, so the frame
      // ends up a different distance from the boundary depending on where you
      // look at it, and the corners open up.
      for (let i = 0; i < n; i++) {
        const a = poly.vertices[i];
        const b = poly.vertices[(i + 1) % n];
        const ex = b.x - a.x, ey = b.y - a.y;
        const len = Math.hypot(ex, ey);
        if (len < 1) continue;
        let nx = -ey / len, ny = ex / len;
        // Point it away from the middle of the board.
        const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy;
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        // Extended half a thickness at each end so neighbouring edges overlap
        // into a mitre instead of leaving a notch at every corner.
        const tx = (ex / len) * push, ty = (ey / len) * push;
        this.drawSegment(
          { x: a.x + nx * push - tx, y: a.y + ny * push - ty },
          { x: b.x + nx * push + tx, y: b.y + ny * push + ty },
          OUTER_WALL_THICKNESS, true, light, w2s, scale, true,
        );
      }
    } finally {
      this.bodies = bodies;
      this.rims = rims;
    }
  }

  /** A wall's sub-segments with the obstacle footprints removed. */
  private clippedSegments(w: Wall, game: CanvasGameState): { start: Vector2; end: Vector2 }[] {
    if (game.obstaclePolygons.length === 0) return [{ start: w.start, end: w.end }];
    let segs = this.clipCache.get(w);
    if (!segs) {
      segs = clipLineAgainstPolygons(w.start, w.end, game.obstaclePolygons);
      this.clipCache.set(w, segs);
    }
    return segs;
  }

  /**
   * Wall shadows, as true silhouette extrusions collected per intensity bucket.
   *
   * Two earlier attempts failed and both failures are instructive:
   *
   *   PER-SEGMENT QUADS sheared apart at the joins, because a long fence is
   *   stored as many short segments and each computed its offset at its own
   *   midpoint - a visible sawtooth along every fence.
   *
   *   PER-SEGMENT STROKES fixed the joins but produced a comb of teeth whenever
   *   the light ran nearly PARALLEL to the fence (which is exactly what happens
   *   on a down-right diagonal, since the monitor is off the bottom-right). The
   *   offset then slides lengthwise instead of sideways, and each segment's
   *   round cap pokes out past its neighbour.
   *
   * The correct shadow of a thick segment is the convex hull of its quad and
   * that quad translated by the light offset. When the light is parallel to the
   * wall the hull collapses onto the wall itself and NO shadow shows - which is
   * physically right, and is what the two broken versions were fighting.
   *
   * Bucketing by alpha keeps the distance falloff while making each bucket one
   * fill, so overlapping neighbours never double-darken.
   */
  private shadowRuns = new Map<number, Pt[][]>();

  private addShadow(
    a: Pt, b: Pt, nx: number, ny: number, half: number,
    offX: number, offY: number, alpha: number,
  ): void {
    const quad: Pt[] = [
      { x: a.x + nx * half, y: a.y + ny * half },
      { x: b.x + nx * half, y: b.y + ny * half },
      { x: b.x - nx * half, y: b.y - ny * half },
      { x: a.x - nx * half, y: a.y - ny * half },
    ];
    const hull = convexHull([...quad, ...quad.map(p => ({ x: p.x + offX, y: p.y + offY }))]);
    if (hull.length < 3) return;
    const bucket = Math.round(alpha * 20) / 20;
    let run = this.shadowRuns.get(bucket);
    if (!run) { run = []; this.shadowRuns.set(bucket, run); }
    run.push(hull);
  }

  private flushShadows(): void {
    for (const [alpha, polys] of this.shadowRuns) {
      for (const poly of polys) this.shadows.poly(poly);
      this.shadows.fill({ color: PALETTE.shadow, alpha });
    }
  }

  /**
   * A fence still growing. Lit exactly like a finished one - it is the same
   * physical object mid-extension, and giving it a different treatment would
   * make completion look like a substitution.
   *
   * Drawn from the WAYPOINT paths rather than start/end points, so a cut
   * bouncing off a mirror renders every leg instead of one straight line
   * through the geometry.
   */
  private drawGrowing(
    wall: CanvasGameState["activeWalls"][number],
    light: LightScope,
    w2s: W2S,
    scale: number,
  ): void {
    const thickness = Math.max(1, wall.thickness * scale);

    // Walk each direction's completed legs, then the partial one it is on.
    const legs: Array<[Pt, Pt]> = [];
    const collect = (waypoints: { x: number; y: number }[], segIndex: number, tip: { x: number; y: number }) => {
      for (let i = 0; i < Math.min(segIndex, waypoints.length - 1); i++) {
        legs.push([w2s(waypoints[i].x, waypoints[i].y), w2s(waypoints[i + 1].x, waypoints[i + 1].y)]);
      }
      const from = waypoints[Math.min(segIndex, waypoints.length - 1)];
      if (from) legs.push([w2s(from.x, from.y), w2s(tip.x, tip.y)]);
    };
    collect(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    collect(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    // Remember which legs are the LIVE ones. collect() pushes each direction's
    // finished legs and then its partial one, so the advancing tip is always the
    // end of the leg it pushed last.

    this.drawGrowTip(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint, w2s, scale, thickness);
    this.drawGrowTip(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint, w2s, scale, thickness);

    for (const [a0, b0] of legs) {
      const { a, b } = snapSegment(a0, b0, snapWidth(thickness));
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) continue;
      const cast = shadowFor(light, (a.x + b.x) / 2, (a.y + b.y) / 2, thickness);
      this.addShadow(
        a, b,
        -(b.y - a.y) / len, (b.x - a.x) / len, thickness / 2,
        cast.dx * cast.length, cast.dy * cast.length, cast.alpha,
      );
      const amb = ambientAt(light, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.bodies
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({
          width: snapWidth(thickness),
          color: mix(PALETTE.shadow, PALETTE.accentDim, 0.55 + amb * 0.45),
          alpha: 1, cap: "butt",
        });
      this.bodies
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({
          width: Math.max(1, snapWidth(thickness * 0.3)),
          color: mix(PALETTE.accentDim, PALETTE.accent, 0.3 * amb),
          alpha: 0.8, cap: "butt",
        });
    }

    // The growing TIPS stay bright, and are now the only emissive thing a fence
    // has. That is deliberate: the tip is live, in-progress, and the one moment
    // a cut genuinely is energy rather than material.
    for (const tip of [wall.startPoint, wall.endPoint]) {
      const p = w2s(tip.x, tip.y);
      this.rims
        .circle(p.x, p.y, thickness * 0.7)
        .fill({ color: PALETTE.accentGlow, alpha: 0.85 * light.level });
    }
  }

  /**
   * One wall segment, in the SAME material language as the board's furniture.
   *
   * A fence used to be drawn emissive: a flat dark core with a full-chroma neon
   * centreline riding on it, unaffected by the light. Next to obstacles that are
   * genuinely lit (ambient-tinted body, rim only on the face pointing at the
   * monitor) that read as two unrelated art styles on one board.
   *
   * Now a fence is a lit object like everything else - its body is tinted by the
   * ambient falloff, and it keeps only a narrow accent core so the player can
   * still find their own cuts. It reads as a thing standing on the board rather
   * than a glowing line painted over it.
   */
  /**
   * The screen points to stroke this segment through.
   *
   * Two, snapped to the pixel grid, whenever nothing has hit it: that is every
   * wall on every frame, so the bulge has to cost nothing at rest, and a
   * straight fence has to keep landing exactly on the grid or its edges soften.
   *
   * When a ball HAS struck nearby, the segment is sampled into N_NODES points
   * and each is displaced by the impact bulge. Sampled and displaced in WORLD
   * space, then transformed: the displacement direction is a world normal, so
   * adding it to screen coordinates would point the wrong way the moment the
   * board is tilted. Doing it before w2s makes the tilt handle it for free.
   *
   * Not snapped in that case, deliberately. Snapping a curve to whole pixels
   * quantises a 6-unit bulge into a visible staircase, and the bulge is worth
   * more than the crispness for the half second it lasts.
   */
  private segmentPoints(
    startW: Vector2, endW: Vector2, w2s: W2S, snapTo: number, rigid = false,
  ): { pts: Pt[]; bulged: boolean } {
    if (rigid || !hasNearbyImpacts(startW, endW)) {
      const { a, b } = snapSegment(w2s(startW.x, startW.y), w2s(endW.x, endW.y), snapTo);
      return { pts: [a, b], bulged: false };
    }
    const pts: Pt[] = [];
    for (let i = 0; i < N_NODES; i++) {
      const t = i / (N_NODES - 1);
      const wx = startW.x + (endW.x - startW.x) * t;
      const wy = startW.y + (endW.y - startW.y) * t;
      // scale 1: world units in, world units out.
      const e = getEffectsAtPoint({ x: wx, y: wy }, 1);
      pts.push(w2s(wx + e.dx, wy + e.dy));
    }
    return { pts, bulged: true };
  }

  /** Queue a polyline through `pts`. Two points is the ordinary straight wall. */
  private path(g: Graphics, pts: Pt[]): Graphics {
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    return g;
  }

  /**
   * The bright head of a fence as it extends.
   *
   * A growing fence and a finished one were drawn identically, so a cut in
   * progress read as a line that already existed rather than as something being
   * built. The head is the one part of the board the player is actually looking
   * at while they draw, and it was the least distinguished thing on it.
   *
   * Drawn AFTER the legs would put the halo over the body; drawn before, the
   * body's own core runs over the trail and the two merge into one bright
   * taper into the head, which is the read we want.
   */
  private drawGrowTip(
    waypoints: { x: number; y: number }[],
    segIndex: number,
    tipW: { x: number; y: number },
    w2s: W2S,
    scale: number,
    thickness: number,
  ): void {
    const from = waypoints[Math.min(segIndex, waypoints.length - 1)];
    if (!from) return;
    const a = w2s(from.x, from.y);
    const t = w2s(tipW.x, tipW.y);
    const dx = t.x - a.x, dy = t.y - a.y;
    const len = Math.hypot(dx, dy);
    // A tip that has not moved yet has no direction; drawing a head there would
    // put a bright dot on the board the instant a cut is armed, before anything
    // has actually grown.
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;

    const trail = Math.min(len, 30 * scale);
    this.bodies
      .moveTo(t.x - ux * trail, t.y - uy * trail)
      .lineTo(t.x, t.y)
      .stroke({
        width: Math.max(1, thickness * 0.6),
        color: PALETTE.accent,
        alpha: 0.5,
        cap: "round",
      });
    this.bodies
      .circle(t.x, t.y, Math.max(1.5, thickness * 0.55))
      .fill({ color: PALETTE.accentGlow, alpha: 0.95 });
  }

  private drawSegment(
    startW: Vector2,
    endW: Vector2,
    worldThickness: number,
    isEdge: boolean,
    light: LightScope,
    w2s: W2S,
    scale: number,
    /**
     * Never deform, whatever lands on it. The board's frame is the enclosure
     * rather than something the player built: a fence giving under a ball reads
     * as material, and the wall the whole board sits inside doing the same reads
     * as the room being made of rubber. Fine for one hit and wonky over a
     * session, which is how it was reported.
     */
    rigid = false,
  ): void {
    const thickness = Math.max(1, worldThickness * scale);
    const { pts, bulged } = this.segmentPoints(startW, endW, w2s, snapWidth(thickness), rigid);
    const a = pts[0];
    const b = pts[pts.length - 1];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    // Unit normal. Which of the two faces is lit is decided per wall by the
    // light, not by winding order, so a fence drawn in either direction lights
    // identically.
    const nx = -dy / len;
    const ny = dx / len;
    const half = thickness / 2;

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // ── 1. Cast shadow ─────────────────────────────────────────────────────
    const cast = shadowFor(light, midX, midY, thickness);
    this.addShadow(a, b, nx, ny, half, cast.dx * cast.length, cast.dy * cast.length, cast.alpha);

    // ── 2. Body ────────────────────────────────────────────────────────────
    // Lit like a slab: the same mix(shadow, material, ambient) the obstacles
    // use, so a fence and a wall are visibly made of the same stuff.
    const amb = ambientAt(light, midX, midY);
    const material = isEdge ? PALETTE.edge : PALETTE.accentDim;
    this.path(this.bodies, pts)
      .stroke({
        width: snapWidth(thickness),
        color: mix(PALETTE.shadow, material, 0.55 + amb * 0.45),
        alpha: 1,
        // A bulged run is one bent line rather than a chain of butted stubs, so
        // its joins have to be round or every sample point shows as a notch.
        cap: bulged ? "round" : "butt",
        join: "round",
      });

    if (!isEdge) {
      // A narrow accent core - the player's own mark still needs to be findable
      // at a glance. Much dimmer and thinner than the old neon centreline, and
      // it now dims with the ambient like everything else rather than emitting.
      this.path(this.bodies, pts)
        .stroke({
          join: "round",
          cap: bulged ? "round" : "butt",
          width: Math.max(1, snapWidth(thickness * 0.3)),
          // Deliberately kept well short of full accent: this is a lit material
          // catching the monitor, not a neon tube. Blending most of the way to
          // PALETTE.accent (the first attempt) left it as hot as before and
          // still clashing with the furniture around it.
          color: mix(PALETTE.accentDim, PALETTE.accent, 0.3 * amb),
          alpha: 0.8,
        });
    }

    // ── 3. Rim on the lit face ─────────────────────────────────────────────
    // Test BOTH faces and light whichever actually points at the monitor.
    const litPos = facing(light, midX + nx, midY + ny, nx, ny);
    const litNeg = facing(light, midX - nx, midY - ny, -nx, -ny);
    const useNx = litPos >= litNeg ? nx : -nx;
    const useNy = litPos >= litNeg ? ny : -ny;
    const lit = Math.max(litPos, litNeg);
    if (lit <= 0.02) return;

    const rx = useNx * half;
    const ry = useNy * half;
    // Same 1px rim, same strength constant as the obstacles and mirrors use, so
    // every lit edge on the board is spoken in one voice.
    // The rim rides the same curve, offset along the chord normal. Using a
    // per-point normal would be more correct and is not worth it: the bulge
    // peaks at six world units, so the curve's own normals never diverge from
    // the chord's by enough to see.
    this.path(this.rims, pts.map(p => ({ x: p.x + rx, y: p.y + ry })))
      .stroke({
        width: hairline(),
        color: isEdge ? PALETTE.edge : PALETTE.accentGlow,
        alpha: Math.min(0.95, lit * 0.95 * light.level),
        cap: bulged ? "round" : "butt",
        join: "round",
      });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
