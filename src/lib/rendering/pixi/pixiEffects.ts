/**
 * Pixi effects layer — lock flashes, cut preview, swipe afterglow, trajectory
 * prediction, the space progress bar, plus the Stage-A simplified level-clear
 * shimmer and game-over dissolve.
 *
 * All math mirrors renderFrame.ts section by section; only the drawing calls
 * are Pixi. Simplifications (finished in Stage B): the shimmer desaturates the
 * whole board while the wave sweeps (instead of the exact drained-wake split),
 * and the dissolve reuses the captured-canvas tiles as sprites.
 */
import { CanvasSource, Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture, TextureSource } from "pixi.js";
import { CanvasGameState } from "@/types/gameState";
import { DissolveState } from "@/types/game";
import { RenderContext } from "../types";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { computeBallTrajectory, trajectoryBallSnapshots } from "@/lib/gameUtils";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { vec2Sub, vec2Length, vec2Normalize, lineSegmentIntersection, Vector2 } from "@/lib/polygon";
import {
  LOCK_PULSE_DURATION,
  LOCK_FLOOD_DURATION,
  LOCK_DUST_DURATION,
  INFO_UNLOCKED_DURATION,
  SWIPE_TRAIL_DURATION,
  DISSOLVE_DURATION,
  SPACE_BAR_FADE_MS,
} from "@/lib/gameConstants";
import { getRemainingPercent } from "@/lib/spaceGrid";
import { glowTexture, textureFor } from "./textures";
import { getPickupSprite, pickupColor, pickupFeedbackLabel } from "../pickupSprites";
import { PICKUP_DRAW_RADIUS, PICKUP_FEEDBACK_MS, PICKUP_EXPIRY_WARN_SECONDS } from "@/lib/pickups";

type W2S = (x: number, y: number) => { x: number; y: number };

/** Dashed polyline helper (Pixi has no setLineDash). */
export function dashedLine(
  g: Graphics,
  ax: number, ay: number, bx: number, by: number,
  dash: number, gap: number,
): void {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const ux = dx / len, uy = dy / len;
  let d = 0;
  while (d < len) {
    const e = Math.min(d + dash, len);
    g.moveTo(ax + ux * d, ay + uy * d).lineTo(ax + ux * e, ay + uy * e);
    d = e + gap;
  }
}

export class EffectsLayer {
  /** Board-masked content (lock flash, preview, trail, trajectory). */
  readonly container = new Container();
  /** Unmasked content (space bar below the board, shimmer wave). */
  readonly overlayContainer = new Container();

  private lockFill = new Graphics();
  private lockBursts = new Container();
  private lockDust = new Graphics();
  private infoTexts = new Map<string, Text>();
  private superiorTexts = new Map<string, Text>();
  private preview = new Graphics();
  private swipe = new Graphics();
  private trajectory = new Graphics();
  private spaceBar = new Graphics();
  private burstPool: Sprite[] = [];
  private pickupLayer = new Container();
  private pickupSprites = new Map<string, Sprite>();
  private pickupRings = new Graphics();
  private pickupTexts = new Map<string, Text>();
  private abilityFx = new Graphics();

  constructor() {
    this.lockDust.blendMode = "add";
    // Pickup tokens go FIRST (under the lock flash — a claimed token vanishes
    // beneath the pocket fill); feedback rings/labels ride on top of the rest.
    // The ability burst goes last so its flash/rings sit above everything.
    this.container.addChild(this.pickupLayer, this.lockFill, this.lockBursts, this.lockDust, this.preview, this.swipe, this.trajectory, this.pickupRings, this.abilityFx);
    this.overlayContainer.addChild(this.spaceBar);
  }

  sync(game: CanvasGameState, rctx: RenderContext, w2s: W2S, now: number): void {
    const { boardRect } = game;
    const scale = boardRect.scale;
    const accent = rctx.accentColor;

    this.syncPickups(game, rctx, w2s, scale, accent, now);
    this.syncLockFlashes(game, rctx, w2s, scale, accent, now);
    this.syncCutPreview(game, w2s, scale, accent);
    this.syncSwipeTrail(game, w2s, scale, accent, now);
    this.syncTrajectory(game, rctx, w2s, scale);
    this.syncSpaceBar(game, rctx, scale, accent, now);
    this.syncAbilityFx(game, w2s, scale, now);
  }

  // ── Ability-fired burst (#38): board flash + rings tinted by the ability ──
  private syncAbilityFx(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const g = this.abilityFx;
    g.clear();
    if (!game.abilityFx || game.abilityFx.length === 0) return;
    const { boardRect } = game;
    const maxR = 0.6 * Math.hypot(boardRect.width, boardRect.height);
    let anyExpired = false;
    for (const fx of game.abilityFx) {
      const elapsed = now - fx.startTime;
      if (elapsed >= fx.durationMs) { anyExpired = true; continue; }
      const t = elapsed / fx.durationMs;
      const cs = w2s(fx.center.x, fx.center.y);
      // Board flash — the guaranteed "something happened" cue.
      g.rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height)
        .fill({ color: fx.color, alpha: 0.20 * (1 - t) });
      // Staggered rings from the board centre (outward, or inward for Magnet).
      for (let k = 0; k < 3; k++) {
        const ph = t - k * 0.15;
        if (ph <= 0) continue;
        const r = (fx.expand ? ph : 1 - ph) * maxR;
        if (r <= 0) continue;
        g.circle(cs.x, cs.y, r).stroke({ width: Math.max(2, 3 * scale), color: fx.color, alpha: 0.85 * (1 - t) });
      }
    }
    if (anyExpired) game.abilityFx = game.abilityFx.filter(fx => now - fx.startTime < fx.durationMs);
  }

  // ── Pickup tokens + claim/waste feedback (renderFrame's pickup sections) ──
  private syncPickups(
    game: CanvasGameState, rctx: RenderContext, w2s: W2S,
    scale: number, accent: string, now: number,
  ): void {
    const live = new Set<string>();
    if (game.pickups && game.pickups.length > 0) {
      const nowS = game.activePlaySeconds;
      for (const token of game.pickups) {
        live.add(token.id);
        let sprite = this.pickupSprites.get(token.id);
        if (!sprite) {
          sprite = new Sprite();
          sprite.anchor.set(0.5);
          this.pickupLayer.addChild(sprite);
          this.pickupSprites.set(token.id, sprite);
        }
        // Re-fetch per frame: the bake is scale-keyed and the texture cache is
        // swept — a held stale texture would render a destroyed source.
        sprite.texture = textureFor(getPickupSprite(token.effect, accent, PICKUP_DRAW_RADIUS * scale));
        const aliveS = nowS - token.spawnedAtSeconds;
        const remainingS = token.expiresAtSeconds - nowS;
        const popT = Math.min(1, aliveS / 0.25);
        const pop = 1 - Math.pow(1 - popT, 3);
        const pulse = 1 + 0.07 * Math.sin(now / 280 + token.position.x);
        let alpha = popT;
        if (remainingS < PICKUP_EXPIRY_WARN_SECONDS) {
          const hz = 2 + (PICKUP_EXPIRY_WARN_SECONDS - remainingS) * 2;
          alpha *= 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((now / 1000) * hz * Math.PI * 2));
        }
        const p = w2s(token.position.x, token.position.y);
        sprite.position.set(p.x, p.y);
        sprite.scale.set(pulse * pop);
        sprite.alpha = alpha;
        sprite.visible = alpha > 0 && pop > 0;
      }
    }
    for (const [id, sprite] of this.pickupSprites) {
      if (!live.has(id)) {
        sprite.destroy();
        this.pickupSprites.delete(id);
      }
    }

    // Feedback: claimed = rising label + expanding ring; wasted = grey
    // collapsing ring with a strike. Entries are culled by updatePickups.
    this.pickupRings.clear();
    const liveTexts = new Set<string>();
    if (game.pickupFeedback && game.pickupFeedback.length > 0) {
      for (const fb of game.pickupFeedback) {
        const elapsed = now - fb.startTime;
        if (elapsed < 0 || elapsed >= PICKUP_FEEDBACK_MS) continue;
        const t = elapsed / PICKUP_FEEDBACK_MS;
        if (fb.kind === "claimed") {
          const col = pickupColor(fb.effect, accent);
          liveTexts.add(fb.id);
          let label = this.pickupTexts.get(fb.id);
          if (!label) {
            label = new Text({
              text: pickupFeedbackLabel(fb, rctx.pickupLabels),
              style: new TextStyle({
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: Math.max(11, Math.round(13 * scale)),
                fontWeight: "bold",
                fill: col,
              }),
            });
            label.anchor.set(0.5, 1);
            this.container.addChild(label);
            this.pickupTexts.set(fb.id, label);
          }
          label.alpha = Math.min(1, elapsed / 120) * (t > 0.6 ? (1 - t) / 0.4 : 1);
          const tp = w2s(fb.position.x, fb.position.y - 18 - 45 * t);
          label.position.set(tp.x, tp.y);
          const ringT = Math.min(1, elapsed / 450);
          if (ringT < 1) {
            const p = w2s(fb.position.x, fb.position.y);
            this.pickupRings
              .circle(p.x, p.y, (PICKUP_DRAW_RADIUS + 30 * ringT) * scale)
              .stroke({ width: 2 * scale, color: col, alpha: (1 - ringT) * 0.8 });
          }
        } else {
          const p = w2s(fb.position.x, fb.position.y);
          const rr = PICKUP_DRAW_RADIUS * scale * (1 - t);
          if (rr <= 0.5) continue;
          const alpha = 0.7 * (1 - t);
          this.pickupRings
            .circle(p.x, p.y, rr)
            .stroke({ width: 2 * scale, color: 0x9aa3ad, alpha });
          this.pickupRings
            .moveTo(p.x - rr, p.y - rr)
            .lineTo(p.x + rr, p.y + rr)
            .stroke({ width: 2 * scale, color: 0x9aa3ad, alpha });
        }
      }
    }
    for (const [id, label] of this.pickupTexts) {
      if (!liveTexts.has(id)) {
        label.destroy();
        this.pickupTexts.delete(id);
      }
    }
  }

  // ── Lock flash / assimilations (renderFrame section T) ────────────────────
  private syncLockFlashes(
    game: CanvasGameState, rctx: RenderContext, w2s: W2S,
    scale: number, accent: string, now: number,
  ): void {
    this.lockFill.clear();
    this.lockDust.clear();
    let burstIdx = 0;
    const liveInfo = new Set<string>();
    const liveSuperior = new Set<string>();

    for (const [key, flash] of game.assimilations) {
      if (flash.contours.length === 0) continue;
      const elapsed = now - flash.startTime;

      let fillAlpha = 0;
      let glowAlpha = 0;
      if (elapsed < LOCK_PULSE_DURATION) {
        const t = elapsed / LOCK_PULSE_DURATION;
        fillAlpha = Math.abs(Math.sin(t * Math.PI * 3)) * 0.5;
        glowAlpha = fillAlpha * 0.7;
      } else if (elapsed < LOCK_PULSE_DURATION + LOCK_FLOOD_DURATION) {
        const ft = Math.min(1, (elapsed - LOCK_PULSE_DURATION) / LOCK_FLOOD_DURATION);
        fillAlpha = Math.sin(ft * Math.PI) * 0.7;
        glowAlpha = (1 - ft) * 0.9;
      }

      // Fill the pocket's smooth contour loops (traced + Chaikin-rounded at lock
      // time — same as the persistent tint): bounded to the real cells (no
      // overshoot toward a nearby object) and smooth (no 15px staircase). Pixi
      // has no even-odd multi-loop fill, so classify loops by orientation: fill
      // the outer boundary(ies), cut the hole loops and interior movers.
      if (flash.contours.length > 0 && fillAlpha > 0) {
        const loops = flash.contours;
        // Signed area (world coords; w2s is orientation-preserving). The loop
        // with the largest |area| is an outer boundary; its sign flags outers.
        const areas = loops.map(loop => {
          let a = 0;
          for (let i = 0; i < loop.length; i++) {
            const p = loop[i], q = loop[(i + 1) % loop.length];
            a += p.x * q.y - q.x * p.y;
          }
          return a;
        });
        let outerSign = 1, maxAbs = 0;
        for (const a of areas) {
          if (Math.abs(a) > maxAbs) { maxAbs = Math.abs(a); outerSign = Math.sign(a) || 1; }
        }
        const toScreen = (loop: typeof loops[number]): number[] => {
          const pts: number[] = [];
          for (const v of loop) { const sp = w2s(v.x, v.y); pts.push(sp.x, sp.y); }
          return pts;
        };
        for (let i = 0; i < loops.length; i++) {
          if (loops[i].length >= 3 && Math.sign(areas[i]) === outerSign) this.lockFill.poly(toScreen(loops[i]));
        }
        this.lockFill.fill({ color: accent, alpha: fillAlpha });
        for (let i = 0; i < loops.length; i++) {
          if (loops[i].length >= 3 && Math.sign(areas[i]) !== outerSign) this.lockFill.poly(toScreen(loops[i])).cut();
        }
        // Interior movers aren't grid cells, so they fall inside a loop — cut them.
        for (const mover of game.movers) {
          const vs = mover.polygon.vertices;
          if (vs.length < 3) continue;
          const hole: number[] = [];
          for (const v of vs) { const sp = w2s(v.x, v.y); hole.push(sp.x, sp.y); }
          this.lockFill.poly(hole).cut();
        }
      }

      // Expanding burst at the centroid.
      if (elapsed >= LOCK_PULSE_DURATION && glowAlpha > 0) {
        const ft = Math.min(1, (elapsed - LOCK_PULSE_DURATION) / LOCK_FLOOD_DURATION);
        const c = w2s(flash.centroid.x, flash.centroid.y);
        const burstR = 120 * scale * (0.3 + ft * 1.8);
        let sprite = this.burstPool[burstIdx];
        if (!sprite) {
          sprite = new Sprite(glowTexture("burst"));
          sprite.anchor.set(0.5);
          sprite.blendMode = "add";
          this.burstPool.push(sprite);
          this.lockBursts.addChild(sprite);
        }
        // Re-fetch per use: pooled sprites outlive texture-cache clears, and a
        // stale destroyed texture (null source) crashes the batcher.
        sprite.texture = glowTexture("burst");
        sprite.visible = true;
        sprite.tint = accent;
        sprite.alpha = glowAlpha;
        sprite.position.set(c.x, c.y);
        sprite.width = sprite.height = burstR * 2;
        burstIdx++;
      }

      // Dust streaks radiating from the catch position.
      if (elapsed < LOCK_DUST_DURATION && flash.particles.length > 0) {
        for (const p of flash.particles) {
          if (elapsed > p.lifetime) continue;
          const progress = elapsed / p.lifetime;
          const drag = Math.pow(1 - progress, 1.8);
          const tSec = elapsed / 1000;
          const wx = flash.ballPos.x + Math.cos(p.angle) * p.speed * tSec * drag;
          const wy = flash.ballPos.y + Math.sin(p.angle) * p.speed * tSec * drag + 18 * tSec * tSec;
          const sp = w2s(wx, wy);
          const alpha = Math.pow(1 - progress, 1.4);
          const tailLen = p.lengthPx * (1 - progress);
          this.lockDust
            .moveTo(sp.x - Math.cos(p.angle) * tailLen, sp.y - Math.sin(p.angle) * tailLen)
            .lineTo(sp.x, sp.y)
            .stroke({ width: 1.5, color: flash.ballColor, alpha, cap: "round" });
        }
      }

      // First-encounter "Info Unlocked" label.
      if (flash.firstEncounter && elapsed < INFO_UNLOCKED_DURATION) {
        liveInfo.add(key);
        let label = this.infoTexts.get(key);
        if (!label) {
          label = new Text({
            text: rctx.infoUnlockedLabel ?? "Info Unlocked",
            style: new TextStyle({
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: Math.max(11, Math.round(13 * scale)),
              fontWeight: "bold",
              fill: accent,
            }),
          });
          label.anchor.set(0.5, 1);
          this.container.addChild(label);
          this.infoTexts.set(key, label);
        }
        const FADE_IN_MS = 150, FADE_OUT_MS = 500, RISE_WORLD = 55;
        const fadeIn = Math.min(1, elapsed / FADE_IN_MS);
        const fadeOut = elapsed > INFO_UNLOCKED_DURATION - FADE_OUT_MS
          ? Math.max(0, (INFO_UNLOCKED_DURATION - elapsed) / FADE_OUT_MS)
          : 1;
        label.alpha = Math.min(fadeIn, fadeOut);
        const rise = RISE_WORLD * (elapsed / INFO_UNLOCKED_DURATION);
        const tp = w2s(flash.centroid.x, flash.centroid.y - 40 - rise);
        label.position.set(tp.x, tp.y);
      }

      // Superior lock (tight pocket): same rising-label treatment in gold.
      // When the first-encounter label is also up, this one sits below it.
      if (flash.superior && elapsed < INFO_UNLOCKED_DURATION) {
        liveSuperior.add(key);
        let label = this.superiorTexts.get(key);
        if (!label) {
          label = new Text({
            text: rctx.superiorLockLabel ?? "Superior Lock!",
            style: new TextStyle({
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: Math.max(11, Math.round(13 * scale)),
              fontWeight: "bold",
              fill: "#ffd54a",
            }),
          });
          label.anchor.set(0.5, 1);
          this.container.addChild(label);
          this.superiorTexts.set(key, label);
        }
        const FADE_IN_MS = 150, FADE_OUT_MS = 500, RISE_WORLD = 55;
        const fadeIn = Math.min(1, elapsed / FADE_IN_MS);
        const fadeOut = elapsed > INFO_UNLOCKED_DURATION - FADE_OUT_MS
          ? Math.max(0, (INFO_UNLOCKED_DURATION - elapsed) / FADE_OUT_MS)
          : 1;
        label.alpha = Math.min(fadeIn, fadeOut);
        const rise = RISE_WORLD * (elapsed / INFO_UNLOCKED_DURATION);
        const yOff = flash.firstEncounter ? 18 : 40;
        const tp = w2s(flash.centroid.x, flash.centroid.y - yOff - rise);
        label.position.set(tp.x, tp.y);
      }
    }

    for (let i = burstIdx; i < this.burstPool.length; i++) this.burstPool[i].visible = false;
    for (const [key, label] of this.infoTexts) {
      if (!liveInfo.has(key)) {
        label.destroy();
        this.infoTexts.delete(key);
      }
    }
    for (const [key, label] of this.superiorTexts) {
      if (!liveSuperior.has(key)) {
        label.destroy();
        this.superiorTexts.delete(key);
      }
    }
  }

  // ── Cut preview during drag (section P) ───────────────────────────────────
  private syncCutPreview(game: CanvasGameState, w2s: W2S, scale: number, accent: string): void {
    const g = this.preview;
    g.clear();
    const { swipeStart, swipeRegionId, currentSwipePos, activeWall } = game;
    if (!swipeStart || !swipeRegionId || !currentSwipePos || activeWall) return;
    const delta = vec2Sub(currentSwipePos, swipeStart);
    if (vec2Length(delta) < 5) return;

    const direction = vec2Normalize(delta);
    const negDir = { x: -direction.x, y: -direction.y };
    const fwdPreview = castRayWithReflections(swipeStart, direction, game.walls);
    const bwdPreview = castRayWithReflections(swipeStart, negDir, game.walls);
    if (!fwdPreview || !bwdPreview) return;

    const fEnd = fwdPreview.waypoints[fwdPreview.waypoints.length - 1];
    const bEnd = bwdPreview.waypoints[bwdPreview.waypoints.length - 1];
    const isDud = cutAnchorsBreakable(game, fEnd, bEnd, WALL_THICKNESS + 6);
    const outerColor = isDud ? "#ff8080" : "#ffffff";
    const innerColor = isDud ? "#ff2a2a" : accent;
    const dotColor = isDud ? "#ff5b5b" : "#88ddff";
    const bandAlpha = isDud ? 0.3 : 0.15;

    const previewThickness = WALL_THICKNESS;
    for (const waypoints of [fwdPreview.waypoints, bwdPreview.waypoints]) {
      for (let i = 0; i < waypoints.length - 1; i++) {
        const s = w2s(waypoints[i].x, waypoints[i].y);
        const e = w2s(waypoints[i + 1].x, waypoints[i + 1].y);
        const dx = e.x - s.x, dy = e.y - s.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.001) continue;
        const inv = 1 / len;
        const quad = (hw: number, color: string) => {
          const px = -dy * inv * hw, py = dx * inv * hw;
          g.poly([s.x + px, s.y + py, e.x + px, e.y + py, e.x - px, e.y - py, s.x - px, s.y - py])
            .fill({ color, alpha: bandAlpha });
        };
        quad((previewThickness + 8) * scale / 2, outerColor);
        quad((previewThickness + 4) * scale / 2, innerColor);
      }
      for (let i = 1; i < waypoints.length - 1; i++) {
        const pt = w2s(waypoints[i].x, waypoints[i].y);
        g.circle(pt.x, pt.y, 4 * scale).fill({ color: dotColor, alpha: 0.4 });
      }
    }
  }

  // ── Swipe afterglow (section Q) ────────────────────────────────────────────
  private syncSwipeTrail(game: CanvasGameState, w2s: W2S, scale: number, accent: string, now: number): void {
    const g = this.swipe;
    g.clear();
    if (!game.swipeTrail) return;
    const age = now - game.swipeTrail.createdAt;
    if (age >= SWIPE_TRAIL_DURATION) {
      game.swipeTrail = null;
      return;
    }
    const t = age / SWIPE_TRAIL_DURATION;
    const ease = 1 - t * t;

    const startW = game.swipeTrail.start;
    const endW = game.swipeTrail.end;
    const fullLen = vec2Length(vec2Sub(endW, startW));
    let drawLen = fullLen;
    let crossed = false;
    if (fullLen > 0.001) {
      const consider = (a: Vector2, b: Vector2) => {
        const ix = lineSegmentIntersection(startW, endW, a, b);
        if (!ix) return;
        const d = vec2Length(vec2Sub(ix, startW));
        if (d > 0.5 && d < drawLen) { drawLen = d; crossed = true; }
      };
      for (const wl of game.walls) consider(wl.start, wl.end);
      for (const poly of game.obstaclePolygons) {
        const v = poly.vertices;
        for (let i = 0; i < v.length; i++) consider(v[i], v[(i + 1) % v.length]);
      }
    }
    if (crossed) drawLen = Math.max(0, drawLen - WALL_THICKNESS * 0.5);
    const dir = fullLen > 0.001 ? vec2Normalize(vec2Sub(endW, startW)) : { x: 0, y: 0 };
    const s = w2s(startW.x, startW.y);
    const e = w2s(startW.x + dir.x * drawLen, startW.y + dir.y * drawLen);

    g.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 9 * scale, color: accent, alpha: 0.18 * ease, cap: "round" });
    g.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 2 * scale, color: accent, alpha: 0.55 * ease, cap: "round" });
    for (const p of [s, e]) g.circle(p.x, p.y, 3 * scale).fill({ color: accent, alpha: 0.6 * ease });
  }

  // ── Ball trajectory prediction (section R) ────────────────────────────────
  private syncTrajectory(game: CanvasGameState, rctx: RenderContext, w2s: W2S, scale: number): void {
    const g = this.trajectory;
    g.clear();
    const mods = rctx.activeModifiers;
    if (mods.ballPathPredictionBounces <= 0 || mods.ballPathPredictionBalls <= 0) return;

    const activeBalls = game.balls.filter(b => b.state === "active").sort((a, b) => b.speed - a.speed);
    const tracked = mods.ballPathPredictionBalls >= 100 ? activeBalls : activeBalls.slice(0, mods.ballPathPredictionBalls);

    for (const ball of tracked) {
      const startPos = ball.renderPosition ?? ball.position;
      const waypoints = computeBallTrajectory(startPos, ball.velocity, game.walls, mods.ballPathPredictionBounces, ball.radius, game.obstaclePolygons, game.movers, game.creepFactor || 1, trajectoryBallSnapshots(game.balls, ball, game.frozenBallId));
      if (waypoints.length < 2) continue;

      const totalSegs = waypoints.length - 1;
      const segLengths: number[] = [];
      let totalLength = 0;
      for (let i = 0; i < totalSegs; i++) {
        const len = Math.hypot(waypoints[i + 1].x - waypoints[i].x, waypoints[i + 1].y - waypoints[i].y);
        segLengths.push(len);
        totalLength += len;
      }
      const cumDist: number[] = [0];
      for (let i = 0; i < totalSegs; i++) cumDist.push(cumDist[i] + segLengths[i]);
      const pathAlpha = (d: number) => {
        const tt = totalLength > 0 ? d / totalLength : 0;
        const fadeStart = 2 / 3;
        if (tt <= fadeStart) return 0.55;
        return 0.55 * (1 - (tt - fadeStart) / (1 - fadeStart));
      };

      for (let i = 0; i < totalSegs; i++) {
        const a = (pathAlpha(cumDist[i]) + pathAlpha(cumDist[i + 1])) / 2;
        if (a <= 0) continue;
        const s = w2s(waypoints[i].x, waypoints[i].y);
        const e = w2s(waypoints[i + 1].x, waypoints[i + 1].y);
        dashedLine(g, s.x, s.y, e.x, e.y, 6 * scale, 8 * scale);
        g.stroke({ width: 2 * scale, color: 0x00ff88, alpha: a, cap: "round" });
      }
      for (let i = 1; i < waypoints.length - 1; i++) {
        const alpha = pathAlpha(cumDist[i]) * (0.75 / 0.55);
        const pt = w2s(waypoints[i].x, waypoints[i].y);
        const r = 4 * scale;
        g.poly([pt.x, pt.y - r, pt.x + r, pt.y, pt.x, pt.y + r, pt.x - r, pt.y]).fill({ color: 0x00ff88, alpha });
      }
    }
  }

  // ── Space progress bar (section W, below the board) ───────────────────────
  private syncSpaceBar(game: CanvasGameState, rctx: RenderContext, scale: number, accent: string, now: number): void {
    const g = this.spaceBar;
    g.clear();
    if (!game.spaceGrid) return;
    // Once the map is won the bar fades out over SPACE_BAR_FADE_MS - it must
    // not sit under the board through the clear wave. It returns with the next
    // map's fresh game state.
    let fade = 1;
    if (game.levelComplete) {
      fade = 1 - (now - (game.levelCompleteTime ?? 0)) / SPACE_BAR_FADE_MS;
      if (fade <= 0) return;
    }
    g.alpha = fade;
    const remaining = getRemainingPercent(game.spaceGrid);
    const threshold = rctx.spaceThreshold;
    const captured = 100 - remaining;
    const targetCaptured = 100 - threshold;
    const fillRatio = Math.min(1, targetCaptured > 0 ? captured / targetCaptured : 1);

    const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
    const gap = 3 * scale;
    const barH = 4 * scale;
    const barY = bt + bh + gap;

    g.rect(bl, barY, bw, barH).fill({ color: 0x000000, alpha: 0.4 });
    const isComplete = fillRatio >= 1;
    g.rect(bl, barY, bw * fillRatio, barH).fill({ color: isComplete ? 0x00ff44 : accent, alpha: 0.75 });

    if (game.pushMode === "pushing" && game.pushStartPercent > 0) {
      const extraCaptured = game.pushStartPercent - remaining;
      const pushRatio = Math.min(1, Math.max(0, extraCaptured / game.pushStartPercent));
      if (pushRatio > 0) {
        const pushW = bw * pushRatio;
        g.rect(bl + bw - pushW, barY, pushW, barH).fill({ color: 0xff8800, alpha: 0.85 });
      }
    }
  }

  destroy(): void {
    for (const [, label] of this.infoTexts) label.destroy();
    this.infoTexts.clear();
    for (const [, label] of this.superiorTexts) label.destroy();
    this.superiorTexts.clear();
    for (const [, label] of this.pickupTexts) label.destroy();
    this.pickupTexts.clear();
    this.pickupSprites.clear(); // sprites are children — destroyed below
    this.container.destroy({ children: true });
    this.overlayContainer.destroy({ children: true });
  }
}

// ── Game-over dissolve (Stage-A: captured-canvas tiles as sprites) ───────────

export class DissolveLayer {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private forState: DissolveState | null = null;
  /** Source WE created for the captured-canvas fallback; a gpuSource passed in
   *  is owned by the renderer's dissolveRT and must not be destroyed here. */
  private ownedSource: CanvasSource | null = null;

  /**
   * Advance the dissolve; mirrors the 2D tile kinematics in useGameLoop.
   * `gpuSource` (a RenderTexture source from captureForDissolve) avoids the
   * canvas readback path entirely; without it the captured canvas is used.
   */
  render(dissolve: DissolveState, now: number, gpuSource?: TextureSource): void {
    if (this.forState !== dissolve) {
      this.clear();
      this.forState = dissolve;
      // Explicit source (not Texture.from) to stay out of Pixi's global cache.
      const source = gpuSource
        ?? (this.ownedSource = new CanvasSource({ resource: dissolve.captured }));
      for (const tile of dissolve.tiles) {
        const tex = new Texture({
          source,
          frame: new Rectangle(tile.sx, tile.sy, tile.sw, tile.sh),
        });
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        this.sprites.push(s);
        this.container.addChild(s);
      }
    }
    const elapsed = (now - dissolve.startTime) / 1000;
    const dur = DISSOLVE_DURATION / 1000;
    // Reverse (run-intro assemble): same kinematics played backwards, so the
    // tiles fly IN from their scattered end-state and settle in place.
    const anim = dissolve.reverse ? Math.max(0, dur - elapsed) : elapsed;
    for (let i = 0; i < dissolve.tiles.length; i++) {
      const tile = dissolve.tiles[i];
      const s = this.sprites[i];
      const t = Math.max(0, anim - tile.delay);
      const tMax = dur - tile.delay;
      const progress = tMax > 0 ? Math.min(1, t / tMax) : 1;
      // Forward: shards fade out as they scatter. Reverse: they must stay
      // SOLID while flying together (the mirrored curve leaves them nearly
      // invisible for most of the flight and the assemble reads as a soft
      // fade instead of shards) - only a short global fade-in at the very
      // start stops the scattered cloud from popping in.
      s.alpha = dissolve.reverse
        ? Math.max(0, Math.min(1, elapsed / 0.2))
        : Math.max(0, 1 - progress * 1.15);
      s.position.set(tile.cx + tile.vx * t, tile.cy + tile.vy * t + 400 * t * t);
      s.rotation = tile.rotSpeed * t;
    }
  }

  clear(): void {
    if (!this.forState && this.sprites.length === 0) return; // called per idle frame
    for (const s of this.sprites) {
      s.texture.destroy(); // frame textures only; the shared source goes below
      s.destroy();
    }
    this.sprites = [];
    this.container.removeChildren();
    this.forState = null;
    // A gpuSource is the renderer's dissolveRT (it destroys it); the fallback
    // CanvasSource is ours - leaking it strands a full-screen GPU texture per
    // run-intro assemble / captured dissolve. unload(), NOT destroy():
    // destroying a CanvasSource poisons Pixi's cached batches (they still hold
    // the source and read .alphaMode of null on the next validation - the
    // batcher crash / silently blank scene). unload() frees the GPU copy while
    // keeping the JS object valid; it simply never re-uploads because nothing
    // references it again.
    this.ownedSource?.unload();
    this.ownedSource = null;
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
