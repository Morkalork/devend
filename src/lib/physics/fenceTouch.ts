/**
 * What a ball's speed does when it bounces off a fence (FENCE_TYPES_PLAN.md).
 *
 * Ice takes speed off, flare puts it on. Both are a STEP PER BOUNCE rather than
 * a timed effect, and the difference matters more than it sounds: a timed effect
 * stops mattering the moment the ball leaves, so where you built the fence stops
 * mattering with it. A step per bounce pays for the fence being in the lane the
 * ball keeps returning to, which is a thing the player chose.
 *
 * Deliberately the same shape as the yellow ball's variable-speed ability
 * (updateBall, `ability === 'variableSpeed'`): a debounce, a floor at the ball's
 * own minimumSpeed, and the velocity rescaled to the new speed rather than
 * re-aimed. Copying that shape is the point - two speed rules that behaved
 * differently would be two things for the player to learn about one word.
 *
 * ── The failure this is written around ─────────────────────────────────────
 *
 * A ball wedged in an ice corner touches the fence on every single frame. Slow
 * it every frame and it ratchets to a standstill and the map becomes
 * unfinishable - the worst outcome in the feature, and one that would look like
 * a physics bug rather than a rule. So the debounce and the floor are not
 * polish, they are the mechanic: STEP_DEBOUNCE_MS bounds how often, and
 * `minimumSpeed` bounds how far.
 */
import type { Ball } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import { getFenceType } from "@/lib/fences";

/**
 * Minimum gap between two speed steps on one ball.
 *
 * 90ms, matching the yellow ball's debounce exactly. Long enough that a ball
 * resting against a fence steps at most eleven times a second rather than sixty,
 * short enough that a genuine rally off an ice wall still reads as cumulative.
 */
export const STEP_DEBOUNCE_MS = 90;

/**
 * The fastest a fence may ever make a ball.
 *
 * Flare has no natural ceiling the way ice has a floor: `minimumSpeed` already
 * stops ice, and nothing stopped flare. A ball accelerated without limit stops
 * being dodgeable and starts being a coin flip, and it also outruns the
 * collision step - a fast enough ball tunnels through a fence rather than
 * bouncing off it, which would turn the reward for using flare into a fence
 * that silently does nothing.
 *
 * Expressed as a multiple of the ball's OWN base speed rather than an absolute,
 * so it scales with the ball-speed ramp instead of becoming a hard wall in the
 * late game.
 */
export const MAX_SPEED_FACTOR = 2.2;

/** A fence the player drew, carrying a type that changes ball speed. */
function speedStepOf(wall: Wall): number {
  // Board edges and obstacle boundaries have no fence type and never will;
  // getFenceType would answer `standard` for them, whose step is 0 anyway, but
  // checking the id keeps the intent readable at the call site.
  if (!wall.fenceTypeId) return 0;
  return getFenceType(wall.fenceTypeId).ballSpeedStep;
}

/**
 * Apply one fence's speed step to a ball, or do nothing.
 *
 * Returns true when a step was actually taken, so a caller can tell "the fence
 * had no effect" from "the fence was on cooldown" - which the tests need and a
 * future sound cue would.
 */
export function applyFenceSpeedStep(ball: Ball, wall: Wall, now: number): boolean {
  const step = speedStepOf(wall);
  if (step === 0) return false;
  if (now - (ball.lastFenceStepAt ?? 0) < STEP_DEBOUNCE_MS) return false;

  const current = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (current < 1e-6) return false;

  // The floor is the ball's own, not a constant: a grey ball that has wound
  // itself down is already at its minimum and ice must not take it below.
  const floor = ball.minimumSpeed;
  const ceiling = Math.max(floor, (ball.baseSpeed || current) * MAX_SPEED_FACTOR);
  const target = Math.max(floor, Math.min(ceiling, current + step));
  // Already pinned at the end this fence pushes toward: not a step, so the
  // debounce is left alone and a later bounce off the OTHER kind still works.
  if (Math.abs(target - current) < 1e-6) return false;

  ball.lastFenceStepAt = now;
  const r = target / current;
  ball.velocity.x *= r;
  ball.velocity.y *= r;
  ball.speed = target;
  return true;
}
