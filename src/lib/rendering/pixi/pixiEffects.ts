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
import { CanvasSource, Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { CanvasGameState } from "@/types/gameState";
import { DissolveState } from "@/types/game";
import { RenderContext } from "../types";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { computeBallTrajectory } from "@/lib/gameUtils";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { vec2Sub, vec2Length, vec2Normalize, lineSegmentIntersection, Vector2 } from "@/lib/polygon";
import {
  LOCK_PULSE_DURATION,
  LOCK_FLOOD_DURATION,
  LOCK_DUST_DURATION,
  INFO_UNLOCKED_DURATION,
  SWIPE_TRAIL_DURATION,
  DISSOLVE_DURATION,
} from "@/lib/gameConstants";
import { getRemainingPercent } from "@/lib/spaceGrid";
import { glowTexture } from "./textures";

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
  private preview = new Graphics();
  private swipe = new Graphics();
  private trajectory = new Graphics();
  private spaceBar = new Graphics();
  private burstPool: Sprite[] = [];

  constructor() {
    this.lockDust.blendMode = "add";
    this.container.addChild(this.lockFill, this.lockBursts, this.lockDust, this.preview, this.swipe, this.trajectory);
    this.overlayContainer.addChild(this.spaceBar);
  }

  sync(game: CanvasGameState, rctx: RenderContext, w2s: W2S, now: number): void {
    const { boardRect } = game;
    const scale = boardRect.scale;
    const accent = rctx.accentColor;

    this.syncLockFlashes(game, rctx, w2s, scale, accent, now);
    this.syncCutPreview(game, w2s, scale, accent);
    this.syncSwipeTrail(game, w2s, scale, accent, now);
    this.syncTrajectory(game, rctx, w2s, scale);
    this.syncSpaceBar(game, rctx, scale, accent);
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

    for (const [key, flash] of game.assimilations) {
      if (flash.polygon.length === 0) continue;
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

      // Region fill with obstacle holes cut out (evenodd clip in the 2D path).
      if (flash.polygon.length >= 3 && fillAlpha > 0) {
        const pts: number[] = [];
        for (const p of flash.polygon) {
          const sp = w2s(p.x, p.y);
          pts.push(sp.x, sp.y);
        }
        this.lockFill.poly(pts).fill({ color: accent, alpha: fillAlpha });
        for (const poly of game.obstaclePolygons) {
          const hole: number[] = [];
          for (const v of poly.vertices) {
            const sp = w2s(v.x, v.y);
            hole.push(sp.x, sp.y);
          }
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
    }

    for (let i = burstIdx; i < this.burstPool.length; i++) this.burstPool[i].visible = false;
    for (const [key, label] of this.infoTexts) {
      if (!liveInfo.has(key)) {
        label.destroy();
        this.infoTexts.delete(key);
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
      const waypoints = computeBallTrajectory(startPos, ball.velocity, game.walls, mods.ballPathPredictionBounces, ball.radius, game.obstaclePolygons);
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
  private syncSpaceBar(game: CanvasGameState, rctx: RenderContext, scale: number, accent: string): void {
    const g = this.spaceBar;
    g.clear();
    if (!game.spaceGrid) return;
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
    this.container.destroy({ children: true });
    this.overlayContainer.destroy({ children: true });
  }
}

// ── Game-over dissolve (Stage-A: captured-canvas tiles as sprites) ───────────

export class DissolveLayer {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private forState: DissolveState | null = null;

  /** Advance the dissolve; mirrors the 2D tile kinematics in useGameLoop. */
  render(dissolve: DissolveState, now: number): void {
    if (this.forState !== dissolve) {
      this.clear();
      this.forState = dissolve;
      // Explicit source (not Texture.from) to stay out of Pixi's global cache.
      const source = new CanvasSource({ resource: dissolve.captured });
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
    for (let i = 0; i < dissolve.tiles.length; i++) {
      const tile = dissolve.tiles[i];
      const s = this.sprites[i];
      const t = Math.max(0, elapsed - tile.delay);
      const tMax = dur - tile.delay;
      const progress = tMax > 0 ? Math.min(1, t / tMax) : 1;
      s.alpha = Math.max(0, 1 - progress * 1.15);
      s.position.set(tile.cx + tile.vx * t, tile.cy + tile.vy * t + 400 * t * t);
      s.rotation = tile.rotSpeed * t;
    }
  }

  clear(): void {
    for (const s of this.sprites) {
      s.texture.destroy();
      s.destroy();
    }
    this.sprites = [];
    this.container.removeChildren();
    this.forState = null;
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
