/**
 * Transient effects: the lock flash, chains, collapse debris and falling slabs.
 *
 * These are the moments the board rewards or punishes you, so they are the one
 * place the renderer is allowed to be loud. They are still bound by the light
 * model, with one deliberate exception: a lock flash EMITS. For the second it
 * burns it is the brightest thing on the board and takes no ambient dimming,
 * because it is the payoff for the whole loop.
 *
 * Everything here is culled by the physics layer; this module only draws what
 * it is handed and never mutates game state.
 */

import { Container, Graphics } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
// Imported, never re-declared: these govern how long the physics keeps a marker
// alive, and a local copy that drifts makes markers disappear early.
import { PICKUP_DRAW_RADIUS, PICKUP_FEEDBACK_MS } from "@/lib/pickups";
import { computeBallTrajectory, trajectoryBallSnapshots, buildTrajectorySegments } from "@/lib/gameUtils";
import { dashedLine } from "./dashedLine";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { vec2Sub, vec2Length, vec2Normalize } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { ambientAt, shadowFor, type LightScope } from "./light";
import type { Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** How long a lock flash burns. Mirrors the classic renderer's feel. */
const LOCK_FLASH_MS = 900;
const SUPERIOR_FLASH_MS = 1500;
/**
 * Magnet marker lifetime. Not exported from anywhere shared - the physics culls
 * the marker on its own clock - so this must stay 1100 to match. Guessing it
 * shorter makes the marker vanish while the state says it is still live.
 */
const MAGNET_MARKER_MS = 1100;

/** Token colours, mirroring propLayer so a claim ring matches its token. */
const PICKUP_FX_COLORS: Record<string, number> = {
  overtime: 0x00ff88,
  capRaise: 0xffd76b,
  freezeCharge: 0xbfefff,
  fork: 0xff9ebf,
  freeShopItem: 0x9fe6ff,
  extraLife: 0xff5b7a,
  rainbowConvert: 0xffbf80,
};

function parseColor(c: string, fallback: number): number {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : fallback;
}

export class FxLayer {
  readonly container = new Container();

  private under = new Graphics();  // pocket fills, below the actors
  private over = new Graphics();   // sparks, chains, debris

  constructor() {
    this.container.addChild(this.under, this.over);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    mods: GameModifiers,
    w2s: W2S,
    scale: number,
    now: number,
  ): void {
    this.under.clear();
    this.over.clear();

    this.drawCutPreview(game, w2s, scale);
    this.drawLockFlashes(game, w2s, scale, now);
    this.drawChains(game, light, w2s, scale);
    this.drawDebris(game, w2s, scale, now);
    this.drawFalling(game, light, w2s, now);
    this.drawAbilityFx(game, w2s, scale, now);
    this.drawMagnetMarker(game, w2s, scale, now);
    this.drawPickupFeedback(game, w2s, scale, now);
    this.drawLockMarkers(game, w2s, scale);
    this.drawBallPops(game, w2s, scale, now);
    this.drawTrajectory(game, mods, w2s, scale);
  }

  /**
   * Banked power-up badges: a dot per power-up a lock claimed, left in the
   * pocket for the rest of the map. Persistent, not transient - the point is to
   * be able to look at a sealed pocket later and see what it paid.
   */
  private drawLockMarkers(game: CanvasGameState, w2s: W2S, scale: number): void {
    for (const m of game.pickupLockMarkers ?? []) {
      const p = w2s(m.x, m.y);
      const color = PICKUP_FX_COLORS[m.effect] ?? PALETTE.amber;
      // Brief pop-in on the active-play clock, so it lands with the lock.
      const age = game.activePlaySeconds - m.bornActiveSeconds;
      const pop = age < 0.35 ? 0.5 + (age / 0.35) * 0.5 : 1;
      const r = 5 * scale * pop;
      this.under.circle(p.x, p.y, r * 1.9).fill({ color, alpha: 0.16 });
      this.under.circle(p.x, p.y, r).fill({ color, alpha: 0.9 });
    }
  }

  /** A white "tappable" ball was tapped away: a quick expanding pop. */
  private drawBallPops(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const pop of game.ballPops ?? []) {
      const t = (now - pop.startTime) / 420;
      if (t < 0 || t >= 1) continue;
      const p = w2s(pop.x, pop.y);
      const color = parseColor(pop.color, 0xffffff);
      this.over
        .circle(p.x, p.y, (6 + 26 * t) * scale)
        .stroke({ width: Math.max(1, 2 * scale), color, alpha: (1 - t) * 0.9 });
      this.over
        .circle(p.x, p.y, Math.max(0.5, 6 * scale * (1 - t)))
        .fill({ color, alpha: (1 - t) * 0.8 });
    }
  }

  /**
   * Trajectory prediction (the SCRUM Master modifier): where the tracked balls
   * are heading, bounces included. Dashed rather than solid, because it is a
   * forecast - a solid line would read as geometry that already exists.
   *
   * Both the bounce count and how many balls are tracked come from the upgrade,
   * so this is off entirely unless the player bought it.
   */
  private drawTrajectory(
    game: CanvasGameState,
    mods: GameModifiers,
    w2s: W2S,
    scale: number,
  ): void {
    const bounces = mods.ballPathPredictionBounces;
    const maxBalls = mods.ballPathPredictionBalls;
    if (bounces <= 0 || maxBalls <= 0) return;

    const active = game.balls
      .filter(b => b.state === "active")
      .sort((a, b) => b.speed - a.speed);
    const tracked = maxBalls >= 100 ? active : active.slice(0, maxBalls);

    // Built ONCE for the frame, not once per tracked ball: the surfaces are
    // identical for every prediction, and rebuilding them per ball made the cost
    // and the garbage scale with balls x segments for no difference in result.
    const segs = buildTrajectorySegments(game.walls, game.obstaclePolygons);

    for (const ball of tracked) {
      // Start from the RENDER position, not the physics one, so the line begins
      // exactly at the drawn ball rather than a step ahead of it.
      const start = ball.renderPosition ?? ball.position;
      const wps = computeBallTrajectory(
        start, ball.velocity, game.walls, bounces, ball.radius,
        game.obstaclePolygons, game.movers, game.creepFactor || 1,
        trajectoryBallSnapshots(game.balls, ball, game.frozenBallId),
        segs,
        // Gravity maps curve, so the preview curves with them (issue #77).
        game.gravityConfig ? { cfg: game.gravityConfig, atSeconds: game.activePlaySeconds } : null,
      );
      if (wps.length < 2) continue;
      for (let i = 0; i < wps.length - 1; i++) {
        const a = w2s(wps[i].x, wps[i].y);
        const b = w2s(wps[i + 1].x, wps[i + 1].y);
        dashedLine(this.over, a.x, a.y, b.x, b.y, 6 * scale, 8 * scale);
      }
    }
    this.over.stroke({ width: Math.max(1, 2 * scale), color: PALETTE.accent, alpha: 0.5, cap: "round" });
  }

  /**
   * Ability fired: a board-wide flash plus staggered rings.
   *
   * The flash exists because an ability can fire and change nothing the player
   * can see (one ball, already cornered), and "did that work?" is a terrible
   * thing for a spent charge to leave behind. Rings expand for most abilities
   * and CONVERGE for Magnet, matching the direction of the thing they describe.
   *
   * Pure UI, so no lighting: this is the interface confirming an input.
   */
  private drawAbilityFx(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const list = game.abilityFx;
    if (!list || list.length === 0) return;
    const { boardRect } = game;
    const maxR = 0.6 * Math.hypot(boardRect.width, boardRect.height);
    let expired = false;

    for (const fx of list) {
      const elapsed = now - fx.startTime;
      if (elapsed >= fx.durationMs) { expired = true; continue; }
      const t = elapsed / fx.durationMs;
      const color = parseColor(fx.color, PALETTE.accent);

      this.over
        .rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height)
        .fill({ color, alpha: 0.2 * (1 - t) });

      const c = w2s(fx.center.x, fx.center.y);
      for (let k = 0; k < 3; k++) {
        const ph = t - k * 0.15;
        if (ph <= 0) continue;
        const r = (fx.expand ? ph : 1 - ph) * maxR;
        if (r <= 0) continue;
        this.over
          .circle(c.x, c.y, r)
          .stroke({ width: Math.max(2, 3 * scale), color, alpha: 0.85 * (1 - t) });
      }
    }
    if (expired) game.abilityFx = list.filter(fx => now - fx.startTime < fx.durationMs);
  }

  /** Magnet: a fading ring at the point the player pulled toward. */
  private drawMagnetMarker(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const m = game.magnetMarker;
    if (!m) return;
    const t = (now - m.startTime) / MAGNET_MARKER_MS;
    if (t < 0 || t >= 1) return;
    const p = w2s(m.x, m.y);
    const r = (13 + t * 4) * scale;
    this.over.circle(p.x, p.y, r).stroke({ width: Math.max(1.5, 2 * scale), color: PALETTE.mover, alpha: 1 - t });
    this.over.circle(p.x, p.y, r * 0.35).fill({ color: PALETTE.mover, alpha: (1 - t) * 0.8 });
  }

  /**
   * Pickup claimed or wasted.
   *
   * Claimed gets an expanding ring in the token's own colour; wasted gets a grey
   * ring collapsing to nothing with a strike through it. The two read as
   * opposites at a glance, which matters because the player usually finds out a
   * token was wasted from this marker alone.
   *
   * The rising "+Nh" label the 2D path draws is omitted: the top bar already
   * reports the value, and floating text is the one thing that would fight the
   * board's typography.
   */
  private drawPickupFeedback(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const list = game.pickupFeedback;
    if (!list || list.length === 0) return;

    for (const fb of list) {
      const elapsed = now - fb.startTime;
      if (elapsed < 0 || elapsed >= PICKUP_FEEDBACK_MS) continue;
      const t = elapsed / PICKUP_FEEDBACK_MS;
      const p = w2s(fb.position.x, fb.position.y);

      if (fb.kind === "claimed") {
        const ringT = Math.min(1, elapsed / 450);
        if (ringT >= 1) continue;
        const color = PICKUP_FX_COLORS[fb.effect] ?? PALETTE.accent;
        this.over
          .circle(p.x, p.y, (PICKUP_DRAW_RADIUS + 30 * ringT) * scale)
          .stroke({ width: Math.max(1.5, 2 * scale), color, alpha: (1 - ringT) * 0.8 });
      } else {
        const r = PICKUP_DRAW_RADIUS * scale * (1 - t);
        if (r <= 0.5) continue;
        const alpha = 0.7 * (1 - t);
        this.over.circle(p.x, p.y, r).stroke({ width: Math.max(1.5, 2 * scale), color: 0x9aa3ad, alpha });
        this.over
          .moveTo(p.x - r, p.y - r).lineTo(p.x + r, p.y + r)
          .stroke({ width: Math.max(1.5, 2 * scale), color: 0x9aa3ad, alpha });
      }
    }
  }

  /**
   * The cut preview: where the fence WILL land, shown while the player drags.
   *
   * This is the single most important affordance on the board - every cut is
   * aimed with it - so it is drawn as pure UI and deliberately breaks the light
   * model: no shadow, no ambient dimming, no rim. It is a projection of intent,
   * not an object sitting on the surface, and lighting it would both bury it
   * against the board and imply it is already real.
   *
   * The ray is cast through the same castRayWithReflections the physics uses,
   * so what the player sees is exactly what they will get, bounces included. A
   * cut that would anchor on a breakable turns red: it will "dud", and the
   * player deserves to know before they commit rather than after.
   */
  private drawCutPreview(game: CanvasGameState, w2s: W2S, scale: number): void {
    const { swipeStart, currentSwipePos, swipeRegionId } = game;
    if (!swipeStart || !currentSwipePos || !swipeRegionId) return;

    const delta = vec2Sub(currentSwipePos, swipeStart);
    // Below this the direction is noise, and a preview that flails around while
    // the finger settles is worse than none.
    if (vec2Length(delta) < 5) return;

    const dir = vec2Normalize(delta);
    const fwd = castRayWithReflections(swipeStart, dir, game.walls);
    const bwd = castRayWithReflections(swipeStart, { x: -dir.x, y: -dir.y }, game.walls);
    if (!fwd || !bwd) return;

    const fEnd = fwd.waypoints[fwd.waypoints.length - 1];
    const bEnd = bwd.waypoints[bwd.waypoints.length - 1];
    const isDud = cutAnchorsBreakable(game, fEnd, bEnd, WALL_THICKNESS + 6);

    const outer = isDud ? 0xff8080 : 0xffffff;
    const inner = isDud ? PALETTE.danger : PALETTE.accent;
    const dot = isDud ? 0xff5b5b : PALETTE.mirror;
    const alpha = isDud ? 0.3 : 0.15;

    const paths = [fwd.waypoints, bwd.waypoints];
    const stroke = (width: number, color: number) => {
      for (const wps of paths) {
        for (let i = 0; i < wps.length - 1; i++) {
          const s = w2s(wps[i].x, wps[i].y);
          const e = w2s(wps[i + 1].x, wps[i + 1].y);
          this.over.moveTo(s.x, s.y).lineTo(e.x, e.y);
        }
      }
      this.over.stroke({ width, color, alpha, cap: "butt" });
    };
    stroke((WALL_THICKNESS + 8) * scale, outer);
    stroke((WALL_THICKNESS + 4) * scale, inner);

    // Bounce points: the interior waypoints are where the cut turns, and seeing
    // them is what makes a mirror bank readable before committing.
    for (const wps of paths) {
      for (let i = 1; i < wps.length - 1; i++) {
        const p = w2s(wps[i].x, wps[i].y);
        this.over.circle(p.x, p.y, 4 * scale).fill({ color: dot, alpha: 0.4 });
      }
    }
  }

  /**
   * The lock flash. Fills the pocket's traced contours (even-odd, so an obstacle
   * enclosed by the pocket stays a hole) and throws a dust burst from the catch
   * point. A SUPERIOR lock gets gold and expanding rings instead of a label -
   * the celebration should be felt, not read.
   *
   * The contours are pre-smoothed by checkBallWonState and must NOT be snapped,
   * for the same reason the region boundary must not be: snapping re-quantises
   * the smoothing into a staircase.
   */
  private drawLockFlashes(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const a of game.assimilations.values()) {
      const dur = a.superior ? SUPERIOR_FLASH_MS : LOCK_FLASH_MS;
      const t = (now - a.startTime) / dur;
      if (t < 0 || t > 1) continue;

      // Zone first: landing a var/let/const box is the rarest and most valuable
      // outcome, so it owns the flash colour even on a superior lock (which
      // still keeps its longer duration and rings).
      const tint = a.zoneColor
        ? parseColor(a.zoneColor, PALETTE.accent)
        : a.superior ? 0xffd54a : parseColor(a.ballColor, PALETTE.accent);
      // Fast in, slow out: the pocket slams bright then drains.
      const intensity = t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.6);

      for (const loop of a.contours) {
        if (loop.length < 3) continue;
        this.under.poly(loop.map(p => w2s(p.x, p.y)));
      }
      this.under.fill({ color: tint, alpha: 0.42 * intensity });
      for (const loop of a.contours) {
        if (loop.length < 3) continue;
        this.under.poly(loop.map(p => w2s(p.x, p.y)));
      }
      this.under.stroke({ width: Math.max(1, 2 * scale), color: tint, alpha: 0.85 * intensity });

      // Dust: each particle flies its own bearing from the catch point.
      const origin = w2s(a.ballPos.x, a.ballPos.y);
      const age = now - a.startTime;
      for (const p of a.particles) {
        const pt = age / p.lifetime;
        if (pt >= 1) continue;
        const dist = p.speed * (age / 1000) * scale;
        const x = origin.x + Math.cos(p.angle) * dist;
        const y = origin.y + Math.sin(p.angle) * dist;
        const tailX = x - Math.cos(p.angle) * p.lengthPx * scale * 0.5;
        const tailY = y - Math.sin(p.angle) * p.lengthPx * scale * 0.5;
        this.over
          .moveTo(tailX, tailY).lineTo(x, y)
          .stroke({ width: Math.max(1, p.size * scale), color: tint, alpha: (1 - pt) * 0.85 });
      }

      // Superior: expanding rings, the visual "that was a good one".
      if (a.superior) {
        const c = w2s(a.centroid.x, a.centroid.y);
        for (let i = 0; i < 3; i++) {
          const rt = Math.max(0, Math.min(1, t * 1.4 - i * 0.18));
          if (rt <= 0 || rt >= 1) continue;
          this.over
            .circle(c.x, c.y, rt * 130 * scale)
            .stroke({ width: Math.max(1, 2 * scale), color: 0xffd54a, alpha: (1 - rt) * 0.6 });
        }
      }
    }
  }

  /** Chains: a taut rope between two balls, lit as a thin solid object. */
  private drawChains(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number): void {
    for (const chain of game.chains ?? []) {
      if (chain.nodes.length < 2) continue;
      const pts = chain.nodes.map(n => w2s(n.x, n.y));

      // One shadow for the whole rope, offset from its midpoint.
      const mid = pts[Math.floor(pts.length / 2)];
      const cast = shadowFor(light, mid.x, mid.y, 4 * scale);
      const ox = cast.dx * cast.length;
      const oy = cast.dy * cast.length;
      this.over.moveTo(pts[0].x + ox, pts[0].y + oy);
      for (let i = 1; i < pts.length; i++) this.over.lineTo(pts[i].x + ox, pts[i].y + oy);
      this.over.stroke({ width: Math.max(1, 4 * scale), color: PALETTE.shadow, alpha: cast.alpha, cap: "round", join: "round" });

      const amb = ambientAt(light, mid.x, mid.y);
      const body = chain.breaksFences ? PALETTE.danger : 0x9aa8a2;
      this.over.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) this.over.lineTo(pts[i].x, pts[i].y);
      this.over.stroke({
        width: Math.max(1, 3 * scale),
        color: mix(PALETTE.shadow, body, 0.45 + amb * 0.55),
        alpha: 1, cap: "round", join: "round",
      });
    }
  }

  /** Collapse debris: shards spinning out from a destroyed object. */
  private drawDebris(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    for (const d of game.objectDebris) {
      const t = (now - d.startTime) / d.durationMs;
      if (t < 0 || t > 1) continue;
      const color = parseColor(d.color, PALETTE.obstacle);
      const secs = (now - d.startTime) / 1000;
      for (const p of d.particles) {
        const x = p.x + p.vx * secs;
        const y = p.y + p.vy * secs;
        const s = w2s(x, y);
        const size = Math.max(1, p.size * scale * (1 - t * 0.4));
        const rot = p.rotation + p.rotSpeed * secs;
        // A square shard, rotated: cheaper than a sprite and reads as rubble.
        const c = Math.cos(rot) * size, sn = Math.sin(rot) * size;
        this.over
          .poly([
            { x: s.x - c + sn, y: s.y - sn - c },
            { x: s.x + c + sn, y: s.y + sn - c },
            { x: s.x + c - sn, y: s.y + sn + c },
            { x: s.x - c - sn, y: s.y - sn + c },
          ])
          .fill({ color, alpha: (1 - t) * 0.9 });
      }
    }
  }

  /** A toppled obstacle mid-fall: the shape slides down and fades out. */
  private drawFalling(game: CanvasGameState, light: LightScope, w2s: W2S, now: number): void {
    for (const f of game.fallingObjects) {
      const t = (now - f.startTime) / f.durationMs;
      if (t < 0 || t > 1) continue;
      const drop = f.fallSpeed * ((now - f.startTime) / 1000);
      const pts = f.vertices.map(v => w2s(v.x, v.y + drop));
      if (pts.length < 3) continue;

      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      cx /= pts.length; cy /= pts.length;

      const amb = ambientAt(light, cx, cy);
      this.over
        .poly(pts)
        .fill({
          color: mix(PALETTE.shadow, parseColor(f.color, PALETTE.obstacle), 0.35 + amb * 0.65),
          alpha: 1 - t,
        });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
