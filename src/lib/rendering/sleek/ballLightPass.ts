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
import type { Ball } from "@/types/game";
import type { MoteLight } from "@/lib/rendering/motes";
import type { BoardRect } from "@/lib/boardConstants";
import { PALETTE, mix } from "./palette";
import { ballLight, segmentDistance, shadowQuad, type BallLight } from "./ballLight";
import { webPoolTex, POOL_STOPS, WEB_POOL_BAKE, WEB_SPIN } from "./ballWeb";
import { derivedLights, type DerivedLight } from "./derivedLight";
import {
  causticFor, flashEnvelope, flashReach, FLASH_INTENSITY,
  LOCK_FLASH_MS, SUPERIOR_FLASH_MS, impactEnvelope, IMPACT_FLASH_MS,
  IMPACT_REACH_RADII, IMPACT_INTENSITY, type PlacedLight,
} from "./flashLight";
import { activeWallImpacts } from "@/lib/wallImpactEffects";
import type { LightScope } from "./light";
import { flicker, heartPhase } from "@/lib/rendering/ballLife";
import { tell, warmup, speedStretch, WARMUP_EMBER, type Warmup } from "@/lib/rendering/ballTell";
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

/**
 * How dark a ball's shadow is against a wall's.
 *
 * Not full. A wall is a solid slab and blocks everything; a ball is the
 * translucent body the caustic exists to describe, so it has no business
 * casting the same hard black. Partial also keeps the case that happens
 * constantly - a ball drifting through another's pool - from reading as a hole
 * being punched in the floor every time two of them pass.
 */
export const BALL_SHADOW_ALPHA = 0.55;

/**
 * The ball radius an impact flash is sized against, in world units.
 *
 * A constant rather than the ball's own, because an impact does not carry a
 * reference to the ball that made it and matching one up by position is
 * exactly wrong in the case worth looking at: two balls striking the same
 * fence in the same frame. Every ball on the board is within a factor of two
 * of this, and the flash is scaled by impact STRENGTH anyway, which is where
 * a heavier ball's extra weight already shows.
 */
export const BALL_RADIUS_REF = 18;

/**
 * Reach and strength of the light at a growing fence's tip, in world units.
 *
 * Deliberately smaller than a ball's pool. The tip is a working point, not a
 * lamp: it should show the player where their cut has got to and throw a
 * short shadow off whatever it is about to reach, without competing with the
 * balls they are trying to trap.
 */
export const TIP_REACH = 62;
export const TIP_INTENSITY = 0.5;

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
  /**
   * Holds the two pool sprites so a moving ball's light can be stretched
   * along its heading.
   *
   * A container rather than scaling the sprites, because the two disagree
   * about rotation: the plain pool has none, and the webbed one is turned by
   * the shell's spin. Stretching a parent applies to both, and the shear it
   * puts on the spun gobo is a smear of the web pattern along the direction
   * of travel - which is what motion blur on a pattern actually looks like.
   * The shade stays OUTSIDE it: shadows are screen-space geometry and must
   * not be stretched with the thing casting them.
   */
  pool: Container;
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
  /**
   * This frame's emitters in WORLD units, for anything that needs to know
   * where the light is without being part of the composite - the motes, so far.
   *
   * World rather than screen because the motes live in world space and the
   * board can be tilted; and published rather than recomputed because a second
   * opinion about where the light is would be a second thing to keep in step
   * with this one.
   */
  readonly worldLights: MoteLight[] = [];

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
    this.worldLights.length = 0;
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
      // A light source travelling fast does not light a circle. Stretching
      // the pool along the heading puts SPEED in the largest, softest,
      // most peripherally visible thing on the board, which is the one
      // channel a player reads without looking directly at it.
      e.pool.position.set(light.x, light.y);
      const vx = ball.velocity?.x ?? 0, vy = ball.velocity?.y ?? 0;
      const sp = Math.hypot(vx, vy);
      const st = speedStretch(sp, tellGain);
      e.pool.rotation = sp > 1 ? Math.atan2(vy, vx) : 0;
      e.pool.scale.set(st.along, st.across);
      e.glow.visible = true;
      e.glow.texture = tex;
      e.glow.position.set(0, 0);
      // The bake is a fixed radius; scale it to this ball's reach.
      e.glow.scale.set(light.reach / BAKE_RADIUS);
      e.glow.tint = light.color;
      e.glow.alpha = light.intensity * flick * (1 - webbed);

      e.gobo.visible = webbed > 0.001;
      if (e.gobo.visible) {
        e.gobo.texture = webPoolTex();
        e.gobo.position.set(0, 0);
        e.gobo.scale.set(light.reach / (WEB_POOL_BAKE / 2));
        e.gobo.rotation = ball.rotation * WEB_SPIN;
        e.gobo.tint = light.color;
        e.gobo.alpha = light.intensity * flick * webbed;
      }

      e.shade.visible = true;
      this.drawShadows(e.shade, light, p, game, w2s, scale, ball);
      this.note(p.x, p.y, light, scale, flick);

      // The bright core inside this ball's own shadow (flashLight.ts). It is
      // placed from the MONITOR, not from the ball's light: it is the monitor's
      // beam being focused by a translucent body, and the shadow it sits in is
      // the monitor's too.
      const causticGain = getLightLook().caustic;
      const caustic = monitor && causticGain > 0.001
        ? causticFor(ball, c, r, light.color, light.intensity * causticGain * flick, monitor)
        : null;
      if (caustic) this.place(this.emitterAt(this.live++), caustic, tex, p, game, w2s, scale, ball);

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
        this.place(this.emitterAt(this.live++), dl, tex, d, game, w2s, scale, ball, d);
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

    // ── A bounce is an event, so it makes light ─────────────────────────
    // The most frequent thing that happens in this game carried no light at
    // all: the fence bulged, the ball squished, a sound played, and the room
    // did not notice. These are already tracked per frame for the bulge, so
    // the flash is a read of state that exists rather than new bookkeeping.
    const reaction = getLightLook().reaction;
    if (reaction > 0.001) {
      for (const hit of activeWallImpacts()) {
        const env = impactEnvelope((now - hit.startTime) / IMPACT_FLASH_MS);
        if (env <= 0.001) continue;
        const at = w2s(hit.impactPoint.x, hit.impactPoint.y);
        this.place(this.emitterAt(this.live++), {
          x: at.x, y: at.y,
          reach: IMPACT_REACH_RADII * BALL_RADIUS_REF * scale * (0.6 + 0.4 * hit.strength),
          intensity: IMPACT_INTENSITY * reaction * env * hit.strength,
          color: parseColor(hit.color ?? "#ffffff"),
        }, tex, hit.impactPoint, game, w2s, scale);
      }
    }

    // ── The cut the player is drawing is hot ────────────────────────────
    // The one thing on the board that is the PLAYER's doing emitted nothing.
    // A fence grows from a point in both directions, so the light belongs at
    // the two travelling tips rather than along the line: that is where the
    // work is happening, and it is where the eye already is.
    if (reaction > 0.001) {
      for (const g of game.activeWalls ?? []) {
        if (g.isComplete) continue;
        for (const tip of [g.startPoint, g.endPoint]) {
          const at = w2s(tip.x, tip.y);
          this.place(this.emitterAt(this.live++), {
            x: at.x, y: at.y,
            reach: TIP_REACH * scale,
            intensity: TIP_INTENSITY * reaction,
            color: PALETTE.accentGlow,
          }, tex, tip, game, w2s, scale);
        }
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
    game: CanvasGameState, w2s: W2S, scale: number, skip?: Ball, derived?: DerivedLight,
  ): void {
    // Second-hand light, a caustic and a flash are all still: nothing here
    // is travelling, so the pool stays round.
    e.pool.position.set(light.x, light.y);
    e.pool.rotation = 0;
    e.pool.scale.set(1);
    e.glow.visible = true;
    e.glow.texture = tex;
    e.glow.position.set(0, 0);
    e.glow.scale.set(light.reach / BAKE_RADIUS);
    e.glow.tint = light.color;
    e.glow.alpha = light.intensity;
    e.gobo.visible = false;
    e.shade.visible = true;
    this.drawShadows(e.shade, light, world, game, w2s, scale, skip, derived);
    this.note(world.x, world.y, light, scale, 1);
  }

  /** Remember an emitter in world units. */
  private note(
    x: number, y: number, light: PlacedLight, scale: number, flick: number,
  ): void {
    const intensity = light.intensity * flick;
    if (intensity <= 0.002) return;
    this.worldLights.push({ x, y, reach: light.reach / scale, intensity, color: light.color });
  }

  /** Every wall inside this pool, as one black quad each. */
  private drawShadows(
    g: Graphics, light: PlacedLight, world: { x: number; y: number },
    game: CanvasGameState, w2s: W2S, scale: number, skip?: Ball, derived?: DerivedLight,
  ): void {
    g.clear();
    // A mirror's reflection stands BEHIND that mirror (derivedLight.ts), so the
    // mirror is the one wall on the board that must not shadow this light: it
    // sits between the light and the entire room the light exists to reach.
    // Named by owner rather than by geometry, so only the object that produced
    // the light is exempt and every other wall - including any OTHER mirror -
    // still occludes it normally.
    const exempt = derived?.owner;
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
      if (exempt && wall.id.startsWith(exempt)) continue;
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

    // ── Balls occlude each other ───────────────────────────────────────────
    // A glowing ball is still opaque - ballLight.ts says exactly that where it
    // explains the half-strength self-lit shadow - but until now only WALLS
    // were in this loop, so one ball's pool shone straight through another.
    // Two shadows on one object is the strongest single cue that a scene has
    // real lights in it rather than painted glows, and this is where it comes
    // from.
    if (getLightLook().ballShadows <= 0.001) return;
    let balls = 0;
    for (const other of game.balls) {
      // Never its own parent. For a ball's own pool that would be the ball
      // eclipsing itself; for its caustic it would be worse, since a caustic
      // is by definition the light that went THROUGH that ball.
      if (other === skip || other.state === "won") continue;
      const q = other.splatMass ?? other.renderPosition ?? other.position;
      const orad = other.radius * (other.assimScale ?? 1);
      const d = Math.hypot(q.x - world.x, q.y - world.y);
      if (d >= reach || d < orad * 0.5) continue;
      // A sphere's silhouette from a point light is a disc facing the light,
      // so its umbra is what a SEGMENT across that disc would throw. Reusing
      // shadowQuad keeps the two kinds of occluder on one piece of geometry
      // code, quad ordering and degenerate cases included.
      const c = w2s(q.x, q.y);
      const dx = c.x - light.x, dy = c.y - light.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * orad * scale, py = (dx / len) * orad * scale;
      const quad = shadowQuad(light, c.x - px, c.y - py, c.x + px, c.y + py);
      if (quad) { g.poly(quad); balls++; }
    }
    // One fill for all of them, the way wallLayer buckets its shadows by
    // alpha: they share a strength, so a single fill both costs less and stops
    // two balls whose umbras cross from double-darkening the overlap.
    if (balls > 0) g.fill({ color: PALETTE.shadow, alpha: BALL_SHADOW_ALPHA });

    this.clipToFrontOfMirror(g, light, w2s, derived);
  }

  /**
   * Black out the half of a mirror's reflection that falls BEHIND the mirror.
   *
   * The light stands at the ball's virtual image, which is behind the face, so
   * without this the back of the mirror is the brightest part of the pool and
   * the mirror reads as a window rather than a mirror. The exemption above
   * removes the mirror as an occluder; this is what replaces it, and the pair
   * is what a reflection is: light on one side of a line and none on the other.
   *
   * A half-plane rather than a cone through the mirror's ends, which is what
   * true optics would clip to. The cone is only correct for an eye at a fixed
   * point, and a board seen from above has no such eye; the half-plane says the
   * true thing for every viewer, which is that this light lives in front.
   */
  private clipToFrontOfMirror(
    g: Graphics, light: PlacedLight, w2s: W2S, derived?: DerivedLight,
  ): void {
    const face = derived?.face;
    if (!face) return;
    const a = w2s(face.ax, face.ay);
    const b = w2s(face.bx, face.by);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len, uy = dy / len;
    // Normal pointing at the light, which is the side to erase: the light is
    // behind the mirror by construction.
    let nx = -uy, ny = ux;
    if ((light.x - a.x) * nx + (light.y - a.y) * ny < 0) { nx = -nx; ny = -ny; }
    // Far enough to cover the whole pool in both directions along the face and
    // away from it, so the mask is a half-plane rather than a rectangle whose
    // corners the pool can leak past.
    const R = light.reach * 2 + len;
    const a0x = a.x - ux * R, a0y = a.y - uy * R;
    const b0x = b.x + ux * R, b0y = b.y + uy * R;
    g.poly([
      { x: a0x, y: a0y }, { x: b0x, y: b0y },
      { x: b0x + nx * R, y: b0y + ny * R }, { x: a0x + nx * R, y: a0y + ny * R },
    ]).fill({ color: PALETTE.shadow, alpha: 1 });
  }

  private emitterAt(i: number): Emitter {
    let e = this.emitters[i];
    if (!e) {
      const glow = new Sprite();
      glow.anchor.set(0.5);
      const gobo = new Sprite();
      gobo.anchor.set(0.5);
      const pool = new Container();
      pool.addChild(glow, gobo);
      const shade = new Graphics();
      this.stage.addChild(pool, shade);
      e = { pool, glow, gobo, shade };
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
