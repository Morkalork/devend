/**
 * The board's one and only light source.
 *
 * A monitor sits just past the BOTTOM-RIGHT corner of the screen, off-frame.
 * It is never drawn - the player only ever sees its consequences: everything on
 * the board casts up-and-left, lit edges face down-and-right, and the whole
 * surface falls off toward the top-left corner.
 *
 * Two rules make it coherent, and every layer must obey both:
 *
 * 1. ONE SCOPE. Every shadow in the scene comes from `shadowFor()`. No layer
 *    invents its own offset, and nothing casts symmetrically (the old renderer's
 *    wall shadows fanned out both sides of every fence, which is why the board
 *    read flat).
 * 2. SCREEN SPACE. The light is pinned to the viewport, not the world. Maps are
 *    shown in one of four random orientations (mapRotation.ts), and a light that
 *    rotated with the map would tell the player which orientation they drew -
 *    besides looking wrong, since the monitor is a physical object in the
 *    player's room, not on the board.
 *
 * The source is a POINT, not a directional light: shadow direction fans across
 * the board and lengthens with distance, which is what sells "a screen just off
 * the corner" instead of "the sun".
 */

import type { BoardRect } from "@/lib/boardConstants";
import { monitorLevel } from "./monitorSignal";

/**
 * Where the monitor sits, in board-widths past the bottom-right corner. Far
 * enough that shadow directions stay coherent (a near light fans them so hard
 * the board looks fish-eyed), close enough that the fan is still visible.
 */
const LIGHT_OFFSET_X = 0.85;
const LIGHT_OFFSET_Y = 0.72;

/** Shadow length as a fraction of an object's own size, at the board's centre. */
const SHADOW_LENGTH = 1.15;
/** How much longer shadows get at the far (top-left) corner than the near one. */
const DISTANCE_STRETCH = 0.9;

export interface LightScope {
  /** Light position in screen (device-pixel) space. */
  x: number;
  y: number;
  /** Current monitor brightness, ~1.0, wavering with the flicker. */
  level: number;
  /** Board diagonal, the reference length for all falloff maths. */
  reach: number;
}

/**
 * Build this frame's light. Call ONCE per frame and thread it down: every layer
 * sharing one object is what guarantees a single coherent scope, and it also
 * means the flicker is sampled once rather than drifting between layers.
 */
export function lightScope(boardRect: BoardRect, now: number): LightScope {
  const w = boardRect.width;
  const h = boardRect.height;
  return {
    x: boardRect.left + w * (1 + LIGHT_OFFSET_X),
    y: boardRect.top + h * (1 + LIGHT_OFFSET_Y),
    level: monitorLevel(now),
    reach: Math.hypot(w, h),
  };
}

export interface ShadowCast {
  /** Unit vector pointing AWAY from the light: the direction shadows fall. */
  dx: number;
  dy: number;
  /** How far this object's shadow reaches, in screen pixels. */
  length: number;
  /** Shadow opacity at its root, already flicker-scaled. */
  alpha: number;
}

/**
 * The shadow cast by an object of `size` (its radius or half-thickness in
 * screen pixels) sitting at screen point (x, y).
 *
 * Shadows lengthen and soften with distance from the light, so an object in the
 * far corner throws a long faint smear while one near the corner throws a short
 * hard stub. That gradient across the board is most of what makes the scene
 * read as lit rather than merely decorated.
 */
export function shadowFor(light: LightScope, x: number, y: number, size: number): ShadowCast {
  const vx = x - light.x;
  const vy = y - light.y;
  const dist = Math.hypot(vx, vy) || 1;
  // 0 at the light, 1 at the far corner of its reach.
  const t = Math.min(1, dist / (light.reach * 1.9));
  const stretch = 1 + t * DISTANCE_STRETCH;
  return {
    dx: vx / dist,
    dy: vy / dist,
    length: size * SHADOW_LENGTH * stretch,
    // Distant shadows are longer but weaker: the light spreads.
    alpha: (0.72 - t * 0.22) * light.level,
  };
}

/**
 * How strongly a surface facing (nx, ny) at screen point (x, y) catches the
 * light: 1 = square-on to the monitor, 0 = facing fully away.
 *
 * Used for rim highlights on the lit side of walls, obstacles and balls. Pure
 * Lambert with a floor, because a hard cut to zero makes edges pop in and out
 * as objects move.
 */
export function facing(light: LightScope, x: number, y: number, nx: number, ny: number): number {
  const vx = light.x - x;
  const vy = light.y - y;
  const len = Math.hypot(vx, vy) || 1;
  const d = (nx * vx + ny * vy) / len;
  return Math.max(0, d);
}

/**
 * Ambient brightness of the bare board surface at a screen point: ~1 nearest
 * the monitor, falling off toward the top-left. Subtle on purpose - this is the
 * wash that stops the board reading as a flat sheet of colour, not a spotlight.
 */
export function ambientAt(light: LightScope, x: number, y: number): number {
  const dist = Math.hypot(x - light.x, y - light.y);
  const t = Math.min(1, dist / (light.reach * 1.6));
  return (1 - t * 0.45) * light.level;
}

/**
 * Contact shading: the tight dark band where an object meets the board. Much
 * shorter and denser than the cast shadow, and it is what actually makes things
 * look SEATED on the surface rather than floating above it.
 */
export function contactFor(light: LightScope, x: number, y: number, size: number): ShadowCast {
  const s = shadowFor(light, x, y, size);
  return { dx: s.dx, dy: s.dy, length: Math.max(1.5, size * 0.16), alpha: 0.5 * light.level };
}
