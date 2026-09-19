/**
 * Drawing the face light (faceLight.ts): a wall's face answering the light in
 * front of it.
 *
 * One additive, tinted sprite per lit face off one baked band, hung above the
 * wall layer - the same shape as bounceLayer's half of this, and for the same
 * reason: the light buffer is composited UNDER the walls, so a wall's own face
 * is the one surface in the scene it cannot reach.
 *
 * No occlusion, deliberately, which is the same call bounceLayer makes: light
 * landing on a surface is occluded by that surface, and the case this gets
 * wrong - a second wall standing between the light and this face - is both
 * rare on a board of thin fences and cheap to be wrong about, since the band
 * is a soft wash rather than a shape with an edge to notice.
 *
 * BOARD EDGES ARE SKIPPED, and that is a masking fact rather than a design
 * one. The frame is drawn beyond the play boundary (wallLayer.outer) while
 * this container lives inside the board mask, so a band on the frame's face
 * would be sliced off at exactly the line it was lighting. The frame already
 * has an answer to light in bounceLayer's `onFrame`, which carries its own
 * mask for precisely this.
 */

import { Container, Sprite, Texture } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { MoteLight } from "@/lib/rendering/motes";
import { collectFaceLights, FACE_ALPHA, FACE_DEPTH, type FaceLight } from "./faceLight";
import { getLightLook } from "@/lib/lightLook";
import type { Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** Bake size of the band, in texture pixels. */
const BAND_W = 128;
const BAND_H = 64;
/** Where the lit FACE sits in the bake, as a fraction of its height. */
const FACE_AT = 0.3;

let bandTexture: Texture | null = null;

/**
 * The band: soft in both directions, and with no rim.
 *
 * The missing rim is the point of difference from bounceLayer's band, not an
 * omission. A hairline spike on the face is the cue that says CONTACT, and it
 * belongs to the one effect that only fires at contact; borrowing it here
 * would have every fence within a pool of a ball claiming to be touching one.
 *
 * ACROSS the face the falloff is asymmetric, biased into the wall's body: the
 * floor on the lit side is already at the peak of that ball's own pool, so
 * brightness spent there is brightness the eye cannot find. The wall's body is
 * unlit by anything but the monitor, which makes it the one place a second
 * light source has room to say something.
 *
 * ALONG the wall it is one wide Gaussian centred on the closest point, which
 * is what puts the grade in: the face is brightest where the light is nearest
 * to it and falls away down the wall in both directions, without the patch
 * ever acquiring an edge of its own. It is also the only profile that survives
 * a ball running the length of a fence without strobing, since every pixel it
 * crosses changes gradually.
 */
function bandTex(): Texture {
  if (bandTexture) return bandTexture;
  const canvas = document.createElement("canvas");
  canvas.width = BAND_W;
  canvas.height = BAND_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (bandTexture = Texture.WHITE);

  const img = ctx.createImageData(BAND_W, BAND_H);
  for (let j = 0; j < BAND_H; j++) {
    const d = j / (BAND_H - 1) - FACE_AT;
    // 0.34 into the wall, 0.10 out over the floor.
    const across = Math.exp(-((d / (d > 0 ? 0.34 : 0.10)) ** 2));
    for (let i = 0; i < BAND_W; i++) {
      const u = i / (BAND_W - 1);
      const along = Math.exp(-(((u - 0.5) / 0.3) ** 2));
      const k = (j * BAND_W + i) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * across * along);
    }
  }
  ctx.putImageData(img, 0, 0);
  bandTexture = Texture.from(canvas);
  return bandTexture;
}

export function clearFaceLightTexture(): void {
  bandTexture?.destroy(true);
  bandTexture = null;
}

export class FaceLightLayer {
  /** Hung above the wall layer, inside the board mask. */
  readonly container = new Container();

  private bands: Sprite[] = [];
  private faces: FaceLight[] = [];

  constructor() {
    // Additive: this is light arriving on a surface, and light adds. It also
    // means two balls lighting one face from two sides sum rather than the
    // later one replacing the earlier, which is what two lamps do.
    this.container.blendMode = "add";
  }

  sync(game: CanvasGameState, lights: readonly MoteLight[], w2s: W2S, scale: number): void {
    const gain = getLightLook().facing;
    const list = gain > 0.001
      ? collectFaceLights(game, lights, this.faces)
      : (this.faces.length = 0, this.faces);

    let drawn = 0;
    for (const f of list) {
      const band = this.bandAt(drawn++);
      band.visible = true;
      band.texture = bandTex();
      // Pinned to the lit FACE with the bake's own face line as the anchor, so
      // the brightest row lands on the edge of the wall the light is on
      // whatever that wall's thickness.
      const c = w2s(f.x + f.nx * f.faceOffset, f.y + f.ny * f.faceOffset);
      band.position.set(c.x, c.y);
      // Local +y must point INTO the wall, away from the light. Pixi's local y
      // axis in world is (-sin, cos), so setting that to -n gives this.
      band.rotation = Math.atan2(f.nx, -f.ny);
      band.width = f.span * scale;
      band.height = FACE_DEPTH * 2 * scale;
      band.tint = f.color;
      band.alpha = Math.min(1, f.strength * gain * FACE_ALPHA);
    }

    for (let i = drawn; i < this.bands.length; i++) {
      const s = this.bands[i];
      if (s) s.visible = false;
    }
  }

  private bandAt(i: number): Sprite {
    let s = this.bands[i];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5, FACE_AT);
      this.container.addChild(s);
      this.bands[i] = s;
    }
    return s;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
