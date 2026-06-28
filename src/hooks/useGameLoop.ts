/**
 * createGameLoop — factory for the main rAF game loop.
 *
 * Called from inside GameCanvas's setup effect after canvas/ctx/game are
 * established.  Returns the loop function so the caller can pass it to
 * `requestAnimationFrame` and store it in `game.gameLoopFn` for restarts.
 *
 * Keeps rAF lifecycle concerns out of GameCanvas without introducing
 * React hook ordering constraints that would require all callbacks to exist
 * at component render time (they don't, as updateWall / applyCut are
 * closure-scoped in the setup effect).
 */

import { CanvasGameState } from "@/types/gameState";
import { GrowingWall } from "@/types/game";
import { PHYSICS_STEP, DISSOLVE_DURATION, AUTO_FREEZE_INTERVAL_MS, FREEZE_COOLDOWN_MULTIPLIER } from "@/lib/gameConstants";
import { updateBall } from "@/lib/physics/updateBall";
import { handleBallCollisions } from "@/lib/physics/handleBallCollisions";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import { updateWallImpacts } from "@/lib/wallImpactEffects";

export interface GameLoopCallbacks {
  /** Called every physics step to advance wall growth. */
  updateWall: (dt: number) => void;
  /** Called when a wall's growth animation completes (triggers area split). */
  applyCut: (wall: GrowingWall) => void;
  /** Called once per frame to composite everything onto the canvas. */
  render: () => void;
  /** Called when Ascension fences ran out of durability this frame. */
  processWallBreaks?: () => void;
  /** Called when a black ball destroyed a mirror/mover this frame. */
  processDestroys?: () => void;
}

/**
 * Build and return the `gameLoop` function.
 *
 * @param game     - The mutable game state object (from gameRef.current)
 * @param canvas   - The main canvas DOM element
 * @param ctx      - The 2D rendering context for the canvas
 * @param parallaxTickRef - Ref to the parallax tick function (shared rAF)
 * @param callbacks - render / updateWall / applyCut functions
 * @param autoFreezeDuration - Cron Job: seconds an auto-frozen ball holds (0 = upgrade off)
 */
export function createGameLoop(
  game: CanvasGameState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  parallaxTickRef: { current: ((ts: number) => void) | null | undefined } | null | undefined,
  callbacks: GameLoopCallbacks,
  autoFreezeDuration: number,
): (timestamp: number) => void {
  // Always cancel the previously-stored handle before scheduling a new one, so
  // an external start site (resume/dissolve/pushMode) that assigns into
  // game.animationId can never leave a second self-rescheduling loop running.
  const schedule = () => {
    cancelAnimationFrame(game.animationId);
    game.animationId = requestAnimationFrame(gameLoop);
  };

  // The frozen-ball invariant breach below should never happen; log it once
  // rather than every physics tick (up to 120Hz) so it can't flood the console
  // and tank performance if the invariant ever does break.
  let frozenBreachLogged = false;

  const gameLoop = (timestamp: number): void => {
    // Forward tick to MemoryParallaxLayer so it shares this rAF instead of owning one
    parallaxTickRef?.current?.(timestamp);

    // Dissolve animation always runs regardless of gameOver/levelComplete state
    if (game.dissolve) {
      const d       = game.dissolve;
      const elapsed = (performance.now() - d.startTime) / 1000;
      const dur     = DISSOLVE_DURATION / 1000;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const tile of d.tiles) {
        const t        = Math.max(0, elapsed - tile.delay);
        const tMax     = dur - tile.delay;
        const progress = tMax > 0 ? Math.min(1, t / tMax) : 1;
        const alpha    = Math.max(0, 1 - progress * 1.15);
        const x        = tile.cx + tile.vx * t;
        const y        = tile.cy + tile.vy * t + 400 * t * t; // gravity
        const angle    = tile.rotSpeed * t;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.drawImage(d.captured, tile.sx, tile.sy, tile.sw, tile.sh,
          -tile.sw / 2, -tile.sh / 2, tile.sw, tile.sh);
        ctx.restore();
      }

      if (elapsed >= dur) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        game.dissolve = null;
        d.onComplete();
        return;
      }

      schedule();
      return;
    }

    if (game.gameOver || game.pushMode === "prompt") return;

    // After level complete, keep rendering until all lock animations finish
    if (game.levelComplete) {
      if (game.assimilations.size > 0) {
        for (const ball of game.balls) {
          if (ball.state === 'won') {
            const elapsed = performance.now() - ball.wonTime;
            ball.assimScale = Math.max(0, 1 - Math.max(0, elapsed - 50) / 180);
          }
        }
        callbacks.render();
        schedule();
      }
      return;
    }

    const dt = game.lastTime ? (timestamp - game.lastTime) / 1000 : 0;
    game.lastTime   = timestamp;
    game.accumulator += Math.min(dt, 0.05);

    // Cron Job: on a fixed interval, freeze one random eligible ball. Reuses the
    // same frozenUntil/freezeReadyAt path as the tap-driven Feature Freeze, so
    // the physics loop below (and rendering) already hold and visualise it.
    if (autoFreezeDuration > 0 && !game.isRecovering) {
      const now = performance.now();
      if (game.lastAutoFreezeAt === 0) {
        // First active frame of the map — start the clock so the first freeze
        // lands one full interval in, not immediately at map start.
        game.lastAutoFreezeAt = now;
      } else if (now - game.lastAutoFreezeAt >= AUTO_FREEZE_INTERVAL_MS) {
        const eligible = game.balls.filter(b =>
          b.state === "active" &&
          !(b.frozenUntil && now < b.frozenUntil) &&     // not already frozen
          !(b.freezeReadyAt && now < b.freezeReadyAt)     // not on thaw cooldown
        );
        if (eligible.length > 0) {
          const target = eligible[Math.floor(Math.random() * eligible.length)];
          const durationMs = autoFreezeDuration * 1000;
          target.frozenUntil   = now + durationMs;
          target.freezeReadyAt = now + durationMs * (1 + FREEZE_COOLDOWN_MULTIPLIER);
          game.lastAutoFreezeAt = now;
        }
        // No eligible ball (all frozen/cooling) — leave the clock so it retries
        // next frame rather than skipping this scheduled tick entirely.
      }
    }

    while (game.accumulator >= PHYSICS_STEP) {
      // Snapshot positions before this step (used for render interpolation).
      // Mutate in-place to avoid allocating a new object every physics tick.
      for (const ball of game.balls) {
        if (!ball.prevPosition) {
          ball.prevPosition = { x: ball.position.x, y: ball.position.y };
        } else {
          ball.prevPosition.x = ball.position.x;
          ball.prevPosition.y = ball.position.y;
        }
      }

      updateMoversFn(PHYSICS_STEP, game);

      for (const ball of game.balls) {
        // WON balls keep full physics but visually disintegrate
        if (ball.state === 'won') {
          const elapsed = performance.now() - ball.wonTime;
          ball.assimScale = Math.max(0, 1 - Math.max(0, elapsed - 50) / 180);
        }

        // Skip updating frozen ball - it stays in place during shake animation
        if (game.frozenBallId && ball.id === game.frozenBallId) {
          if (game.frozenBallPosition &&
              (ball.position.x !== game.frozenBallPosition.x ||
               ball.position.y !== game.frozenBallPosition.y)) {
            if (!frozenBreachLogged) {
              console.error("[FREEZE] Ball position changed during freeze! Current:", ball.position, "Should be:", game.frozenBallPosition);
              frozenBreachLogged = true;
            }
            ball.position = { ...game.frozenBallPosition };
          }
          continue;
        }

        // Feature Freeze: tap-frozen balls hold position until their timer ends.
        if (ball.frozenUntil && performance.now() < ball.frozenUntil) continue;

        updateBall(ball, PHYSICS_STEP, game);
      }
      handleBallCollisions(game);
      callbacks.updateWall(PHYSICS_STEP);
      game.accumulator -= PHYSICS_STEP;
    }

    // Break any Ascension fences that ran out of durability (outside the
    // fixed-step loop — breaking rebuilds regions, too heavy per step)
    if (game.pendingWallBreaks.length > 0) {
      callbacks.processWallBreaks?.();
    }

    // Remove mirrors/movers a black ball finished off this frame (rebuilds
    // regions when a mirror reopens space — too heavy for the fixed-step loop).
    if (game.pendingDestroys.length > 0) {
      callbacks.processDestroys?.();
    }

    // Interpolate render positions between last two physics states.
    // Mutate in-place to avoid allocating a new object every display frame.
    const alpha = game.accumulator / PHYSICS_STEP;
    for (const ball of game.balls) {
      const prev = ball.prevPosition ?? ball.position;
      if (!ball.renderPosition) {
        ball.renderPosition = { x: 0, y: 0 };
      }
      ball.renderPosition.x = prev.x + (ball.position.x - prev.x) * alpha;
      ball.renderPosition.y = prev.y + (ball.position.y - prev.y) * alpha;
    }

    // Update wall impact visual effects (time-based)
    updateWallImpacts();

    callbacks.render();

    // Apply completed wall cut immediately (skip if level already finishing)
    if (!game.levelComplete && game.activeWall && game.activeWall.isComplete) {
      callbacks.applyCut(game.activeWall);
    }

    schedule();
  };

  return gameLoop;
}
