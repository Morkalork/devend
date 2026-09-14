/**
 * Motes: the air the light travels through.
 *
 * A pool of light on a flat floor is a decal. What makes it read as a VOLUME
 * is something in between the source and the eye catching it, which on this
 * board means a sparse field of specks that are invisible until a ball's light
 * crosses them. That is the whole idea, and it has three faces built from one
 * substrate:
 *
 *   AMBIENT   a fixed field that drifts slowly and wraps at the board's edge.
 *     Always there, never visible on its own, and the only reason you can tell
 *     a pool has depth.
 *   WEATHER   the same field with a heading: snow, ash, an updraft. Authored
 *     per map, because it is scenery and scenery belongs to the map.
 *   RESIDUE   motes born from an event rather than standing around - a
 *     destructible breaking, a chest smashing, a pocket locking - which then
 *     drift and die. Debris that catches a passing ball's light is debris that
 *     belongs to the scene rather than sitting on top of it.
 *
 * ── WHY THIS IS AFFORDABLE ──────────────────────────────────────────────────
 *
 * The cost of a particle system is never the particle count, it is what each
 * particle ASKS FOR. A particle that is a display object costs a node, a
 * transform and a draw; a thousand of those is a real bill. A particle that is
 * four vertices in one shared mesh costs some arithmetic and no draw call at
 * all, which is the same trade ballLayer.ts already makes for the body and the
 * corona. So every mote here is four vertices in one buffer, and the whole
 * field is one draw.
 *
 * The interesting cost is the lighting, because a mote has to know how much
 * light is falling on it and there are tens of emitters. Done naively that is
 * motes x emitters - four hundred motes against thirty-three emitters is
 * thirteen thousand distance checks a frame, which is exactly the kind of
 * number that ends with the effect being deleted. So the emitters are binned
 * into a coarse grid once per frame (each one inserted into the few cells its
 * reach overlaps) and each mote reads only the cell it is standing in. The
 * per-mote cost stops depending on how many emitters the board has.
 *
 * Everything here is pure and in WORLD units; moteLayer.ts draws it.
 */

import type { Pt } from "./sleek/pixelGrid";

/** One speck. Packed as a struct-of-arrays would be faster and unreadable. */
export interface Mote {
  x: number;
  y: number;
  /** Drift, world units per second. Ambient motes keep theirs for ever. */
  vx: number;
  vy: number;
  /** World units across. */
  size: number;
  /** Per-mote brightness multiplier, so a field is not a grid of identical dots. */
  gain: number;
  /**
   * Milliseconds left to live, or Infinity for an ambient mote.
   *
   * The two kinds share one pool and one mesh on purpose: a residue burst is
   * the same object with a clock on it, and keeping them apart would mean two
   * buffers, two draws and two places to get the lighting right.
   */
  life: number;
  /** What it was born with, so the fade knows where it started. */
  maxLife: number;
  /** Packed colour. Ambient motes are white and take the light's own hue. */
  color: number;
}

/** A light the motes can catch. Deliberately not BallLight: this is all it needs. */
export interface MoteLight {
  x: number;
  y: number;
  reach: number;
  intensity: number;
  color: number;
}

/**
 * How wide a bin is, in world units.
 *
 * Comfortably larger than a ball's pool (about 97 units) so a typical emitter
 * lands in one or two cells rather than smearing across nine. Larger still
 * would mean more emitters per cell and a slower mote; smaller means more
 * insertions. On a 900-unit board this is an 8x8 grid, which is 64 small
 * arrays rebuilt per frame and nothing worth optimising further.
 */
export const BIN_SIZE = 120;

/** Ambient motes drift this slowly, in world units per second. */
export const AMBIENT_DRIFT = 5;

/**
 * Ambient mote size range, in world units.
 *
 * Bigger than the first pass, and that is a consequence of brightness being
 * carried by SIZE (see moteLayer.ts). A mote at half brightness is drawn at
 * roughly half its size, so a base of one world unit means a lit mote is
 * sub-pixel and the field is invisible - which is exactly what the first
 * screenshot showed. These are sized so that even a dim one still lands on a
 * pixel or two.
 */
export const MOTE_MIN_SIZE = 2.6;
export const MOTE_MAX_SIZE = 5.4;

/**
 * How bright a mote gets at the very centre of a pool.
 *
 * Low, and it has to be. A mote is only honest if it is invisible until light
 * finds it; anything bright enough to see on an unlit board is a speck painted
 * on the floor, which is worse than nothing because it reads as dirt on the
 * screen.
 */
export const MOTE_PEAK_ALPHA = 0.5;

/**
 * The floor a mote is allowed to sit at with no light on it at all.
 *
 * Zero. Not nearly zero - zero. This is the single rule the effect lives or
 * dies by, and it is also what makes it free to leave on: an unlit board draws
 * a field of fully transparent quads, which costs the buffer write and nothing
 * on screen.
 */
export const MOTE_DARK_ALPHA = 0;

/**
 * The fastest a map's weather may drift, in world units per second.
 *
 * Low. Anything crossing the whole board competes for attention with the balls,
 * which are the thing the player is actually tracking - so this is a drift, not
 * a gale. At 40 a mote takes about twenty seconds to cross an 810-unit board.
 */
export const WEATHER_MAX = 40;

/** A map's authored weather, clamped. Absent or zero means still air. */
export function clampWeather(w?: { x: number; y: number } | null): { x: number; y: number } | undefined {
  if (!w) return undefined;
  const x = Number.isFinite(w.x) ? Math.max(-WEATHER_MAX, Math.min(WEATHER_MAX, w.x)) : 0;
  const y = Number.isFinite(w.y) ? Math.max(-WEATHER_MAX, Math.min(WEATHER_MAX, w.y)) : 0;
  return x === 0 && y === 0 ? undefined : { x, y };
}

/** A deterministic generator, so two devices show the same field. */
export function moteRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

export interface MoteField {
  motes: Mote[];
  /** How many slots at the front are ambient; the rest are the residue ring. */
  ambient: number;
  /** Next residue slot to overwrite. */
  cursor: number;
  /** The box motes wrap inside, in world units. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Build a field over a board box.
 *
 * The ambient count is fixed at creation rather than grown on demand, because
 * a pool that never allocates is a pool that never causes a hitch mid-play -
 * and because the residue ring OVERWRITING its oldest entry is the correct
 * behaviour when a map is spraying debris, not a limitation to work around.
 */
export function createMoteField(
  minX: number, minY: number, maxX: number, maxY: number,
  ambient: number, residue: number, seed = 20260914,
): MoteField {
  const rnd = moteRandom(seed);
  const motes: Mote[] = [];
  for (let i = 0; i < ambient; i++) {
    const a = rnd() * Math.PI * 2;
    motes.push({
      x: minX + rnd() * (maxX - minX),
      y: minY + rnd() * (maxY - minY),
      vx: Math.cos(a) * AMBIENT_DRIFT,
      vy: Math.sin(a) * AMBIENT_DRIFT,
      size: MOTE_MIN_SIZE + rnd() * (MOTE_MAX_SIZE - MOTE_MIN_SIZE),
      // A field of identically bright specks reads as a texture; a spread of
      // brightnesses reads as depth, because the eye takes the dim ones as
      // further away.
      gain: 0.35 + rnd() * 0.65,
      life: Infinity,
      maxLife: Infinity,
      color: 0xffffff,
    });
  }
  for (let i = 0; i < residue; i++) {
    motes.push({
      x: 0, y: 0, vx: 0, vy: 0, size: 0, gain: 0,
      life: 0, maxLife: 1, color: 0xffffff,
    });
  }
  return { motes, ambient, cursor: 0, minX, minY, maxX, maxY };
}

/** Resize the box a field wraps in, keeping the motes it already has. */
export function refitMoteField(
  f: MoteField, minX: number, minY: number, maxX: number, maxY: number,
): void {
  f.minX = minX; f.minY = minY; f.maxX = maxX; f.maxY = maxY;
}

/**
 * Throw a burst of residue motes.
 *
 * Overwrites the oldest slots in the ring. A burst that arrives while the ring
 * is full silently costs the tail of an older one, which is the right answer:
 * the newest event is the one the player is looking at.
 */
export function spawnResidue(
  f: MoteField, x: number, y: number, count: number, color: number,
  speed: number, lifeMs: number, rnd: () => number,
): void {
  const ring = f.motes.length - f.ambient;
  if (ring <= 0) return;
  for (let i = 0; i < count; i++) {
    const m = f.motes[f.ambient + (f.cursor % ring)];
    f.cursor++;
    const a = rnd() * Math.PI * 2;
    const s = speed * (0.35 + rnd() * 0.65);
    m.x = x; m.y = y;
    m.vx = Math.cos(a) * s;
    m.vy = Math.sin(a) * s;
    m.size = MOTE_MIN_SIZE + rnd() * (MOTE_MAX_SIZE - MOTE_MIN_SIZE);
    m.gain = 0.5 + rnd() * 0.5;
    m.maxLife = lifeMs * (0.6 + rnd() * 0.8);
    m.life = m.maxLife;
    m.color = color;
  }
}

/**
 * Advance the field by `dt` seconds, with an optional weather push.
 *
 * Ambient motes WRAP; residue motes expire. Wrapping rather than respawning is
 * what keeps the field a fixed cost forever, and at this drift speed nobody has
 * ever seen a mote cross the boundary.
 */
export function stepMotes(f: MoteField, dt: number, windX = 0, windY = 0): void {
  const w = f.maxX - f.minX, h = f.maxY - f.minY;
  if (!(w > 0 && h > 0)) return;
  const ms = dt * 1000;
  for (let i = 0; i < f.motes.length; i++) {
    const m = f.motes[i];
    if (i < f.ambient) {
      m.x += (m.vx + windX) * dt;
      m.y += (m.vy + windY) * dt;
      if (m.x < f.minX) m.x += w; else if (m.x > f.maxX) m.x -= w;
      if (m.y < f.minY) m.y += h; else if (m.y > f.maxY) m.y -= h;
    } else if (m.life > 0) {
      m.life -= ms;
      // Residue slows as it settles. Debris that kept its birth speed until it
      // vanished would read as being sucked away rather than coming to rest.
      const drag = Math.exp(-dt * 1.8);
      m.vx *= drag;
      m.vy *= drag;
      m.x += (m.vx + windX) * dt;
      m.y += (m.vy + windY) * dt;
    }
  }
}

/**
 * Emitters binned by position, so a mote's cost does not scale with the board.
 *
 * Each emitter goes into every cell its reach touches, which is one or two for
 * a ball's pool and a handful for a lock flash. The mote then reads exactly one
 * cell. The alternative - the mote reading its own cell plus the eight round it
 * - moves the same work to the side that is run four hundred times instead of
 * thirty.
 */
export class MoteBins {
  private cells = new Map<number, MoteLight[]>();
  private cols = 0;

  rebuild(lights: readonly MoteLight[], minX: number, minY: number, cols: number, rows: number): void {
    this.cells.clear();
    this.cols = cols;
    for (const l of lights) {
      if (l.intensity <= 0.002) continue;
      const c0 = Math.max(0, Math.floor((l.x - l.reach - minX) / BIN_SIZE));
      const c1 = Math.min(cols - 1, Math.floor((l.x + l.reach - minX) / BIN_SIZE));
      const r0 = Math.max(0, Math.floor((l.y - l.reach - minY) / BIN_SIZE));
      const r1 = Math.min(rows - 1, Math.floor((l.y + l.reach - minY) / BIN_SIZE));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const k = r * cols + c;
          const list = this.cells.get(k);
          if (list) list.push(l);
          else this.cells.set(k, [l]);
        }
      }
    }
  }

  at(col: number, row: number): readonly MoteLight[] | undefined {
    return this.cells.get(row * this.cols + col);
  }
}

/**
 * How much light reaches a point, and in what colour.
 *
 * The falloff is the square of the pool's own linear one, which lands a mote's
 * visible region well inside the pool rather than at its edge - a speck lit to
 * the very rim of a pool draws the rim, and the rim is the one part of a soft
 * light that should not have an edge.
 */
export function lightAt(
  bins: MoteBins, x: number, y: number, minX: number, minY: number,
  cols: number, rows: number,
): { level: number; color: number } {
  const col = Math.floor((x - minX) / BIN_SIZE);
  const row = Math.floor((y - minY) / BIN_SIZE);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return { level: 0, color: 0xffffff };
  const list = bins.at(col, row);
  if (!list) return { level: 0, color: 0xffffff };

  let level = 0, r = 0, g = 0, b = 0;
  for (const l of list) {
    // SQUARED first, and Math.sqrt rather than Math.hypot for the survivors.
    // This runs per mote per emitter in the cell, which is the innermost loop
    // in the whole effect, and Math.hypot's overflow-safe path costs several
    // times a plain sqrt for numbers that can never overflow. Measured: the
    // two together were most of the mote field's per-frame cost.
    const dx = x - l.x, dy = y - l.y;
    const d2 = dx * dx + dy * dy;
    const reach2 = l.reach * l.reach;
    if (d2 >= reach2) continue;
    const t = 1 - Math.sqrt(d2) / l.reach;
    const v = l.intensity * t * t;
    if (v <= 0) continue;
    level += v;
    r += ((l.color >> 16) & 255) * v;
    g += ((l.color >> 8) & 255) * v;
    b += (l.color & 255) * v;
  }
  if (level <= 0) return { level: 0, color: 0xffffff };
  // The colour is the light-weighted average of everything reaching it, so a
  // mote between a red ball and a blue one is the colour standing there really
  // is rather than whichever emitter happened to be last in the list.
  return {
    level,
    color: (Math.min(255, r / level) << 16) | (Math.min(255, g / level) << 8) | Math.min(255, b / level),
  };
}

/** A mote's alpha: what the light gives it, times its own gain and its fade. */
export function moteAlpha(m: Mote, level: number): number {
  if (level <= 0) return MOTE_DARK_ALPHA;
  const fade = m.life === Infinity ? 1 : Math.max(0, Math.min(1, m.life / m.maxLife));
  return Math.min(MOTE_PEAK_ALPHA, level * m.gain * MOTE_PEAK_ALPHA) * fade;
}

/** Board-box columns and rows for a field. */
export function binDims(f: MoteField): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.ceil((f.maxX - f.minX) / BIN_SIZE)),
    rows: Math.max(1, Math.ceil((f.maxY - f.minY) / BIN_SIZE)),
  };
}

export type { Pt };
