/**
 * The board's floor: the visible outline as one flat polygon at y = 0.
 *
 * Everything the player reads about ground - captured, live, locked, the
 * lattice, coloured areas, props, pocket flashes - is painted onto it from the
 * surface texture (surfaceMaterial.ts); this mesh only gives that paint a
 * place to receive light and shadows. It is the VISIBLE outline, not the
 * physics one, for the reason the 2D mask uses it: on a board a starting
 * capture trimmed, the head-start strip is part of the board.
 *
 * Rebuilt only when the outline changes, which is once per map.
 */
import { BufferAttribute, BufferGeometry, Mesh, ShapeUtils, Vector2 as V2, type Material } from "three";
import type { CanvasGameState } from "@/types/gameState";
import { visibleOutline } from "@/lib/headStartStrip";
import type { Vector2 } from "@/lib/polygon";

const SQUARE: Vector2[] = [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }];

/** A flat, upward-facing triangulation of a polygon in the floor plane. */
export function floorGeometry(vertices: Vector2[]): BufferGeometry {
  const pts = vertices.length >= 3 ? vertices : SQUARE;
  const pos = new Float32Array(pts.length * 3);
  const nrm = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    pos[i * 3] = p.x; pos[i * 3 + 2] = p.y;
    nrm[i * 3 + 1] = 1;
  });
  const idx: number[] = [];
  for (const [a, b, c] of ShapeUtils.triangulateShape(pts.map(p => new V2(p.x, p.y)), [])) {
    // Up-facing from a camera above: clockwise in (x, z). See solids3d.extrude.
    const pa = pts[a], pb = pts[b], pc = pts[c];
    const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    if (cross < 0) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export class Floor3D {
  readonly mesh: Mesh;
  private key = "";

  constructor(material: Material) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    // Drawn before anything standing on it, and translucent over the page.
    this.mesh.renderOrder = -1;
  }

  sync(game: CanvasGameState): void {
    const outline = visibleOutline(game);
    const verts = outline?.vertices ?? SQUARE;
    const key = verts.map(v => `${Math.round(v.x * 4)},${Math.round(v.y * 4)}`).join(";");
    if (key === this.key) return;
    this.key = key;
    this.mesh.geometry.dispose();
    this.mesh.geometry = floorGeometry(verts);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
