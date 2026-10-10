/**
 * A ball's ability mark in UI pixels (canvas BallMark).
 *
 * Read straight out of BALL_MARKS, the table the board draws from, rather than
 * redrawn by hand: two hand-kept copies of a symbol set drift silently and then
 * teach the player the wrong glyph. The marks are in unit-ball coordinates, so
 * a swatch `size` px across maps them with a centre and a radius.
 */
import { markFor, markColor, markWidth } from "@/lib/rendering/sleek/ballMark";

export type MarkShape =
  | { kind: "dot"; cx: number; cy: number; r: number }
  /** Flat [x0, y0, x1, y1, ...]; a closed shape repeats its first point at the end. */
  | { kind: "line"; points: number[] };

export interface BallMarkDrawing {
  /** Black or white, whichever the ball's colour carries (markColor, as the board). */
  ink: number;
  /** Stroke width in px: the board's weight at this radius. */
  width: number;
  shapes: MarkShape[];
}

/** The mark to draw, or null for a ball that just rolls (no ability, or one with no mark). */
export function ballMarkDrawing(ability: string | undefined | null, color: string, size: number): BallMarkDrawing | null {
  const strokes = markFor(ability);
  if (!strokes) return null;
  const r = size / 2;
  const at = (p: [number, number]) => [r + p[0] * r, r + p[1] * r];
  const shapes: MarkShape[] = strokes.map(s => s.kind === "dot"
    ? { kind: "dot", cx: r + s.at[0] * r, cy: r + s.at[1] * r, r: s.r * r }
    // Closed by repeating the first point: an unclosed polygon reads as a bent
    // line, not a shape.
    : { kind: "line", points: (s.close ? [...s.pts, s.pts[0]] : s.pts).flatMap(at) });
  return { ink: markColor(color), width: markWidth(r), shapes };
}
