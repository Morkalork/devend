/**
 * The drawing behind TutorialArt (and the lock explainer's picture): the
 * game's own visual language - dark dot-grid board, bright accent fences,
 * glowing balls - as Pixi Graphics calls, in the same 150x120 coordinates the
 * SVG used, so every number below is the number the DOM drew with.
 */
import { FillGradient, type FillInput, type Graphics } from "pixi.js";

export const ART_ACCENT = 0x00ff88;
export const ART_W = 150;
export const ART_H = 120;

export interface BoardRect { x: number; y: number; w: number; h: number; r: number }

/** The TutorialArt board: 138x108 at (6,6), rounded 12. */
export const ART_BOARD: BoardRect = { x: 6, y: 6, w: 138, h: 108, r: 12 };

type Corner = "tl" | "tr" | "bl" | "br";

/**
 * A rect with ONE rounded corner. The SVG clipped its captured pockets to the
 * rounded board; a pocket that fills a board corner is exactly a rect whose
 * corner on the board's corner is rounded to the board's radius.
 */
export function cornerRect(g: Graphics, x: number, y: number, w: number, h: number, corner: Corner, r: number): Graphics {
  const x2 = x + w, y2 = y + h;
  g.moveTo(corner === "tl" ? x + r : x, y);
  if (corner === "tr") { g.lineTo(x2 - r, y); g.arcTo(x2, y, x2, y + r, r); } else g.lineTo(x2, y);
  if (corner === "br") { g.lineTo(x2, y2 - r); g.arcTo(x2, y2, x2 - r, y2, r); } else g.lineTo(x2, y2);
  if (corner === "bl") { g.lineTo(x + r, y2); g.arcTo(x, y2, x, y2 - r, r); } else g.lineTo(x, y2);
  if (corner === "tl") { g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); } else g.lineTo(x, y);
  return g.closePath();
}

/** Is (px,py) inside the rounded board (for clipping the dot grid to it)? */
export function insideRounded(b: BoardRect, px: number, py: number): boolean {
  if (px < b.x || py < b.y || px > b.x + b.w || py > b.y + b.h) return false;
  const cx = Math.max(b.x + b.r, Math.min(b.x + b.w - b.r, px));
  const cy = Math.max(b.y + b.r, Math.min(b.y + b.h - b.r, py));
  return Math.hypot(px - cx, py - cy) <= b.r;
}

/** The board's dark fill and faint dot grid (9px pattern, dot at 1,1). */
export function drawBoardBase(g: Graphics, b: BoardRect = ART_BOARD, gridAlpha = 0.1): void {
  g.roundRect(b.x, b.y, b.w, b.h, b.r).fill(0x0f2117);
  // The SVG pattern tiles from the user-space origin, so dots sit at 1 + 9k.
  for (let x = 1; x <= b.x + b.w; x += 9) {
    for (let y = 1; y <= b.y + b.h; y += 9) {
      if (insideRounded(b, x, y)) g.circle(x, y, 0.8);
    }
  }
  g.fill({ color: 0x2bff9e, alpha: gridAlpha });
}

/** The board's outline, drawn over its contents. */
export function drawBoardOutline(g: Graphics, b: BoardRect = ART_BOARD): void {
  g.roundRect(b.x, b.y, b.w, b.h, b.r).stroke({ width: 2, color: 0x24422f });
}

/** A glowing ball: a soft halo, the ball, a highlight. */
export function drawBall(g: Graphics, x: number, y: number, r = 14, color = 0xff5a52): void {
  g.circle(x, y, r + 6).fill({ color, alpha: 0.16 });
  g.circle(x, y, r).fill(color);
  g.circle(x - r * 0.33, y - r * 0.33, r * 0.28).fill({ color: 0xffffff, alpha: 0.45 });
}

interface StrokeLook { width: number; color: number; alpha?: number; cap?: "round" | "butt"; join?: "round" | "miter" }

/** An open polyline through [x0,y0, x1,y1, ...]. */
export function polyline(g: Graphics, pts: number[], look: StrokeLook): void {
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke({ cap: "round", join: "round", ...look });
}

/** A dashed straight line (SVG strokeDasharray "dash gap"). */
export function dashedLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number, look: StrokeLook): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len === 0) return;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
  }
  g.stroke({ cap: "butt", ...look });
}

/** A fence: a wide faint glow under a bright line, the board's own look. */
function fence(g: Graphics, pts: number[], cap: "round" | "butt" = "round"): void {
  polyline(g, pts, { width: 7, color: ART_ACCENT, alpha: 0.28, cap });
  polyline(g, pts, { width: 3, color: ART_ACCENT, cap });
}

// ── The pictures ───────────────────────────────────────────────────────────
// Each draws a whole 150x120 square. Fences that end ON the board edge use a
// butt cap: the SVG's round cap ran past the edge and was clipped by the board.

/** FENCE: drag to grow a slicing wall that partitions the board. */
export function drawFenceArt(g: Graphics): void {
  g.clear();
  drawBoardBase(g);
  fence(g, [76, 10, 76, 110]);
  // drag gesture: a finger dot + dashed swipe + arrowhead
  g.circle(76, 24, 4).fill({ color: 0xffffff, alpha: 0.85 });
  dashedLine(g, 76, 24, 76, 94, 3, 5, { width: 2, color: 0xffffff, alpha: 0.7 });
  polyline(g, [70, 88, 76, 96, 82, 88], { width: 2.4, color: 0xffffff, alpha: 0.85 });
  // a ball to keep clear of
  drawBall(g, 110, 60, 13, 0x4aa3ff);
  drawBoardOutline(g);
}

/** LOCK: a ball fenced tight into a captured corner pocket. */
export function drawLockArt(g: Graphics): void {
  g.clear();
  drawBoardBase(g);
  cornerRect(g, 6, 63, 52, 51, "bl", ART_BOARD.r).fill({ color: ART_ACCENT, alpha: 0.2 });
  fence(g, [6, 63, 58, 63, 58, 114], "butt");
  drawBall(g, 32, 89, 16);
  drawBoardOutline(g);
}

/** MOVER: an orange obstacle on a track; a ball bounces off it. */
export function drawMoverArt(g: Graphics): void {
  const O = 0xff8800;
  g.clear();
  drawBoardBase(g);
  // track
  dashedLine(g, 20, 60, 130, 60, 4, 5, { width: 2, color: O, alpha: 0.55 });
  // movement arrows
  polyline(g, [34, 55, 26, 60, 34, 65], { width: 2.5, color: O, alpha: 0.8 });
  polyline(g, [116, 55, 124, 60, 116, 65], { width: 2.5, color: O, alpha: 0.8 });
  // obstacle
  g.roundRect(60, 49, 30, 22, 4).fill({ color: O, alpha: 0.22 });
  g.roundRect(62, 51, 26, 18, 3).fill(O);
  // ball bouncing off the top
  drawBall(g, 104, 34, 12, 0x4aa3ff);
  drawBoardOutline(g);
}

/** BREAK: an amber block, cracked, with a ball smashing into it. */
export function drawBreakArt(g: Graphics): void {
  const A = 0xffb454;
  const CRACK = 0x7a4b12;
  g.clear();
  drawBoardBase(g);
  g.roundRect(60, 38, 44, 40, 4).fill({ color: A, alpha: 0.2 });
  g.roundRect(62, 40, 40, 36, 3).fill(A);
  // cracks
  polyline(g, [82, 40, 76, 52, 84, 58, 79, 70], { width: 2.2, color: CRACK });
  polyline(g, [78, 58, 68, 55], { width: 2, color: CRACK });
  polyline(g, [84, 52, 93, 50], { width: 2, color: CRACK });
  // ball hitting from the left + impact spark
  drawBall(g, 38, 60, 13, 0x20242b);
  polyline(g, [52, 60, 59, 60], { width: 2.2, color: A });
  polyline(g, [54, 52, 59, 55], { width: 2.2, color: A });
  polyline(g, [54, 68, 59, 65], { width: 2.2, color: A });
  drawBoardOutline(g);
}

/** PICKUP: a ball trapped in a pocket that covers a glowing power-up token. */
export function drawPickupArt(g: Graphics): void {
  const M = 0xe879f9;
  g.clear();
  drawBoardBase(g);
  cornerRect(g, 86, 6, 58, 52, "tr", ART_BOARD.r).fill({ color: ART_ACCENT, alpha: 0.18 });
  // The SVG's two strokes from (86,58) drawn as one corner, ends on the edge.
  fence(g, [86, 6, 86, 58, 144, 58], "butt");
  // token
  g.circle(122, 24, 13).fill({ color: M, alpha: 0.2 });
  g.poly([122, 15, 131, 24, 122, 33, 113, 24]).fill(M);
  g.poly([122, 19.5, 126.5, 24, 122, 28.5, 117.5, 24]).fill({ color: 0xffffff, alpha: 0.7 });
  // ball sealed in over it
  drawBall(g, 106, 40, 13, 0x4aa3ff);
  drawBoardOutline(g);
}

/** CIRCUIT: a teal node wired to a dim sleeping ball. */
export function drawCircuitArt(g: Graphics): void {
  const T = 0x7fe3d4;
  g.clear();
  drawBoardBase(g);
  // link line node -> sleeper
  dashedLine(g, 52, 44, 98, 74, 5, 5, { width: 1.6, color: T, alpha: 0.5 });
  // terminal node
  g.circle(52, 44, 15).stroke({ width: 2, color: T, alpha: 0.5 });
  g.circle(52, 44, 10).stroke({ width: 3, color: T });
  g.circle(52, 44, 3.4).fill(T);
  // sleeping (dormant) ball: dim + caged
  g.circle(98, 74, 15).fill({ color: 0xff5a52, alpha: 0.28 });
  g.circle(98, 74, 13).stroke({ width: 2, color: T, alpha: 0.7 });
  g.circle(98, 74, 17).stroke({ width: 1.4, color: T, alpha: 0.4 });
  drawBoardOutline(g);
}

// ── The lock explainer's picture (152x134) ─────────────────────────────────

export const LOCKED_BALL_W = 152;
export const LOCKED_BALL_H = 134;
const LOCK_BOARD: BoardRect = { x: 7, y: 7, w: 138, h: 120, r: 12 };

let ballGradient: FillGradient | null = null;

/**
 * The locked ball's shading (the SVG's radial gradient, light upper-left to a
 * dark rim). Made once and shared: a gradient owns a texture, and the picture
 * redraws whenever its component does.
 */
export function lockedBallGradient(): FillGradient {
  ballGradient ??= new FillGradient({
    type: "radial",
    center: { x: 0.42, y: 0.38 }, innerRadius: 0,
    outerCenter: { x: 0.42, y: 0.38 }, outerRadius: 0.64,
    colorStops: [{ offset: 0, color: 0xffd7cf }, { offset: 0.45, color: 0xff5a52 }, { offset: 1, color: 0x8f1a16 }],
    textureSpace: "local",
  });
  return ballGradient;
}

/**
 * The actual in-game lock: a ball sealed into a small captured pocket in the
 * corner of the board by two fences (the other two sides are board walls).
 * `ballFill` defaults to the shaded gradient.
 */
export function drawLockedBallArt(g: Graphics, ballFill: FillInput = lockedBallGradient()): void {
  g.clear();
  drawBoardBase(g, LOCK_BOARD, 0.12);
  cornerRect(g, 7, 71, 55, 56, "bl", LOCK_BOARD.r).fill({ color: ART_ACCENT, alpha: 0.2 });
  drawBoardOutline(g, LOCK_BOARD);
  // The two fences that seal the corner pocket (glow under, bright over). The
  // SVG drew these outside the board's clip, so their round caps show.
  fence(g, [7, 71, 62, 71, 62, 127]);
  // The locked ball, snug in the pocket: a halo, the shaded ball, a highlight.
  g.circle(34, 99, 24).fill({ color: 0xff5a52, alpha: 0.18 });
  g.circle(34, 99, 18).fill(ballFill);
  g.circle(28, 93, 5).fill({ color: 0xffffff, alpha: 0.45 });
}
