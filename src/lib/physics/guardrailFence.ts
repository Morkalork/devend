/**
 * The Guardrail fence: a fence that brings its own shield.
 *
 * The Defensive Programming shield, carried by a fence type instead of by the
 * run. The first ball to cut through a GROWING Guardrail on a map costs the
 * fence, not a life, exactly as a spent Defensive Programming shield would.
 *
 * It replaced Breakpoint, which held the first ball to bounce off a FINISHED
 * fence for two seconds. A finished fence is already safe, so that hold paid
 * out at the one moment nothing was at risk. This pays out while the fence is
 * growing, which is the only time a fence can go wrong.
 *
 * ── Once per MAP, not once per fence ───────────────────────────────────────
 *
 * A fence type is unlimited once owned, so a per-fence shield would be a free
 * life on every cut: more than the four-purchase Defensive Programming line
 * sells. Per map, it is one forgiven mistake, and only on a cut the player
 * chose to draw slower to get it.
 *
 * The budget lives on the game state rather than on the walls because it is a
 * property of the map, and the fence that spends it is destroyed by the hit.
 *
 * ── Spent before the run's shields ─────────────────────────────────────────
 *
 * fenceStrike.ts tries this first, then the Defensive Programming shields. The
 * fence's own shield is the one that goes when the fence does; spending a run
 * shield on a Guardrail hit would leave the Guardrail's shield sitting unused
 * while the one the player bought for every other fence is gone.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";
import { getFenceType } from "@/lib/fences";

/** How many shields a map gets for this fence type, or 0 for a type with none. */
export function guardrailShieldsOf(fenceTypeId: string | undefined): number {
  // Absent is the standard fence, which carries no shield.
  if (!fenceTypeId) return 0;
  return getFenceType(fenceTypeId).shieldsPerMap;
}

/** True when a fence of this type would still be forgiven on this map. */
export function isArmedGuardrail(game: CanvasGameState, fenceTypeId: string | undefined): boolean {
  const n = guardrailShieldsOf(fenceTypeId);
  return n > 0 && (game.guardrailShieldsUsed ?? 0) < n;
}

/**
 * A ball just cut through a growing fence of this type: spend the map's
 * Guardrail shield if it is still there.
 *
 * Returns true when the shield was spent, and the caller then forgives the
 * hit. Only the budget and the flash are written here; what forgiving MEANS
 * (the fence goes, the recovery window, the shake) is fenceStrike's, so a
 * Guardrail save and a Defensive Programming save cannot drift apart.
 */
export function spendGuardrailShield(
  game: CanvasGameState, ball: Ball, fenceTypeId: string | undefined, now: number,
): boolean {
  if (!isArmedGuardrail(game, fenceTypeId)) return false;
  game.guardrailShieldsUsed = (game.guardrailShieldsUsed ?? 0) + 1;
  // Where it happened, for the renderer's ring. Read by the effects layer,
  // which lets it fade out on its own; nothing here waits on it.
  game.guardrailFlash = { x: ball.position.x, y: ball.position.y, startTime: now };
  return true;
}
