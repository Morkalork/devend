/**
 * What hitting a fence costs, in ONE place.
 *
 * There were three answers to that and the player could not tell which one was
 * coming. A ball caught DURING growth (updateFenceWall) froze the ball, let a
 * shield absorb it, failed the push if one was live, and otherwise docked a
 * single life and handed back a recovery window. The same ball caught at cut
 * COMPLETION (applyCut, via isBallOnCutLine) skipped all of that and ended the
 * whole run. A mover took a third path, hand-copied from the first.
 *
 * Nothing on screen distinguishes the first two. Whether a fence finishes a
 * frame before the ball arrives or a frame after is not a decision the player
 * makes, so pricing one at a life and the other at twenty minutes of progress
 * was a coin flip wearing the costume of a rule. The old comment in applyCut
 * said as much and left it alone.
 *
 * So the consequence lives here. Callers still build their own MapFailure - the
 * paths genuinely know different things about what the player was doing - but
 * what it COSTS is no longer theirs to decide.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { GameCallbacks } from "./gameCallbacks";
import type { MapFailure } from "@/lib/mapFailure";
import type { GameMessageId } from "@/lib/gameMessages";
import { handleGameOverFn, handlePushFailedFn } from "./handleGameOver";
import { RECOVERY_WINDOW_MS } from "@/lib/gameConstants";
import { playFenceBreakSound } from "@/lib/gameAudio";
import { vibrateFenceBreak } from "@/lib/gameHaptics";

/**
 * How long a post-break freeze may last before the loop lifts it regardless.
 *
 * The shake timer that normally lifts it runs at SHAKE_MS. This is comfortably
 * past that, so the ordinary path always wins and this only ever fires when
 * that timer was cancelled by something with no idea a ball was frozen.
 */
export const FREEZE_MAX_MS = 1500;

/**
 * How long the board shakes after a break, and therefore when the freeze is
 * normally lifted - the shake ending IS the release.
 *
 * Named rather than written at the call site because FREEZE_MAX_MS above is
 * only correct RELATIVE to it: a shake that outlasted the deadline would have
 * the safety net firing on every ordinary break, restoring the ball a beat
 * early and making the shake look broken. Two loose numbers cannot state that
 * relationship, and a test cannot check it.
 */
export const SHAKE_MS = 400;

/**
 * Drop the post-break freeze, whatever state it is in.
 *
 * One function rather than the four copies of the same four assignments that
 * used to be scattered through the fence code. The copies are exactly how the
 * deadline came to be missing from one of them in the first place, and how the
 * whole freeze came to be missing from the per-map reset: a clear that has to
 * be remembered in N places is a clear that will be forgotten in one.
 */
export function clearFreeze(game: CanvasGameState): void {
  game.frozenBallId = null;
  game.frozenBallPosition = null;
  game.frozenBallVelocity = null;
  game.frozenBallReleaseAt = null;
}

/**
 * What the bar says for each way a fence can be broken.
 *
 * A Record over the two kinds rather than a ternary or a default: one kind for
 * both would be a lie about which thing on the board killed you, and the lesson
 * differs - a ball is dodgeable, a patrol is a timing window. Written as an
 * exhaustive map so a third way of breaking a fence is a COMPILE error here
 * rather than a break that silently blames a ball.
 */
const BROKEN_BY: Record<"ballHitFence" | "moverHitFence", GameMessageId> = {
  ballHitFence: "lifeLostBall",
  moverHitFence: "lifeLostMover",
};

/** Red flash plus the shake, and whatever has to happen when the shake ends. */
function flashAndShake(
  callbacks: GameCallbacks, flashMs: number, onShakeEnd: () => void,
): void {
  if (callbacks.flashTimeoutRef.current) clearTimeout(callbacks.flashTimeoutRef.current);
  if (callbacks.shakeTimeoutRef.current) clearTimeout(callbacks.shakeTimeoutRef.current);
  callbacks.setScreenFlash("red");
  callbacks.setIsShaking(true);
  callbacks.flashTimeoutRef.current = setTimeout(() => {
    callbacks.setScreenFlash("none");
    callbacks.flashTimeoutRef.current = null;
  }, flashMs);
  callbacks.shakeTimeoutRef.current = setTimeout(() => {
    callbacks.setIsShaking(false);
    onShakeEnd();
  }, SHAKE_MS);
}

/** The window where a fresh fence cannot be punished for the same mistake. */
function recover(game: CanvasGameState, callbacks: GameCallbacks): void {
  game.isRecovering = true;
  game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
  callbacks.setIsRecovering(true);
  setTimeout(() => {
    game.isRecovering = false;
    callbacks.setIsRecovering(false);
  }, RECOVERY_WINDOW_MS);
}

/**
 * Dock the life, or end the run on the last one. The shared tail: this is the
 * half that must never differ between the ways a fence can be broken.
 */
function dockOrEnd(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  callbacks: GameCallbacks,
  failure: MapFailure,
  onShakeEnd: () => void,
): void {
  playFenceBreakSound();
  vibrateFenceBreak();
  const newLives = callbacks.getLives() - 1;
  callbacks.setLivesRef(newLives);
  callbacks.setDisplayLives(newLives);
  callbacks.onLivesChange(newLives);
  game.activeWalls = [];

  if (newLives <= 0) {
    clearFreeze(game);
    handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks, failure);
    return;
  }

  // A life remains and the map goes on, so this says what happened in the one
  // slot under the board rather than stopping play to explain it.
  const said = BROKEN_BY[failure.kind as keyof typeof BROKEN_BY];
  if (said) callbacks.onGameMessage?.(said);
  recover(game, callbacks);
  flashAndShake(callbacks, 200, onShakeEnd);
}

/**
 * Charge a ball/fence collision, from the freeze through to the life.
 *
 * Order matters and is the reason this is one function: the freeze has to be
 * recorded before anything can return early, or a shielded hit leaves the ball
 * running while the screen says it was caught; and the shield has to be spent
 * before the push is failed, or a shield the player bought does nothing on the
 * one cut they most wanted it for.
 */
export function ballStruckFence(
  game: CanvasGameState,
  ball: Ball,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  callbacks: GameCallbacks,
  failure: MapFailure,
): void {
  // Freeze the ball. This is what tells the player WHICH ball did it: the
  // board stops with the culprit sitting on the fence it broke.
  game.frozenBallId = ball.id;
  game.frozenBallPosition = { ...ball.position };
  game.frozenBallVelocity = { ...ball.velocity };
  // The deadline the loop falls back on if the shake timer is cancelled by
  // something that does not know about the freeze. Generous: the timer is
  // the normal path and must be allowed to win.
  game.frozenBallReleaseAt = performance.now() + FREEZE_MAX_MS;
  ball.velocity = { x: 0, y: 0 };

  const unfreezeAfterShake = () => {
    // Identity, not an id lookup. Ball ids are `${type.id}-${index}` and are
    // therefore only unique WITHIN a map, while this timer can outlive the
    // map that scheduled it: looking "grey-0" up on the next map finds a
    // different ball and teleports it to the previous map's coordinates. The
    // per-map reset clears the freeze so this should never see a stale one,
    // but the restore is the destructive half and gets its own check.
    if (game.frozenBallId === ball.id && game.balls.includes(ball)) {
      if (game.frozenBallPosition) ball.position = { ...game.frozenBallPosition };
      if (game.frozenBallVelocity) ball.velocity = { ...game.frozenBallVelocity };
    }
    clearFreeze(game);
  };

  // Shield absorbs the hit.
  if (game.wallShieldsRemaining > 0) {
    game.wallShieldsRemaining--;
    callbacks.setWallShieldCount(game.wallShieldsRemaining);
    game.activeWalls = [];
    recover(game, callbacks);
    flashAndShake(callbacks, 150, unfreezeAfterShake);
    return;
  }

  // Push mode: fail the push, not the life.
  if (game.pushMode === "pushing") {
    game.activeWalls = [];
    flashAndShake(callbacks, 200, unfreezeAfterShake);
    handlePushFailedFn(game, level, levelNumber, activeModifiers, callbacks);
    return;
  }

  dockOrEnd(game, level, levelNumber, activeModifiers, callbacks, failure, unfreezeAfterShake);
}

/**
 * Charge a mover/fence collision.
 *
 * Deliberately NOT the ball path with a different noun. There is nothing to
 * freeze - a mover is terrain, and stopping it mid-orbit would misreport whose
 * fault the break was - and neither the wall shield nor a live push saves you
 * from one: both are sold against BALLS, which are the thing you are steering.
 * A mover was always going to be where it is; cutting into it is a read you got
 * wrong, not a collision you were dodging.
 *
 * The life itself is the shared tail, which is the part that used to drift.
 */
export function moverStruckFence(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  callbacks: GameCallbacks,
  failure: MapFailure,
): void {
  clearFreeze(game);
  dockOrEnd(game, level, levelNumber, activeModifiers, callbacks, failure, () => {});
}
