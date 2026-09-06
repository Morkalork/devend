/**
 * Lock bands: the fences that only seal a pocket holding the right crowd.
 *
 * Mutex wants exactly one ball. Semaphore wants two or more. One rule in two
 * settings, the way ice and flare are one `ballSpeedStep` with the sign
 * flipped - and unlike every other fence type, this one does not modify what
 * happens, it REFUSES the game's central action under a condition.
 *
 * ── Refused, not failed ────────────────────────────────────────────────────
 *
 * A pocket outside the band simply does not lock. The ball keeps bouncing, the
 * ground stays uncaptured, and the player can cut again inside it. That is the
 * same shape as the refusal a pocket around a still-needed slab already gets,
 * and for the same reason: there IS a ball in here, so there is something to
 * refuse FOR.
 *
 * It is also the mechanic's whole price. A Semaphore cut that catches one ball
 * has spent a fence and captured nothing, and on a space-clear map that is real
 * progress lost. The fence is not "pays more" - it is "you had better be right".
 *
 * ── Which fence decides ────────────────────────────────────────────────────
 *
 * The cut that SEALS the pocket, not the walls that happen to bound it. A
 * pocket is usually bounded by board edges, obstacles and old fences, and
 * asking "what types are on this boundary" would make the rule depend on
 * geometry the player was not thinking about. "I closed this with a Semaphore"
 * is what they did, and it is what this reads.
 */
import type { CanvasGameState } from "@/types/gameState";
import { getFenceType, type FenceTypeId } from "@/lib/fences";

/** The band a sealing cut of this type imposes, or null for no band. */
export function lockBandOf(fenceTypeId: FenceTypeId | undefined | null): [number, number] | null {
  if (!fenceTypeId) return null;
  return getFenceType(fenceTypeId).lockBand;
}

/**
 * May a cut of this type lock a pocket holding this many balls?
 *
 * True whenever there is no band, which is every fence in the game but two -
 * so a caller that has no idea what sealed the pocket behaves exactly as it
 * did before bands existed.
 */
export function bandAllowsLock(
  fenceTypeId: FenceTypeId | undefined | null, ballsInPocket: number,
): boolean {
  const band = lockBandOf(fenceTypeId);
  if (!band) return true;
  return ballsInPocket >= band[0] && ballsInPocket <= band[1];
}

/**
 * How many lock-eligible balls share this grid region.
 *
 * Counted over the same `regionOf` lookup the caller used for the ball being
 * judged, so the count and the pocket cannot disagree. A ball that is already
 * `won` is not in the pocket any more; a dormant or frozen one still is, since
 * it will be sealed in there with the rest.
 */
export function ballsSharingPocket(
  game: CanvasGameState,
  regionId: string | number,
  regionOf: (x: number, y: number) => { id: string | number } | null,
): number {
  let n = 0;
  for (const ball of game.balls) {
    if (ball.state === "won") continue;
    if (regionOf(ball.position.x, ball.position.y)?.id === regionId) n++;
  }
  return n;
}
