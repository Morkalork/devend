/**
 * Balls, as lamps.
 *
 * They used to be spheres lit BY the monitor: a highlight baked toward one
 * edge, the sprite rotated so that highlight always faced the light, and a dark
 * terminator on the limb curving away from it. That is the correct way to draw
 * an object in a scene with one light, and it is the wrong way to draw the
 * thing the player is tracking on a board everyone called too dark. It made the
 * ball a surface that RECEIVED light, so a third of every ball was the darkest
 * pixel on it.
 *
 * A ball now has a bulb in it. That single decision is what the rest of this
 * file follows from:
 *
 *   NO TERMINATOR   the gradient is brightest in the middle and never goes
 *     dark, because a lamp has no shaded side. This is what makes the ball
 *     easier to see, which was the point.
 *   NO ROTATION     the bulb is centred, so the sprite has no direction to aim.
 *     The whole "rotate the sprite, counter-rotate inside the squash" dance
 *     existed only to keep a baked highlight pointed at the monitor, and it is
 *     gone with the highlight.
 *   NO SPECULAR     a hot spot on the limb facing the monitor says "this object
 *     is lit from over there", which is the opposite of what a lamp says.
 *   A CORONA        an additive bloom hugging the rim, drawn OVER the body and
 *     over whatever the ball is passing. Without it a bright disc reads as a
 *     bright disc; the bleed past its own edge is what reads as emitting.
 *
 * Its shadow stays, softened. A glowing ball is still opaque and still blocks
 * the monitor, and without a shadow it floats off the board - but a lamp fills
 * in its own shadow, and a hard dark ellipse beside a bulb looks like a mistake.
 *
 * The light this ball throws ONTO the board is a separate pass (ballLightPass),
 * because that has to be occluded by walls and this does not.
 *
 * Parts, cheapest first: cast shadow and contact, the baked bulb body, the
 * corona, then the informational overlays (frost, rings, splash) that are not
 * lighting at all.
 */
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { getSquishEffect, getWallHitEffect, getBallHitEffect } from "@/lib/ballEffects";
import { bossSplashFrame } from "@/lib/rendering/bossSplash";
import { BALL_FALLBACK, PALETTE, mix, withAlpha } from "./palette";
import { CORONA_RADII, bulbStops, coronaStops } from "./bulb";
import { contactFor, shadowFor, type LightScope } from "./light";
import { compassRing } from "./compassRing";
import { ballTrail } from "./ballTrail";
import type { Pt } from "./pixelGrid";
import {
  markFor, markColor, markWidth, MARK_MIN_RADIUS_PX,
} from "@/lib/rendering/sleek/ballMark";

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
 * Bake a bulb: white-hot in the middle, the ball's colour through the body, and
 * still lit at the rim.
 *
 * Centred, so callers never rotate it. The old bake put the highlight at a
 * fixed offset and rotated the sprite to aim it, which cost nothing but bought
 * an effect this no longer wants.
 *
 * The last stop is the one that matters: it used to be PALETTE.shadow at 0.88,
 * the terminator of a sphere turning away from the light. A lamp has no such
 * edge, so the rim stays the ball's own colour and the corona takes over from
 * there. Nothing on a ball is darker than the board it sits on any more.
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

  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  for (const stop of bulbStops(color)) grad.addColorStop(stop.offset, withAlpha(stop.color, stop.alpha));

  ctx.beginPath();
  ctx.arc(radius, radius, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const tex = Texture.from(canvas);
  sphereCache.set(key, tex);
  return tex;
}

/**
 * How much of its monitor shadow a self-lit ball keeps.
 *
 * Set by looking at it. Half was still too much: a bulb's own pool washes the
 * floor right where its monitor shadow falls, so at anything near full strength
 * the shadow reads as a dark smudge stuck to the ball rather than as shading.
 * Not zero, though - without a shadow the ball floats off the board, and it is
 * still an opaque object between the monitor and the floor.
 */
export const SELF_LIT_SHADOW = 0.35;

/** Corona bake radius, in texture pixels. Scaled per ball by the sprite. */
const CORONA_BAKE = 96;
let coronaTexture: Texture | null = null;

/**
 * The bloom around a bulb: nothing at the centre, peaking exactly at the ball's
 * edge, gone by the outside.
 *
 * Zero in the middle ON PURPOSE. This is drawn additively OVER the body, so any
 * brightness here would blow the ball out to white and throw away the colour
 * that tells the player which ball it is. The peak sits at 1/CORONA_RADII of
 * the texture, which is exactly where the ball's edge lands.
 *
 * One texture for every ball, tinted per colour: a white radial tinted is
 * exactly the coloured version of itself, which is not true of the body bake.
 */
function coronaTex(): Texture {
  if (coronaTexture) return coronaTexture;
  const size = CORONA_BAKE * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (coronaTexture = Texture.WHITE);

  const g = ctx.createRadialGradient(
    CORONA_BAKE, CORONA_BAKE, 0, CORONA_BAKE, CORONA_BAKE, CORONA_BAKE,
  );
  for (const stop of coronaStops()) g.addColorStop(stop.offset, `rgba(255,255,255,${stop.alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  coronaTexture = Texture.from(canvas);
  return coronaTexture;
}

/** Drop every baked sphere (level change / resize). */
export function clearSphereCache(): void {
  for (const t of sphereCache.values()) t.destroy(true);
  sphereCache.clear();
  coronaTexture?.destroy(true);
  coronaTexture = null;
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
  /** Additive bloom at the rim, in its own layer above every body. */
  corona: Sprite;
}

export class SleekBallLayer {
  readonly container = new Container();

  /**
   * Motion smears, UNDER the bodies: a trail drawn over its own ball would sit
   * on the lit sphere and flatten it.
   */
  private trails = new Graphics();
  private bodies = new Container();
  /**
   * Every corona, in ONE additive layer above every body.
   *
   * Above, so a ball's bloom spills over the fence or obstacle it is passing,
   * which is what a light does and what a glow drawn underneath cannot. One
   * shared layer rather than a child of each ball, so two balls close together
   * add their blooms together instead of the later one painting over the
   * earlier one's.
   */
  private coronas = new Container();
  /** Frost + fastest-ball ring: informational marks drawn over the bodies. */
  private overlays = new Graphics();
  private views: BallView[] = [];
  /** The renderer's shared floor plane, set each frame in sync(). */
  private shadows!: Graphics;
  private fastestId: string | null = null;
  private now = 0;

  constructor() {
    // No shadow child: cast shadows go to the renderer's shared floor plane.
    this.container.addChild(this.trails, this.bodies, this.coronas, this.overlays);
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

      const corona = new Sprite();
      corona.anchor.set(0.5);
      corona.blendMode = "add";
      this.coronas.addChild(corona);

      this.views.push({ holder, sprite, corona });
    }
    for (let i = balls.length; i < this.views.length; i++) {
      this.views[i].holder.visible = false;
      this.views[i].corona.visible = false;
    }

    this.trails.clear();
    for (let i = 0; i < balls.length; i++) {
      this.drawBall(balls[i], this.views[i], light, w2s, scale, game.activePlaySeconds);
    }
  }

  /**
   * The compass ball's countdown: a ring that unwinds toward its next quarter
   * turn, and leans the way it is going to turn.
   *
   * A ring rather than a numeral because a ball is 18 world units across, which
   * is eight to sixteen screen pixels on a phone: a digit in there is not
   * legible, and for most of a nine-second cycle it would not be actionable
   * either. An arc reads at any size and from across the board.
   *
   * Driven from turnProgress, which is the same function the turn itself uses,
   * so the ring cannot unwind on a different clock from the event it promises.
   * A countdown that disagrees with what it counts down to is worse than none.
   *
   * The geometry lives in compassRing.ts, which hands back the arc's starting
   * point so this cannot forget to open a subpath on it. See the note there.
   */
  private drawTurnRing(
    ball: Ball, c: Pt, r: number, scale: number, activeSeconds: number,
  ): void {
    const ring = compassRing(ball, c.x, c.y, r, scale, activeSeconds);
    if (!ring) return;

    // Stroked as an explicit polyline, NOT with arc(). compassRing.ts has the
    // long version; the short one is that arc() both continues whatever path is
    // open AND leaves a corrupt "last point" behind it (Pixi reads a plain
    // arc's data as if it were an arcToSvg), which every later mark on this
    // SHARED Graphics then inherits. moveTo + lineTo has neither problem, and
    // the ring is flattened to the same steps Pixi used, so it looks identical.
    const pts = ring.points;
    this.overlays.moveTo(pts[0], pts[1]);
    for (let i = 2; i + 1 < pts.length; i += 2) {
      this.overlays.lineTo(pts[i], pts[i + 1]);
    }
    this.overlays
      .stroke({
        width: Math.max(1.5, 2.2 * scale),
        // Reddens as it runs out: the last second should catch the eye of a
        // player who is looking somewhere else entirely, which is exactly when
        // this ball is about to punish them.
        color: ring.urgent ? PALETTE.danger : PALETTE.compassRing,
        alpha: 0.9,
        cap: "round",
      });
  }

  /**
   * The ability mark: what this ball DOES, said without using its colour.
   *
   * Ball identity was hue and nothing else, and hue is the channel that fails
   * in daylight, on the dark maps the game now offers on purpose, and for the
   * ~8% of men with a colour vision deficiency - for whom purple and compass
   * measure 4.6 apart in CIELAB, against the ~15 where two colours stop being
   * confusable. See ballMark.ts for the shapes and why they are so plain.
   *
   * Drawn into `overlays` rather than onto the holder, like the frost and the
   * collision halos, so it stays upright while the body squashes and spins.
   * A mark that rolled with the ball would be unreadable exactly when the ball
   * is doing something worth reading.
   */
  private drawMark(ball: Ball, c: Pt, r: number): void {
    // Too small to resolve: a mark that cannot hold its shape is not a faint
    // mark, it is a smudge, and it reads as damage to the ball.
    if (r < MARK_MIN_RADIUS_PX) return;
    const strokes = markFor(ball.ability);
    if (!strokes) return;

    const color = markColor(ball.color);
    const width = markWidth(r);
    for (const st of strokes) {
      if (st.kind === "dot") {
        this.overlays
          .circle(c.x + st.at[0] * r, c.y + st.at[1] * r, st.r * r)
          .fill({ color, alpha: 0.92 });
      } else {
        // moveTo first, for the same reason drawTurnRing does: Pixi continues
        // the current path, so without opening a subpath every mark would be
        // joined to the previous ball's by a line across the board.
        this.overlays.moveTo(c.x + st.pts[0][0] * r, c.y + st.pts[0][1] * r);
        for (let i = 1; i < st.pts.length; i++) {
          this.overlays.lineTo(c.x + st.pts[i][0] * r, c.y + st.pts[i][1] * r);
        }
        if (st.close) this.overlays.lineTo(c.x + st.pts[0][0] * r, c.y + st.pts[0][1] * r);
        this.overlays.stroke({ width, color, alpha: 0.92, cap: "round", join: "round" });
      }
    }
  }

  private drawBall(
    ball: Ball, view: BallView, light: LightScope, w2s: W2S, scale: number,
    activeSeconds: number,
  ): void {
    const { holder, sprite, corona } = view;
    const p = ball.renderPosition ?? ball.position;
    const c = w2s(p.x, p.y);
    const r = Math.max(2, ball.radius * scale * (ball.assimScale ?? 1));

    // The smear first, so the sphere lands on top of its own blur.
    const trail = ballTrail(ball, c, r, scale, this.now);
    if (trail) {
      this.trails
        .moveTo(trail.from.x, trail.from.y)
        .lineTo(trail.to.x, trail.to.y)
        .stroke({
          width: trail.width,
          color: parseColor(ball.color),
          alpha: trail.alpha,
          cap: "round",
        });
    }

    const dormant = ball.state === "dormant";

    // ── Cast shadow + contact ───────────────────────────────────────────────
    // Skipped while dormant: a sleeper is not yet part of the scene, and seating
    // it on the board with a shadow makes it read as a live ball to be locked.
    if (!dormant) {
      // SELF_LIT_SHADOW: a lamp fills in its own shadow. The shadow still has
      // to exist (a glowing ball is still opaque, and without one it floats off
      // the board), but at full strength a hard dark ellipse beside a bulb
      // reads as a mistake rather than as shading.
      const cast = shadowFor(light, c.x, c.y, r);
      this.shadows
        .ellipse(c.x + cast.dx * cast.length, c.y + cast.dy * cast.length, r * 1.02, r * 0.72)
        .fill({ color: PALETTE.shadow, alpha: cast.alpha * SELF_LIT_SHADOW });

      const contact = contactFor(light, c.x, c.y, r);
      this.shadows
        .ellipse(
          c.x + contact.dx * contact.length,
          c.y + contact.dy * contact.length,
          r * 0.95,
          r * 0.68,
        )
        .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.45 * SELF_LIT_SHADOW });
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
    // the envelope; this only draws it). Applied to the HOLDER, and the sprite
    // inherits the non-uniform scale, so the bulb smears with the deformation
    // and reads as a soft ball rather than a scaled disc.
    //
    // The sprite itself is never rotated now. It used to be, in both branches,
    // purely to keep a baked highlight aimed at the monitor while the holder
    // turned to the impact axis. The bulb is centred and radially symmetric, so
    // there is no direction left to preserve and the counter-rotation went with
    // the highlight it existed for.
    const squish = getSquishEffect(ball.effects, ball.isBoss ? 0.5 : 1);
    if (squish.active) {
      holder.rotation = Math.atan2(squish.ny, squish.nx);
      holder.scale.set(squish.scaleAlong, squish.scalePerp);
    } else {
      holder.rotation = 0;
      holder.scale.set(1, 1);
    }

    // ── Corona ──────────────────────────────────────────────────────────────
    // The bleed past the ball's own edge. A bright disc reads as a bright disc;
    // this is the part that reads as emitting. It follows the body's dimming,
    // so a sleeper is an unlit bulb and a locked ball goes out as it drains.
    corona.visible = !dormant && sprite.alpha > 0.01;
    if (corona.visible) {
      corona.texture = coronaTex();
      corona.position.set(c.x, c.y);
      corona.scale.set((r * CORONA_RADII) / CORONA_BAKE);
      // Whitened like the light pool, for the same reason: a pure hue bloom
      // over a pure hue ball is invisible, and it is the WHITENING that reads
      // as heat.
      corona.tint = mix(bodyColor, 0xffffff, 0.4);
      corona.alpha = sprite.alpha;
    }

    // The ability mark rides on top of the body, including on a sleeper: what a
    // dormant ball will be once a fence wakes it is exactly what the player
    // needs to know while deciding whether to route through its terminal. Not
    // on a locked ball, which is draining toward the accent and has stopped
    // being a thing you can act on.
    if (ball.state !== "won") this.drawMark(ball, c, r);

    if (ball.state === "won" || dormant) return;

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

    // The compass countdown, last so it sits over the ball it belongs to.
    this.drawTurnRing(ball, c, r, scale, activeSeconds);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
