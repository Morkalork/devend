/**
 * The twinkle inside a superior lock.
 *
 * A superior pocket is marked for the rest of the map by a gold hatch on its
 * captured cells (boardLayer.drawSuperiorHatch). That is a good badge and a
 * still one: it says "this was a tight seal" and then says nothing ever again,
 * so the best thing a player does on a map stops being visible the moment its
 * flash ends.
 *
 * Asked for as "a star that blinks by quickly and then fades inside superior
 * locks. Think Nintendo." That reference is specific and worth taking
 * literally, because it names a shape AND a timing that a plain glow does not:
 *
 *   THE SHAPE    a four-pointed sparkle with a deeply pinched waist, not a
 *                five-pointed badge star. The pinch is the whole look: at
 *                INNER_RATIO the arms read as thin rays of light rather than
 *                as a solid polygon, which is what separates a twinkle from a
 *                sheriff's badge.
 *   THE TIMING   snap on, drift across, fade out. It is over in well under a
 *                second, and most of that is the fade. A sparkle that eased in
 *                and out symmetrically would read as a pulsing light fixture;
 *                the hard attack is what makes it a glint.
 *   THE CADENCE  rare. One or two on the board at a time, seconds apart. This
 *                is a reward being remembered, not treasure shining on a
 *                shelf, and this board has already been told once that a
 *                marker competing for attention is clutter.
 *
 * ── Why it is a pure function of the clock ──────────────────────────────────
 *
 * No state on the game, nothing to reset per map, nothing to keep in step
 * across a lockstep pair: two devices at the same timestamp with the same
 * captured cells twinkle identically, for the same reason monitorSignal.ts and
 * compassRing.ts are written this way. The schedule falls out of a hash of the
 * sparkle's index and which cycle it is on, so a sparkle "chooses" a cell
 * without anything having to remember the choice.
 */
import type { SpaceGrid } from "@/lib/spaceGrid";

/** One twinkle, in WORLD units. The renderer converts and colours it. */
export interface Sparkle {
  x: number;
  y: number;
  /** 0..1 of its full size, over its life. */
  scale: number;
  /** 0..1. */
  alpha: number;
  /** Radians. */
  rotation: number;
}

/** How long one sparkle lives, ms. Short: this is a glint, not a lamp. */
export const SPARKLE_MS = 620;

/**
 * Gap between one sparkle's cycles, ms.
 *
 * With two sparkles running out of phase this puts something on the board
 * roughly every second and a half, each in a different place, which reads as
 * an occasional catch of light. Dropping it much below this is the difference
 * between a pocket that glints and a pocket covered in glitter.
 */
export const SPARKLE_PERIOD_MS = 3200;

/**
 * Full radius of a sparkle at its peak, in world units.
 *
 * Under a ball's 18 on purpose: this decorates the pocket, it does not compete
 * with the thing the player is tracking. Looked at on a real board at 13 it
 * was a speck that had to be hunted for, which is not what "blinks by" means.
 */
export const SPARKLE_RADIUS = 16;

/**
 * Waist of the four-pointed star, as a fraction of its radius.
 *
 * The one number that decides whether this reads as Nintendo. At 0.5 it is a
 * chunky pinwheel; at this it is four thin rays meeting at a bright middle,
 * which is the shape the reference actually means.
 */
export const INNER_RATIO = 0.22;

/** Most sparkles alive at once, however much superior ground there is. */
const MAX_SPARKLES = 2;

/** Superior cells per sparkle, up to the cap. */
const CELLS_PER_SPARKLE = 45;

/** How far a sparkle drifts over its life, in world units. */
const DRIFT = 9;

/**
 * A small deterministic hash. Integers in, 0..1 out.
 *
 * Not `Math.random`: which cell a sparkle picks has to be the same on both
 * halves of a pair and on a replayed Daily run, and it has to be the same on
 * every frame of one sparkle's life or the twinkle would teleport as it drew.
 */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The cells a sparkle may sit in, cached until the superior ground changes.
 *
 * Keyed on the lock COUNT rather than on the cells themselves: superior cells
 * are only ever added, and only by a superior lock, which is exactly what that
 * counter counts. Rebuilding the list every frame would be a fresh array of a
 * few hundred numbers sixty times a second for a picture that changes once a
 * minute.
 */
let cachedGrid: SpaceGrid | null = null;
let cachedCount = -1;
let cachedCells: number[] = [];

function superiorCells(grid: SpaceGrid, superiorLockCount: number): number[] {
  if (cachedGrid === grid && cachedCount === superiorLockCount) return cachedCells;
  const flags = grid.superiorCaptured;
  const out: number[] = [];
  if (flags) {
    for (let i = 0; i < flags.length; i++) {
      if (flags[i]) out.push(i);
    }
  }
  cachedGrid = grid;
  cachedCount = superiorLockCount;
  cachedCells = out;
  return out;
}

/** Test seam: drop the cell cache. */
export function resetSparkleCache(): void {
  cachedGrid = null;
  cachedCount = -1;
  cachedCells = [];
}

/**
 * The sparkle's envelope over its life, 0..1 in and out.
 *
 * Attack is a twentieth of the life, which at this duration is about a frame
 * and a half: it is ON before the eye has registered anything moving, which is
 * what "blinks" means. Everything after is the fade, squared so it lingers
 * faintly rather than switching off.
 */
function envelope(t: number): { scale: number; alpha: number } {
  if (t < 0.05) {
    const a = t / 0.05;
    return { scale: a, alpha: a };
  }
  const f = (t - 0.05) / 0.95;
  // Scale holds a moment at full size before shrinking, so the shape is
  // legible as a star rather than only ever seen mid-grow.
  const shrink = f < 0.3 ? 1 : 1 - (f - 0.3) / 0.7;
  return { scale: shrink, alpha: (1 - f) * (1 - f) };
}

/**
 * Every twinkle alive right now, in world units.
 *
 * Returns an empty array on a board with no superior ground, which is most
 * boards for most of their life, so the caller's fast path is "nothing here".
 */
export function superiorSparkles(
  grid: SpaceGrid | null | undefined,
  superiorLockCount: number,
  now: number,
): Sparkle[] {
  if (!grid || !grid.superiorCaptured) return [];
  const cells = superiorCells(grid, superiorLockCount);
  if (cells.length === 0) return [];

  const count = Math.min(MAX_SPARKLES, 1 + Math.floor(cells.length / CELLS_PER_SPARKLE));
  const out: Sparkle[] = [];

  for (let i = 0; i < count; i++) {
    // Each sparkle runs on its own phase, so two never land together.
    const offset = (SPARKLE_PERIOD_MS / count) * i;
    const since = now + offset;
    const cycle = Math.floor(since / SPARKLE_PERIOD_MS);
    const age = since - cycle * SPARKLE_PERIOD_MS;
    if (age >= SPARKLE_MS) continue;

    const t = age / SPARKLE_MS;
    const { scale, alpha } = envelope(t);
    if (alpha <= 0.01) continue;

    // Which cell, decided once per cycle: the same for every frame of this
    // sparkle's life, and a different one next time round.
    const cell = cells[Math.floor(hash(i, cycle) * cells.length) % cells.length];
    const col = cell % grid.width;
    const row = (cell / grid.width) | 0;
    // Somewhere inside the cell rather than dead on its centre, or a pocket's
    // sparkles would visibly sit on the same lattice the hatch is drawn on.
    const jx = hash(cell, cycle + 1);
    const jy = hash(cell, cycle + 2);
    const bearing = hash(i, cycle + 3) * Math.PI * 2;

    // It travels: "blinks BY". A short drift across the cell, so the twinkle
    // is going somewhere rather than sitting still and dimming.
    const travelled = DRIFT * t;
    out.push({
      x: grid.originX + (col + jx) * grid.cellSize + Math.cos(bearing) * travelled,
      y: grid.originY + (row + jy) * grid.cellSize + Math.sin(bearing) * travelled,
      scale,
      alpha,
      // A lazy quarter-turn over its life. Enough to catch the eye, far too
      // little to read as spinning.
      rotation: bearing + t * 0.4,
    });
  }
  return out;
}

/**
 * The four-pointed star as a flat list of x,y pairs, ready to stroke or fill.
 *
 * Returned as points rather than drawn here for the reason compassRing.ts
 * gives at length: this renderer has no arcs and no shape helpers that leave a
 * corrupt point behind on a shared Graphics, so geometry comes back as a
 * polyline and the layer that owns the Graphics draws it.
 */
export function sparklePoints(cx: number, cy: number, radius: number, rotation: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = rotation + (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? radius : radius * INNER_RATIO;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}
