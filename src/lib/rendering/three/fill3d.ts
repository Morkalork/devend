/**
 * Fenced-off ground as a raised block (filledGround.ts).
 *
 * The 2D surface already paints a captured pocket as an opaque cover; on the
 * 3D board a cover on the floor would still leave every obstacle and prop in
 * the pocket standing up out of it. So the fill rises, to just under a fence's
 * height: the pocket reads as poured full, whatever was in it is buried, and
 * the fences around it stand a hair proud of it as the seams of the cuts.
 *
 * The top samples the surface texture like every other surface here, so the
 * lock tints and a pocket's badges painted on the 2D cover land on the top of
 * the block. Sides face the live ground they border.
 *
 * Rebuilt only when the outline changes (filledGround's version) or the Admin
 * height knob moves.
 */
import { BufferAttribute, BufferGeometry, Mesh, ShapeUtils, Vector2 as V2, type Material } from "three";
import type { CanvasGameState } from "@/types/gameState";
import type { Vector2 } from "@/lib/polygon";
import { filledGround, type FilledShape } from "@/lib/rendering/filledGround";
import { HEIGHTS } from "./heights3d";

/** The fill's height as a share of a fence's: fences stay just proud of it. */
export const FILL_RISE = 0.92;
/** How far inside an edge a side face samples its colour, world units. */
const SIDE_INSET = 2.2;

function signedArea(loop: Vector2[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Extrude filled shapes: a triangulated top with its holes, and a wall along
 * every loop facing AWAY from the fill (out of an outer, into a hole).
 */
export function extrudeFill(shapes: FilledShape[], height: number): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const ins: number[] = [];
  const idx: number[] = [];

  const vertex = (x: number, y: number, z: number, nx: number, nz: number, ix: number, iz: number, up: boolean) => {
    pos.push(x, y, z);
    nrm.push(nx, up ? 1 : 0, nz);
    ins.push(ix, iz);
    return pos.length / 3 - 1;
  };

  for (const shape of shapes) {
    if (shape.outer.length < 3) {
      continue;
    }
    const holes = shape.holes.filter(h => h.length >= 3);

    // Top: the outer and its holes in one triangulation, indices running over
    // the outer followed by each hole in order.
    const all = [shape.outer, ...holes].flat();
    const base = pos.length / 3;
    for (const p of all) {
      vertex(p.x, height, p.y, 0, 0, 0, 0, true);
    }
    const tris = ShapeUtils.triangulateShape(
      shape.outer.map(p => new V2(p.x, p.y)),
      holes.map(h => h.map(p => new V2(p.x, p.y))),
    );
    for (const [a, b, c] of tris) {
      const pa = all[a], pb = all[b], pc = all[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      // Up-facing from a camera above: clockwise in (x, z). See solids3d.extrude.
      if (cross < 0) {
        idx.push(base + a, base + b, base + c);
      } else {
        idx.push(base + a, base + c, base + b);
      }
    }

    // Sides.
    const loops: { loop: Vector2[]; hole: boolean }[] = [
      { loop: shape.outer, hole: false },
      ...holes.map(loop => ({ loop, hole: true })),
    ];
    for (const { loop, hole } of loops) {
      // For a loop of positive area the outward normal of edge (dx, dy) is
      // (dy, -dx); a hole's sides face into the hole, the other way.
      const flip = (signedArea(loop) > 0) !== hole ? 1 : -1;
      for (let e = 0; e < loop.length; e++) {
        const a = loop[e], b = loop[(e + 1) % loop.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          continue;
        }
        const nx = (dy / len) * flip, ny = (-dx / len) * flip;
        // Sample a little inside the fill, so a side takes the fill's colour.
        const ix = -nx * SIDE_INSET, iy = -ny * SIDE_INSET;
        const v0 = vertex(a.x, 0, a.y, nx, ny, ix, iy, false);
        const v1 = vertex(b.x, 0, b.y, nx, ny, ix, iy, false);
        const v2 = vertex(b.x, height, b.y, nx, ny, ix, iy, false);
        const v3 = vertex(a.x, height, a.y, nx, ny, ix, iy, false);
        // Face normal of (a0, b0, b1) is (-dz*h, 0, dx*h) with dz = dy here;
        // keep the winding whose normal agrees with the outward one.
        const faceOut = (-dy * nx + dx * ny) > 0;
        if (faceOut) {
          idx.push(v0, v1, v2, v0, v2, v3);
        } else {
          idx.push(v0, v2, v1, v0, v3, v2);
        }
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("aSampleInset", new BufferAttribute(new Float32Array(ins), 2));
  g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

export class Fill3D {
  readonly mesh: Mesh;
  private key = "";

  constructor(material: Material) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  sync(game: CanvasGameState, heightScale: number): void {
    const ground = filledGround(game);
    const key = ground ? `${ground.version}|${heightScale}` : "none";
    if (key === this.key) {
      return;
    }
    this.key = key;
    this.mesh.geometry.dispose();
    if (!ground) {
      this.mesh.geometry = new BufferGeometry();
      return;
    }
    const shapes = ground.strip ? [...ground.shapes, ground.strip] : ground.shapes;
    this.mesh.geometry = extrudeFill(shapes, HEIGHTS.fence * FILL_RISE * heightScale);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
