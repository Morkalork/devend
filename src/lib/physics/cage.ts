/**
 * The cage: somewhere to PUT a ball for a while.
 *
 * Every tool in the game is permanent. A lock removes a ball for good, a fence
 * divides the board for good, a smash destroys a thing for good. There has
 * never been a way to say "not this one, not yet" - to take the fastest ball
 * out of the way for twenty seconds while you seal the corner it kept ruining,
 * and then deal with it.
 *
 * A cage is a container with one open side, like the launcher and the delivery
 * box, and the only object whose state is driven by a ball rather than by a
 * clock or by the player: a ball wanders in, the mouth shuts behind it, and it
 * opens again after `holdSeconds`.
 *
 * ── Why the mouth is a phasing object ───────────────────────────────────────
 *
 * `phase`/`alpha` on a PhasingObjectState is already the single source of truth
 * for whether a thing is tangible AND for how it is drawn, and both collision
 * systems and both renderers read it. A mouth that decided for itself whether
 * it was solid would have to be taught to all of them again, and whichever one
 * was missed would be a wall balls pass through and fences stop at - the exact
 * bug shape the pass-rule and portal comments already warn about.
 *
 * So the cage owns the mouth's phase and tickPhasing leaves it alone, the same
 * arrangement the latch uses.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

export interface CageState {
  id: string;
  /** Interior, in world units: a ball inside this is caught. */
  inner: { x: number; y: number; width: number; height: number };
  /** The phasing object that is the mouth. Intangible when the cage is OPEN. */
  mouthId: string;
  /** Seconds a caught ball is held. */
  holdSeconds: number;
  /** When the mouth shut, in ms, or undefined while the cage is open. */
  closedAt?: number;
  /** The ball currently held, so releasing it can be reported. */
  heldBallId?: string;
}

/** Is this ball inside the cage's interior? */
export function ballInCage(ball: Ball, cage: CageState): boolean {
  const { x, y, width, height } = cage.inner;
  return ball.position.x >= x && ball.position.x <= x + width
    && ball.position.y >= y && ball.position.y <= y + height;
}

/**
 * Shut the mouth behind a ball, and open it again when its time is up.
 *
 * Deliberately does NOT stop the caught ball. It keeps bouncing around inside,
 * which is the whole read: a cage is a holding pen, not a freezer, and a ball
 * rattling in a box is visibly waiting rather than visibly dead. It also means
 * the ball leaves under its own power the moment the mouth opens, with no
 * special release to write.
 *
 * A cage only ever catches ONE ball. Two balls in a small box would be a
 * multi-lock the player did not earn, sitting in a pocket that cannot be
 * fenced.
 */
export function tickCages(game: CanvasGameState, nowMs: number): void {
  const cages = game.cages;
  if (!cages || cages.length === 0) return;
  const mouths = game.phasingObjects ?? [];

  for (const cage of cages) {
    const mouth = mouths.find(m => m.id === cage.mouthId);
    if (cage.closedAt === undefined) {
      // Open: watch for a ball wandering in. Dormant balls do not count - a
      // launcher's loaded roster must not spring a cage it is sitting next to.
      const caught = game.balls.find(b => b.state === "active" && ballInCage(b, cage));
      if (caught) {
        cage.closedAt = nowMs;
        cage.heldBallId = caught.id;
        if (mouth) { mouth.phase = "in"; mouth.alpha = 1; }
      } else if (mouth) {
        mouth.phase = "out";
        mouth.alpha = 0;
      }
      continue;
    }
    // Closed: hold, then open. Compared against the recorded time rather than
    // counted down, so a paused map or a dropped frame cannot shorten a
    // sentence or extend it.
    if (nowMs - cage.closedAt >= cage.holdSeconds * 1000) {
      cage.closedAt = undefined;
      cage.heldBallId = undefined;
      if (mouth) { mouth.phase = "out"; mouth.alpha = 0; }
    } else if (mouth) {
      mouth.phase = "in";
      mouth.alpha = 1;
    }
  }
}

/** 0..1 of the hold served, for a renderer that wants to show the wait. */
export function cageProgress(cage: CageState, nowMs: number): number {
  if (cage.closedAt === undefined) return 0;
  return Math.min(1, (nowMs - cage.closedAt) / Math.max(1, cage.holdSeconds * 1000));
}
