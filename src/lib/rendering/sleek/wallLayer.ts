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
import { snapSegment, snapWidth, type Pt } from "./pixelGrid";

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
  private fenceScope = new Container();
  private fenceMask = new Graphics();
  private fenceMaskKey = "";
  /** Per-wall clipped sub-segments; walls are immutable, so cache on identity. */
  private clipCache = new WeakMap<Wall, { start: Vector2; end: Vector2 }[]>();

  private shadows = new Graphics();
  private bodies = new Graphics();
  private rims = new Graphics();

  constructor() {
    // Shadows first so every wall body sits on top of every shadow: a wall must
    // never be dimmed by its neighbour's shadow falling across it.
    this.fenceScope.addChild(this.shadows, this.bodies, this.rims);
    this.fenceScope.mask = this.fenceMask;
    // The mask must be a sibling in the display list, not a detached Graphics.
    this.container.addChild(this.fenceScope, this.fenceMask);
  }

  /** Board polygon with the obstacle footprints cut out of it. */
  private syncMask(game: CanvasGameState, w2s: W2S, scale: number): void {
    const key = `${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 10000)}_${game.obstaclePolygons.length}`;
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
      m.poly(poly.vertices.map(v => w2s(v.x, v.y))).cut();
    }
  }

  sync(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    this.shadows.clear();
    this.bodies.clear();
    this.rims.clear();
    this.shadowRuns.clear();
    this.syncMask(game, w2s, scale);

    for (const w of game.walls) {
      const isEdge = w.isBoardEdge ?? w.id.startsWith("board-");
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
  private drawSegment(
    startW: Vector2,
    endW: Vector2,
    worldThickness: number,
    isEdge: boolean,
    light: LightScope,
    w2s: W2S,
    scale: number,
  ): void {
    const thickness = Math.max(1, worldThickness * scale);
    const a0 = w2s(startW.x, startW.y);
    const b0 = w2s(endW.x, endW.y);
    const { a, b } = snapSegment(a0, b0, snapWidth(thickness));

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
    this.bodies
      .moveTo(a.x, a.y)
      .lineTo(b.x, b.y)
      .stroke({
        width: snapWidth(thickness),
        color: mix(PALETTE.shadow, material, 0.55 + amb * 0.45),
        alpha: 1,
        cap: "butt",
      });

    if (!isEdge) {
      // A narrow accent core - the player's own mark still needs to be findable
      // at a glance. Much dimmer and thinner than the old neon centreline, and
      // it now dims with the ambient like everything else rather than emitting.
      this.bodies
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({
          width: Math.max(1, snapWidth(thickness * 0.3)),
          // Deliberately kept well short of full accent: this is a lit material
          // catching the monitor, not a neon tube. Blending most of the way to
          // PALETTE.accent (the first attempt) left it as hot as before and
          // still clashing with the furniture around it.
          color: mix(PALETTE.accentDim, PALETTE.accent, 0.3 * amb),
          alpha: 0.8,
          cap: "butt",
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
    this.rims
      .moveTo(a.x + rx, a.y + ry)
      .lineTo(b.x + rx, b.y + ry)
      .stroke({
        width: 1,
        color: isEdge ? PALETTE.edge : PALETTE.accentGlow,
        alpha: Math.min(0.95, lit * 0.95 * light.level),
        cap: "butt",
      });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
