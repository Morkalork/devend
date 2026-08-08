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
import { BALL_FALLBACK, PALETTE, withAlpha } from "./palette";
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

export class SleekBallLayer {
  readonly container = new Container();

  private shadows = new Graphics();
  private bodies = new Container();
  private speculars = new Graphics();
  private sprites: Sprite[] = [];

  constructor() {
    this.container.addChild(this.shadows, this.bodies, this.speculars);
  }

  sync(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    this.shadows.clear();
    this.speculars.clear();

    const balls = game.balls.filter(b => b.state !== "dormant");

    // Grow the sprite pool to match; sprites are reused frame to frame so a
    // steady board allocates nothing.
    while (this.sprites.length < balls.length) {
      const s = new Sprite();
      s.anchor.set(0.5);
      this.bodies.addChild(s);
      this.sprites.push(s);
    }
    for (let i = balls.length; i < this.sprites.length; i++) this.sprites[i].visible = false;

    for (let i = 0; i < balls.length; i++) {
      this.drawBall(balls[i], this.sprites[i], light, w2s, scale);
    }
  }

  private drawBall(ball: Ball, sprite: Sprite, light: LightScope, w2s: W2S, scale: number): void {
    const p = ball.renderPosition ?? ball.position;
    const c = w2s(p.x, p.y);
    const r = Math.max(2, ball.radius * scale * (ball.assimScale ?? 1));

    // Bearing toward the monitor: everything below orients off this.
    const bearing = Math.atan2(light.y - c.y, light.x - c.x);

    // ── Cast shadow: an ellipse, squashed across the light bearing ──────────
    const cast = shadowFor(light, c.x, c.y, r);
    const sx = c.x + cast.dx * cast.length;
    const sy = c.y + cast.dy * cast.length;
    this.shadows
      .ellipse(sx, sy, r * 1.02, r * 0.72)
      .fill({ color: PALETTE.shadow, alpha: cast.alpha });

    // ── Contact crescent, hard against the shaded limb ──────────────────────
    const contact = contactFor(light, c.x, c.y, r);
    this.shadows
      .ellipse(
        c.x + contact.dx * contact.length,
        c.y + contact.dy * contact.length,
        r * 0.95,
        r * 0.68,
      )
      .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.45 });

    // ── Body ────────────────────────────────────────────────────────────────
    const rb = bucket(r);
    sprite.visible = true;
    sprite.texture = sphereTexture(parseColor(ball.color), rb);
    sprite.position.set(c.x, c.y);
    // Scale the bucketed bake back to the exact radius, and rotate so the baked
    // highlight points at the monitor.
    sprite.scale.set(r / rb);
    sprite.rotation = bearing;
    // Locked balls dim toward the captured substrate they now belong to.
    sprite.alpha = ball.state === "won" ? 0.72 : 1;

    // ── Specular ────────────────────────────────────────────────────────────
    if (ball.state === "won") return;
    const hx = c.x + Math.cos(bearing) * r * 0.42;
    const hy = c.y + Math.sin(bearing) * r * 0.42;
    this.speculars
      .circle(hx, hy, Math.max(0.8, r * 0.17))
      .fill({ color: PALETTE.monitor, alpha: 0.5 * light.level });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
