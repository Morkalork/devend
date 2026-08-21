/**
 * A world-space rectangle as it actually lands on screen.
 *
 * Every floor marking in the game (coloured areas, gravity wells) is authored
 * as an axis-aligned world rect, and for most of the game's life the screen
 * transform was a translate plus a uniform scale, so "w2s the top-left, w2s the
 * bottom-right, draw a rect" was exactly right.
 *
 * The board tilt (issue #77) broke that. Once the transform rotates, those two
 * corners no longer bound anything: at 45 degrees the level-12 well measures
 * 35x205 instead of a turned 240x170, and at 90 degrees the width comes out
 * NEGATIVE, which snapRect clamps to a 1px sliver. The marking does not look
 * wrong so much as vanish.
 *
 * So a rect has to be carried as its four transformed corners plus the local
 * basis they imply. The basis is what lets interior detail - stripes, glyphs,
 * insets - keep being authored in comfortable "pixels from the top-left corner"
 * terms and still land correctly on a turned board.
 */
import type { Pt } from "./pixelGrid";

export type W2S = (x: number, y: number) => Pt;

export interface ScreenQuad {
  /** The four corners in screen space, in world tl/tr/br/bl order. */
  tl: Pt; tr: Pt; br: Pt; bl: Pt;
  /** Centroid, which is where a glyph or label belongs. */
  cx: number; cy: number;
  /** Edge lengths in screen px (width along the local x axis, height along y). */
  w: number; h: number;
  /** Unit basis vectors: local +x and local +y, in screen space. */
  ux: number; uy: number;
  vx: number; vy: number;
  /**
   * True when the quad is still an upright screen rect, i.e. the board is at
   * rest. Callers use it to take the crisp pixel-snapped path; at rest the
   * output must be identical to the pre-tilt code, because that is the state
   * the game is in almost all of the time.
   */
  axisAligned: boolean;
}

/** How far off-axis a basis vector may drift and still count as upright. */
const AXIS_EPS = 1e-6;

/** Project a world-space axis-aligned rect through `w2s` into a ScreenQuad. */
export function worldRectQuad(
  x: number, y: number, width: number, height: number, w2s: W2S,
): ScreenQuad {
  const tl = w2s(x, y);
  const tr = w2s(x + width, y);
  const br = w2s(x + width, y + height);
  const bl = w2s(x, y + height);

  const ax = tr.x - tl.x, ay = tr.y - tl.y;
  const bx = bl.x - tl.x, by = bl.y - tl.y;
  const w = Math.hypot(ax, ay);
  const h = Math.hypot(bx, by);

  // A degenerate rect (zero width or height) has no direction to report, so
  // fall back to the screen axes rather than dividing by zero and poisoning
  // every downstream coordinate with NaN.
  const ux = w > AXIS_EPS ? ax / w : 1, uy = w > AXIS_EPS ? ay / w : 0;
  const vx = h > AXIS_EPS ? bx / h : 0, vy = h > AXIS_EPS ? by / h : 1;

  return {
    tl, tr, br, bl,
    cx: (tl.x + tr.x + br.x + bl.x) / 4,
    cy: (tl.y + tr.y + br.y + bl.y) / 4,
    w, h, ux, uy, vx, vy,
    axisAligned:
      Math.abs(uy) < AXIS_EPS && Math.abs(vx) < AXIS_EPS && ux > 0 && vy > 0,
  };
}

/**
 * A point `a` px along the quad's local x and `b` px along its local y, from
 * the top-left corner.
 *
 * This is the whole reason the basis is carried around: interior detail stays
 * authored in the flat, obvious frame and comes out correct at any rotation.
 */
export function quadLocal(q: ScreenQuad, a: number, b: number): Pt {
  return {
    x: q.tl.x + q.ux * a + q.vx * b,
    y: q.tl.y + q.uy * a + q.vy * b,
  };
}

/**
 * The same quad grown by `px` screen pixels on every side, as four corners.
 *
 * Used by the activation flare, which expands a ring OUT of the border. Growing
 * along the local basis rather than in screen x/y keeps the ring concentric
 * with the marking instead of shearing away from it as the board turns.
 */
export function expandQuad(q: ScreenQuad, px: number): [Pt, Pt, Pt, Pt] {
  const dux = q.ux * px, duy = q.uy * px;
  const dvx = q.vx * px, dvy = q.vy * px;
  return [
    { x: q.tl.x - dux - dvx, y: q.tl.y - duy - dvy },
    { x: q.tr.x + dux - dvx, y: q.tr.y + duy - dvy },
    { x: q.br.x + dux + dvx, y: q.br.y + duy + dvy },
    { x: q.bl.x - dux + dvx, y: q.bl.y - duy + dvy },
  ];
}

/** The quad's corners as a flat point list, for Graphics.poly. */
export function quadPoly(q: ScreenQuad): number[] {
  return [q.tl.x, q.tl.y, q.tr.x, q.tr.y, q.br.x, q.br.y, q.bl.x, q.bl.y];
}

/** A four-corner list as a flat point list, for Graphics.poly. */
export function cornersPoly(c: readonly [Pt, Pt, Pt, Pt]): number[] {
  return [c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y];
}
