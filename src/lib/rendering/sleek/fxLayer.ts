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
import { vec2Sub, vec2Length, vec2Normalize } from "@/lib/polygon";
import { PALETTE, mix } from "./palette";
import { ambientAt, shadowFor, type LightScope } from "./light";
import type { Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** How long a lock flash burns. Mirrors the classic renderer's feel. */
const LOCK_FLASH_MS = 900;
const SUPERIOR_FLASH_MS = 1500;

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

  sync(game: CanvasGameState, light: LightScope, w2s: W2S, scale: number, now: number): void {
    this.under.clear();
    this.over.clear();

    this.drawCutPreview(game, w2s, scale);
    this.drawLockFlashes(game, w2s, scale, now);
    this.drawChains(game, light, w2s, scale);
    this.drawDebris(game, w2s, scale, now);
    this.drawFalling(game, light, w2s, now);
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

      const tint = a.superior ? 0xffd54a : parseColor(a.ballColor, PALETTE.accent);
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
