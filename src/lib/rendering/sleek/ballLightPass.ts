/**
 * The ball-light pass: pools of light that the board's geometry actually blocks.
 *
 * WHY A BUFFER AND NOT JUST ADDITIVE SPRITES
 *
 * A glow is easy: draw a radial gradient under each ball with blendMode "add"
 * and stop. The reason that is not what happens here is the second rule in
 * ballLight.ts - the light has to be occluded, and additive blending cannot
 * subtract. Once a pool is on the screen there is no later draw that can take
 * it back off behind a wall.
 *
 * So the pass composes the lighting on its own surface first, where ordinary
 * over-blending applies and a shadow is simply black paint, and only the
 * finished surface is added to the board. Black adds nothing, so the shadowed
 * region contributes exactly zero light while the lit region contributes its
 * pool. That is the whole trick, and it is why this needs a RenderTexture.
 *
 * It is drawn at HALF resolution. Light is the lowest-frequency thing in the
 * scene, so half costs a quarter and loses nothing - and the bilinear upscale
 * softens the shadow edges for free, which is what you want: a ball is an area
 * source, and a razor-edged shadow from one would look wrong at any resolution.
 *
 * THE ONE APPROXIMATION, stated plainly: a correct multi-light scene needs one
 * pass per light, because ball A's shadow must not eat ball B's light. This
 * pass interleaves instead - each ball's pool, then that ball's shadows, then
 * the next ball - so a later ball's light is painted back over an earlier
 * ball's shadow and only the reverse case is wrong. With pools a tenth of the
 * board wide the overlap-behind-a-wall case is rare and moving, and it costs
 * one target switch instead of five.
 */

import { Container, Graphics, Matrix, RenderTexture, Sprite, Texture } from "pixi.js";
import type { Renderer } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { BoardRect } from "@/lib/boardConstants";
import { PALETTE, mix } from "./palette";
import { ballLight, segmentDistance, shadowQuad, type BallLight } from "./ballLight";
import { webPoolTex, POOL_STOPS, WEB_POOL_BAKE, WEB_SPIN } from "./ballWeb";
import { derivedLights, type DerivedLight } from "./derivedLight";
import {
  causticFor, flashEnvelope, flashReach, FLASH_INTENSITY,
  LOCK_FLASH_MS, SUPERIOR_FLASH_MS, type PlacedLight,
} from "./flashLight";
import type { LightScope } from "./light";
import { flicker, heartPhase } from "@/lib/rendering/ballLife";
import { tell, warmup, WARMUP_EMBER, type Warmup } from "@/lib/rendering/ballTell";
import { getBallLook } from "@/lib/ballLook";
import { getLightLook } from "@/lib/lightLook";
import type { Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** Fraction of device resolution the light buffer runs at. */
export const LIGHT_RESOLUTION = 0.5;

/**
 * Occluders considered per light. A pool is about a tenth of the board wide, so
 * a real board puts single digits inside one; this exists so a pathological
 * fence tangle cannot turn one frame into thousands of quads, not as a limit
 * anyone should hit.
 */
export const MAX_OCCLUDERS_PER_LIGHT = 40;

/** Radius of the baked gradient in texture pixels. Bigger than any pool needs. */
const BAKE_RADIUS = 128;

let poolTexture: Texture | null = null;

/** A bulb already at temperature: what the dial being off gives back. */
const FULLY_WARM: Warmup = { gain: 1, hue: 1 };

/** Shared empty list, so the dial being off allocates nothing. */
const NO_DERIVED: readonly DerivedLight[] = [];

/**
 * One white radial pool, baked once and TINTED per ball rather than baked per
 * colour. A tint is a multiply, so tinting white gives back exactly the ball's
 * hue: there is no reason to hold a texture per ball type the way the sphere
 * bake has to (a sphere's gradient is not a pure scale of one image).
 *
 * The falloff peaks just OUTSIDE the centre. The middle of the pool is under
 * the ball's own body, so brightness spent there is invisible; pushing it out
 * to where the board actually shows makes the same alpha read as more light.
 */
function poolTex(): Texture {
  if (poolTexture) return poolTexture;
  const size = BAKE_RADIUS * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (poolTexture = Texture.WHITE);

  const g = ctx.createRadialGradient(
    BAKE_RADIUS, BAKE_RADIUS, 0, BAKE_RADIUS, BAKE_RADIUS, BAKE_RADIUS,
  );
  // The stops are shared with the webbed pool (ballWeb.ts) so the two mix
  // linearly at any web strength; the long tail keeps the edge soft.
  for (const [o, a] of POOL_STOPS) g.addColorStop(o, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  poolTexture = Texture.from(canvas);
  return poolTexture;
}

export function clearPoolTexture(): void {
  poolTexture?.destroy(true);
  poolTexture = null;
}

/**
 * How big the light buffer is, and how board space maps into it.
 *
 * Sized to the BOARD, not to the window. Every light is a ball, every ball is
 * on the board, and `boardScope` is masked to the board anyway - so a
 * window-sized buffer spent most of its pixels clearing and compositing area
 * that was guaranteed to be clipped away. On a wide desktop window the board is
 * well under a fifth of the surface; even on a portrait phone, where the board
 * comes closest to filling the screen, it is about half.
 *
 * The transform maps the board's top-left to the buffer's origin and scales by
 * LIGHT_RESOLUTION, so the pass can keep composing in screen coordinates and
 * nothing upstream has to know the buffer moved.
 */
export function lightBufferPlan(rect: BoardRect): {
  w: number; h: number; transform: Matrix;
} {
  const r = LIGHT_RESOLUTION;
  return {
    w: Math.max(1, Math.ceil(rect.width * r)),
    h: Math.max(1, Math.ceil(rect.height * r)),
    transform: new Matrix(r, 0, 0, r, -rect.left * r, -rect.top * r),
  };
}

interface Emitter {
  glow: Sprite;
  /**
   * The same pool with the shell's web shadowed into it (ballWeb.ts), turned
   * by the ball's rotation. Both pools are additive, so mixing their alphas
   * by the web strength is a linear blend between plain light and webbed
   * light, and a strength of zero is exactly today's pool.
   */
  gobo: Sprite;
  shade: Graphics;
}

export class BallLightPass {
  /** The composited buffer, added to the board with blendMode "add". */
  readonly sprite = new Sprite();

  /** Where the pools and their shadows are composed, before compositing. */
  private stage = new Container();
  private emitters: Emitter[] = [];
  private rt: RenderTexture | null = null;
  private rtW = 0;
  private rtH = 0;
  /** Lights built this frame; zero means the composite is skipped entirely. */
  private live = 0;
  /** Scratch for the derived lights, reused so a frame allocates nothing. */
  private derived: DerivedLight[] = [];

  constructor() {
    this.sprite.blendMode = "add";
  }

  /**
   * Compose this frame's lighting. Pure display-tree work: no renderer, no GPU,
   * so it is drivable headlessly and the geometry is testable.
   */
  build(
    game: CanvasGameState, w2s: W2S, scale: number, now: number = performance.now(),
    monitor?: LightScope,
  ): void {
    this.live = 0;
    const tex = poolTex();

    for (const ball of game.balls) {
      // A stuck ball's light comes from where its mass is drawn, which on a
      // corner is not where its position is (see Ball.splatMass).
      const p = ball.splatMass ?? ball.renderPosition ?? ball.position;
      const c = w2s(p.x, p.y);
      const r = Math.max(2, ball.radius * scale * (ball.assimScale ?? 1));
      const light = ballLight(ball, c, r, parseColor(ball.color));
      if (!light) continue;

      const e = this.emitterAt(this.live++);
      // The light inside flickers now and then; asleep and locked balls are
      // excluded by ballLight already (no light, or a fading one).
      const look = getBallLook();
      const flick = look.flicker && ball.state === "active" ? flicker(now, heartPhase(ball.id) * 7) : 1;
      // What the light SAYS (ballTell.ts): the countdown beat of a ball with a
      // timer, and the warm-up of one that has just switched on. Both fold
      // into the same intensity the flicker does, because they are the same
      // channel - and the tell multiplies the flicker rather than replacing
      // it, so a compass still stutters like every other bulb between beats.
      const tellGain = getLightLook().tell;
      const beat = tellGain > 0.001 ? 1 - (1 - tell(ball, game.activePlaySeconds)) * tellGain : 1;
      const warm = tellGain > 0.001 ? warmup(now, ball.spawnTime) : FULLY_WARM;
      light.intensity *= beat * (1 - (1 - warm.gain) * tellGain);
      light.color = mix(WARMUP_EMBER, light.color, warm.hue);
      const webbed = look.web;
      e.glow.visible = true;
      e.glow.texture = tex;
      e.glow.position.set(light.x, light.y);
      // The bake is a fixed radius; scale it to this ball's reach.
      e.glow.scale.set(light.reach / BAKE_RADIUS);
      e.glow.tint = light.color;
      e.glow.alpha = light.intensity * flick * (1 - webbed);

      e.gobo.visible = webbed > 0.001;
      if (e.gobo.visible) {
        e.gobo.texture = webPoolTex();
        e.gobo.position.set(light.x, light.y);
        e.gobo.scale.set(light.reach / (WEB_POOL_BAKE / 2));
        e.gobo.rotation = ball.rotation * WEB_SPIN;
        e.gobo.tint = light.color;
        e.gobo.alpha = light.intensity * flick * webbed;
      }

      e.shade.visible = true;
      this.drawShadows(e.shade, light, p, game, w2s, scale);

      // The bright core inside this ball's own shadow (flashLight.ts). It is
      // placed from the MONITOR, not from the ball's light: it is the monitor's
      // beam being focused by a translucent body, and the shadow it sits in is
      // the monitor's too.
      const causticGain = getLightLook().caustic;
      const caustic = monitor && causticGain > 0.001
        ? causticFor(ball, c, r, light.color, light.intensity * causticGain * flick, monitor)
        : null;
      if (caustic) this.place(this.emitterAt(this.live++), caustic, tex, p, game, w2s, scale);

      // Second-hand light: a mirror giving this ball's pool back, a portal
      // passing it to the far mouth (derivedLight.ts). Each is an ordinary
      // emitter placed in world space, so it interleaves with its own shadows
      // exactly as a ball's own light does - and must, for the same reason.
      const secondHand = getLightLook().reflected;
      for (const d of secondHand > 0.001 ? derivedLights(ball, game, this.derived) : NO_DERIVED) {
        const dc = w2s(d.x, d.y);
        const dl: PlacedLight = {
          x: dc.x, y: dc.y,
          reach: light.reach * d.spread,
          intensity: light.intensity * d.gain * secondHand,
          color: light.color,
        };
        // Flickers with its parent, because it IS its parent's light: a
        // reflection that held steady while the ball behind it stuttered
        // would read as a second, unrelated source.
        dl.intensity *= flick;
        this.place(this.emitterAt(this.live++), dl, tex, d, game, w2s, scale);
      }
    }

    // ── Lock flashes as real lights ─────────────────────────────────────
    // For the second one burns it IS the brightest thing on the board, so the
    // room has to answer: every fence around the pocket throws a long shadow
    // that appears and fades with it. Added after the balls so a ball standing
    // in a flash is lit by it rather than the other way round.
    const flashGain = getLightLook().flash;
    if (flashGain > 0.001 && game.assimilations) {
      const cell = game.spaceGrid?.cellSize ?? 15;
      for (const a of game.assimilations.values()) {
        const dur = a.superior ? SUPERIOR_FLASH_MS : LOCK_FLASH_MS;
        const env = flashEnvelope((now - a.startTime) / dur);
        if (env <= 0.001) continue;
        const at = w2s(a.centroid.x, a.centroid.y);
        // The flash's own tint, picked exactly as fxLayer picks it, so the
        // light and the flare it belongs to are one event and not two.
        const color = a.zoneColor
          ? parseColor(a.zoneColor)
          : a.superior ? 0xffd54a : parseColor(a.ballColor);
        this.place(this.emitterAt(this.live++), {
          x: at.x, y: at.y,
          reach: flashReach(a, cell) * scale,
          intensity: FLASH_INTENSITY * flashGain * env,
          color,
        }, tex, a.centroid, game, w2s, scale);
      }
    }

    for (let i = this.live; i < this.emitters.length; i++) {
      this.emitters[i].glow.visible = false;
      this.emitters[i].gobo.visible = false;
      this.emitters[i].shade.visible = false;
    }
    this.sprite.visible = this.live > 0;
  }

  /**
   * One light onto one emitter, with its own shadows straight after it.
   *
   * Shared by everything that is not a ball's own pool - the caustic, a
   * mirror's return, a portal's far mouth, a lock flash - because the ONE rule
   * this pass has is that a light's shadows sit directly after that light, so
   * the next light paints back over them. Hand-rolling that per source is how
   * you get a shadow eating a light it has nothing to do with.
   *
   * None of them take the gobo. The web is a pattern on one ball's shell, and
   * carrying it crisply through a reflection, a portal or a beam focused by
   * the ball's own body would claim more than second-hand light can support.
   */
  private place(
    e: Emitter, light: PlacedLight, tex: Texture, world: { x: number; y: number },
    game: CanvasGameState, w2s: W2S, scale: number,
  ): void {
    e.glow.visible = true;
    e.glow.texture = tex;
    e.glow.position.set(light.x, light.y);
    e.glow.scale.set(light.reach / BAKE_RADIUS);
    e.glow.tint = light.color;
    e.glow.alpha = light.intensity;
    e.gobo.visible = false;
    e.shade.visible = true;
    this.drawShadows(e.shade, light, world, game, w2s, scale);
  }

  /** Every wall inside this pool, as one black quad each. */
  private drawShadows(
    g: Graphics, light: PlacedLight, world: { x: number; y: number },
    game: CanvasGameState, w2s: W2S, scale: number,
  ): void {
    g.clear();
    // The reach test runs in WORLD units against the ball's world position. A
    // board tilt is a rotation, so it preserves distance exactly, which makes
    // the cheap test the correct one - and means only the handful of walls that
    // survive it are ever transformed. A busy board carries several hundred
    // fence segments, and transforming all of them, per ball, per frame, would
    // be the expensive part of this pass by a wide margin.
    const reach = light.reach / scale;

    let drawn = 0;
    for (const wall of game.walls) {
      if (drawn >= MAX_OCCLUDERS_PER_LIGHT) break;
      if (segmentDistance(
        world.x, world.y, wall.start.x, wall.start.y, wall.end.x, wall.end.y,
      ) >= reach) continue;

      const a = w2s(wall.start.x, wall.start.y);
      const b = w2s(wall.end.x, wall.end.y);
      const quad = shadowQuad(light, a.x, a.y, b.x, b.y);
      if (!quad) continue;
      g.poly(quad).fill({ color: PALETTE.shadow, alpha: 1 });
      drawn++;
    }
  }

  private emitterAt(i: number): Emitter {
    let e = this.emitters[i];
    if (!e) {
      const glow = new Sprite();
      glow.anchor.set(0.5);
      const gobo = new Sprite();
      gobo.anchor.set(0.5);
      const shade = new Graphics();
      this.stage.addChild(glow, gobo, shade);
      e = { glow, gobo, shade };
      this.emitters[i] = e;
    }
    return e;
  }

  /**
   * Render the composed buffer and point the composite sprite at it.
   *
   * Separate from build() because this is the only part that needs a GPU: a
   * headless test can drive build() and read the quads back off the Graphics.
   */
  commit(renderer: Renderer, boardRect: BoardRect): void {
    if (this.live === 0) return;
    const plan = lightBufferPlan(boardRect);
    if (!this.rt || this.rtW !== plan.w || this.rtH !== plan.h) {
      this.rt?.destroy(true);
      this.rt = RenderTexture.create({ width: plan.w, height: plan.h });
      this.rtW = plan.w;
      this.rtH = plan.h;
      this.sprite.texture = this.rt;
      this.sprite.scale.set(1 / LIGHT_RESOLUTION);
    }
    // The buffer's origin is the board's top-left, so the composite sprite has
    // to sit there rather than at the window's origin.
    this.sprite.position.set(boardRect.left, boardRect.top);
    renderer.render({
      container: this.stage,
      target: this.rt,
      transform: plan.transform,
      clear: true,
      // Fully transparent black. Under "add" the untouched parts of the buffer
      // must contribute nothing, which means transparent - not merely dark.
      clearColor: [0, 0, 0, 0],
    });
  }

  destroy(): void {
    this.rt?.destroy(true);
    this.rt = null;
    this.stage.destroy({ children: true });
    this.sprite.destroy();
  }
}

function parseColor(c: string): number {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}
