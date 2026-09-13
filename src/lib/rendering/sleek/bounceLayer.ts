/**
 * Drawing the bounce (ballBounce.ts): the surface lights up, and the ball
 * takes some of it back.
 *
 * TWO CONTAINERS, AT TWO DEPTHS, and that is the whole design. The band on the
 * wall has to sit ON the wall, so it goes above the wall layer; the return
 * light has to sit on the BALL, so it goes above the ball layer. One container
 * could not do both, and putting either in the layer that owns the object it
 * lands on would have meant threading the bounce list through two more sync
 * signatures for something neither layer has any other use for.
 *
 * Both are additive, both are one tinted sprite per bounce off one baked
 * texture, and neither needs occlusion: a reflection lives on a surface, and
 * the surface is its own occluder.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import {
  collectBounces, BOUNCE_ALPHA, BOUNCE_LENGTH_RADII, BOUNCE_KISS_ALPHA,
  BOUNCE_KISS_RADII, type Bounce,
} from "./ballBounce";
import { getLightLook } from "@/lib/lightLook";
import { OUTER_WALL_THICKNESS } from "./wallLayer";
import type { Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** Bake size of the band, in texture pixels. */
const BAND_W = 128;
const BAND_H = 64;
/** Where the lit FACE sits in the band bake, as a fraction of its height. */
const FACE_AT = 0.32;
/** Bake radius of the return light. */
const KISS_BAKE = 64;

let bandTexture: Texture | null = null;
let kissTexture: Texture | null = null;

/**
 * The band: a hard rim on the lit face, with a soft glow behind it.
 *
 * TWO PROFILES STACKED, and the first version had only the soft one, which is
 * why it was nearly invisible on screen. Right beside a ball the floor is
 * already at the peak of that ball's own pool, so a second soft glow in the
 * same place adds almost nothing the eye can find - to read as a different
 * thing the bounce has to be a different KIND of thing. So:
 *
 *   THE RIM   a hairline spike exactly on the face. The pool can never produce
 *     this, because the pool is composited UNDER the wall and the wall's own
 *     edge is the one place its light cannot reach. It is also the cue the
 *     wall layer already uses to say "raised object", now answering a second
 *     light, which is exactly the sentence this effect exists to finish.
 *   THE GLOW  a wider falloff biased INTO the wall rather than out onto the
 *     floor, for the same reason: the wall's dark body is unlit by anything
 *     but the monitor, and the floor beside it is already spoken for.
 *
 * ALONG the wall both fade on one wide Gaussian. A ball is a round area source,
 * so what it lights is a patch - and a soft patch is also the only thing that
 * survives a ball SLIDING along a fence without strobing, because every pixel
 * it crosses changes gradually.
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
    const v = j / (BAND_H - 1);
    const d = v - FACE_AT;
    // Asymmetric: 0.20 into the wall, 0.07 out over the floor.
    const glow = Math.exp(-((d / (d > 0 ? 0.20 : 0.07)) ** 2));
    const rim = Math.exp(-((d / 0.028) ** 2));
    const across = Math.min(1, 0.55 * glow + rim);
    for (let i = 0; i < BAND_W; i++) {
      const u = i / (BAND_W - 1);
      const along = Math.exp(-(((u - 0.5) / 0.24) ** 2));
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

/** The return light: a plain soft disc, peaking off-centre like the pool does. */
function kissTex(): Texture {
  if (kissTexture) return kissTexture;
  const size = KISS_BAKE * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (kissTexture = Texture.WHITE);
  const g = ctx.createRadialGradient(KISS_BAKE, KISS_BAKE, 0, KISS_BAKE, KISS_BAKE, KISS_BAKE);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.62)");
  g.addColorStop(0.65, "rgba(255,255,255,0.22)");
  g.addColorStop(0.85, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  kissTexture = Texture.from(canvas);
  return kissTexture;
}

export function clearBounceTextures(): void {
  bandTexture?.destroy(true);
  bandTexture = null;
  kissTexture?.destroy(true);
  kissTexture = null;
}

export class BounceLayer {
  /** The bands on the fences and obstacles. Hung above the wall layer. */
  readonly onWalls = new Container();
  /**
   * The bands on the BOARD'S OWN FRAME, hung beside walls.outer, OUTSIDE the
   * board mask.
   *
   * Its own container purely because of that mask. The frame is drawn beyond
   * the play boundary on purpose (wallLayer.outer), so a band for it composed
   * inside the board scope is clipped off at exactly the edge it is meant to
   * light, and the most common contact in the game - a ball off the wall -
   * would be the one surface that never answered.
   */
  readonly onFrame = new Container();
  /** The return light on the balls. Hung above the ball layer. */
  readonly onBalls = new Container();

  private bands: Sprite[] = [];
  private frameBands: Sprite[] = [];
  /**
   * Board plus frame: how far outside the play area a frame band may reach.
   *
   * Being outside the board mask is what lets a band light the frame, and with
   * nothing in its place a streak ran straight off the corner and drew a cross
   * on the black page. So the mask is not the board's - it is the board's
   * polygon FILLED and then STROKED at the frame's width, which is board plus
   * frame and nothing else, and which follows a gravity map's tilt for free
   * because it is built from the same transformed points the frame is.
   */
  private frameMask = new Graphics();
  private kisses: Sprite[] = [];
  private bounces: Bounce[] = [];

  sync(game: CanvasGameState, w2s: W2S, scale: number): void {
    this.syncFrameMask(game, w2s, scale);
    const strength = getLightLook().bounce;
    const list = strength > 0.001 ? collectBounces(game, this.bounces) : (this.bounces.length = 0, this.bounces);

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const r = b.ball.radius * (b.ball.assimScale ?? 1);
      const a = b.strength * strength;

      // ── The band on the wall ────────────────────────────────────────────
      const edge = b.wall.isBoardEdge ?? b.wall.id.startsWith("board-");
      const band = this.bandAt(i, edge);
      band.visible = true;
      band.texture = bandTex();
      // Pinned to the lit FACE, not the centreline, with the bake's own face
      // line (FACE_AT) as the sprite's y anchor - so the brightest row of the
      // texture lands exactly on the edge of the wall the ball is on, whatever
      // the wall's thickness.
      const c = w2s(b.x + b.nx * b.wall.thickness / 2, b.y + b.ny * b.wall.thickness / 2);
      band.position.set(c.x, c.y);
      // Local +y must point INTO the wall, away from the ball. Pixi's local y
      // axis in world is (-sin, cos), so setting that to -n gives this.
      band.rotation = Math.atan2(b.nx, -b.ny);
      const len = r * BOUNCE_LENGTH_RADII * (0.55 + 0.45 * b.strength) * scale;
      // Capped against the ball as well as the wall: a board edge is twice a
      // fence's thickness, and scaling the spill straight off that would give
      // the frame a halo half a ball deep while a fence got a hairline.
      const across = Math.min(b.wall.thickness * 3.5, r * 1.6) * scale;
      band.width = len;
      band.height = across;
      band.tint = b.color;
      band.alpha = a * BOUNCE_ALPHA;

      // ── The return light on the ball ────────────────────────────────────
      // On the ball's own rim, facing the wall: the light it threw, coming
      // back. Without this half the wall lights up and the ball stays a decal
      // beside it, which reads as the fence glowing on its own.
      const kiss = this.kissAt(i);
      kiss.visible = true;
      kiss.texture = kissTex();
      const p = b.ball.splatMass ?? b.ball.renderPosition ?? b.ball.position;
      const k = w2s(p.x - b.nx * r * 0.72, p.y - b.ny * r * 0.72);
      kiss.position.set(k.x, k.y);
      const kr = r * BOUNCE_KISS_RADII * scale;
      kiss.width = kr * 2;
      kiss.height = kr * 2;
      kiss.tint = b.color;
      kiss.alpha = a * BOUNCE_KISS_ALPHA;
    }

    for (let i = list.length; i < this.bands.length; i++) this.bands[i].visible = false;
    for (let i = list.length; i < this.frameBands.length; i++) this.frameBands[i].visible = false;
    for (let i = list.length; i < this.kisses.length; i++) this.kisses[i].visible = false;
  }

  private syncFrameMask(game: CanvasGameState, w2s: W2S, scale: number): void {
    this.frameMask.clear();
    const poly = game.boardPolygon?.vertices;
    if (!poly || poly.length < 3) return;
    const pts = poly.map(v => w2s(v.x, v.y));
    // A stroke straddles the path, so half its width lies outside: doubling
    // the frame's thickness is what puts the outer lip of the band on the
    // outer lip of the frame.
    this.frameMask.poly(pts).fill({ color: 0xffffff, alpha: 1 });
    this.frameMask.poly(pts).stroke({
      width: OUTER_WALL_THICKNESS * 2 * scale, color: 0xffffff, alpha: 1,
    });
    if (this.onFrame.mask !== this.frameMask) {
      this.onFrame.addChild(this.frameMask);
      this.onFrame.mask = this.frameMask;
    }
  }

  /**
   * A band sprite for bounce `i`, from the pool for the surface it lands on.
   *
   * Both pools are indexed by the same i, so a bounce that switches surface
   * between frames leaves a stale sprite in the other pool - which the visible
   * sweep below turns off, because it runs over both.
   */
  private bandAt(i: number, onFrame: boolean): Sprite {
    const pool = onFrame ? this.frameBands : this.bands;
    let s = pool[i];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5, FACE_AT);
      s.blendMode = "add";
      (onFrame ? this.onFrame : this.onWalls).addChild(s);
      pool[i] = s;
    }
    const stale = onFrame ? this.bands[i] : this.frameBands[i];
    if (stale) stale.visible = false;
    return s;
  }

  private kissAt(i: number): Sprite {
    let s = this.kisses[i];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      s.blendMode = "add";
      this.onBalls.addChild(s);
      this.kisses[i] = s;
    }
    return s;
  }

  destroy(): void {
    this.onWalls.destroy({ children: true });
    this.onFrame.destroy({ children: true });
    this.onBalls.destroy({ children: true });
  }
}
