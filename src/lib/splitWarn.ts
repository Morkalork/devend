/**
 * splitWarn — "you already have this side", said on the board.
 *
 * A `splitLocks` win wants a lock on EACH side of a line. A second lock on a
 * side that is already paid for is worth nothing to it, and on a two-ball map
 * it is worse than nothing: the ball that went into the wrong pocket was the
 * one the other side needed, and the map can no longer be won. The goal chip
 * says "1 of 2 sides", but it says it in the top bar, and the mistake is made
 * on the board, with the eyes on a ball.
 *
 * So the side that is done tints a gentle red while a live ball is on it:
 * the moment a ball wanders into the half where sealing it would be wasted,
 * that half says so, and it stops the moment the ball leaves. Nothing tints
 * once both sides are done, because from then on a lock anywhere is fine.
 *
 * Gentle on purpose. The board has already been reported twice for blinking,
 * so this is a slow breath (one swell every ~2 seconds) at a low alpha, faded
 * in and out rather than switched, and only on the live ground of that half:
 * captured ground is settled and has nothing to warn about.
 *
 * Pure, and split from the drawing, so the rule is pinned by ordinary tests.
 */
import type { WinCondition, WinSpec } from "@/types/winSpec";
import type { MapRotation } from "@/lib/mapRotation";
import { dealtSplit, splitLockCounts } from "@/lib/winSpec";

type SplitClause = Extract<WinCondition, { kind: "splitLocks" }>;

export interface SplitWarnSides {
  /** The half below the line on its axis (left, or top). */
  before: boolean;
  /** The half at or past the line (right, or bottom). */
  after: boolean;
}

/** The map's split clause, if it has one: a required one first, else a bonus one. */
export function splitClauseOf(spec: WinSpec): SplitClause | null {
  const find = (list: WinCondition[]) =>
    list.find((c): c is SplitClause => c.kind === "splitLocks") ?? null;
  return find(spec.require) ?? find(spec.alsoWinIf);
}

/**
 * Which halves should warn right now.
 *
 * A half warns when it already has the locks the clause asks of it, the
 * clause as a whole is still unmet, and a ball that could still be sealed is
 * standing in it. Sides are split exactly as the win check splits them (the
 * same `splitLockCounts`, the same point-on-the-line rule), so the tint can
 * never call a side done that the goal chip does not.
 */
export function splitWarnSides(
  clause: SplitClause,
  rotation: MapRotation,
  lockPoints: { x: number; y: number }[],
  balls: { state: string; position: { x: number; y: number } }[],
): SplitWarnSides {
  const [lockedBefore, lockedAfter] = splitLockCounts(clause, lockPoints, rotation);
  const doneBefore = lockedBefore >= clause.count;
  const doneAfter = lockedAfter >= clause.count;
  if (doneBefore && doneAfter) return { before: false, after: false };
  if (!doneBefore && !doneAfter) return { before: false, after: false };

  const { axis, at } = dealtSplit(clause, rotation);
  const along = (p: { x: number; y: number }) => (axis === "horizontal" ? p.y : p.x);
  let ballBefore = false, ballAfter = false;
  for (const b of balls) {
    if (b.state !== "active") continue;
    if (along(b.position) < at) ballBefore = true;
    else ballAfter = true;
  }
  return { before: doneBefore && ballBefore, after: doneAfter && ballAfter };
}

/** How long a side takes to fade fully in or out, in ms. */
export const SPLIT_WARN_FADE_MS = 350;
/** One full breath of the tint, in ms. Slow: ~0.55 Hz. */
export const SPLIT_WARN_PERIOD_MS = 1800;
/** The tint's alpha at the bottom and top of a breath, fully faded in. */
export const SPLIT_WARN_ALPHA_MIN = 0.07;
export const SPLIT_WARN_ALPHA_MAX = 0.2;
export const SPLIT_WARN_COLOR = 0xff3b3b;

/** Move a side's fade level toward where it should be. */
export function stepSplitWarnFade(level: number, on: boolean, dtMs: number): number {
  const step = Math.max(0, dtMs) / SPLIT_WARN_FADE_MS;
  return on ? Math.min(1, level + step) : Math.max(0, level - step);
}

/** The tint's alpha for a side at this fade level and moment. */
export function splitWarnAlpha(fade: number, now: number): number {
  if (!(fade > 0)) return 0;
  const breathe = 0.5 - 0.5 * Math.cos((2 * Math.PI * now) / SPLIT_WARN_PERIOD_MS);
  return fade * (SPLIT_WARN_ALPHA_MIN + (SPLIT_WARN_ALPHA_MAX - SPLIT_WARN_ALPHA_MIN) * breathe);
}

/**
 * The half as a world-space quad, clipped to the board's own extent. The
 * caller maps the corners through its world-to-screen transform, which is
 * what keeps the tint on the right half of a tilted board.
 */
export function splitHalfQuad(
  side: "before" | "after",
  axis: "vertical" | "horizontal",
  at: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): { x: number; y: number }[] {
  const { minX, minY, maxX, maxY } = bounds;
  if (axis === "vertical") {
    const [x0, x1] = side === "before" ? [minX, at] : [at, maxX];
    return [{ x: x0, y: minY }, { x: x1, y: minY }, { x: x1, y: maxY }, { x: x0, y: maxY }];
  }
  const [y0, y1] = side === "before" ? [minY, at] : [at, maxY];
  return [{ x: minX, y: y0 }, { x: maxX, y: y0 }, { x: maxX, y: y1 }, { x: minX, y: y1 }];
}
