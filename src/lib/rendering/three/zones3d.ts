/**
 * The board's floor zones as inlaid plates, and portal mouths as glowing rims.
 *
 * A zone - a syntax-highlighting area, a gravity well, a slow area, fence-speed
 * ground - is GROUND: balls cross it, and the 2D layer goes out of its way not
 * to box it in, because a boxed region reads as something a ball bounces off.
 * So it does not stand up as furniture. It is a plate a couple of units proud
 * of the floor, its top showing exactly what the 2D layer painted there (the
 * surface material samples by world position), its edge catching the light and
 * laying a hairline shadow. That is enough to read as a tile set into the
 * board without ever reading as a wall: a ball is ten times taller than it.
 *
 * A portal is the one obstacle that is never solid (solids3d.ts), so it was a
 * flat mouth on the floor. It gets a rim: a low emissive ring round the mouth,
 * which reads as an opening with an edge to it rather than a painted circle.
 */
import { Group, Mesh, MeshStandardMaterial, TorusGeometry, type Material } from "three";
import type { CanvasGameState } from "@/types/gameState";
import type { Vector2 } from "@/lib/polygon";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import { Solids3D, type Solid } from "./solids3d";

/** How far a zone plate stands proud of the floor, world units. */
export const PLATE_HEIGHT = 1.6;

type Rect = { x: number; y: number; width: number; height: number };

function rectPoly(r: Rect): Vector2[] {
  return [
    { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height },
  ];
}

/** Every zone plate on the board this frame. */
export function collectPlates(game: CanvasGameState, out: Solid[] = []): Solid[] {
  out.length = 0;
  const rects: Rect[] = [
    ...(game.coloredAreas ?? []),
    ...(game.gravityWells ?? []),
    ...(game.slowAreas ?? []),
    ...(game.fenceZones ?? []),
  ];
  for (const r of rects) {
    if (!(r.width > 0 && r.height > 0)) continue;
    out.push({ vertices: rectPoly(r), height: PLATE_HEIGHT });
  }
  return out;
}

export class Zones3D {
  private plates: Solids3D;
  private plateList: Solid[] = [];
  private rims: Mesh[] = [];
  private rimGeo = new TorusGeometry(1, 0.09, 8, 48).rotateX(Math.PI / 2);
  private rimMat = new MeshStandardMaterial({ color: PALETTE.portal, roughness: 0.35, metalness: 0.2 });
  private group = new Group();

  constructor(private parent: Group, plateMaterial: Material) {
    this.plates = new Solids3D(plateMaterial);
    // Too low to throw a shadow worth its cost; the edge's shading does the work.
    this.plates.mesh.castShadow = false;
    this.rimMat.emissive.setHex(PALETTE.portal);
    this.group.add(this.plates.mesh);
    parent.add(this.group);
  }

  sync(game: CanvasGameState, now: number): void {
    this.plates.syncSolids(collectPlates(game, this.plateList));

    let n = 0;
    if (game.portals) {
      for (const spec of game.portals.values()) {
        if (!(spec.radius > 0)) continue;
        let rim = this.rims[n];
        if (!rim) {
          rim = new Mesh(this.rimGeo, this.rimMat);
          rim.castShadow = true;
          rim.receiveShadow = false;
          this.rims.push(rim);
          this.group.add(rim);
        }
        rim.visible = true;
        const r = spec.radius * 0.95;
        rim.scale.setScalar(r);
        rim.position.set(spec.centre.x, r * 0.09, spec.centre.y);
        n++;
      }
    }
    for (let i = n; i < this.rims.length; i++) this.rims[i].visible = false;
    // The mouth breathes, so it reads as live rather than as a painted ring.
    this.rimMat.emissiveIntensity = 0.7 + 0.25 * Math.sin(now / 520);
  }

  dispose(): void {
    this.parent.remove(this.group);
    this.plates.dispose();
    this.rimGeo.dispose();
    this.rimMat.dispose();
  }
}
