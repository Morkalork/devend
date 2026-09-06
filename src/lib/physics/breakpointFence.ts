/**
 * The Breakpoint fence: the first ball to touch one stops dead.
 *
 * Execution halts when a breakpoint is hit, once, and then you carry on. The
 * fence is the same idea: build one across a lane, and the first ball to bounce
 * off it is held still for two seconds while you cut somewhere it cannot reach.
 *
 * ── Once per MAP, not once per fence ───────────────────────────────────────
 *
 * The one balance decision here, and it is the whole mechanic. A fence type is
 * unlimited once owned, so a per-fence hold would let a player line a board with
 * Breakpoints and chain-hold a single ball from one end of the map to the other
 * - a stronger effect than Cascade Freeze, which costs a maxed family and
 * twenty-two levels to reach. Per map, it is one deliberate stop: a panic
 * button you have to have BUILT before you needed it.
 *
 * The budget lives on the game state rather than on the walls, because it is a
 * property of the map and not of any one fence. That also makes it survive a
 * fence being broken, which is correct - spending your hold and then losing the
 * fence must not refund it.
 *
 * ── It reuses freezing rather than inventing holding ───────────────────────
 *
 * A held ball IS a frozen ball: same `frozenUntil`, same renderer, same rule
 * for what a frozen ball does. Tap-freeze, Cron Job and Cold Boot all drive
 * those two fields already, and a second kind of motionless ball would be a
 * second thing for the player to learn about one word.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 *
 * It does not save a GROWING fence. Ice and flare act on a bounce off a
 * finished wall and so does this; a Breakpoint that also absorbed the hit that
 * kills a half-drawn fence would be Second Wind - a capstone - for free, and on
 * a fence you can draw as many of as you like.
 */
import type { Ball } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import type { CanvasGameState } from "@/types/gameState";
import { getFenceType } from "@/lib/fences";
import { FREEZE_COOLDOWN_MULTIPLIER } from "@/lib/gameConstants";

/** How long this fence holds a ball, or 0 for a type that does not hold. */
export function holdMsOf(wall: Wall): number {
  // Board edges and obstacle boundaries carry no fence type and never will.
  if (!wall.fenceTypeId) return 0;
  const type = getFenceType(wall.fenceTypeId);
  return type.holdsPerMap > 0 ? type.holdMs : 0;
}

/** True when this fence could still hold something on this map. */
export function isArmedBreakpoint(game: CanvasGameState, wall: Wall): boolean {
  const ms = holdMsOf(wall);
  if (ms <= 0) return false;
  const type = getFenceType(wall.fenceTypeId);
  return (game.breakpointHoldsUsed ?? 0) < type.holdsPerMap;
}

/**
 * A ball just bounced off `wall`: hold it if this is the map's Breakpoint.
 *
 * Returns true when the hold was actually spent, so a caller can tell "this
 * fence stopped a ball" from "the map's hold was already gone" - which the
 * tests need and a sound cue would.
 *
 * A ball that is ALREADY frozen is left alone and the hold is not spent. It is
 * not moving, so a hold would buy nothing and would silently swallow the one
 * the player was saving - the same courtesy the fence-speed step gives a ball
 * already pinned at its floor.
 */
export function holdOnBreakpoint(
  game: CanvasGameState, ball: Ball, wall: Wall, now: number,
): boolean {
  if (!isArmedBreakpoint(game, wall)) return false;
  if (ball.frozenUntil && now < ball.frozenUntil) return false;

  const ms = holdMsOf(wall);
  ball.frozenUntil = now + ms;
  // The same cooldown a tap-freeze leaves behind, so a held ball cannot be
  // re-frozen the instant it thaws any more than a tapped one can. Written
  // through the same two fields for the same reason: one kind of still ball.
  ball.freezeReadyAt = now + ms * (1 + FREEZE_COOLDOWN_MULTIPLIER);
  game.breakpointHoldsUsed = (game.breakpointHoldsUsed ?? 0) + 1;
  // Where it happened, for the renderer's flash. Read and cleared by the
  // effects layer; nothing here waits on it.
  game.breakpointFlash = { x: ball.position.x, y: ball.position.y, startTime: now };
  return true;
}
