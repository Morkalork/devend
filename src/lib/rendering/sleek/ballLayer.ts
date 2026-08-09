/**
 * Balls, lit as spheres by the shared scope.
 *
 * A ball is the one object on the board that is unambiguously round, so it is
 * where the light either convinces or doesn't. Four parts, cheapest first:
 *
 *   ELLIPSE SHADOW - cast up-left and flattened perpendicular to the light
 *     bearing, because a sphere's shadow on a flat surface is an ellipse, not a
 *     circle. This one detail does most of the work of seating the ball.
 *   CONTACT        - a tight dark crescent hugging the shaded limb.
 *   BODY           - a baked sphere gradient, rotated per ball so the highlight
 *     always faces the monitor no matter where the ball sits.
 *   SPECULAR       - a small hot spot on the lit limb, flicker-modulated.
 *
 * The body gradient is baked ONCE per (colour, radius) into a texture and then
 * reused: the highlight direction is applied by rotating the sprite, not by
 * re-baking, so a board full of balls costs one texture per distinct ball type.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { getSquishEffect, getWallHitEffect, getBallHitEffect } from "@/lib/ballEffects";
import { bossSplashFrame } from "@/lib/rendering/bossSplash";
import { BALL_FALLBACK, PALETTE, mix, withAlpha } from "./palette";
import { contactFor, shadowFor, type LightScope } from "./light";
import type { Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** Baked sphere textures, keyed by colour + rounded radius bucket. */
const sphereCache = new Map<string, Texture>();

/** Radii are bucketed so a ball that grows smoothly doesn't rebake every frame. */
function bucket(r: number): number {
  return Math.max(4, Math.round(r / 2) * 2);
}

function parseColor(c: string): number {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : BALL_FALLBACK;
}

/**
 * Bake a lit sphere: the highlight sits at a FIXED offset (up-right in texture
 * space) and callers rotate the sprite so it points at the light. Baking the
 * direction in would mean one texture per position, which is unaffordable.
 */
function sphereTexture(color: number, radius: number): Texture {
  const key = `${color}:${radius}`;
  const cached = sphereCache.get(key);
  if (cached) return cached;

  const size = radius * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;

  // Highlight offset toward the texture's +x axis; the sprite's rotation aims it.
  const hx = radius + radius * 0.38;
  const hy = radius;
  const grad = ctx.createRadialGradient(hx, hy, radius * 0.05, radius, radius, radius);
  grad.addColorStop(0, withAlpha(0xffffff, 0.92));
  grad.addColorStop(0.18, withAlpha(color, 1));
  grad.addColorStop(0.72, withAlpha(color, 1));
  // The terminator: the limb curving away from the light, not a black ring.
  grad.addColorStop(1, withAlpha(PALETTE.shadow, 0.88));

  ctx.beginPath();
  ctx.arc(radius, radius, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const tex = Texture.from(canvas);
  sphereCache.set(key, tex);
  return tex;
}

/** Drop every baked sphere (level change / resize). */
export function clearSphereCache(): void {
  for (const t of sphereCache.values()) t.destroy(true);
  sphereCache.clear();
}

/**
 * One ball's display objects.
 *
 * The squash needs its own transform, because the SPRITE's rotation is already
 * spent aiming the baked highlight at the monitor. So each ball is a holder
 * carrying the deformation (rotated to the impact axis, scaled non-uniformly)
 * with the lit sphere nested inside it, counter-rotated so the highlight still
 * points at the light. The child inherits the parent's non-uniform scale, which
 * is exactly right: a squashed ball's highlight should smear with it.
 */
interface BallView {
  holder: Container;
  sprite: Sprite;
}

export class SleekBallLayer {
  readonly container = new Container();

  private bodies = new Container();
  private speculars = new Graphics();
  /** Frost + fastest-ball ring: informational marks drawn over the bodies. */
  private overlays = new Graphics();
  private views: BallView[] = [];
  /** The renderer's shared floor plane, set each frame in sync(). */
  private shadows!: Graphics;
  private fastestId: string | null = null;
  private now = 0;

  constructor() {
    // No shadow child: cast shadows go to the renderer's shared floor plane.
    this.container.addChild(this.bodies, this.speculars, this.overlays);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    shadows: Graphics,
    w2s: W2S,
    scale: number,
    now: number,
  ): void {
    this.shadows = shadows;
    this.speculars.clear();
    this.overlays.clear();
    this.fastestId = game.fastestBallId;
    this.now = now;

    // Dormant balls MUST be drawn. They are the whole point of the circuit maps
    // (#73): an un-booted sleeper reserves space you cannot clear until you
    // route a fence through its terminal to wake it. Filtering them out (as this
    // layer originally did) leaves the player staring at territory that refuses
    // to be captured with nothing on screen explaining why.
    const balls = game.balls;

    // Grow the pool to match; views are reused frame to frame so a steady board
    // allocates nothing.
    while (this.views.length < balls.length) {
      const holder = new Container();
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      holder.addChild(sprite);
      this.bodies.addChild(holder);
      this.views.push({ holder, sprite });
    }
    for (let i = balls.length; i < this.views.length; i++) this.views[i].holder.visible = false;

    for (let i = 0; i < balls.length; i++) {
      this.drawBall(balls[i], this.views[i], light, w2s, scale);
    }
  }

  private drawBall(ball: Ball, view: BallView, light: LightScope, w2s: W2S, scale: number): void {
    const { holder, sprite } = view;
    const p = ball.renderPosition ?? ball.position;
    const c = w2s(p.x, p.y);
    const r = Math.max(2, ball.radius * scale * (ball.assimScale ?? 1));

    const dormant = ball.state === "dormant";
    // Bearing toward the monitor: everything below orients off this.
    const bearing = Math.atan2(light.y - c.y, light.x - c.x);

    // ── Cast shadow + contact ───────────────────────────────────────────────
    // Skipped while dormant: a sleeper is not yet part of the scene, and seating
    // it on the board with a shadow makes it read as a live ball to be locked.
    if (!dormant) {
      const cast = shadowFor(light, c.x, c.y, r);
      this.shadows
        .ellipse(c.x + cast.dx * cast.length, c.y + cast.dy * cast.length, r * 1.02, r * 0.72)
        .fill({ color: PALETTE.shadow, alpha: cast.alpha });

      const contact = contactFor(light, c.x, c.y, r);
      this.shadows
        .ellipse(
          c.x + contact.dx * contact.length,
          c.y + contact.dy * contact.length,
          r * 0.95,
          r * 0.68,
        )
        .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.45 });
    }

    // ── Dormant: asleep, not gone ───────────────────────────────────────────
    // Dimmed and wrapped in a breathing teal cage, matching the circuit
    // terminals' colour so the link between sleeper and terminal is readable at
    // a glance. It casts no shadow and takes no specular below: it is not yet a
    // participant in the scene, and lighting it like one would make it read as a
    // live ball the player could lock.
    if (dormant) {
      const tp = 0.5 + 0.5 * Math.sin(this.now / 600);
      this.overlays
        .circle(c.x, c.y, r + 5 * scale)
        .stroke({ width: Math.max(1.5, 2 * scale), color: PALETTE.areaConst, alpha: 0.3 + 0.3 * tp });
      this.overlays
        .circle(c.x, c.y, r + 10 * scale)
        .stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.areaConst, alpha: 0.15 + 0.2 * tp });
    }

    // ── Body ────────────────────────────────────────────────────────────────
    const rb = bucket(r);
    holder.visible = true;
    holder.position.set(c.x, c.y);
    // While a lock plays out the ball drains toward the accent, so it visibly
    // becomes part of the territory it just created rather than simply stopping.
    // BUCKET the fade before blending. assimColorFade is a continuous 0->1 clock
    // over the ~2s lock fade, and sphereTexture caches per colour - so an
    // unbucketed blend bakes a fresh texture nearly every frame, per locking
    // ball. 13 steps is visually indistinguishable from continuous and bounds
    // the cache to at most 13 extra bakes for the whole clear.
    const fadeRaw = ball.assimColorFade ?? 0;
    const fade = fadeRaw > 0 ? Math.round(Math.min(1, fadeRaw) * 12) / 12 : 0;
    const bodyColor = fade > 0
      ? mix(parseColor(ball.color), PALETTE.accent, fade)
      : parseColor(ball.color);
    sprite.texture = sphereTexture(bodyColor, rb);
    sprite.position.set(0, 0);
    // Scale the bucketed bake back to the exact radius.
    sprite.scale.set(r / rb);
    // Locked balls dim toward the captured substrate they now belong to.
    sprite.alpha = dormant ? 0.5 : ball.state === "won" ? 0.72 : 1;

    // ── Squash & stretch ────────────────────────────────────────────────────
    // The ball flattens along the impact normal and springs back (physics owns
    // the envelope; this only draws it). Applied to the HOLDER so the sphere
    // keeps its own rotation for the highlight - and because the child inherits
    // the squash, the highlight smears with the deformation, which is what makes
    // it read as a soft ball rather than a scaled sprite.
    const squish = getSquishEffect(ball.effects, ball.isBoss ? 0.5 : 1);
    if (squish.active) {
      const impact = Math.atan2(squish.ny, squish.nx);
      holder.rotation = impact;
      holder.scale.set(squish.scaleAlong, squish.scalePerp);
      // Counter-rotate so the highlight still faces the monitor in world space.
      sprite.rotation = bearing - impact;
    } else {
      holder.rotation = 0;
      holder.scale.set(1, 1);
      sprite.rotation = bearing;
    }

    // ── Specular ────────────────────────────────────────────────────────────
    if (ball.state === "won" || dormant) return;
    // Drawn in screen space, so it has to be deformed by hand - otherwise the
    // hot spot floats off the surface of a squashed ball. Rotate the offset into
    // the impact frame, scale it, rotate back.
    let ox = Math.cos(bearing) * r * 0.42;
    let oy = Math.sin(bearing) * r * 0.42;
    if (squish.active) {
      const ca = squish.nx, sa = squish.ny;
      const along = ox * ca + oy * sa;
      const perp = -ox * sa + oy * ca;
      const a2 = along * squish.scaleAlong;
      const p2 = perp * squish.scalePerp;
      ox = a2 * ca - p2 * sa;
      oy = a2 * sa + p2 * ca;
    }
    this.speculars
      .circle(c.x + ox, c.y + oy, Math.max(0.8, r * 0.17))
      .fill({ color: PALETTE.monitor, alpha: 0.5 * light.level });

    // ── Frost: this ball is held by a tap-freeze ────────────────────────────
    // Informational, not decorative - a frozen ball is one the player has spent
    // a charge on and is planning a cut around, so it has to be unmistakable.
    if (ball.frozenUntil !== undefined && this.now < ball.frozenUntil) {
      this.overlays
        .circle(c.x, c.y, r * 1.12)
        .stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.frost, alpha: 0.85 });
      // Crystal spokes, so it reads as frozen rather than merely outlined.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 12;
        this.overlays
          .moveTo(c.x + Math.cos(a) * r * 0.45, c.y + Math.sin(a) * r * 0.45)
          .lineTo(c.x + Math.cos(a) * r * 1.05, c.y + Math.sin(a) * r * 1.05);
      }
      this.overlays.stroke({ width: Math.max(1, scale), color: PALETTE.frost, alpha: 0.55 });
    }

    // ── Collision halos ─────────────────────────────────────────────────────
    // An expanding ring on impact: wall hits and ball-to-ball hits get their own,
    // the latter larger and brighter because it is the rarer, more consequential
    // event. This is feedback, not decoration - it is how a hit you did not see
    // coming announces itself - so it is drawn over the body rather than lit.
    const wallHit = getWallHitEffect(ball.effects);
    if (wallHit.active) {
      this.overlays
        .circle(c.x, c.y, r * wallHit.ringRadius)
        .stroke({
          width: Math.max(1, wallHit.ringWidth * scale),
          color: parseColor(ball.color),
          alpha: wallHit.glowAlpha,
        });
    }
    const ballHit = getBallHitEffect(ball.effects, this.now);
    if (ballHit.active) {
      this.overlays
        .circle(c.x, c.y, r * ballHit.ringRadius)
        .stroke({
          width: Math.max(1, 2 * scale),
          color: parseColor(ball.color),
          alpha: ballHit.glowAlpha,
        });
    }

    // ── Fastest ball: the one the trajectory tracks and the danger frame means.
    if (ball.id === this.fastestId && ball.state === "active") {
      this.overlays
        .circle(c.x, c.y, r + 6 * scale)
        .stroke({ width: Math.max(1, 2 * scale), color: PALETTE.mirror, alpha: 0.55 });
    }

    // ── Boss splash: a minion budding out of the boss ───────────────────────
    // Droplets thrown from the boss rim along the birth direction, so a spawn
    // reads as something being EXPELLED rather than a ball appearing from
    // nowhere. Frame geometry comes from the shared bossSplashFrame.
    if (ball.splitAnimAt !== undefined) {
      const dir = ball.splitDirX !== undefined && ball.splitDirY !== undefined
        ? { x: ball.splitDirX, y: ball.splitDirY }
        : { x: 1, y: 0 };
      const frame = bossSplashFrame(
        r, dir.x, dir.y, ball.splitAnimAt, this.now, scale,
        ball.id.charCodeAt(ball.id.length - 1) || 1,
      );
      if (frame.active) {
        const color = parseColor(ball.color);
        // The rupture ring is the tell that the boss SPLIT rather than that a
        // ball drifted past; droplets alone read as ambient particles.
        if (frame.ringAlpha > 0) {
          this.overlays
            .circle(c.x + frame.ringX, c.y + frame.ringY, Math.max(0.5, frame.ringR))
            .stroke({ width: Math.max(1, frame.ringWidth), color, alpha: frame.ringAlpha });
        }
        for (const d of frame.droplets) {
          this.overlays.circle(c.x + d.x, c.y + d.y, Math.max(0.5, d.r)).fill({ color, alpha: d.alpha });
          this.overlays
            .circle(c.x + d.x + d.hx, c.y + d.y + d.hy, Math.max(0.3, d.r * 0.35))
            .fill({ color: 0xffffff, alpha: d.alpha * 0.6 });
        }
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
