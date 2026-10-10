/**
 * The cut being dragged, previewed by light (lib/cutPreview.ts says why).
 *
 * Two parts, because they answer two halves of one question:
 *
 *   THE WALL  the would-be fence stands up in the scene as a wall only light
 *     can see: it draws nothing, but it is in the shadow maps, so the balls'
 *     pools stop dead at the line exactly as they will once the fence lands.
 *   THE DARK  ground the cut would capture goes dark. A wall alone cannot
 *     say this: only the lamp and a couple of balls' lights cast shadows on a
 *     phone tier, and "no ball can reach this" is a statement about EVERY ball.
 *     So the capture is simulated (predictCapture) and laid over the floor as a
 *     small mask, one texel per grid cell, sampled with bilinear filtering so
 *     its edge is soft rather than a staircase of cells.
 *
 * The strength eases in and out over a tenth of a second, so the dark does not
 * blink on the frame a drag crosses the noise threshold.
 */
import {
  DataTexture, LinearFilter, MeshBasicMaterial, RedFormat, UnsignedByteType, Vector4,
  type Group,
} from "three";
import type { CanvasGameState } from "@/types/gameState";
import { predictCapture, previewCutPaths, previewKey, previewSegments } from "@/lib/cutPreview";
import { WALL_THICKNESS } from "@/lib/wallGeometry";
import { Walls3D, type WallRun } from "./walls3d";
import { HEIGHTS } from "./heights3d";

/** How dark captured-to-be ground goes at full strength (a multiplier taken off). */
export const PREVIEW_DARK = 0.62;
/** How fast the preview eases in and out, per second. */
const EASE = 9;

/** Shared with the floor material. */
export interface PreviewUniforms {
  uPreviewMask: { value: DataTexture | null };
  /** (originX, originY, width * cell, height * cell), world units. */
  uPreviewRect: { value: Vector4 };
  /** 0..1 strength, already scaled by the dial and the ease. */
  uPreviewStrength: { value: number };
}

export function createPreviewUniforms(): PreviewUniforms {
  return {
    uPreviewMask: { value: null },
    uPreviewRect: { value: new Vector4(0, 0, 900, 900) },
    uPreviewStrength: { value: 0 },
  };
}

/**
 * A material that draws nothing but still casts a shadow: three renders an
 * object into the shadow maps from its depth, whatever its colour pass does.
 */
export function shadowOnlyMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.colorWrite = false;
  m.depthWrite = false;
  return m;
}

export class CutPreview3D {
  private walls: Walls3D;
  private material = shadowOnlyMaterial();
  private texture: DataTexture | null = null;
  private key = "";
  private strength = 0;
  private last = 0;
  private runs: WallRun[] = [];

  constructor(private parent: Group, readonly uniforms: PreviewUniforms) {
    this.walls = new Walls3D(this.material, 32);
    parent.add(this.walls.mesh);
  }

  private textureFor(w: number, h: number): DataTexture {
    const t = this.texture;
    if (t && t.image.width === w && t.image.height === h) return t;
    t?.dispose();
    const tex = new DataTexture(new Uint8Array(w * h), w, h, RedFormat, UnsignedByteType);
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;
    return tex;
  }

  sync(game: CanvasGameState, now: number, gain: number, heightScale: number): void {
    const dt = this.last > 0 ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    const grid = game.spaceGrid;
    const preview = gain > 0.001 ? previewCutPaths(game) : null;

    if (preview && grid) {
      const tex = this.textureFor(grid.width, grid.height);
      const key = previewKey(preview);
      if (key !== this.key) {
        this.key = key;
        const mask = predictCapture(game, preview);
        const data = tex.image.data as Uint8Array;
        if (mask) for (let i = 0; i < data.length; i++) data[i] = mask[i] ? 255 : 0;
        else data.fill(0);
        tex.needsUpdate = true;
      }
      this.uniforms.uPreviewMask.value = tex;
      this.uniforms.uPreviewRect.value.set(
        grid.originX, grid.originY, grid.width * grid.cellSize, grid.height * grid.cellSize,
      );
      // Tall enough that a ball's light, at the ball's own height, cannot
      // reach over it: the pool stops at the line rather than thinning past it.
      this.runs.length = 0;
      for (const s of previewSegments(preview)) {
        this.runs.push({
          ax: s.start.x, ay: s.start.y, bx: s.end.x, by: s.end.y,
          thickness: WALL_THICKNESS, height: HEIGHTS.fence * heightScale + 30,
        });
      }
    } else {
      this.key = "";
      this.runs.length = 0;
    }
    const want = preview ? gain : 0;
    this.strength += (want - this.strength) * Math.min(1, dt * EASE);
    if (want === 0 && this.strength < 0.01) this.strength = 0;
    this.uniforms.uPreviewStrength.value = this.strength;

    const mesh = this.walls.syncRuns(this.runs);
    if (mesh.parent !== this.parent) this.parent.add(mesh);
  }

  dispose(): void {
    this.parent.remove(this.walls.mesh);
    this.walls.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}
