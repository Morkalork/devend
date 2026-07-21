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
  Polygon,
} from "@/lib/polygon";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { computeBallTrajectory, trajectoryBallSnapshots, hexToRgba } from "@/lib/gameUtils";
import { getBallBase, getBallSpecular, getHexOverlay } from "@/lib/ballRenderCache";
import { rainbowBaseColor } from "@/lib/rendering/rainbowColor";
import { getBallSphere } from "@/lib/ballSphereCache";
import { getRainGlyph } from "./rainGlyphCache";
import { renderBallEffects, getSquishEffect, BOSS_SQUISH_SCALE } from "@/lib/ballEffects";
import { bossSplashFrame } from "@/lib/rendering/bossSplash";
import { renderWallWithEffects } from "@/lib/wallImpactEffects";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { getPickupSprite, pickupColor, pickupFeedbackLabel } from "./pickupSprites";
import { PICKUP_DRAW_RADIUS, PICKUP_FEEDBACK_MS, PICKUP_EXPIRY_WARN_SECONDS } from "@/lib/pickups";
import { BOARD_WIDTH, BOARD_HEIGHT, BoardRect } from "@/lib/boardConstants";
import {
  LOCK_PULSE_DURATION,
  LOCK_FLOOD_DURATION,
  LOCK_DUST_DURATION,
  INFO_UNLOCKED_DURATION,
  COLORS,
  FREEZE_COOLDOWN_MULTIPLIER,
  SWIPE_TRAIL_DURATION,
  BALL_DANGER_SPEED,
  LEVEL_CLEAR_SHIMMER_MS,
  SPACE_BAR_FADE_MS,
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
  _flamePuffCache.clear();
  _flamePaletteCache.clear();
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

/**
 * Screen-space Path2D of all obstacle outlines, for punching obstacle holes out
 * of a fill via the even-odd rule. Obstacles are static per level, so the traced
 * path (each obstacle is a 64-gon) is cached and only rebuilt on a boardRect/scale
 * change or when the obstacle-polygon array identity changes (new level).
 */
function getObstacleHolesPath(obstacles: Polygon[], boardRect: BoardRect, scale: number): Path2D {
  const key = `${Math.round(boardRect.left)}_${Math.round(boardRect.top)}_${Math.round(scale * 10000)}`;
  if (_obstacleHolesCache.key !== key || _obstacleHolesCache.polys !== obstacles) {
    _obstacleHolesCache.key = key;
    _obstacleHolesCache.polys = obstacles;
    const holes = new Path2D();
    for (const poly of obstacles) {
      const v0 = worldToScreen(poly.vertices[0].x, poly.vertices[0].y, boardRect);
      holes.moveTo(v0.x, v0.y);
      for (let i = 1; i < poly.vertices.length; i++) {
        const vp = worldToScreen(poly.vertices[i].x, poly.vertices[i].y, boardRect);
        holes.lineTo(vp.x, vp.y);
      }
      holes.closePath();
    }
    _obstacleHolesCache.path = holes;
  }
  return _obstacleHolesCache.path!;
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

// ── Level-clear wake cache ──────────────────────────────────────────────────
// The drained-grey scene the clear wave reveals is static for the whole sweep
// (physics is halted), but drawing it live costs many shadowBlur passes per
// frame — visible lag on mobile. It's rendered ONCE per shimmer into a
// full-screen OffscreenCanvas and blitted per frame; only the flames stay live.
let _wakeOC: OffscreenCanvas | null = null;
let _wakeKey = '';

// Frozen snapshot of the entire live (below-wave) scene. During the sweep the
// board is static (physics halted), so the whole coloured scene is captured
// ONCE on the first sweep frame and blitted thereafter — the renderFrame body
// (walls, obstacles, movers, data rain, sphere-shaded balls) is skipped entirely.
let _frozenLiveOC: OffscreenCanvas | null = null;
let _frozenLiveKey = '';

// The moving wave band + its glowing leading edge, pre-rendered to a strip
// sprite. Baked once at reference intensity and blitted at the wave's Y with
// globalAlpha = peak, so the per-frame linear-gradient alloc and (expensive)
// leading-edge shadowBlur are gone.
let _waveStripOC: OffscreenCanvas | null = null;
let _waveStripKey = '';

// ── Flame puff sprite cache ─────────────────────────────────────────────────
// Balls burn continuously, so the plume must be cheap. It's drawn as many small
// additive "puffs"; each colour's puff is pre-rendered once to an OffscreenCanvas
// (a soft radial gradient) and blitted per tongue, so no gradient is allocated
// per frame. Under 'lighter' compositing the overlapping puffs pile up toward
// white, reading as a hot core.
const _flamePuffCache = new Map<string, OffscreenCanvas>();
const FLAME_PUFF_PX = 24; // sprite half-size in px; scaled per-tongue on draw

function getFlamePuff(rgb: string): OffscreenCanvas {
  const cached = _flamePuffCache.get(rgb);
  if (cached) return cached;
  const R = FLAME_PUFF_PX;
  const oc = new OffscreenCanvas(R * 2, R * 2);
  const c = oc.getContext('2d');
  if (c) {
    const g = c.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0,    `rgba(${rgb},1)`);
    g.addColorStop(0.45, `rgba(${rgb},0.55)`);
    g.addColorStop(1,    `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(R, R, R, 0, Math.PI * 2);
    c.fill();
  }
  _flamePuffCache.set(rgb, oc);
  return oc;
}

// Flame palette: [hot core, mid, cool tip] as "r,g,b" strings. DRAINED is the
// white/grey clear-wave beat; live balls derive theirs from their own colour
// (ballFlamePalette) so the fire matches the ball.
const FLAME_DRAINED: [string, string, string] = ['255,255,255', '230,234,242', '196,201,212'];
const FLAME_SHEAR_SPEED = 380; // ball speed (world u/s) at which the lean saturates

/**
 * LOD for the flame plume: how many tongues (each a blit) to draw given the
 * number of flaming balls on screen. The plume is the dominant per-ball draw
 * cost, and its detail matters least exactly when the board is crowded, so the
 * count degrades gracefully. Tuned to keep total flame blits roughly bounded
 * (~100-150/frame) as ball count climbs.
 */
export function flameTonguesForCount(activeBalls: number): number {
  if (activeBalls <= 8) return 12;
  if (activeBalls <= 14) return 9;
  if (activeBalls <= 20) return 6;
  if (activeBalls <= 30) return 4;
  return 3;
}

// Per-colour flame palette derived from the ball's own colour: a near-white hot
// core, the ball colour in the middle, and a darkened tip. Cached so a distinct
// ball colour yields a stable set of puff colours (bounding getFlamePuff's cache).
const _flamePaletteCache = new Map<string, [string, string, string]>();

function ballFlamePalette(hex: string): [string, string, string] {
  const cached = _flamePaletteCache.get(hex);
  if (cached) return cached;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  const toward = (c: number, t: number, target: number) => Math.round(c + (target - c) * t);
  const hot = `${toward(r, 0.75, 255)},${toward(g, 0.75, 255)},${toward(b, 0.75, 255)}`;
  const mid = `${toward(r, 0.15, 255)},${toward(g, 0.15, 255)},${toward(b, 0.15, 255)}`;
  const tip = `${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)}`;
  const palette: [string, string, string] = [hot, mid, tip];
  _flamePaletteCache.set(hex, palette);
  return palette;
}

/**
 * Draw a stateless flame plume rising off a ball. The looping "tongues" are
 * seeded per-ball (stable across frames) and animated by the clock, so no
 * particle state is stored. Each tongue is blitted from a cached puff sprite
 * (getFlamePuff) — no per-frame gradient allocation.
 *
 * Buoyancy always lifts the plume upward; (vx,vy) is the ball's screen-space
 * velocity and shears the plume opposite to travel (more toward the tips), so a
 * fast ball's flame trails behind it like a real burning object in motion. The
 * vertical shear is damped and can never overcome buoyancy, so it always burns
 * upward. `alpha` scales overall opacity.
 *
 * `tongues` is the LOD tongue count (see flameTonguesForCount): each tongue is a
 * blit, and the plume is the dominant per-ball draw cost, so a crowded board
 * uses fewer tongues. Tongues are seeded in a stable order, so drawing the first
 * N is a stable subset of the full plume, not a different-looking flame.
 */
function drawBallFlame(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, r: number, id: string, now: number,
  vx: number, vy: number,
  palette: [string, string, string],
  alpha: number,
  tongues = 12,
): void {
  const rng = _mulberry(_hashStr(`flame-${id}`));
  const FLAME_N = tongues;
  const flameH = r * 4.8;
  const life = 620; // ms per tongue cycle
  const speed = Math.hypot(vx, vy);
  const lean = speed > 0 ? Math.min(1, speed / FLAME_SHEAR_SPEED) : 0;
  // Lean opposite to travel: horizontal applied fully, vertical damped so it
  // never cancels the upward rise.
  const lx = speed > 0 ? -(vx / speed) * lean * 1.1  : 0;
  const ly = speed > 0 ? -(vy / speed) * lean * 0.35 : 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < FLAME_N; i++) {
    const off = rng();               // stable phase offset for this tongue
    const spd = 0.75 + rng() * 0.6;  // per-tongue rise speed
    const lat = rng() - 0.5;         // lateral spawn position
    const ph = ((now / life) * spd + off) % 1; // 0..1 life progress
    const rise = (ph * 0.4 + ph * ph * 0.6) * flameH; // buoyant, accelerating
    const wob = Math.sin(now * 0.008 + off * 6.283 + rise * 0.04) * r * 0.5 * ph;
    // Shear scales with rise, so tips lean downstream more than the base.
    const cx = px + lat * r * 0.7 + wob + lx * rise;
    const cy = py - r * 0.2 - rise + ly * rise;
    const size = Math.max(0.5, r * (0.95 - 0.6 * ph) * (0.55 + off * 0.5));
    const a = (1 - ph) * 0.55 * alpha;
    if (a <= 0.01) continue;
    const rgb = ph < 0.35 ? palette[0] : ph < 0.65 ? palette[1] : palette[2];
    ctx.globalAlpha = a;
    ctx.drawImage(getFlamePuff(rgb), cx - size, cy - size, size * 2, size * 2);
  }
  ctx.restore();
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
  const { accentColor, activeModifiers, boardGridCanvas, regionCanvas, rain, infoUnlockedLabel = 'Info Unlocked', superiorLockLabel = 'Superior Lock!' } = rctx;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const w2s = (wx: number, wy: number) => worldToScreen(wx, wy, boardRect);

  // ── Clear ─────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, screenWidth, screenHeight);

  // ── Level-clear freeze fast-path ──────────────────────────────────────────
  // During the clear sweep the whole below-wave scene is static (physics halted).
  // Once it's been snapshotted, blit that and draw ONLY the shimmer, skipping the
  // entire live render below (data rain, board, walls, movers, sphere-shaded
  // balls). This is the single biggest saving for the on-mobile wave lag.
  if (game.shimmerStart > 0) {
    const raw = performance.now() - game.shimmerStart;
    const el = game.shimmerFrozen ? Math.min(raw, LEVEL_CLEAR_SHIMMER_MS) : raw;
    const key = `${game.shimmerStart}|${ctx.canvas.width}x${ctx.canvas.height}`;
    if (el >= 0 && el <= LEVEL_CLEAR_SHIMMER_MS && _frozenLiveOC && _frozenLiveKey === key) {
      ctx.drawImage(_frozenLiveOC, 0, 0);
      renderClearShimmer(ctx, game, rctx, w2s, boardRect, scale, accentColor, walls, balls);
      return;
    }
  }

  // ── Ambient data rain ─────────────────────────────────────────────────────
  {
    const now = performance.now();
    const dtRain = rain.lastTime ? Math.min((now - rain.lastTime) / 1000, 0.05) : 0;
    rain.lastTime = now;
    const { scale: s, left: bx, top: by } = game.boardRect;
    // Blit pre-rendered glyph sprites instead of ctx.fillText per particle: text
    // shaping is one of the slowest mobile Canvas2D ops and ran 40x every frame.
    const fontPx = Math.round(14 * s);
    ctx.save();
    for (const p of rain.particles) {
      p.y += p.speed * dtRain;
      if (p.y > BOARD_HEIGHT + 20) {
        p.y = -(10 + Math.random() * 60);
        p.x = 15 + Math.random() * (BOARD_WIDTH - 30);
        p.symbol = RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)];
        p.alpha = 0.03 + Math.random() * 0.04;
        p.speed = 30 + Math.random() * 50;
      }
      const glyph = getRainGlyph(p.symbol, accentColor, fontPx);
      ctx.globalAlpha = p.alpha;
      ctx.drawImage(glyph.canvas, Math.round(bx + p.x * s) - glyph.pad, Math.round(by + p.y * s) - glyph.pad);
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
    // Flat speeds (issue #37): danger is measured against an absolute reference
    // speed rather than each ball's (now equal) top speed. Plain loop (no
    // filter/reduce) to avoid a per-frame array + closure allocation.
    let maxDanger = 0;
    for (const b of balls) {
      if (b.speed > 0) {
        const d = b.speed / BALL_DANGER_SPEED;
        if (d > maxDanger) maxDanger = d;
      }
    }
    {
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

  // ── Pickup tokens ─────────────────────────────────────────────────────────
  // Drawn under the balls: a ball rolling over a token reads as "reachable".
  // Timing (pop-in, expiry blink) runs on activePlaySeconds so a paused game
  // never advances a token's clock; only the idle pulse uses the wall clock.
  if (game.pickups && game.pickups.length > 0) {
    const nowP = performance.now();
    const nowS = game.activePlaySeconds;
    for (const token of game.pickups) {
      const sprite = getPickupSprite(token.effect, accentColor, PICKUP_DRAW_RADIUS * scale);
      const aliveS = nowS - token.spawnedAtSeconds;
      const remainingS = token.expiresAtSeconds - nowS;
      const popT = Math.min(1, aliveS / 0.25);
      const pop = 1 - Math.pow(1 - popT, 3); // easeOutCubic pop-in
      const pulse = 1 + 0.07 * Math.sin(nowP / 280 + token.position.x);
      let alpha = popT;
      if (remainingS < PICKUP_EXPIRY_WARN_SECONDS) {
        // Accelerating blink over the final seconds (2 Hz → ~8 Hz).
        const hz = 2 + (PICKUP_EXPIRY_WARN_SECONDS - remainingS) * 2;
        alpha *= 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((nowP / 1000) * hz * Math.PI * 2));
      }
      const p = w2s(token.position.x, token.position.y);
      const size = sprite.width * pulse * pop;
      if (size <= 0 || alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      ctx.restore();

      // Cryo Protocol: ice the token over so it reads as "frozen, won't expire".
      // A pale glowing ring with a few slowly-rotating frost spikes.
      if (game.freezePickups) {
        const r = size / 2 + 3 * scale;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.strokeStyle = "#bfefff";
        ctx.lineWidth = Math.max(1, 1.6 * scale);
        ctx.shadowColor = "#9fe6ff";
        ctx.shadowBlur = 7 * scale;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1, 1.2 * scale);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + nowP / 3000;
          const cx = Math.cos(a), cy = Math.sin(a);
          ctx.beginPath();
          ctx.moveTo(cx * r, cy * r);
          ctx.lineTo(cx * (r + 3 * scale), cy * (r + 3 * scale));
          ctx.stroke();
        }
        ctx.restore();
      }
    }
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
      const waypoints = computeBallTrajectory(startPos, ball.velocity, walls, numBounces, ball.radius, game.obstaclePolygons, game.movers, game.creepFactor || 1, trajectoryBallSnapshots(balls, ball, game.frozenBallId));
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
      // Most segments sit in the flat-alpha (0.55) run before the tail fade, so
      // their gradient is a solid color — use a plain stroke there and only
      // allocate a CanvasGradient for the genuinely fading tail segments.
      ctx.lineWidth = 2 * scale;
      for (let i = 0; i < totalSegs; i++) {
        const a0 = pathAlpha(cumDist[i]);
        const a1 = pathAlpha(cumDist[i + 1]);
        if (a0 <= 0 && a1 <= 0) continue;

        const s = w2s(waypoints[i].x, waypoints[i].y);
        const e = w2s(waypoints[i + 1].x, waypoints[i + 1].y);

        if (a0 === a1) {
          ctx.strokeStyle = `rgba(0,255,136,${a0.toFixed(3)})`;
        } else {
          const grad = ctx.createLinearGradient(s.x, s.y, e.x, e.y);
          grad.addColorStop(0, `rgba(0,255,136,${a0.toFixed(3)})`);
          grad.addColorStop(1, `rgba(0,255,136,${a1.toFixed(3)})`);
          ctx.strokeStyle = grad;
        }
        ctx.shadowColor = `rgba(0,255,136,${Math.max(a0, a1).toFixed(3)})`;
        ctx.shadowBlur = 6 * scale;
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
  // Flame LOD: fewer tongues per plume as more balls burn, so the dominant
  // per-ball draw cost stays roughly bounded on a crowded board.
  let activeBallCount = 0;
  for (const b of balls) if (b.state === 'active') activeBallCount++;
  const flameTongues = flameTonguesForCount(activeBallCount);
  for (const ball of balls) {
    const screenPos = w2s(
      (ball.renderPosition ?? ball.position).x,
      (ball.renderPosition ?? ball.position).y,
    );
    const assimScale = ball.assimScale ?? 1;
    if (assimScale <= 0) continue;

    const screenRadius = ball.radius * scale;
    const isFastest = ball.id === game.fastestBallId;

    // Per-ball hash de-correlates the sphere band phases between balls; the
    // shading itself is a pure function of (radius, rotation, hash), cached by
    // getBallSphere. Phase math lives there now.
    const ballIdHash = ball.id.charCodeAt(ball.id.length - 1) || 0;

    // Squash & stretch (issue #44): computed once here so the fastest-ball ring
    // below, and the flame plume + body sprites further down, all deform along
    // the same impact axis as one unit. The transient collision halos and the
    // motion trail stay round. Big boss balls squish at half strength (see
    // BOSS_SQUISH_SCALE).
    const squishScale = ball.isBoss ? BOSS_SQUISH_SCALE : 1;
    const squish = getSquishEffect(ball.effects, squishScale);
    const applySquish = () => {
      if (!squish.active) return;
      const ang = Math.atan2(squish.ny, squish.nx);
      ctx.translate(screenPos.x, screenPos.y);
      ctx.rotate(ang);
      ctx.scale(squish.scaleAlong, squish.scalePerp);
      ctx.rotate(-ang);
      ctx.translate(-screenPos.x, -screenPos.y);
    };

    if (isFastest) {
      ctx.save();
      applySquish(); // the cyan highlight ring squishes with the ball
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, screenRadius + 15 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.fastestBallHighlight;
      ctx.lineWidth = 3 * scale;
      ctx.shadowColor = COLORS.fastestBallHighlight;
      ctx.shadowBlur = 15 * scale;
      ctx.stroke();
      ctx.restore();
    }

    // Bucket the fade before blending. assimColorFade is a continuous 0→1 clock
    // during the ~2s lock fade, so an unbucketed blend produces a distinct
    // blendedHex nearly every frame and getBallBase spawns a fresh OffscreenCanvas
    // per key. 13 steps (1/12) is visually indistinguishable from continuous but
    // collapses the per-clear canvas churn from ~120 to ≤13. r0/g0/b0 stay the
    // true ball color (the motion trail below uses them unblended).
    // Rainbow balls cycle their hue (bucketed so the ball cache stays bounded);
    // every colour read below uses this base instead of the static ball.color.
    const baseColor = ball.ability === 'rainbow' ? rainbowBaseColor(ball.id, performance.now()) : ball.color;
    const fadeRaw = ball.assimColorFade ?? 0;
    const fade = fadeRaw > 0 ? Math.round(fadeRaw * 12) / 12 : 0;
    const r0 = parseInt(baseColor.slice(1, 3), 16);
    const g0 = parseInt(baseColor.slice(3, 5), 16);
    const b0 = parseInt(baseColor.slice(5, 7), 16);
    let blendedHex: string;
    if (fade === 0) {
      // No fade (the common case for every active ball): the blend is the ball's
      // own color, so skip the channel math and string building entirely.
      blendedHex = baseColor.slice(1);
    } else {
      const ar = parseInt(accentColor.slice(1, 3), 16);
      const ag = parseInt(accentColor.slice(3, 5), 16);
      const ab = parseInt(accentColor.slice(5, 7), 16);
      const r = Math.round(r0 + (ar - r0) * fade);
      const g = Math.round(g0 + (ag - g0) * fade);
      const b = Math.round(b0 + (ab - b0) * fade);
      blendedHex = `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    ctx.save();
    ctx.globalAlpha = assimScale;

    renderBallEffects(
      ctx, ball.effects, screenPos.x, screenPos.y,
      screenRadius, accentColor, baseColor, performance.now(), scale, squishScale,
    );

    // Motion trail. Ring buffer: overwrite slots in place with a moving head
    // index instead of push()/shift() (which allocated a {x,y} every frame per
    // ball and O(n)-reindexed the array) — the previous version was the only
    // steady, unconditional per-frame allocation in the render hot path.
    {
      const TRAIL_LEN = 8;
      const trailPos = ball.renderPosition ?? ball.position;
      let buf = ball.trailPositions;
      if (!buf || buf.length !== TRAIL_LEN) {
        buf = ball.trailPositions = Array.from({ length: TRAIL_LEN }, () => ({ x: 0, y: 0 }));
        ball.trailHead = 0;
        ball.trailCount = 0;
      }
      const slot = buf[ball.trailHead ?? 0];
      slot.x = trailPos.x;
      slot.y = trailPos.y;
      const head = ((ball.trailHead ?? 0) + 1) % TRAIL_LEN;
      ball.trailHead = head;
      const N = ball.trailCount = Math.min((ball.trailCount ?? 0) + 1, TRAIL_LEN);
      if (N > 1 && assimScale > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // Oldest→newest, skipping the newest (the ball body sits there). Oldest
        // valid entry is `head - N`; index k of N maps to (head - N + k) mod LEN.
        for (let k = 0; k < N - 1; k++) {
          const fraction = (k + 1) / N;
          const idx = (head - N + k + TRAIL_LEN) % TRAIL_LEN;
          const tp = w2s(buf[idx].x, buf[idx].y);
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, screenRadius * fraction * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r0},${g0},${b0},${fraction * 0.35})`;
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Squash & stretch (issue #44): the transform (hoisted above) is set up
    // FIRST so the flame (drawn next) and the body sprites (base, sphere, hex,
    // specular, frost) all squish together as one burning object; the halos and
    // trail, drawn earlier, stay round.
    if (squish.active) {
      ctx.save();
      applySquish();
    }

    // Continuous flame plume: the ball is a burning object. Drawn behind the
    // body so the tongues rise up and around it, and inside the squish transform
    // above so the fire aura deforms with the ball. Skipped while frozen (frost,
    // not fire) and for won/disintegrating balls (the clear wave draws their
    // drained flame instead).
    {
      const nowF = performance.now();
      const isFrozen = ball.frozenUntil !== undefined && nowF < ball.frozenUntil;
      if (ball.state === 'active' && !isFrozen && screenRadius > 0.5) {
        drawBallFlame(
          ctx, screenPos.x, screenPos.y, screenRadius, ball.id, nowF,
          ball.velocity.x, ball.velocity.y, ballFlamePalette(baseColor), assimScale,
          flameTongues,
        );
      }
    }

    const { canvas: baseCanvas, halfSize: baseHalf } = getBallBase(blendedHex, screenRadius, scale);
    ctx.drawImage(baseCanvas, Math.round(screenPos.x - baseHalf), Math.round(screenPos.y - baseHalf));

    // Sphere shading (latitude bands, longitude meridians, equatorial band,
    // polar caps) — Layers 1-4 baked into a rotation-bucketed sprite and blitted
    // once, instead of ~18 live ellipse/arc path ops + a clip per ball per frame.
    // Pure black-on-transparent, so it sits directly over the coloured base disc.
    {
      const sphere = getBallSphere(screenRadius, scale, ball.rotation, ballIdHash);
      ctx.drawImage(sphere.canvas, Math.round(screenPos.x - sphere.halfSize), Math.round(screenPos.y - sphere.halfSize));
    }

    // Layer 5: Circuit-board hex overlay. Kept live (not baked) because its
    // 'overlay' composite must blend against the coloured base disc beneath it;
    // baking it onto transparency would change the blend. Clips to the ball
    // circle itself now that the shared clip above is gone.
    if (screenRadius > 0) {
      const hexOC = getHexOverlay(accentColor);
      ctx.save();
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.18;
      ctx.translate(Math.round(screenPos.x), Math.round(screenPos.y));
      ctx.rotate(ball.rotation * 0.3);
      ctx.drawImage(hexOC, -screenRadius, -screenRadius, screenRadius * 2, screenRadius * 2);
      ctx.restore();
    }

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

    if (squish.active) ctx.restore(); // squash & stretch transform

    // Boss birth splash: wet droplets sprayed as a minion buds out. Drawn in the
    // ball's own screen space (outside the squish transform) so it reads as fluid
    // flung off the boss, not a deformed body layer.
    if (ball.isBoss && ball.bornSplashAt !== undefined && ball.splitDirX !== undefined) {
      const sf = bossSplashFrame(
        screenRadius, ball.splitDirX, ball.splitDirY ?? 0,
        ball.bornSplashAt, performance.now(), scale, Math.round(ball.bornSplashAt),
      );
      if (sf.active) {
        if (sf.ringAlpha > 0.01) {
          ctx.beginPath();
          ctx.arc(screenPos.x + sf.ringX, screenPos.y + sf.ringY, sf.ringR, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(baseColor, sf.ringAlpha);
          ctx.lineWidth = sf.ringWidth;
          ctx.stroke();
        }
        for (const d of sf.droplets) {
          ctx.beginPath();
          ctx.arc(screenPos.x + d.x, screenPos.y + d.y, d.r, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(baseColor, d.alpha);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(screenPos.x + d.x + d.hx, screenPos.y + d.y + d.hy, d.r * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${d.alpha * 0.7})`;
          ctx.fill();
        }
      }
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
        // Wash the accent flood in and back out over the region, leaving nothing
        // behind. A permanent fill here painted the ray-cast lock polygon, which
        // is occluded by any obstacle from the ball's lock centre — that stale
        // wedge in the obstacle's shadow was the persistent "shadow behind the
        // obstacle". The captured territory already shows via the region fill, so
        // no overlay needs to linger.
        fillAlpha = Math.sin(ft * Math.PI) * 0.7;
        glowAlpha = (1 - ft) * 0.9;
      } else {
        fillAlpha = 0;
        glowAlpha = 0;
      }

      ctx.save();
      if (flash.contours.length > 0 && fillAlpha > 0) {
        // Fill the pocket's smooth contour loops (traced + Chaikin-rounded at lock
        // time, exactly like the persistent captured-territory tint). Bounded to
        // the real cells so it can't overshoot toward a nearby object, and smooth
        // so there's no 15px staircase. Even-odd handles enclosed obstacle holes.
        ctx.save();
        // Interior movers aren't grid cells, so a pocket cell can sit under one —
        // CLIP them out (board minus movers). Clipping, not an even-odd subpath:
        // a mover OUTSIDE the pocket must stay untouched, not get filled.
        if (game.movers.length > 0) {
          const clip = new Path2D();
          clip.rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height);
          for (const mover of game.movers) {
            const vs = mover.polygon.vertices;
            if (vs.length < 3) continue;
            const m0 = w2s(vs[0].x, vs[0].y);
            clip.moveTo(m0.x, m0.y);
            for (let i = 1; i < vs.length; i++) {
              const mv = w2s(vs[i].x, vs[i].y);
              clip.lineTo(mv.x, mv.y);
            }
            clip.closePath();
          }
          ctx.clip(clip, 'evenodd');
        }
        ctx.beginPath();
        for (const loop of flash.contours) {
          if (loop.length < 3) continue;
          const p0 = w2s(loop[0].x, loop[0].y);
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < loop.length; i++) {
            const p = w2s(loop[i].x, loop[i].y);
            ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
        }
        ctx.fillStyle = `rgba(${acR}, ${acG}, ${acB}, ${fillAlpha})`;
        ctx.fill('evenodd');
        ctx.restore();
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

      // First-ever lock of this ball type: a rising, fading "Info Unlocked"
      // label above the ball, on top of the usual lock animation.
      if (flash.firstEncounter && elapsed < INFO_UNLOCKED_DURATION) {
        const FADE_IN_MS = 150, FADE_OUT_MS = 500, RISE_WORLD = 55;
        const fadeIn = Math.min(1, elapsed / FADE_IN_MS);
        const fadeOut = elapsed > INFO_UNLOCKED_DURATION - FADE_OUT_MS
          ? Math.max(0, (INFO_UNLOCKED_DURATION - elapsed) / FADE_OUT_MS)
          : 1;
        const textAlpha = Math.min(fadeIn, fadeOut);
        const rise = RISE_WORLD * (elapsed / INFO_UNLOCKED_DURATION);
        const tp = w2s(flash.centroid.x, flash.centroid.y - 40 - rise);

        ctx.save();
        ctx.globalAlpha = textAlpha;
        ctx.font = `bold ${Math.max(11, Math.round(13 * scale))}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 10 * scale;
        ctx.fillStyle = accentColor;
        ctx.fillText(infoUnlockedLabel, tp.x, tp.y);
        ctx.restore();
      }

      // Superior lock (tight pocket): same rising label treatment in gold.
      // When the first-encounter label is also up, this one sits below it.
      if (flash.superior && elapsed < INFO_UNLOCKED_DURATION) {
        const FADE_IN_MS = 150, FADE_OUT_MS = 500, RISE_WORLD = 55;
        const fadeIn = Math.min(1, elapsed / FADE_IN_MS);
        const fadeOut = elapsed > INFO_UNLOCKED_DURATION - FADE_OUT_MS
          ? Math.max(0, (INFO_UNLOCKED_DURATION - elapsed) / FADE_OUT_MS)
          : 1;
        const textAlpha = Math.min(fadeIn, fadeOut);
        const rise = RISE_WORLD * (elapsed / INFO_UNLOCKED_DURATION);
        const yOff = flash.firstEncounter ? 18 : 40;
        const tp = w2s(flash.centroid.x, flash.centroid.y - yOff - rise);

        ctx.save();
        ctx.globalAlpha = textAlpha;
        ctx.font = `bold ${Math.max(11, Math.round(13 * scale))}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = '#ffd54a';
        ctx.shadowBlur = 10 * scale;
        ctx.fillStyle = '#ffd54a';
        ctx.fillText(superiorLockLabel, tp.x, tp.y);
        ctx.restore();
      }
    }
  }

  // ── Pickup claim / waste feedback ─────────────────────────────────────────
  // Claimed: a rising label (Info Unlocked styling) + an expanding ring in the
  // token's colour. Wasted: a grey collapsing ring with a strike. Entries are
  // culled by updatePickups, so this only ever draws live markers.
  if (game.pickupFeedback && game.pickupFeedback.length > 0) {
    const nowP = performance.now();
    for (const fb of game.pickupFeedback) {
      const elapsed = nowP - fb.startTime;
      if (elapsed < 0 || elapsed >= PICKUP_FEEDBACK_MS) continue;
      const t = elapsed / PICKUP_FEEDBACK_MS;
      if (fb.kind === 'claimed') {
        const col = pickupColor(fb.effect, accentColor);
        const alpha = Math.min(1, elapsed / 120) * (t > 0.6 ? (1 - t) / 0.4 : 1);
        const tp = w2s(fb.position.x, fb.position.y - 18 - 45 * t);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${Math.max(11, Math.round(13 * scale))}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = col;
        ctx.shadowBlur = 10 * scale;
        ctx.fillStyle = col;
        ctx.fillText(pickupFeedbackLabel(fb, rctx.pickupLabels), tp.x, tp.y);
        ctx.restore();
        const ringT = Math.min(1, elapsed / 450);
        if (ringT < 1) {
          const p = w2s(fb.position.x, fb.position.y);
          ctx.save();
          ctx.globalAlpha = (1 - ringT) * 0.8;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2 * scale;
          ctx.beginPath();
          ctx.arc(p.x, p.y, (PICKUP_DRAW_RADIUS + 30 * ringT) * scale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else {
        const p = w2s(fb.position.x, fb.position.y);
        const rr = PICKUP_DRAW_RADIUS * scale * (1 - t);
        if (rr <= 0.5) continue;
        ctx.save();
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.strokeStyle = '#9aa3ad';
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - rr, p.y - rr);
        ctx.lineTo(p.x + rr, p.y + rr);
        ctx.stroke();
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
    // Obstacle hole subpaths are static per level — cached (see helper).
    clipPath.addPath(getObstacleHolesPath(obstacles, boardRect, scale));
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

  // ── Space progress bar (drawn after clear so it sits below the board).
  // Once the map is won it fades out over SPACE_BAR_FADE_MS - it must not sit
  // under the board through the clear wave. It returns with the next map's
  // fresh game state. ───────────────────────────────────────────────────────
  const spaceBarFade = game.levelComplete
    ? 1 - (performance.now() - (game.levelCompleteTime ?? 0)) / SPACE_BAR_FADE_MS
    : 1;
  if (game.spaceGrid && spaceBarFade > 0) {
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
    ctx.globalAlpha = spaceBarFade;
    ctx.fillRect(bl, barY, bw, barH);

    // Primary fill (left → right, accent/green)
    const fillW = bw * fillRatio;
    const isComplete = fillRatio >= 1;
    ctx.fillStyle = isComplete ? '#00ff44' : accentColor;
    ctx.globalAlpha = 0.75 * spaceBarFade;
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
        ctx.globalAlpha = 0.85 * spaceBarFade;
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
  // Free the sweep caches between levels (shimmer inactive).
  if (game.shimmerStart <= 0) {
    if (_wakeOC)       { _wakeOC = null;       _wakeKey = ''; }
    if (_frozenLiveOC) { _frozenLiveOC = null; _frozenLiveKey = ''; }
    if (_waveStripOC)  { _waveStripOC = null;  _waveStripKey = ''; }
    return;
  }

  // Level-clear sweep. The full scene was just rendered above; on the first sweep
  // frame capture it once into _frozenLiveOC so subsequent frames take the frozen
  // fast-path at the top of renderFrame and skip the whole live render.
  {
    const raw = performance.now() - game.shimmerStart;
    const el = game.shimmerFrozen ? Math.min(raw, LEVEL_CLEAR_SHIMMER_MS) : raw;
    if (el >= 0 && el <= LEVEL_CLEAR_SHIMMER_MS) {
      const key = `${game.shimmerStart}|${ctx.canvas.width}x${ctx.canvas.height}`;
      if (!_frozenLiveOC || _frozenLiveKey !== key) {
        _frozenLiveOC = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
        _frozenLiveKey = key;
        const foc = _frozenLiveOC.getContext('2d') as unknown as CanvasRenderingContext2D;
        foc.drawImage(ctx.canvas, 0, 0);
      }
    }
  }
  renderClearShimmer(ctx, game, rctx, w2s, boardRect, scale, accentColor, walls, balls);
}

/**
 * Draw the level-clear shimmer: the drained-grey wake above the wave line plus
 * the luminous wave band sweeping down. Split out of renderFrame so the frozen
 * fast-path can call it directly, without re-rendering the static below-wave
 * scene. Physics is halted for the whole sweep, so both the wake (built once
 * into _wakeOC) and the wave band (baked once into _waveStripOC) are cached.
 */
function renderClearShimmer(
  ctx: CanvasRenderingContext2D,
  game: CanvasGameState,
  rctx: RenderContext,
  w2s: (wx: number, wy: number) => { x: number; y: number },
  boardRect: CanvasGameState['boardRect'],
  scale: number,
  accentColor: string,
  walls: CanvasGameState['walls'],
  balls: CanvasGameState['balls'],
): void {
  // In freeze mode (dev/playground), clamp to the end-state once the sweep is
  // done so the fully-drained board holds indefinitely instead of reverting.
  const elapsedRaw = performance.now() - game.shimmerStart;
  const elapsed = game.shimmerFrozen ? Math.min(elapsedRaw, LEVEL_CLEAR_SHIMMER_MS) : elapsedRaw;
  if (elapsed < 0 || elapsed > LEVEL_CLEAR_SHIMMER_MS) return;

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

  // Dead wake: as the wave passes, redraw JUST the walls, objects and the
  // remaining-space bar in a drained grey so they look powered-down. The board
  // background and region fills are left alone. Clipped to the swept region
  // above the wave front so it drains top-down and objects straddling the
  // front are half-grey; the clip reaches the bar just below the board.
  const barBottom = bt + bh + 7 * scale;
  const wakeBottom = Math.min(centerY, barBottom);
  if (wakeBottom > bt) {
    const drain = Math.min(1, progress / 0.08); // ease in only, never out

    // Build the drained scene ONCE per shimmer (it's static — physics is
    // halted), then blit the swept slice per frame. Drawing it live cost a
    // dozen shadowBlur passes per frame and lagged on mobile.
    const wakeKey = `${game.shimmerStart}|${ctx.canvas.width}x${ctx.canvas.height}|${bl},${bt},${bw},${bh}`;
    if (!_wakeOC || _wakeKey !== wakeKey) {
      _wakeOC = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
      _wakeKey = wakeKey;
      const oc = _wakeOC.getContext('2d') as unknown as CanvasRenderingContext2D;
      const GREY = '#b8bcc4';
      const GREY_GLOW = 'rgba(184,188,196,0.9)';
      oc.lineCap = 'round';
      oc.lineJoin = 'round';

      // Obstacles, mirrors and breakable bodies: soft glowing grey edge with
      // a bright glossy highlight laid over it.
      for (const poly of game.obstaclePolygons) {
        const v = poly.vertices;
        if (v.length < 2) continue;
        const p0 = w2s(v[0].x, v[0].y);
        oc.beginPath();
        oc.moveTo(p0.x, p0.y);
        for (let i = 1; i < v.length; i++) { const p = w2s(v[i].x, v[i].y); oc.lineTo(p.x, p.y); }
        oc.closePath();
        oc.strokeStyle = GREY;
        oc.lineWidth = WALL_THICKNESS * scale;
        oc.shadowColor = GREY_GLOW;
        oc.shadowBlur = 7 * scale;
        oc.stroke();
        // Gloss: a thin bright-white sheen, added on top.
        oc.save();
        oc.globalCompositeOperation = 'lighter';
        oc.strokeStyle = 'rgba(255,255,255,0.45)';
        oc.lineWidth = Math.max(1, WALL_THICKNESS * scale * 0.45);
        oc.shadowColor = 'rgba(235,242,255,0.85)';
        oc.shadowBlur = 5 * scale;
        oc.stroke();
        oc.restore();
      }
      oc.shadowBlur = 0;

      // Moving obstacles: fill solid grey at their (now frozen) position so
      // the live orange body, direction arrow and pulsing glow are fully
      // covered - they read white/dead and stop moving. Physics is already
      // halted at level complete, so the fill sits exactly over the sprite.
      for (const mover of game.movers) {
        const mdx = mover.axis === 'horizontal' ? mover.offset : 0;
        const mdy = mover.axis === 'vertical'   ? mover.offset : 0;
        const sc = w2s(mover.homeX + mdx, mover.homeY + mdy);
        oc.beginPath();
        if (mover.shape === 'circle') {
          oc.arc(sc.x, sc.y, (mover.radius ?? 30) * scale, 0, Math.PI * 2);
        } else {
          const hw = (mover.width ?? 60) / 2 * scale;
          const hh = (mover.height ?? 60) / 2 * scale;
          oc.rect(sc.x - hw, sc.y - hh, hw * 2, hh * 2);
        }
        oc.fillStyle = GREY;
        oc.shadowColor = GREY_GLOW;
        oc.shadowBlur = 14 * scale; // >= the live mover glow so its halo is covered too
        oc.fill();
        oc.shadowBlur = 0;
        oc.strokeStyle = GREY;
        oc.lineWidth = 2 * scale;
        oc.stroke();
      }
      oc.shadowBlur = 0;

      // Fences and board-edge walls: reuse the live wall renderer with grey
      // so the glow and soft caps match, plus a glowBoost for extra bloom.
      for (const w of walls) {
        renderWallWithEffects(
          oc, w2s(w.start.x, w.start.y), w2s(w.end.x, w.end.y),
          w.start, w.end, scale, GREY, w.thickness * scale, 0.5,
        );
      }
      // Gloss: a bright-white sheen run along every border and fence.
      oc.save();
      oc.globalCompositeOperation = 'lighter';
      oc.strokeStyle = 'rgba(255,255,255,0.5)';
      oc.shadowColor = 'rgba(235,242,255,0.9)';
      oc.shadowBlur = 6 * scale;
      for (const w of walls) {
        const s = w2s(w.start.x, w.start.y);
        const e = w2s(w.end.x, w.end.y);
        oc.lineWidth = Math.max(1, w.thickness * scale * 0.4);
        oc.beginPath();
        oc.moveTo(s.x, s.y);
        oc.lineTo(e.x, e.y);
        oc.stroke();
      }
      oc.restore();

      // Balls: soft grey discs (glow halo + core). Flames stay live below.
      for (const ball of balls) {
        const pos = ball.renderPosition ?? ball.position;
        const p = w2s(pos.x, pos.y);
        const r = Math.max(1, ball.radius * scale);
        const halo = oc.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
        halo.addColorStop(0, 'rgba(220,223,230,0.9)');
        halo.addColorStop(0.5, 'rgba(184,188,196,0.45)');
        halo.addColorStop(1, 'rgba(184,188,196,0)');
        oc.fillStyle = halo;
        oc.beginPath();
        oc.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
        oc.fill();
        oc.fillStyle = '#cfd3da';
        oc.beginPath();
        oc.arc(p.x, p.y, r, 0, Math.PI * 2);
        oc.fill();
      }

      // Remaining-space bar below the board, filled in grey.
      if (game.spaceGrid) {
        const remaining = getRemainingPercent(game.spaceGrid);
        const targetCaptured = 100 - rctx.spaceThreshold;
        const fillRatio = Math.min(1, targetCaptured > 0 ? (100 - remaining) / targetCaptured : 1);
        oc.globalAlpha = 0.85;
        oc.fillStyle = GREY;
        oc.shadowColor = GREY_GLOW;
        oc.shadowBlur = 3 * scale;
        oc.fillRect(bl, bt + bh + 3 * scale, bw * fillRatio, 4 * scale);
        oc.shadowBlur = 0;
        oc.globalAlpha = 1;
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(bl, bt, bw, wakeBottom - bt);       // swept region only
    ctx.clip();
    // Remove the region fills (captured + active) in the wake so only the
    // structures remain - just borders, fences, objects and balls, drained to
    // grey below. Clearing sidesteps any fill-recolour artifacts (blocky grid
    // cells, jagged hole seams) entirely.
    ctx.clearRect(bl, bt, bw, Math.min(wakeBottom, bt + bh) - bt);

    // Blit the cached drained scene into the swept slice.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = drain;
    const sliceH = wakeBottom - bt;
    ctx.drawImage(_wakeOC, bl, bt, bw, sliceH, bl, bt, bw, sliceH);

    // Flames animate, so they stay live: cheap cached-sprite blits per ball.
    const flameNow = performance.now();
    for (const ball of balls) {
      const pos = ball.renderPosition ?? ball.position;
      const p = w2s(pos.x, pos.y);
      const r = Math.max(1, ball.radius * scale);
      drawBallFlame(ctx, p.x, p.y, r, ball.id, flameNow, 0, 0, FLAME_DRAINED, drain);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // Wave band + glowing leading edge: baked ONCE into a strip sprite and blitted
  // at the wave's Y with globalAlpha = peak. Removes the per-frame linear-gradient
  // alloc and the per-frame leading-edge shadowBlur (a Gaussian blur every frame).
  const stripMargin = Math.ceil(16 * scale);
  const waveKey = `${accentColor}|${Math.round(bw)}|${Math.round(band)}|${Math.round(scale * 100)}`;
  if (!_waveStripOC || _waveStripKey !== waveKey) {
    const stripW = Math.max(1, Math.ceil(bw));
    const stripH = Math.max(1, Math.ceil(band * 2 + stripMargin * 2));
    _waveStripOC = new OffscreenCanvas(stripW, stripH);
    _waveStripKey = waveKey;
    const sc = _waveStripOC.getContext('2d') as unknown as CanvasRenderingContext2D;
    const midY = stripH / 2;
    sc.globalCompositeOperation = 'lighter';
    // Baked at reference intensity 1; the per-frame globalAlpha = peak reproduces
    // the original alphas exactly (every stop was linear in peak).
    const grad = sc.createLinearGradient(0, midY - band, 0, midY + band);
    grad.addColorStop(0, hexToRgba(accentColor, 0));
    grad.addColorStop(0.45, hexToRgba(accentColor, 0.5));
    grad.addColorStop(0.5, hexToRgba('#ffffff', 1));
    grad.addColorStop(0.55, hexToRgba(accentColor, 0.5));
    grad.addColorStop(1, hexToRgba(accentColor, 0));
    sc.fillStyle = grad;
    sc.fillRect(0, midY - band, stripW, band * 2);
    // Crisp glowing leading edge (its shadowBlur is baked here, just once).
    sc.strokeStyle = hexToRgba('#ffffff', 1);
    sc.lineWidth = Math.max(1.5, 2 * scale);
    sc.shadowColor = accentColor;
    sc.shadowBlur = 12 * scale;
    sc.beginPath();
    sc.moveTo(0, midY);
    sc.lineTo(stripW, midY);
    sc.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = peak;
  ctx.drawImage(_waveStripOC, bl, centerY - band - stripMargin);
  ctx.globalAlpha = 1;

  ctx.restore();
}
