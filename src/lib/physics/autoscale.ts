/**
 * The Autoscaler: a ball whose size follows its room (LATE_GAME_PLAN.md, act V).
 *
 * On the open board it is huge, and every cut that shrinks the region it is in
 * shrinks it too, down to an ordinary ball. So the first cuts are the dangerous
 * ones (a huge ball reaches a growing fence from far away), and the map gets
 * easier exactly as fast as the player makes the ball's room smaller.
 *
 * Two halves, because the two things happen at different rates:
 * - retargetAutoscalers, after a cut: reads the share of the board's starting
 *   space the ball's region holds, and sets the radius to ease toward;
 * - easeAutoscalers, every frame: moves the radius toward it, so the ball
 *   visibly deflates over about half a second instead of snapping.
 *
 * The share is read off the regions the cut just produced (their sample
 * points sit one per grid cell), so it costs a count, not a flood fill.
 */
import type { Ball, Region } from "@/types/game";

/** Open-board radius as a multiple of an ordinary ball's, when the type does not say. */
export const DEFAULT_AUTOSCALE_MAX = 2.2;
/** A boss's open-board radius as a multiple of its HP size, when the map does not say. */
export const BOSS_AUTOSCALE_MAX = 1.6;
/** Fraction of the remaining gap closed per second (exponential ease). */
export const AUTOSCALE_EASE_PER_SECOND = 6;

/** Is this ball an Autoscaler that is still in play? */
export function isAutoscaler(ball: Ball): boolean {
  return ball.ability === "autoscale" && ball.state === "active";
}

/**
 * The radius for a room holding `share` of the board's starting space (0-1).
 *
 * Linear in the share: half the board is halfway between ordinary and huge.
 * Pure, for the tests.
 */
export function autoscaleRadius(base: number, max: number, share: number): number {
  const s = Math.max(0, Math.min(1, share));
  const m = max > 1 ? max : 1;
  return base * (1 + (m - 1) * s);
}

/** Arm a freshly made Autoscaler at its open-board size. */
export function armAutoscaler(ball: Ball, max: number | undefined): void {
  ball.autoscaleBase = ball.radius;
  ball.autoscaleMax = max ?? DEFAULT_AUTOSCALE_MAX;
  ball.radius = autoscaleRadius(ball.autoscaleBase, ball.autoscaleMax, 1);
  ball.autoscaleTarget = ball.radius;
  ball.autoscaleShare = 1;
}

/** After a cut: point every Autoscaler at the size its room now calls for. */
export function retargetAutoscalers(
  balls: ReadonlyArray<Ball>,
  regions: ReadonlyArray<Region>,
  initialActiveCells: number,
): void {
  if (initialActiveCells <= 0) {
    return;
  }
  for (const ball of balls) {
    if (!isAutoscaler(ball) || ball.autoscaleBase === undefined) {
      continue;
    }
    const region = regions.find(r => r.id === ball.regionId);
    if (!region || !region.samplePoints) {
      continue;
    }
    const share = region.samplePoints.length / initialActiveCells;
    ball.autoscaleShare = share;
    ball.autoscaleTarget = autoscaleRadius(ball.autoscaleBase, ball.autoscaleMax ?? DEFAULT_AUTOSCALE_MAX, share);
  }
}

/** Every frame: ease each Autoscaler's radius toward its target. */
export function easeAutoscalers(balls: ReadonlyArray<Ball>, dt: number): void {
  const k = 1 - Math.exp(-AUTOSCALE_EASE_PER_SECOND * dt);
  for (const ball of balls) {
    // Mid-division (a boss budding a minion), updateBall owns the radius.
    if (!isAutoscaler(ball) || ball.autoscaleTarget === undefined || ball.splitBaseRadius !== undefined) {
      continue;
    }
    const gap = ball.autoscaleTarget - ball.radius;
    if (Math.abs(gap) < 0.05) {
      ball.radius = ball.autoscaleTarget;
      continue;
    }
    ball.radius += gap * k;
  }
}
