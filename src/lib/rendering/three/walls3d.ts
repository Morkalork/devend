/**
 * Fences, the board's frame and the head-start fence, as real blocks.
 *
 * Every straight run of wall is one instance of a unit box, scaled to the
 * run's length, thickness and height: ONE draw call for every wall on the
 * board, however many cuts a late map has, and a frame's update is writing
 * a few hundred matrices rather than rebuilding geometry.
 *
 * The runs are the ones the 2D wall layer draws, collected the same way
 * (`collectWallRuns`), because the tops of these blocks show what that layer
 * painted for them (surfaceMaterial.ts) and the two have to agree on where a
 * fence is. That means the same three sources - player fences clipped round
 * the obstacles they cross, the growing cut's legs, the frame pushed outward
 * off the visible outline plus the head-start fence - and the same impact
 * bulge, sampled in world space so a tilted board bends the right way.
 */
import {
  BoxGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3,
  type Material,
} from "three";
import type { CanvasGameState } from "@/types/gameState";
import type { Wall } from "@/lib/wallGeometry";
import { WALL_THICKNESS } from "@/lib/wallGeometry";
import { clipLineAgainstPolygons, type Vector2 } from "@/lib/polygon";
import { visibleOutline, outwardEdges, headStartFenceSegments } from "@/lib/headStartStrip";
import { BOARD_FRAME_THICKNESS } from "@/lib/boardConstants";
import { getEffectsAtPoint, hasNearbyImpacts, N_NODES } from "@/lib/wallImpactEffects";
import { HEIGHTS } from "./heights3d";

/** One straight block: a footprint centreline, its thickness and its height. */
export interface WallRun {
  ax: number; ay: number;
  bx: number; by: number;
  thickness: number;
  height: number;
}

/** Clipped sub-segments per wall. Walls are immutable, so identity caches. */
type ClipCache = WeakMap<Wall, { start: Vector2; end: Vector2 }[]>;

function pushRun(out: WallRun[], a: Vector2, b: Vector2, thickness: number, height: number): void {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.25) return;
  out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, thickness, height });
}

/**
 * A run, bent by any live impact the way the 2D layer bends it: sampled into
 * N_NODES points, each pushed by the bulge, joined as short straight blocks.
 * Rigid runs (the frame) and runs nothing has hit stay one block.
 */
function pushBulged(
  out: WallRun[], start: Vector2, end: Vector2, thickness: number, height: number, rigid: boolean,
): void {
  if (rigid || !hasNearbyImpacts(start, end)) {
    pushRun(out, start, end, thickness, height);
    return;
  }
  let prev: Vector2 | null = null;
  for (let i = 0; i < N_NODES; i++) {
    const t = i / (N_NODES - 1);
    const wx = start.x + (end.x - start.x) * t;
    const wy = start.y + (end.y - start.y) * t;
    const e = getEffectsAtPoint({ x: wx, y: wy }, 1);
    const p = { x: wx + e.dx, y: wy + e.dy };
    if (prev) pushRun(out, prev, p, thickness, height);
    prev = p;
  }
}

/** Every wall block on the board this frame, in untilted world units. */
export function collectWallRuns(
  game: CanvasGameState, heightScale: number, out: WallRun[] = [], cache?: ClipCache,
): WallRun[] {
  out.length = 0;
  const fenceH = HEIGHTS.fence * heightScale;

  // The frame: each edge pushed out along its own normal (outwardEdges), so its
  // inner face sits on the play boundary, and rigid - the enclosure does not
  // give under a ball (wallLayer.drawSegment says why).
  const outline = visibleOutline(game);
  if (outline && outline.vertices.length >= 3) {
    for (const seg of outwardEdges(outline, BOARD_FRAME_THICKNESS / 2)) {
      pushBulged(out, seg.start, seg.end, BOARD_FRAME_THICKNESS, HEIGHTS.frame * heightScale, true);
    }
    for (const seg of headStartFenceSegments(game, WALL_THICKNESS)) {
      pushBulged(out, seg.start, seg.end, WALL_THICKNESS, fenceH, true);
    }
  }

  for (const w of game.walls) {
    if (w.isBoardEdge ?? w.id.startsWith("board-")) continue;   // the frame above
    if (w.isObstacleBoundary) continue;                          // a slab's own edge
    let segs = cache?.get(w);
    if (!segs) {
      segs = game.obstaclePolygons.length === 0
        ? [{ start: w.start, end: w.end }]
        : clipLineAgainstPolygons(w.start, w.end, game.obstaclePolygons);
      cache?.set(w, segs);
    }
    for (const s of segs) pushBulged(out, s.start, s.end, w.thickness, fenceH, false);
  }

  // The cut being drawn: each direction's finished legs, then the partial one.
  for (const g of game.activeWalls) {
    for (const [waypoints, segIndex, tip] of [
      [g.startWaypoints, g.startSegmentIndex, g.startPoint],
      [g.endWaypoints, g.endSegmentIndex, g.endPoint],
    ] as const) {
      for (let i = 0; i < Math.min(segIndex, waypoints.length - 1); i++) {
        pushRun(out, waypoints[i], waypoints[i + 1], g.thickness, fenceH);
      }
      const from = waypoints[Math.min(segIndex, waypoints.length - 1)];
      if (from) pushRun(out, from, tip, g.thickness, fenceH);
    }
  }
  return out;
}

const UP = new Vector3(0, 1, 0);

/** The instanced mesh of every wall block, resized as the board needs. */
export class Walls3D {
  mesh: InstancedMesh;
  private geometry: BoxGeometry;
  private runs: WallRun[] = [];
  private cache: ClipCache = new WeakMap();
  private cacheKey = -1;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();

  constructor(private material: Material, capacity = 256) {
    this.geometry = new BoxGeometry(1, 1, 1);
    // Base on the floor, so scaling the height grows the block upward.
    this.geometry.translate(0, 0.5, 0);
    this.mesh = this.build(capacity);
  }

  private build(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Bounds change every frame and the camera always sees the whole board.
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  /** Rebuild the instance list. Returns the mesh, which may be a new one. */
  sync(game: CanvasGameState, heightScale: number): InstancedMesh {
    // Destructibles leaving changes the clip of every fence through them.
    if (this.cacheKey !== game.obstaclePolygons.length) {
      this.cache = new WeakMap();
      this.cacheKey = game.obstaclePolygons.length;
    }
    const runs = collectWallRuns(game, heightScale, this.runs, this.cache);
    if (runs.length > this.mesh.instanceMatrix.count) {
      const old = this.mesh;
      this.mesh = this.build(Math.max(runs.length, old.instanceMatrix.count * 2));
      old.parent?.add(this.mesh);
      old.parent?.remove(old);
      old.dispose();
    }
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      const dx = r.bx - r.ax, dz = r.by - r.ay;
      const len = Math.hypot(dx, dz);
      // Box x along the run: rotation.y = atan2(-dz, dx) takes +x to (dx, dz).
      this.q.setFromAxisAngle(UP, Math.atan2(-dz, dx));
      this.p.set((r.ax + r.bx) / 2, 0, (r.ay + r.by) / 2);
      this.s.set(len, r.height, r.thickness);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = runs.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    return this.mesh;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
  }
}
