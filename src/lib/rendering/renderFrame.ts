/**
 * renderFrame — stateless per-frame draw call.
 *
 * Extracted from GameCanvas.tsx to isolate all Canvas 2D rendering logic.
 * The function is pure with respect to React; all mutable state is accessed
 * via `game` (CanvasGameState) and `rctx` (RenderContext).
 */

import { CanvasGameState } from "@/types/gameState";
import { RenderContext } from "./types";
import {
  vec2Sub,
  vec2Length,
  vec2Normalize,
  clipLineAgainstPolygons,
  lineSegmentIntersection,
  Vector2,
} from "@/lib/polygon";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { computeBallTrajectory, hexToRgba } from "@/lib/gameUtils";
import { getBallBase, getBallSpecular, getHexOverlay } from "@/lib/ballRenderCache";
import { renderBallEffects } from "@/lib/ballEffects";
import { renderWallWithEffects } from "@/lib/wallImpactEffects";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { BOARD_WIDTH, BOARD_HEIGHT, BoardRect } from "@/lib/boardConstants";
import {
  LOCK_PULSE_DURATION,
  LOCK_FLOOD_DURATION,
  LOCK_DUST_DURATION,
  COLORS,
  FREEZE_COOLDOWN_MULTIPLIER,
  SWIPE_TRAIL_DURATION,
  BALL_DANGER_SPEED,
  LEVEL_CLEAR_SHIMMER_MS,
} from "@/lib/gameConstants";
import { getRemainingPercent } from "@/lib/spaceGrid";

const RAIN_SYMBOLS = '01{}()=>;./#@*';

// ── Wall shadow gradient cache ────────────────────────────────────────────────
// Gradients are keyed by wall ID and invalidated when boardRect changes.
const _shadowGradCache = new Map<string, CanvasGradient>();
let _shadowGradBoardKey = '';

// ── Rim light OffscreenCanvas cache ──────────────────────────────────────────
let _rimOC: OffscreenCanvas | null = null;
let _rimOCKey = '';

// ── Static glow layer caches ─────────────────────────────────────────────────
// shadowBlur is the most expensive Canvas2D operation (a Gaussian blur per
// draw). Obstacle outlines and mirror polygons are static for a whole level,
// so their glow is prerendered to full-screen OffscreenCanvases and blitted
// per frame. Keys include boardRect+colour; the polygon-array reference
// detects level changes.
let _obstacleGlowOC: OffscreenCanvas | null = null;
let _obstacleGlowKey = '';
let _obstacleGlowPolys: unknown = null;
let _mirrorGlowOC: OffscreenCanvas | null = null;
let _mirrorGlowKey = '';
let _mirrorGlowPolys: unknown = null;

// Danger frame: blur is constant, only alpha pulses — bake the glow once and
// modulate with globalAlpha (pixel-identical, alpha is linear).
let _dangerFrameOC: OffscreenCanvas | null = null;
let _dangerFrameKey = '';

// Pulse-bucketed sprites (mover bodies, fence tip cores) and radial glow
// sprites (fence tip bloom, lock burst — replaces per-frame createRadialGradient).
const _pulseSpriteCache = new Map<string, OffscreenCanvas>();
const _radialSpriteCache = new Map<string, OffscreenCanvas>();

// Fence-vs-obstacle clipping is static once a wall exists (walls and
// obstacles never move within a level) — cache per wall object. Old-level
// walls are garbage-collected along with their cache entries.
const _wallClipSegs = new WeakMap<import("@/lib/wallGeometry").Wall, { start: Vector2; end: Vector2 }[]>();

// Cached screen-space clip paths (board polygon + obstacle holes).
const _fenceClipCache = { key: '', board: null as unknown, polys: null as unknown, path: null as Path2D | null };
const _obstacleHolesCache = { key: '', polys: null as unknown, path: null as Path2D | null };

/**
 * Radial glow sprite: unit gradient circle rendered once per (colour, profile),
 * drawn scaled with drawImage. `stops` alphas are baked at full strength;
 * callers modulate with globalAlpha.
 */
const RADIAL_SPRITE_R = 64;
function getRadialGlowSprite(colorHex: string, kind: 'tip' | 'burst'): OffscreenCanvas {
  const key = `${kind}_${colorHex}`;
  let oc = _radialSpriteCache.get(key);
  if (!oc) {
    oc = new OffscreenCanvas(RADIAL_SPRITE_R * 2, RADIAL_SPRITE_R * 2);
    const c = oc.getContext('2d')!;
    const r = parseInt(colorHex.slice(1, 3), 16);
    const g = parseInt(colorHex.slice(3, 5), 16);
    const b = parseInt(colorHex.slice(5, 7), 16);
    const grad = c.createRadialGradient(RADIAL_SPRITE_R, RADIAL_SPRITE_R, 0, RADIAL_SPRITE_R, RADIAL_SPRITE_R, RADIAL_SPRITE_R);
    if (kind === 'tip') {
      grad.addColorStop(0,   `rgba(${r},${g},${b},${0xbb / 255})`);
      grad.addColorStop(0.3, `rgba(${r},${g},${b},${0x44 / 255})`);
      grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    } else {
      grad.addColorStop(0,   `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},0.4)`);
      grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    }
    c.fillStyle = grad;
    c.fillRect(0, 0, RADIAL_SPRITE_R * 2, RADIAL_SPRITE_R * 2);
    _radialSpriteCache.set(key, oc);
  }
  return oc;
}

/**
 * Release all module-level render caches (OffscreenCanvases + sprite maps).
 * Call on canvas teardown so several full-screen bitmaps don't outlive the
 * component for the rest of the page lifetime — matters on memory-constrained
 * WebViews. Mirrors clearBallRenderCache / clearBallEffectsCache.
 */
export function clearRenderFrameCache(): void {
  _shadowGradCache.clear();
  _shadowGradBoardKey = '';
  _rimOC = null;
  _rimOCKey = '';
  _obstacleGlowOC = null;
  _obstacleGlowKey = '';
  _obstacleGlowPolys = null;
  _mirrorGlowOC = null;
  _mirrorGlowKey = '';
  _mirrorGlowPolys = null;
  _dangerFrameOC = null;
  _dangerFrameKey = '';
  _pulseSpriteCache.clear();
  _radialSpriteCache.clear();
  _fenceClipCache.key = '';
  _fenceClipCache.board = null;
  _fenceClipCache.polys = null;
  _fenceClipCache.path = null;
  _obstacleHolesCache.key = '';
  _obstacleHolesCache.polys = null;
  _obstacleHolesCache.path = null;
}

export function createRainParticles(count: number): import("./types").RainParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 15 + Math.random() * (BOARD_WIDTH - 30),
    y: -10 - (i / count) * BOARD_HEIGHT,
    symbol: RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)],
    alpha: 0.03 + Math.random() * 0.04,
    speed: 30 + Math.random() * 50,
    size: 15 + Math.random() * 10,
  }));
}

// ── Coordinate helper ─────────────────────────────────────────────────────

function worldToScreen(worldX: number, worldY: number, boardRect: BoardRect) {
  return {
    x: boardRect.left + worldX * boardRect.scale,
    y: boardRect.top  + worldY * boardRect.scale,
  };
}

// ── Destructible damage cracks (Phase 2) ──────────────────────────────────
// Stateless, deterministic crack lines derived from a polygon + hit count, so
// they're stable per object (and track a moving mover, which is rebuilt each
// frame). Computed at runtime since object size/shape varies.

function _hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function _mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Trace a jagged version of a polygon onto ctx (current path). Each edge is
 * subdivided and its points nudged perpendicular by a seeded amount, so the
 * silhouette reads as chipped/broken. Bigger ampWorld = more frayed.
 */
function traceJaggedPath(
  ctx: CanvasRenderingContext2D,
  w2s: (x: number, y: number) => { x: number; y: number },
  verts: { x: number; y: number }[],
  ampWorld: number,
  rng: () => number,
): void {
  const SUB = 3; // subdivisions per edge
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const el = Math.hypot(ex, ey) || 1;
    const px = -ey / el, py = ex / el; // unit perpendicular
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB;
      const off = (rng() * 2 - 1) * ampWorld;
      const sp = w2s(a.x + ex * t + px * off, a.y + ey * t + py * off);
      if (first) { ctx.moveTo(sp.x, sp.y); first = false; } else ctx.lineTo(sp.x, sp.y);
    }
  }
  ctx.closePath();
}

/**
 * Trace a polygon with mostly-random small fray, but a guaranteed inward DENT
 * at each impact point (where a ball struck). Used for breakable obstacles so
 * the player can read exactly where their hits landed.
 */
function traceDentedPath(
  ctx: CanvasRenderingContext2D,
  w2s: (x: number, y: number) => { x: number; y: number },
  verts: { x: number; y: number }[],
  baseAmp: number,
  dents: { x: number; y: number }[],
  dentDepth: number,
  dentRadius: number,
  rng: () => number,
  bounds?: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  let cx = 0, cy = 0;
  for (const v of verts) { cx += v.x; cy += v.y; }
  cx /= verts.length; cy /= verts.length;

  const EDGE = 7; // world units: points this close to a board edge stay pinned to it
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const el = Math.hypot(ex, ey) || 1;
    const px = -ey / el, py = ex / el;
    const sub = Math.max(2, Math.round(el / 20)); // ~one point every 20 world units
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const baseX = a.x + ex * t, baseY = a.y + ey * t;
      let wx = baseX, wy = baseY;

      // Strongest nearby impact wins.
      let dent = 0;
      for (const imp of dents) {
        const dd = Math.hypot(wx - imp.x, wy - imp.y);
        if (dd < dentRadius) dent = Math.max(dent, 1 - dd / dentRadius);
      }

      if (dent > 0) {
        // Pull the border toward the centre — a clear inward dent at the hit.
        const tox = cx - wx, toy = cy - wy;
        const tl = Math.hypot(tox, toy) || 1;
        wx += (tox / tl) * dentDepth * dent;
        wy += (toy / tl) * dentDepth * dent;
      } else {
        const off = (rng() * 2 - 1) * baseAmp;
        wx += px * off; wy += py * off;
      }

      // Keep edges that sit against the gameboard border flush to it: points
      // whose base is on a board edge are pinned there; everything else is
      // clamped inside the board so nothing overhangs the rim.
      if (bounds) {
        if (Math.abs(baseX - bounds.minX) < EDGE) wx = bounds.minX;
        else if (Math.abs(baseX - bounds.maxX) < EDGE) wx = bounds.maxX;
        else wx = Math.max(bounds.minX, Math.min(bounds.maxX, wx));
        if (Math.abs(baseY - bounds.minY) < EDGE) wy = bounds.minY;
        else if (Math.abs(baseY - bounds.maxY) < EDGE) wy = bounds.maxY;
        else wy = Math.max(bounds.minY, Math.min(bounds.maxY, wy));
      }

      const sp = w2s(wx, wy);
      if (first) { ctx.moveTo(sp.x, sp.y); first = false; } else ctx.lineTo(sp.x, sp.y);
    }
  }
  ctx.closePath();
}

/** Bold jagged damage outline in the object's colour (mirrors/movers). */
function drawDamageCracks(
  ctx: CanvasRenderingContext2D,
  w2s: (x: number, y: number) => { x: number; y: number },
  poly: { vertices: { x: number; y: number }[] },
  level: number,
  seedKey: string,
  scale: number,
  color: string,
): void {
  const verts = poly.vertices;
  if (level <= 0 || verts.length < 3) return;
  const col = color || '#ffffff';
  const rng = _mulberry(_hashStr(seedKey));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  traceJaggedPath(ctx, w2s, verts, 3 + level * 4, rng);
  ctx.strokeStyle = hexToRgba(col, Math.min(1, 0.7 + level * 0.2));
  ctx.lineWidth = Math.max(1.5, 2.4 * scale);
  ctx.stroke();
  ctx.restore();
}

// ── Main render entry point ───────────────────────────────────────────────

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  game: CanvasGameState,
  rctx: RenderContext,
): void {
  const {
    regions,
    walls,
    balls,
    activeWall: wall,
    screenSize,
    boardRect,
    backgroundColor: _backgroundColor,
    regionColor: _regionColor,
    swipeStart,
    swipeRegionId,
    currentSwipePos,
  } = game;
  const { width: screenWidth, height: screenHeight } = screenSize;
  const { scale } = boardRect;
  const { accentColor, activeModifiers, boardGridCanvas, regionCanvas, rain } = rctx;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const w2s = (wx: number, wy: number) => worldToScreen(wx, wy, boardRect);

  // ── Clear ─────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, screenWidth, screenHeight);

  // ── Ambient data rain ─────────────────────────────────────────────────────
  {
    const now = performance.now();
    const dtRain = rain.lastTime ? Math.min((now - rain.lastTime) / 1000, 0.05) : 0;
    rain.lastTime = now;
    const { scale: s, left: bx, top: by } = game.boardRect;
    ctx.save();
    ctx.font = `${Math.round(14 * s)}px 'JetBrains Mono', monospace`;
    ctx.textBaseline = 'top';
    for (const p of rain.particles) {
      p.y += p.speed * dtRain;
      if (p.y > BOARD_HEIGHT + 20) {
        p.y = -(10 + Math.random() * 60);
        p.x = 15 + Math.random() * (BOARD_WIDTH - 30);
        p.symbol = RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)];
        p.alpha = 0.03 + Math.random() * 0.04;
        p.speed = 30 + Math.random() * 50;
      }
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = accentColor;
      ctx.fillText(p.symbol, bx + p.x * s, by + p.y * s);
    }
    ctx.restore();
  }

  // ── Board grid + region fill ──────────────────────────────────────────────
  ctx.drawImage(boardGridCanvas, 0, 0);
  ctx.drawImage(regionCanvas, 0, 0);

  // ── Wall shadow quads ─────────────────────────────────────────────────────
  {
    const shadowW = 7 * scale;
    // Invalidate gradient cache when boardRect changes (resize or level start).
    const curBoardKey = `${Math.round(scale * 10000)}_${Math.round(boardRect.left)}_${Math.round(boardRect.top)}`;
    if (curBoardKey !== _shadowGradBoardKey) {
      _shadowGradCache.clear();
      _pulseSpriteCache.clear(); // sprite sizes depend on scale
      _shadowGradBoardKey = curBoardKey;
    }
    ctx.save();
    // Clip to board polygon so shadow quads don't bleed into the margin.
    if (game.boardPolygon) {
      ctx.beginPath();
      const sv = game.boardPolygon.vertices;
      const sv0 = w2s(sv[0].x, sv[0].y);
      ctx.moveTo(sv0.x, sv0.y);
      for (let i = 1; i < sv.length; i++) { const svp = w2s(sv[i].x, sv[i].y); ctx.lineTo(svp.x, svp.y); }
      ctx.closePath();
      ctx.clip();
    } else {
      ctx.beginPath();
      ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
      ctx.clip();
    }
    for (const w of walls) {
      if (!w.id.startsWith('wall-')) continue;
      const s = w2s(w.start.x, w.start.y);
      const e = w2s(w.end.x, w.end.y);
      const dxW = e.x - s.x;
      const dyW = e.y - s.y;
      const lenW = Math.sqrt(dxW * dxW + dyW * dyW);
      if (lenW < 1) continue;
      const nx = -dyW / lenW;
      const ny =  dxW / lenW;
      // Reuse the cached gradient; create once per wall per boardRect configuration.
      let grad = _shadowGradCache.get(w.id);
      if (!grad) {
        const midX = (s.x + e.x) / 2;
        const midY = (s.y + e.y) / 2;
        grad = ctx.createLinearGradient(
          midX + nx * shadowW, midY + ny * shadowW,
          midX - nx * shadowW, midY - ny * shadowW,
        );
        grad.addColorStop(0,   'rgba(0,0,0,0)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
        grad.addColorStop(1,   'rgba(0,0,0,0)');
        _shadowGradCache.set(w.id, grad);
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(s.x + nx * shadowW, s.y + ny * shadowW);
      ctx.lineTo(e.x + nx * shadowW, e.y + ny * shadowW);
      ctx.lineTo(e.x - nx * shadowW, e.y - ny * shadowW);
      ctx.lineTo(s.x - nx * shadowW, s.y - ny * shadowW);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Moving obstacles ──────────────────────────────────────────────────────
  if (game.movers.length > 0) {
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 320);  // 0–1 pulse
    const MOVER_COLOR = '#ff8800';
    const TRACK_COLOR = 'rgba(255,136,0,0.18)';

    ctx.save();
    ctx.beginPath();
    ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
    ctx.clip();

    for (const mover of game.movers) {
      const dx = mover.axis === 'horizontal' ? mover.offset : 0;
      const dy = mover.axis === 'vertical'   ? mover.offset : 0;
      const cx = mover.homeX + dx;
      const cy = mover.homeY + dy;
      const sc = w2s(cx, cy);
      const half = mover.range / 2;

      // Track line
      const trackA = mover.axis === 'horizontal'
        ? w2s(mover.homeX - half, mover.homeY)
        : w2s(mover.homeX, mover.homeY - half);
      const trackB = mover.axis === 'horizontal'
        ? w2s(mover.homeX + half, mover.homeY)
        : w2s(mover.homeX, mover.homeY + half);
      ctx.strokeStyle = TRACK_COLOR;
      ctx.lineWidth   = 2 * scale;
      ctx.setLineDash([6 * scale, 5 * scale]);
      ctx.beginPath();
      ctx.moveTo(trackA.x, trackA.y);
      ctx.lineTo(trackB.x, trackB.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Body fill + glow — pulse-bucketed sprite (glow stroke uses shadowBlur,
      // far too expensive to repaint per frame; 9 buckets ≈ the rim-light trick).
      {
        const bucket = Math.round(pulse * 8); // 0..8
        const dimKey = mover.shape === 'circle'
          ? `c${mover.radius ?? 30}`
          : `r${mover.width ?? 60}x${mover.height ?? 60}`;
        const key = `mover_${dimKey}_${bucket}`;
        let sprite = _pulseSpriteCache.get(key);
        if (!sprite) {
          const bp = bucket / 8;
          const lw = (1.5 + bp * 1.5) * scale;
          const blur = (6 + bp * 10) * scale;
          const halfW = (mover.shape === 'circle' ? (mover.radius ?? 30) : (mover.width ?? 60) / 2) * scale;
          const halfH = (mover.shape === 'circle' ? (mover.radius ?? 30) : (mover.height ?? 60) / 2) * scale;
          const pad = Math.ceil(blur + lw + 2);
          sprite = new OffscreenCanvas(Math.ceil(halfW * 2) + pad * 2, Math.ceil(halfH * 2) + pad * 2);
          const c = sprite.getContext('2d')!;
          const cxs = sprite.width / 2, cys = sprite.height / 2;
          c.beginPath();
          if (mover.shape === 'circle') {
            c.arc(cxs, cys, halfW, 0, Math.PI * 2);
          } else {
            c.rect(cxs - halfW, cys - halfH, halfW * 2, halfH * 2);
          }
          c.closePath();
          c.fillStyle   = `rgba(255,${Math.round(80 + bp * 30)},0,0.22)`;
          c.fill();
          c.strokeStyle = MOVER_COLOR;
          c.lineWidth   = lw;
          c.shadowColor = MOVER_COLOR;
          c.shadowBlur  = blur;
          c.stroke();
          _pulseSpriteCache.set(key, sprite);
        }
        ctx.drawImage(sprite, Math.round(sc.x - sprite.width / 2), Math.round(sc.y - sprite.height / 2));
      }

      // Hazard arrow showing current direction of travel
      const arrowSize = (mover.shape === 'circle' ? (mover.radius ?? 30) : Math.min(mover.width ?? 60, mover.height ?? 60) / 2) * 0.55 * scale;
      const arrowDx = mover.axis === 'horizontal' ? mover.direction : 0;
      const arrowDy = mover.axis === 'vertical'   ? mover.direction : 0;
      const tip  = { x: sc.x + arrowDx * arrowSize, y: sc.y + arrowDy * arrowSize };
      const base = { x: sc.x - arrowDx * arrowSize * 0.5, y: sc.y - arrowDy * arrowSize * 0.5 };
      const perp = arrowSize * 0.45;
      ctx.fillStyle   = MOVER_COLOR;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(base.x - arrowDy * perp, base.y + arrowDx * perp);
      ctx.lineTo(base.x + arrowDy * perp, base.y - arrowDx * perp);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Black-ball damage cracks (computed from the mover's live polygon so they
      // travel with it).
      const dmover = game.destructibles.find(d => d.kind === 'mover' && !d.destroyed && d.moverId === mover.id);
      if (dmover && dmover.hits > 0) {
        drawDamageCracks(ctx, w2s, mover.polygon, dmover.hits, `mover-${mover.id}`, scale, MOVER_COLOR);
      }
    }

    ctx.restore();
  }

  // ── Obstacle outlines (non-mirror) ───────────────────────────────────────
  // Straight lineTo paths keep the visual boundary pixel-identical to the
  // physics polygon. buildSmoothPath (Catmull-Rom) bows outward, making the
  // visual oval larger than the physics rect — fences correctly stopped at
  // the physics edge but visually appeared to enter the obstacle interior.
  // Static for the whole level → prerendered once to an OffscreenCanvas
  // (the glow stroke uses shadowBlur, which is too expensive per frame).
  {
    const layerKey = `${accentColor}_${Math.round(boardRect.left)}_${Math.round(boardRect.top)}_${Math.round(scale * 10000)}_${screenWidth}x${screenHeight}`;
    if (_obstacleGlowKey !== layerKey || _obstacleGlowPolys !== game.obstaclePolygons) {
      _obstacleGlowKey = layerKey;
      _obstacleGlowPolys = game.obstaclePolygons;
      _obstacleGlowOC = new OffscreenCanvas(Math.max(1, screenWidth), Math.max(1, screenHeight));
      const c = _obstacleGlowOC.getContext('2d')!;
      const mirrorSet = new Set(game.mirrorPolygons);
      // Breakable obstacles get a distinct per-frame look (below), so skip them.
      const breakableSet = new Set(game.destructibles.filter(d => d.kind === 'breakable' && d.obstaclePolygon).map(d => d.obstaclePolygon));
      c.strokeStyle = accentColor;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = WALL_THICKNESS * scale;
      c.shadowColor = accentColor;
      c.shadowBlur = 6 * scale;
      for (const poly of game.obstaclePolygons) {
        if (mirrorSet.has(poly) || breakableSet.has(poly)) continue;
        const sv = poly.vertices.map(v => w2s(v.x, v.y));
        c.beginPath();
        c.moveTo(sv[0].x, sv[0].y);
        for (let i = 1; i < sv.length; i++) c.lineTo(sv[i].x, sv[i].y);
        c.closePath();
        c.stroke();
      }
    }
    if (_obstacleGlowOC) ctx.drawImage(_obstacleGlowOC, 0, 0);
  }

  // ── Breakable obstacles (issue #38) ───────────────────────────────────────
  // All breakables (blocks and border-attached gates) use the same look: a
  // softly rugged amber outline + fill, with a clear inward dent where each ball
  // hit. Clipped to the board, and edges on the board rim stay pinned flush.
  {
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    if (game.boardPolygon) {
      for (const v of game.boardPolygon.vertices) {
        if (v.x < bMinX) bMinX = v.x; if (v.x > bMaxX) bMaxX = v.x;
        if (v.y < bMinY) bMinY = v.y; if (v.y > bMaxY) bMaxY = v.y;
      }
    }
    const bounds = game.boardPolygon ? { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY } : undefined;

    ctx.save();
    ctx.beginPath();
    ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
    ctx.clip();
    for (const d of game.destructibles) {
      if (d.kind !== 'breakable' || d.destroyed || !d.obstaclePolygon) continue;
      const poly = d.obstaclePolygon;
      const amber = d.objective ? '#ffb454' : '#ffcf7a';
      const dmg = d.maxHits > 0 ? Math.min(1, d.hits / d.maxHits) : 0;
      const rng = _mulberry(_hashStr(`break-${d.id}`));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // baseAmp 0 when pristine → clean (but board-pinned) outline.
      traceDentedPath(ctx, w2s, poly.vertices, d.hits > 0 ? 1.5 + dmg * 4 : 0, d.dents ?? [], 16, 34, rng, bounds);
      ctx.fillStyle = d.hits > 0 ? hexToRgba(amber, 0.2 * (1 - dmg * 0.7)) : 'rgba(255,180,84,0.12)';
      ctx.fill();
      ctx.lineWidth = Math.max(2, WALL_THICKNESS * scale * (1 - dmg * 0.25));
      ctx.strokeStyle = d.hits > 0 ? hexToRgba(amber, 0.95) : amber;
      ctx.shadowColor = amber;
      ctx.shadowBlur = (d.hits > 0 ? 8 : 7) * scale;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore(); // breakable board clip
  }

  // ── Unified wall render loop ───────────────────────────────────────────────
  ctx.save();
  ctx.fillStyle = accentColor;
  ctx.strokeStyle = accentColor;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
  ctx.clip();

  const obstacles = game.obstaclePolygons;

  const strokeSegment = (
    ss: { x: number; y: number }, es: { x: number; y: number },
    ws: { x: number; y: number }, we: { x: number; y: number },
    baseWidth: number,
    glowBoost = 0,
  ) => {
    renderWallWithEffects(ctx, ss, es, ws, we, scale, accentColor, baseWidth, glowBoost);
  };

  // ── Pass 1: user-drawn fence walls, clipped to the board polygon ──────────
  // The square-cap extension in renderWallWithEffects pushes fence endpoints
  // tangentially past the board wall centre line into the margin.  Clipping to
  // the board polygon (not just boardRect) eliminates that protrusion.
  // Walls and obstacles are immutable once created, so the obstacle clipping
  // of each wall is computed once and cached per wall object (it previously
  // re-clipped every wall against every obstacle polygon on every frame).
  const getClippedSegs = (w: typeof walls[number]) => {
    let segs = _wallClipSegs.get(w);
    if (!segs) {
      segs = clipLineAgainstPolygons(w.start, w.end, obstacles);
      _wallClipSegs.set(w, segs);
    }
    return segs;
  };

  if (game.boardPolygon) {
    ctx.save();
    // Board polygon with obstacle holes — static per level, cached as Path2D.
    {
      const clipKey = `${Math.round(boardRect.left)}_${Math.round(boardRect.top)}_${Math.round(scale * 10000)}`;
      if (_fenceClipCache.key !== clipKey || _fenceClipCache.board !== game.boardPolygon || _fenceClipCache.polys !== obstacles) {
        _fenceClipCache.key = clipKey;
        _fenceClipCache.board = game.boardPolygon;
        _fenceClipCache.polys = obstacles;
        const path = new Path2D();
        const bpv = game.boardPolygon.vertices;
        const bp0 = w2s(bpv[0].x, bpv[0].y);
        path.moveTo(bp0.x, bp0.y);
        for (let i = 1; i < bpv.length; i++) {
          const bpt = w2s(bpv[i].x, bpv[i].y);
          path.lineTo(bpt.x, bpt.y);
        }
        path.closePath();
        // Punch obstacle polygons as holes so thick stroke can't bleed inside them.
        for (const poly of obstacles) {
          const sv0 = w2s(poly.vertices[0].x, poly.vertices[0].y);
          path.moveTo(sv0.x, sv0.y);
          for (let i = 1; i < poly.vertices.length; i++) {
            const svp = w2s(poly.vertices[i].x, poly.vertices[i].y);
            path.lineTo(svp.x, svp.y);
          }
          path.closePath();
        }
        _fenceClipCache.path = path;
      }
      ctx.clip(_fenceClipCache.path!, 'evenodd');
    }

    const nowMs = performance.now();
    for (let wi = walls.length - 1; wi >= 0; wi--) {
      const w = walls[wi];
      if (!w.id.startsWith("wall-")) continue;
      const wallLineWidth = w.thickness * scale;
      const freshness = w.createdAt ? Math.max(0, 1 - (nowMs - w.createdAt) / 400) : 0;
      if (obstacles.length > 0) {
        const segments = getClippedSegs(w);
        for (const seg of segments) {
          strokeSegment(w2s(seg.start.x, seg.start.y), w2s(seg.end.x, seg.end.y), seg.start, seg.end, wallLineWidth, freshness);
        }
      } else {
        strokeSegment(w2s(w.start.x, w.start.y), w2s(w.end.x, w.end.y), w.start, w.end, wallLineWidth, freshness);
      }

      // Ascension durability: crumble overlay — damaged fences darken and turn
      // increasingly gap-toothed as their remaining hits run out.
      const damage = w.maxHits && w.hitsLeft !== undefined ? 1 - w.hitsLeft / w.maxHits : 0;
      if (damage > 0) {
        ctx.save();
        ctx.strokeStyle = `rgba(0, 0, 0, ${(0.25 + 0.45 * damage).toFixed(3)})`;
        ctx.lineWidth = wallLineWidth * 0.9;
        ctx.lineCap = 'round';
        ctx.setLineDash([4 * scale, (2 + damage * 7) * scale]);
        const overlaySeg = (a: Vector2, b: Vector2) => {
          const s = w2s(a.x, a.y);
          const e = w2s(b.x, b.y);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);
          ctx.stroke();
        };
        if (obstacles.length > 0) {
          for (const seg of getClippedSegs(w)) overlaySeg(seg.start, seg.end);
        } else {
          overlaySeg(w.start, w.end);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // ── Pass 2: board-edge walls, drawn on top (clipped to boardRect only) ────
  for (let wi = walls.length - 1; wi >= 0; wi--) {
    const w = walls[wi];
    if (w.isMirror) continue;
    if (!w.id.startsWith("board-")) continue;
    const wallLineWidth = w.thickness * scale;
    if (obstacles.length > 0) {
      const segments = getClippedSegs(w);
      for (const seg of segments) {
        strokeSegment(w2s(seg.start.x, seg.start.y), w2s(seg.end.x, seg.end.y), seg.start, seg.end, wallLineWidth);
      }
    } else {
      strokeSegment(w2s(w.start.x, w.start.y), w2s(w.end.x, w.end.y), w.start, w.end, wallLineWidth);
    }
  }
  ctx.restore();

  // ── Hard-clear outside boardRect (first pass) ────────────────────────────
  {
    const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
    const sw = game.screenSize.width;
    const sh = game.screenSize.height;
    ctx.clearRect(0,       0,        sw,             bt);
    ctx.clearRect(0,       bt + bh,  sw,             sh - (bt + bh));
    ctx.clearRect(0,       bt,       bl,             bh);
    ctx.clearRect(bl + bw, bt,       sw - (bl + bw), bh);
  }

  // ── Neon rim light ────────────────────────────────────────────────────────
  // Pre-rendered to an OffscreenCanvas and updated only when the slow pulse
  // crosses a bucket boundary (~10 repaints/sec instead of 60).
  {
    const { left: rl, top: rt, width: rw, height: rh } = boardRect;
    const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.0014);
    // 40 buckets over the 0.8–1.0 pulse range → repaint at most ~20/sec
    const pulseBucket = Math.round(pulse * 40);
    const rimKey = `${accentColor}_${Math.round(rw)}_${Math.round(rh)}_${pulseBucket}_${Math.round(scale * 100)}`;
    if (_rimOCKey !== rimKey) {
      _rimOCKey = rimKey;
      const margin = 25 * scale; // headroom for largest shadowBlur (20*scale)
      const ocW = Math.ceil(rw + margin * 2);
      const ocH = Math.ceil(rh + margin * 2);
      _rimOC = new OffscreenCanvas(ocW, ocH);
      const rCtx = _rimOC.getContext('2d')!;
      const cornerSz = 6 * scale;
      const layers = [
        { lw: 10 * scale, blur: 20 * scale, alpha: 0.10 * pulse },
        { lw: 4  * scale, blur: 10 * scale, alpha: 0.30 * pulse },
        { lw: 1.5 * scale, blur: 4  * scale, alpha: 0.85 * pulse },
      ];
      rCtx.strokeStyle = accentColor;
      for (const { lw, blur, alpha } of layers) {
        rCtx.globalAlpha = alpha;
        rCtx.lineWidth = lw;
        rCtx.shadowColor = accentColor;
        rCtx.shadowBlur = blur;
        rCtx.strokeRect(margin, margin, rw, rh);
      }
      rCtx.globalAlpha = 0.9 * pulse;
      rCtx.shadowBlur = 8 * scale;
      rCtx.fillStyle = accentColor;
      for (const [cx, cy] of [[margin, margin], [margin + rw, margin], [margin, margin + rh], [margin + rw, margin + rh]] as [number, number][]) {
        rCtx.fillRect(cx - cornerSz / 2, cy - cornerSz / 2, cornerSz, cornerSz);
      }
    }
    ctx.drawImage(_rimOC!, Math.round(rl - 25 * scale), Math.round(rt - 25 * scale));
  }

  // ── Speed danger tint ─────────────────────────────────────────────────────
  {
    const activeBalls = balls.filter(b => b.speed > 0);
    if (activeBalls.length > 0) {
      // Flat speeds (issue #37): danger is measured against an absolute reference
      // speed rather than each ball's (now equal) top speed.
      const maxDanger = activeBalls.reduce((m, b) => Math.max(m, b.speed / BALL_DANGER_SPEED), 0);
      if (maxDanger > 0.55) {
        const { left: rl, top: rt, width: rw, height: rh } = boardRect;
        const dangerT = Math.min(1, (maxDanger - 0.55) / 0.45);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006 + Math.PI);
        // Glow baked once (blur is constant); only alpha pulses, which
        // globalAlpha reproduces exactly.
        const margin = Math.ceil(18 * scale + 5 * scale);
        const dangerKey = `${Math.round(rw)}x${Math.round(rh)}_${Math.round(scale * 100)}`;
        if (_dangerFrameKey !== dangerKey) {
          _dangerFrameKey = dangerKey;
          _dangerFrameOC = new OffscreenCanvas(Math.ceil(rw) + margin * 2, Math.ceil(rh) + margin * 2);
          const c = _dangerFrameOC.getContext('2d')!;
          c.strokeStyle = '#ff2244';
          c.shadowColor = '#ff2244';
          c.shadowBlur = 18 * scale;
          c.lineWidth = 5 * scale;
          c.strokeRect(margin, margin, rw, rh);
        }
        ctx.save();
        ctx.globalAlpha = dangerT * 0.45 * (0.55 + 0.45 * pulse);
        ctx.drawImage(_dangerFrameOC!, Math.round(rl - margin), Math.round(rt - margin));
        ctx.restore();
      }
    }
  }

  // ── Mirror polygon fills + outlines ──────────────────────────────────────
  // Mirrors are static for the whole level; the glow stroke uses shadowBlur,
  // so the whole layer is prerendered once and blitted per frame.
  if (game.mirrorPolygons.length > 0) {
    const layerKey = `${Math.round(boardRect.left)}_${Math.round(boardRect.top)}_${Math.round(scale * 10000)}_${screenWidth}x${screenHeight}`;
    if (_mirrorGlowKey !== layerKey || _mirrorGlowPolys !== game.mirrorPolygons) {
      _mirrorGlowKey = layerKey;
      _mirrorGlowPolys = game.mirrorPolygons;
      _mirrorGlowOC = new OffscreenCanvas(Math.max(1, screenWidth), Math.max(1, screenHeight));
      const c = _mirrorGlowOC.getContext('2d')!;
      // Exact straight-edge path of the physics polygon. Never smooth this:
      // a Catmull-Rom spline bows outward — on thin mirror rects the rendered
      // "lens" tip extended ~60 world units past the physics polygon, making
      // fences appear to pass through mirrors. The drawn boundary must match
      // the physics edges exactly; the thick round-joined stroke softens the
      // corners visually.
      const tracePath = (verts: { x: number; y: number }[]) => {
        c.beginPath();
        const sv0 = w2s(verts[0].x, verts[0].y);
        c.moveTo(sv0.x, sv0.y);
        for (let i = 1; i < verts.length; i++) {
          const svp = w2s(verts[i].x, verts[i].y);
          c.lineTo(svp.x, svp.y);
        }
        c.closePath();
      };
      c.fillStyle = "rgba(136, 221, 255, 0.15)";
      for (const poly of game.mirrorPolygons) {
        if (poly.vertices.length < 3) continue;
        tracePath(poly.vertices);
        c.fill();
      }
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = WALL_THICKNESS * scale;
      c.strokeStyle = "#88ddff";
      c.shadowColor = "#88ddff";
      c.shadowBlur = 8 * scale;
      for (const poly of game.mirrorPolygons) {
        tracePath(poly.vertices);
        c.stroke();
      }
      c.strokeStyle = "rgba(255, 255, 255, 0.4)";
      c.lineWidth = 1 * scale;
      c.shadowBlur = 0;
      for (const poly of game.mirrorPolygons) {
        tracePath(poly.vertices);
        c.stroke();
      }
    }
    if (_mirrorGlowOC) ctx.drawImage(_mirrorGlowOC, 0, 0);
  }

  // ── Mirror damage cracks (Phase 2: black ball) ────────────────────────────
  for (const d of game.destructibles) {
    if (d.kind === 'mirror' && !d.destroyed && d.hits > 0 && d.mirrorPolygon) {
      drawDamageCracks(ctx, w2s, d.mirrorPolygon, d.hits, `mirror-${d.id}`, scale, '#88ddff');
    }
  }

  // ── Object destruction debris (Phase 2) ───────────────────────────────────
  if (game.objectDebris.length > 0) {
    const nowD = performance.now();
    let anyExpired = false;
    for (const debris of game.objectDebris) {
      const elapsed = nowD - debris.startTime;
      if (elapsed >= debris.durationMs) { anyExpired = true; continue; }
      const t = elapsed / 1000;                 // seconds for physics
      const prog = elapsed / debris.durationMs; // 0..1 for fade
      const alpha = 1 - prog;
      const cr = parseInt(debris.color.slice(1, 3), 16);
      const cg = parseInt(debris.color.slice(3, 5), 16);
      const cb = parseInt(debris.color.slice(5, 7), 16);
      ctx.save();
      for (const p of debris.particles) {
        const wx = p.x + p.vx * t;
        const wy = p.y + p.vy * t + 220 * t * t; // gravity
        const s = w2s(wx, wy);
        const size = p.size * scale * (1 - prog * 0.5);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(p.rotation + p.rotSpeed * t);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
      ctx.restore();
    }
    if (anyExpired) {
      game.objectDebris = game.objectDebris.filter(dd => nowD - dd.startTime < dd.durationMs);
    }
  }

  // ── Falling obstacles (issue #38: toppled stacks) ─────────────────────────
  if (game.fallingObjects.length > 0) {
    const nowF = performance.now();
    let expired = false;
    for (const fo of game.fallingObjects) {
      const elapsed = nowF - fo.startTime;
      if (elapsed >= fo.durationMs) {
        expired = true;
        if (!fo.shattered) {
          fo.shattered = true;
          // Shatter on landing: a debris burst at the object's final position.
          const finalY = fo.fallSpeed * (fo.durationMs / 1000) + 320 * (fo.durationMs / 1000) ** 2;
          let cx = 0, cy = 0;
          for (const v of fo.vertices) { cx += v.x; cy += v.y; }
          cx /= fo.vertices.length; cy /= fo.vertices.length;
          const particles = fo.vertices.map(v => {
            const dx = v.x - cx, dy = v.y - cy;
            const len = Math.hypot(dx, dy) || 1;
            const speed = 60 + Math.random() * 120;
            return {
              x: v.x, y: v.y + finalY,
              vx: (dx / len) * speed + (Math.random() - 0.5) * 30,
              vy: (dy / len) * speed - 40,
              rotation: Math.random() * Math.PI * 2,
              rotSpeed: (Math.random() - 0.5) * 10,
              size: 5 + Math.random() * 9,
            };
          });
          game.objectDebris.push({ startTime: nowF, durationMs: 500, color: fo.color, particles });
        }
        continue;
      }
      const t = elapsed / 1000;
      const prog = elapsed / fo.durationMs;
      const fallY = fo.fallSpeed * t + 320 * t * t; // accelerating toward the bottom
      const alpha = 1 - prog;
      const cr = parseInt(fo.color.slice(1, 3), 16);
      const cg = parseInt(fo.color.slice(3, 5), 16);
      const cb = parseInt(fo.color.slice(5, 7), 16);
      ctx.save();
      ctx.beginPath();
      const v0 = w2s(fo.vertices[0].x, fo.vertices[0].y + fallY);
      ctx.moveTo(v0.x, v0.y);
      for (let i = 1; i < fo.vertices.length; i++) {
        const p = w2s(fo.vertices[i].x, fo.vertices[i].y + fallY);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${(alpha * 0.45).toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      ctx.restore();
    }
    if (expired) game.fallingObjects = game.fallingObjects.filter(fo => nowF - fo.startTime < fo.durationMs);
  }

  // ── Cut preview line during drag ──────────────────────────────────────────
  if (swipeStart && swipeRegionId && currentSwipePos && !wall) {
    const delta = vec2Sub(currentSwipePos, swipeStart);
    const dist = vec2Length(delta);

    if (dist >= 5) {
      const direction = vec2Normalize(delta);
      const negDir = { x: -direction.x, y: -direction.y };
      const fwdPreview = castRayWithReflections(swipeStart, direction, walls);
      const bwdPreview = castRayWithReflections(swipeStart, negDir, walls);

      if (fwdPreview && bwdPreview) {
        // Issue #38: a fence can't anchor on a breakable — show the preview in
        // red so the player sees the cut will "dud" before releasing.
        const fEnd = fwdPreview.waypoints[fwdPreview.waypoints.length - 1];
        const bEnd = bwdPreview.waypoints[bwdPreview.waypoints.length - 1];
        const isDud = cutAnchorsBreakable(game, fEnd, bEnd, WALL_THICKNESS + 6);
        const outerColor = isDud ? "#ff8080" : "#ffffff";
        const innerColor = isDud ? "#ff2a2a" : accentColor;
        const dotColor   = isDud ? "#ff5b5b" : "#88ddff";

        ctx.save();
        ctx.globalAlpha = isDud ? 0.3 : 0.15;
        ctx.beginPath();
        ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
        ctx.clip();

        const previewThickness = WALL_THICKNESS;
        const allWaypoints = [fwdPreview.waypoints, bwdPreview.waypoints];
        for (const waypoints of allWaypoints) {
          for (let i = 0; i < waypoints.length - 1; i++) {
            const s = w2s(waypoints[i].x, waypoints[i].y);
            const e = w2s(waypoints[i + 1].x, waypoints[i + 1].y);
            const dx = e.x - s.x, dy = e.y - s.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) continue;
            const invLen = 1 / len;

            const drawPoly = (hw: number, color: string) => {
              const px = -dy * invLen * hw, py = dx * invLen * hw;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.moveTo(s.x + px, s.y + py);
              ctx.lineTo(e.x + px, e.y + py);
              ctx.lineTo(e.x - px, e.y - py);
              ctx.lineTo(s.x - px, s.y - py);
              ctx.closePath();
              ctx.fill();
            };

            drawPoly((previewThickness + 8) * scale / 2, outerColor);
            drawPoly((previewThickness + 4) * scale / 2, innerColor);
          }
        }

        ctx.globalAlpha = 0.4;
        for (const waypoints of allWaypoints) {
          for (let i = 1; i < waypoints.length - 1; i++) {
            const pt = w2s(waypoints[i].x, waypoints[i].y);
            ctx.fillStyle = dotColor;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4 * scale, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
  }

  // ── Swipe afterglow (issue #35) ───────────────────────────────────────────
  // A brief fading streak tracing the gesture that produced the latest fence,
  // in the current game colour. Subtle — it reads as feedback, not decoration.
  if (game.swipeTrail) {
    const age = performance.now() - game.swipeTrail.createdAt;
    if (age >= SWIPE_TRAIL_DURATION) {
      game.swipeTrail = null;
    } else {
      const t = age / SWIPE_TRAIL_DURATION;
      const ease = 1 - t * t;            // ease-out fade

      // Truncate the gesture at the first wall/obstacle crossing from its
      // start, so the afterglow never continues past a wall or obstacle.
      // (The start is guaranteed clear of walls by handlePointerDown, and the
      // resulting fence is collinear with the gesture so it never self-clips.)
      const startW = game.swipeTrail.start;
      const endW   = game.swipeTrail.end;
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
        for (const wl of walls) consider(wl.start, wl.end);
        for (const poly of game.obstaclePolygons) {
          const v = poly.vertices;
          for (let i = 0; i < v.length; i++) consider(v[i], v[(i + 1) % v.length]);
        }
      }
      // Pull the endpoint just short of the crossing so it doesn't sit on top.
      if (crossed) drawLen = Math.max(0, drawLen - WALL_THICKNESS * 0.5);
      const dir = fullLen > 0.001 ? vec2Normalize(vec2Sub(endW, startW)) : { x: 0, y: 0 };
      const drawEndW = { x: startW.x + dir.x * drawLen, y: startW.y + dir.y * drawLen };

      const s = w2s(startW.x, startW.y);
      const e = w2s(drawEndW.x, drawEndW.y);

      ctx.save();
      ctx.beginPath();
      ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
      ctx.clip();
      ctx.lineCap = 'round';

      // Soft outer glow
      ctx.strokeStyle = hexToRgba(accentColor, 0.18 * ease);
      ctx.lineWidth = 9 * scale;
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = 12 * scale * ease;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();

      // Bright thin core
      ctx.strokeStyle = hexToRgba(accentColor, 0.55 * ease);
      ctx.lineWidth = 2 * scale;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();

      // Endpoint dots to anchor the gesture's start and finish
      ctx.fillStyle = hexToRgba(accentColor, 0.6 * ease);
      for (const p of [s, e]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── Ball trajectory prediction (SCRUM Master modifier) ───────────────────
  if (activeModifiers.ballPathPredictionBounces > 0 && activeModifiers.ballPathPredictionBalls > 0) {
    const numBounces = activeModifiers.ballPathPredictionBounces;
    const maxBalls = activeModifiers.ballPathPredictionBalls;

    const activeBalls = balls
      .filter(b => b.state === 'active')
      .sort((a, b) => b.speed - a.speed);
    const trackedBalls = maxBalls >= 100 ? activeBalls : activeBalls.slice(0, maxBalls);

    ctx.save();
    for (const ball of trackedBalls) {
      // Start from the interpolated render position (where the ball is drawn),
      // not the physics position, so the line begins exactly at the ball.
      const startPos = ball.renderPosition ?? ball.position;
      const waypoints = computeBallTrajectory(startPos, ball.velocity, walls, numBounces, ball.radius, game.obstaclePolygons);
      if (waypoints.length < 2) continue;

      const totalSegs = waypoints.length - 1;

      ctx.lineCap = 'round';
      ctx.setLineDash([6 * scale, 8 * scale]);
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 6 * scale;

      const segLengths: number[] = [];
      let totalLength = 0;
      for (let i = 0; i < totalSegs; i++) {
        const dx = waypoints[i + 1].x - waypoints[i].x;
        const dy = waypoints[i + 1].y - waypoints[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segLengths.push(len);
        totalLength += len;
      }

      const cumDist: number[] = [0];
      for (let i = 0; i < totalSegs; i++) cumDist.push(cumDist[i] + segLengths[i]);

      const pathAlpha = (d: number) => {
        const t = totalLength > 0 ? d / totalLength : 0;
        const fadeStart = 2 / 3;
        if (t <= fadeStart) return 0.55;
        return 0.55 * (1 - (t - fadeStart) / (1 - fadeStart));
      };

      ctx.globalAlpha = 1;
      for (let i = 0; i < totalSegs; i++) {
        const a0 = pathAlpha(cumDist[i]);
        const a1 = pathAlpha(cumDist[i + 1]);
        if (a0 <= 0 && a1 <= 0) continue;

        const s = w2s(waypoints[i].x, waypoints[i].y);
        const e = w2s(waypoints[i + 1].x, waypoints[i + 1].y);

        const grad = ctx.createLinearGradient(s.x, s.y, e.x, e.y);
        grad.addColorStop(0, `rgba(0,255,136,${a0.toFixed(3)})`);
        grad.addColorStop(1, `rgba(0,255,136,${a1.toFixed(3)})`);
        ctx.strokeStyle = grad;
        ctx.shadowColor = `rgba(0,255,136,${Math.max(a0, a1).toFixed(3)})`;
        ctx.shadowBlur = 6 * scale;
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      for (let i = 1; i < waypoints.length - 1; i++) {
        const alpha = pathAlpha(cumDist[i]) * (0.75 / 0.55);
        const pt = w2s(waypoints[i].x, waypoints[i].y);
        const r = 4 * scale;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - r);
        ctx.lineTo(pt.x + r, pt.y);
        ctx.lineTo(pt.x, pt.y + r);
        ctx.lineTo(pt.x - r, pt.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Balls ─────────────────────────────────────────────────────────────────
  for (const ball of balls) {
    const screenPos = w2s(
      (ball.renderPosition ?? ball.position).x,
      (ball.renderPosition ?? ball.position).y,
    );
    const assimScale = ball.assimScale ?? 1;
    if (assimScale <= 0) continue;

    const screenRadius = ball.radius * scale;
    const isFastest = ball.id === game.fastestBallId;

    const ballIdHash = ball.id.charCodeAt(ball.id.length - 1) || 0;
    const primaryPhase = ball.rotation;
    const secondaryPhase = ball.rotation * 0.7 + ballIdHash * 0.5;
    const tertiaryPhase = ball.rotation * 1.3 + ballIdHash * 0.3;

    if (isFastest) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, screenRadius + 15 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.fastestBallHighlight;
      ctx.lineWidth = 3 * scale;
      ctx.shadowColor = COLORS.fastestBallHighlight;
      ctx.shadowBlur = 15 * scale;
      ctx.stroke();
      ctx.restore();
    }

    const fade = ball.assimColorFade ?? 0;
    const r0 = parseInt(ball.color.slice(1, 3), 16);
    const g0 = parseInt(ball.color.slice(3, 5), 16);
    const b0 = parseInt(ball.color.slice(5, 7), 16);
    const ar = parseInt(accentColor.slice(1, 3), 16);
    const ag = parseInt(accentColor.slice(3, 5), 16);
    const ab = parseInt(accentColor.slice(5, 7), 16);
    const r = Math.round(r0 + (ar - r0) * fade);
    const g = Math.round(g0 + (ag - g0) * fade);
    const b = Math.round(b0 + (ab - b0) * fade);
    const blendedHex = `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    ctx.save();
    ctx.globalAlpha = assimScale;

    renderBallEffects(
      ctx, ball.effects, screenPos.x, screenPos.y,
      screenRadius, accentColor, ball.color, performance.now(), scale,
    );

    // Motion trail
    {
      const trailPos = ball.renderPosition ?? ball.position;
      if (!ball.trailPositions) ball.trailPositions = [];
      ball.trailPositions.push({ x: trailPos.x, y: trailPos.y });
      if (ball.trailPositions.length > 8) ball.trailPositions.shift();
      const N = ball.trailPositions.length;
      if (N > 1 && assimScale > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let ti = 0; ti < N - 1; ti++) {
          const fraction = (ti + 1) / N;
          const tp = w2s(ball.trailPositions[ti].x, ball.trailPositions[ti].y);
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, screenRadius * fraction * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r0},${g0},${b0},${fraction * 0.35})`;
          ctx.fill();
        }
        ctx.restore();
      }
    }

    const { canvas: baseCanvas, halfSize: baseHalf } = getBallBase(blendedHex, screenRadius, scale);
    ctx.drawImage(baseCanvas, Math.round(screenPos.x - baseHalf), Math.round(screenPos.y - baseHalf));

    ctx.save();
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    ctx.clip();

    // Layer 1: Latitude bands
    ctx.save();
    ctx.translate(screenPos.x, screenPos.y);
    const tiltAngle = Math.sin(secondaryPhase) * 0.4;
    ctx.rotate(tiltAngle);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
    ctx.lineWidth = 1.8 * scale;
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      const baseY = i * screenRadius * 0.35;
      const compression = 0.6 + 0.4 * Math.cos(primaryPhase + i * 0.3);
      const yOffset = baseY * compression;
      if (Math.abs(yOffset) < screenRadius * 0.95) {
        const xExtent = Math.sqrt(Math.max(0, screenRadius * screenRadius - yOffset * yOffset));
        ctx.beginPath();
        ctx.ellipse(0, yOffset, xExtent, screenRadius * 0.08, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Layer 2: Longitude meridians
    ctx.save();
    ctx.translate(screenPos.x, screenPos.y);
    ctx.rotate(primaryPhase);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 2 * scale;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const xOffset = Math.sin(angle) * screenRadius * 0.9;
      const foreShorten = Math.abs(Math.cos(angle));
      if (foreShorten > 0.15) {
        ctx.beginPath();
        ctx.ellipse(xOffset * 0.5, 0, Math.max(1, screenRadius * 0.15 * foreShorten), screenRadius * 0.85, 0, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Layer 3: Equatorial band
    ctx.save();
    ctx.translate(screenPos.x, screenPos.y);
    ctx.rotate(tertiaryPhase);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(-screenRadius, 0);
    ctx.lineTo(screenRadius, 0);
    ctx.stroke();
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    const segmentCount = 8;
    for (let i = 0; i < segmentCount; i++) {
      const segAngle = (i / segmentCount) * Math.PI * 2;
      const xPos = Math.cos(segAngle) * screenRadius * 0.65;
      const yPos = Math.sin(segAngle) * screenRadius * 0.15;
      const visibility = Math.cos(segAngle);
      if (visibility > -0.3) {
        const segSize = (2.5 + visibility * 1.5) * scale;
        ctx.beginPath();
        ctx.arc(xPos, yPos, segSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Layer 4: Polar caps
    ctx.save();
    ctx.translate(screenPos.x, screenPos.y);
    const tiltX = Math.sin(secondaryPhase) * screenRadius * 0.1;
    const tiltY = Math.cos(secondaryPhase) * screenRadius * 0.1;
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(tiltX, -screenRadius * 0.7 + tiltY, screenRadius * 0.35, screenRadius * 0.15, secondaryPhase * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-tiltX, screenRadius * 0.7 - tiltY, screenRadius * 0.35, screenRadius * 0.15, -secondaryPhase * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Layer 5: Circuit-board hex overlay
    if (screenRadius > 0) {
      const hexOC = getHexOverlay(accentColor);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.18;
      ctx.translate(Math.round(screenPos.x), Math.round(screenPos.y));
      ctx.rotate(ball.rotation * 0.3);
      ctx.drawImage(hexOC, -screenRadius, -screenRadius, screenRadius * 2, screenRadius * 2);
      ctx.restore();
    }

    ctx.restore(); // end clip

    ctx.save();
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    ctx.clip();
    const specCanvas = getBallSpecular(screenRadius, scale);
    ctx.drawImage(specCanvas, Math.round(screenPos.x - screenRadius - 2), Math.round(screenPos.y - screenRadius - 2));
    ctx.restore();

    // ── Feature Freeze: frost overlay on tap-frozen balls ───────────────────
    const nowFreeze = performance.now();
    if (ball.frozenUntil !== undefined && nowFreeze < ball.frozenUntil) {
      const frost = "#bfefff";

      // Icy tint over the ball body
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(frost, 0.22);
      ctx.fill();
      ctx.restore();

      // Crisp frost ring + crystalline spikes
      ctx.save();
      ctx.translate(screenPos.x, screenPos.y);
      ctx.strokeStyle = hexToRgba(frost, 0.9);
      ctx.lineWidth = Math.max(1.5, 2 * scale);
      ctx.beginPath();
      ctx.arc(0, 0, screenRadius + 2 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      const spikes = 6;
      for (let s = 0; s < spikes; s++) {
        const a = (s / spikes) * Math.PI * 2 + ball.rotation * 0.2;
        const r0 = screenRadius + 2 * scale;
        const r1 = screenRadius + 7 * scale;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.stroke();
      }

      // Countdown arc — remaining freeze time, depleting clockwise from the top.
      // Total duration is recovered from the cooldown window stored on the ball.
      const durMs = ball.freezeReadyAt !== undefined
        ? (ball.freezeReadyAt - ball.frozenUntil) / FREEZE_COOLDOWN_MULTIPLIER
        : 0;
      if (durMs > 0) {
        const frac = Math.max(0, Math.min(1, (ball.frozenUntil - nowFreeze) / durMs));
        ctx.strokeStyle = hexToRgba(frost, 0.95);
        ctx.lineWidth = Math.max(2, 3 * scale);
        ctx.beginPath();
        ctx.arc(0, 0, screenRadius + 5 * scale, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore(); // globalAlpha

    // Admin/Playground: live speed label above the ball.
    if (rctx.showBallSpeeds && ball.state === 'active') {
      const label = String(Math.round(ball.speed));
      const ly = screenPos.y - screenRadius - 6 * scale;
      ctx.save();
      ctx.font = `${Math.max(10, Math.round(11 * scale))}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(label, screenPos.x, ly);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, screenPos.x, ly);
      ctx.restore();
    }
  }


  // ── Lock flash / assimilations ────────────────────────────────────────────
  if (game.assimilations.size > 0) {
    const acR = parseInt(accentColor.slice(1, 3), 16);
    const acG = parseInt(accentColor.slice(3, 5), 16);
    const acB = parseInt(accentColor.slice(5, 7), 16);
    const now = performance.now();

    for (const [, flash] of game.assimilations) {
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
        const ease = ft < 0.5 ? 2 * ft * ft : 1 - Math.pow(-2 * ft + 2, 2) / 2;
        fillAlpha = 0.2 + ease * 0.65;
        glowAlpha = (1 - ft) * 0.9;
      } else {
        // Animation complete — hold a subtle permanent fill over the captured region.
        fillAlpha = 0.22;
        glowAlpha = 0;
      }

      ctx.save();
      if (flash.polygon.length >= 3) {
        ctx.beginPath();
        const fp = w2s(flash.polygon[0].x, flash.polygon[0].y);
        ctx.moveTo(fp.x, fp.y);
        for (let i = 1; i < flash.polygon.length; i++) {
          const p = w2s(flash.polygon[i].x, flash.polygon[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(${acR}, ${acG}, ${acB}, ${fillAlpha})`;
        ctx.fill();
      }

      if (elapsed >= LOCK_PULSE_DURATION && glowAlpha > 0) {
        const ft = Math.min(1, (elapsed - LOCK_PULSE_DURATION) / LOCK_FLOOD_DURATION);
        const c = w2s(flash.centroid.x, flash.centroid.y);
        const burstR = 120 * scale * (0.3 + ft * 1.8);
        // Cached unit gradient sprite; the stop alphas are all linear in
        // glowAlpha, so globalAlpha reproduces the gradient exactly.
        const sprite = getRadialGlowSprite(accentColor, 'burst');
        ctx.globalAlpha = glowAlpha;
        ctx.drawImage(sprite, c.x - burstR, c.y - burstR, burstR * 2, burstR * 2);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      if (elapsed < LOCK_DUST_DURATION && flash.particles.length > 0) {
        const pR = parseInt(flash.ballColor.slice(1, 3), 16);
        const pG = parseInt(flash.ballColor.slice(3, 5), 16);
        const pB = parseInt(flash.ballColor.slice(5, 7), 16);
        ctx.save();
        ctx.lineCap = 'round';
        for (const p of flash.particles) {
          if (elapsed > p.lifetime) continue;
          const progress = elapsed / p.lifetime;
          const drag = Math.pow(1 - progress, 1.8);
          const tSec = elapsed / 1000;
          const wx = flash.ballPos.x + Math.cos(p.angle) * p.speed * tSec * drag;
          const wy = flash.ballPos.y + Math.sin(p.angle) * p.speed * tSec * drag
                   + 18 * tSec * tSec;
          const sp = w2s(wx, wy);
          const alpha = Math.pow(1 - progress, 1.4);
          const tailLen = p.lengthPx * (1 - progress);
          const tx = sp.x - Math.cos(p.angle) * tailLen;
          const ty = sp.y - Math.sin(p.angle) * tailLen;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(sp.x, sp.y);
          ctx.strokeStyle = `rgba(${pR}, ${pG}, ${pB}, ${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // ── Growing wall (active fence) ───────────────────────────────────────────
  if (wall) {
    const activeRegion = regions.find((r) => r.id === wall.activeRegionId);

    ctx.save();

    // Clip to the active region with obstacle polygons punched out as holes.
    // Even-odd rule means any area covered by an odd number of sub-paths is
    // "inside" the clip — the obstacle sub-paths cancel the outer region,
    // making them true holes. This blocks every pixel (including stroke
    // bleed from thick fences) from ever landing inside an obstacle.
    const clipPath = new Path2D();
    if (activeRegion && activeRegion.polygon.vertices.length > 0) {
      const first = w2s(activeRegion.polygon.vertices[0].x, activeRegion.polygon.vertices[0].y);
      clipPath.moveTo(first.x, first.y);
      for (let i = 1; i < activeRegion.polygon.vertices.length; i++) {
        const pt = w2s(activeRegion.polygon.vertices[i].x, activeRegion.polygon.vertices[i].y);
        clipPath.lineTo(pt.x, pt.y);
      }
      clipPath.closePath();
    } else {
      const { left, top, width, height } = game.boardRect;
      clipPath.rect(left, top, width, height);
    }
    // Obstacle hole subpaths are static per level — cached as a Path2D
    // instead of re-tracing every (64-gon) polygon on every growth frame.
    {
      const holesKey = `${Math.round(boardRect.left)}_${Math.round(boardRect.top)}_${Math.round(scale * 10000)}`;
      if (_obstacleHolesCache.key !== holesKey || _obstacleHolesCache.polys !== obstacles) {
        _obstacleHolesCache.key = holesKey;
        _obstacleHolesCache.polys = obstacles;
        const holes = new Path2D();
        for (const poly of obstacles) {
          const sv0 = w2s(poly.vertices[0].x, poly.vertices[0].y);
          holes.moveTo(sv0.x, sv0.y);
          for (let i = 1; i < poly.vertices.length; i++) {
            const svp = w2s(poly.vertices[i].x, poly.vertices[i].y);
            holes.lineTo(svp.x, svp.y);
          }
          holes.closePath();
        }
        _obstacleHolesCache.path = holes;
      }
      clipPath.addPath(_obstacleHolesCache.path!);
    }
    ctx.clip(clipPath, 'evenodd');

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Build a connected path for one arm of the growing fence (origin → current tip).
    const buildArmPath = (waypoints: Vector2[], segIdx: number, cur: Vector2) => {
      const o = w2s(waypoints[0].x, waypoints[0].y);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      for (let i = 0; i < segIdx; i++) {
        const pt = w2s(waypoints[i + 1].x, waypoints[i + 1].y);
        ctx.lineTo(pt.x, pt.y);
      }
      const tip = w2s(cur.x, cur.y);
      ctx.lineTo(tip.x, tip.y);
    };

    const lw = wall.thickness * scale;

    // Outer glow via additive compositing (wide → narrow)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = accentColor;
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 3.5; ctx.globalAlpha = 0.10; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 2.0; ctx.globalAlpha = 0.20; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();
    ctx.restore();

    // White-bright core + accent centerline
    ctx.globalAlpha = 1;
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();
    buildArmPath(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint);
    ctx.lineWidth = lw * 1.0; ctx.strokeStyle = accentColor; ctx.stroke();
    buildArmPath(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint);
    ctx.stroke();

    // ── Pulsating end-cap glows on the growing tips ──────────────────────────
    if (!wall.isComplete) {
      const now = performance.now();
      const throb   = 0.5 + 0.5 * Math.sin(now * 0.009);  // slow 0→1 throb ~0.7 Hz
      const shimmer = 0.5 + 0.5 * Math.sin(now * 0.023);  // faster shimmer

      const coreR = wall.thickness * 0.65 * scale;

      for (const tip of [wall.startPoint, wall.endPoint]) {
        const ts = w2s(tip.x, tip.y);

        // Outer bloom — pulsing radius and opacity, via cached gradient sprite
        const bloomR = coreR * (3.5 + throb * 2.5);
        const bloomSprite = getRadialGlowSprite(accentColor, 'tip');
        ctx.globalAlpha = 0.5 + 0.5 * throb;
        ctx.drawImage(bloomSprite, ts.x - bloomR, ts.y - bloomR, bloomR * 2, bloomR * 2);

        // White-hot core with accent shadow — shimmer bucketed into cached
        // sprites (the shadowBlur repaint per frame was the expensive part)
        ctx.globalAlpha = 1;
        {
          const bucket = Math.round(shimmer * 8); // 0..8
          const key = `tipcore_${accentColor}_${Math.round(coreR * 10)}_${bucket}`;
          let core = _pulseSpriteCache.get(key);
          if (!core) {
            const blur = (8 + (bucket / 8) * 12) * scale;
            const pad = Math.ceil(coreR + blur + 2);
            core = new OffscreenCanvas(pad * 2, pad * 2);
            const c = core.getContext('2d')!;
            c.fillStyle = '#ffffff';
            c.shadowColor = accentColor;
            c.shadowBlur = blur;
            c.beginPath();
            c.arc(pad, pad, coreR, 0, Math.PI * 2);
            c.fill();
            _pulseSpriteCache.set(key, core);
          }
          ctx.drawImage(core, Math.round(ts.x - core.width / 2), Math.round(ts.y - core.height / 2));
        }
      }

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ── Final hard-clear outside boardRect ───────────────────────────────────
  {
    const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
    const sw = game.screenSize.width;
    const sh = game.screenSize.height;
    ctx.clearRect(0,       0,        sw,             bt);
    ctx.clearRect(0,       bt + bh,  sw,             sh - (bt + bh));
    ctx.clearRect(0,       bt,       bl,             bh);
    ctx.clearRect(bl + bw, bt,       sw - (bl + bw), bh);
  }

  // ── Space progress bar (drawn after clear so it sits below the board) ────
  if (game.spaceGrid) {
    const remaining = getRemainingPercent(game.spaceGrid);
    const threshold = rctx.spaceThreshold;
    const captured = 100 - remaining;
    const targetCaptured = 100 - threshold;
    const fillRatio = Math.min(1, targetCaptured > 0 ? captured / targetCaptured : 1);

    const { left: bl, top: bt, width: bw, height: bh } = boardRect;
    const gap = 3 * scale;
    const barH = 4 * scale;
    const barY = bt + bh + gap;

    ctx.save();

    // Track background
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(bl, barY, bw, barH);

    // Primary fill (left → right, accent/green)
    const fillW = bw * fillRatio;
    const isComplete = fillRatio >= 1;
    ctx.fillStyle = isComplete ? '#00ff44' : accentColor;
    ctx.globalAlpha = 0.75;
    ctx.shadowColor = isComplete ? '#00ff44' : accentColor;
    ctx.shadowBlur = 3 * scale;
    ctx.fillRect(bl, barY, fillW, barH);

    // Push overlay (right → left, orange) while player is pushing their luck
    if (game.pushMode === 'pushing' && game.pushStartPercent > 0) {
      const extraCaptured = game.pushStartPercent - remaining;
      const pushRatio = Math.min(1, Math.max(0, extraCaptured / game.pushStartPercent));
      if (pushRatio > 0) {
        const pushW = bw * pushRatio;
        ctx.fillStyle = '#ff8800';
        ctx.globalAlpha = 0.85;
        ctx.shadowColor = '#ff8800';
        ctx.shadowBlur = 5 * scale;
        ctx.fillRect(bl + bw - pushW, barY, pushW, barH);
      }
    }

    ctx.restore();
  }

  // ── Level-clear shimmer ─────────────────────────────────────────────────────
  // A luminous band sweeps top→bottom across the whole cleared board — grid,
  // fences, obstacles and balls all included — as a beat of accomplishment
  // before the completion overlay mounts.
  if (game.shimmerStart > 0) {
    const elapsed = performance.now() - game.shimmerStart;
    if (elapsed >= 0 && elapsed <= LEVEL_CLEAR_SHIMMER_MS) {
      const progress = elapsed / LEVEL_CLEAR_SHIMMER_MS;
      const { left: bl, top: bt, width: bw, height: bh } = boardRect;
      const band = bh * 0.28;
      // Let the wave keep travelling a little past the board's bottom edge.
      const overscan = bh * 0.22;
      // Sweep the band centre from just above the top edge to past the bottom.
      const centerY = bt - band + progress * (bh + band * 2 + overscan);
      // Ease in over the first 15% and out over the last 20% so it never pops.
      const envelope = Math.max(0, Math.min(1, progress / 0.15, (1 - progress) / 0.2));
      const peak = 0.55 * envelope;

      ctx.save();
      ctx.beginPath();
      // Clip extends past the board bottom so the wave can run off it.
      ctx.rect(bl, bt, bw, bh + overscan);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';

      // White wake: only the STRUCTURES the wave has passed go white, keeping the
      // same soft neon glow they had while "live" - just drained of colour so the
      // cleared board reads as finished/dead. The dark board itself is untouched.
      // Clipped to the region above the wave front, so the whitening follows the
      // wave down and objects straddling it are half-white.
      // Extend into the overscan so the progress bar below the board whitens too.
      const wakeBottom = Math.min(centerY, bt + bh + overscan);
      if (wakeBottom > bt) {
        const whiteEnv = Math.min(1, progress / 0.08); // ease in only, never out
        const DEAD = '#c8ccd6';                         // drained, desaturated white
        const DEAD_GLOW = 'rgba(200,206,222,0.9)';
        ctx.save();
        ctx.beginPath();
        ctx.rect(bl, bt, bw, wakeBottom - bt);          // swept region only
        ctx.clip();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = whiteEnv;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Obstacles, mirrors and breakable bodies: faint fill + soft glowing edge.
        for (const poly of game.obstaclePolygons) {
          const v = poly.vertices;
          if (v.length < 2) continue;
          const p0 = w2s(v[0].x, v[0].y);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < v.length; i++) { const p = w2s(v[i].x, v[i].y); ctx.lineTo(p.x, p.y); }
          ctx.closePath();
          ctx.fillStyle = 'rgba(200,206,222,0.12)';
          ctx.fill();
          ctx.strokeStyle = DEAD;
          ctx.lineWidth = WALL_THICKNESS * scale;
          ctx.shadowColor = DEAD_GLOW;
          ctx.shadowBlur = 7 * scale;
          ctx.stroke();
          ctx.stroke(); // second pass thickens the halo for a softer bloom
        }
        ctx.shadowBlur = 0;

        // Moving obstacles at their current position: glowing rounded body.
        for (const mover of game.movers) {
          const mdx = mover.axis === 'horizontal' ? mover.offset : 0;
          const mdy = mover.axis === 'vertical'   ? mover.offset : 0;
          const sc = w2s(mover.homeX + mdx, mover.homeY + mdy);
          ctx.beginPath();
          if (mover.shape === 'circle') {
            ctx.arc(sc.x, sc.y, (mover.radius ?? 30) * scale, 0, Math.PI * 2);
          } else {
            const hw = (mover.width ?? 60) / 2 * scale;
            const hh = (mover.height ?? 60) / 2 * scale;
            ctx.rect(sc.x - hw, sc.y - hh, hw * 2, hh * 2);
          }
          ctx.fillStyle = 'rgba(200,206,222,0.18)';
          ctx.fill();
          ctx.strokeStyle = DEAD;
          ctx.lineWidth = 2 * scale;
          ctx.shadowColor = DEAD_GLOW;
          ctx.shadowBlur = 12 * scale;
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // Fences and board-edge walls: reuse the live wall renderer with the dead
        // colour, so the glow/soft caps match exactly - just white instead of accent.
        for (const w of walls) {
          renderWallWithEffects(
            ctx, w2s(w.start.x, w.start.y), w2s(w.end.x, w.end.y),
            w.start, w.end, scale, DEAD, w.thickness * scale,
          );
        }

        // Balls: soft glowing discs (radial halo + bright core) - a dead pulse.
        ctx.globalAlpha = whiteEnv; // renderWallWithEffects resets alpha to 1
        for (const ball of balls) {
          const pos = ball.renderPosition ?? ball.position;
          const p = w2s(pos.x, pos.y);
          const r = Math.max(1, ball.radius * scale);
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
          halo.addColorStop(0, 'rgba(255,255,255,0.9)');
          halo.addColorStop(0.5, 'rgba(205,210,226,0.45)');
          halo.addColorStop(1, 'rgba(205,210,226,0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#eef1f6';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // Progress bar under the board: its green fill also goes dead as the wave
        // crosses it (the clip above whitens it progressively, top-down).
        if (game.spaceGrid) {
          const remaining = getRemainingPercent(game.spaceGrid);
          const targetCaptured = 100 - rctx.spaceThreshold;
          const fillRatio = Math.min(1, targetCaptured > 0 ? (100 - remaining) / targetCaptured : 1);
          const barY = bt + bh + 3 * scale;
          const barH = 4 * scale;
          ctx.globalAlpha = 0.85 * whiteEnv;
          ctx.fillStyle = DEAD;
          ctx.shadowColor = DEAD_GLOW;
          ctx.shadowBlur = 3 * scale;
          ctx.fillRect(bl, barY, bw * fillRatio, barH);
          ctx.shadowBlur = 0;
        }

        ctx.restore();
      }

      const grad = ctx.createLinearGradient(0, centerY - band, 0, centerY + band);
      grad.addColorStop(0, hexToRgba(accentColor, 0));
      grad.addColorStop(0.45, hexToRgba(accentColor, peak * 0.5));
      grad.addColorStop(0.5, hexToRgba('#ffffff', peak));
      grad.addColorStop(0.55, hexToRgba(accentColor, peak * 0.5));
      grad.addColorStop(1, hexToRgba(accentColor, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(bl, centerY - band, bw, band * 2);

      // Crisp leading edge for a clean "wipe" feel.
      ctx.strokeStyle = hexToRgba('#ffffff', peak);
      ctx.lineWidth = Math.max(1.5, 2 * scale);
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = 12 * scale;
      ctx.beginPath();
      ctx.moveTo(bl, centerY);
      ctx.lineTo(bl + bw, centerY);
      ctx.stroke();

      ctx.restore();
    }
  }
}
