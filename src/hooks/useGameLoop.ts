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
import { creepFactor } from "@/lib/scopeCreep";
import { mutatorSpeedFactor } from "@/lib/mapMutators";
import { PHYSICS_STEP, DISSOLVE_DURATION, AUTO_FREEZE_INTERVAL_MS, FREEZE_COOLDOWN_MULTIPLIER, LEVEL_CLEAR_SHIMMER_MS, LOCK_PULSE_DURATION, LOCK_TOTAL_DURATION } from "@/lib/gameConstants";
import { updateBall } from "@/lib/physics/updateBall";
import { handleBallCollisions } from "@/lib/physics/handleBallCollisions";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import { updatePickups } from "@/lib/pickups";
import { updateChestLoot } from "@/lib/chests";
import { updateWallImpacts } from "@/lib/wallImpactEffects";
import { recordFrame } from "@/lib/rendering/perfStats";

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
  /**
   * Per-frame safety net: evaluate the win conditions so a map that reached the
   * goal by ANY path (not just a completed cut or destroy) always finishes,
   * instead of stalling forever with CLEAR shown in the top bar.
   */
  checkWinCondition?: () => void;
  /** Advance rainbow balls' timed spit-out (appends to game.balls). Once per frame. */
  spawnTimedBalls?: () => void;
  /** Called when Scope Creep escalates to a new step (percentBoost = +X% ball speed). */
  onCreepStep?: (percentBoost: number) => void;
  /** Called once per whole active-play second (drives the Ship Early countdown bar). */
  onActiveSecond?: (seconds: number) => void;
  /** Called when a deferred push prompt opens (the lock flash it waited on ended). */
  onPushPrompt?: () => void;
  /** Renderer-owned "blank the board" (Pixi path; the 2D path clearRects its ctx). */
  renderEmpty?: () => void;
}

/**
 * Lock snap glide: a just-locked ball's physics position snaps to its pocket
 * centroid the moment it locks (see checkBallWonState), but the RENDER position
 * glides there from the catch position over the lock pulse so the centering
 * never reads as a teleport. Runs in the normal interpolation pass AND in the
 * render-only holds (level complete, deferred push prompt), where physics -
 * and therefore the interpolation pass - is stopped.
 */
function applyLockGlide(game: CanvasGameState, nowMs: number): void {
  if (game.assimilations.size === 0) return;
  for (const ball of game.balls) {
    if (ball.state !== 'won') continue;
    const flash = game.assimilations.get(ball.id);
    if (!flash) continue;
    const t = (nowMs - flash.startTime) / LOCK_PULSE_DURATION;
    if (t >= 1) continue;
    const ease = 1 - Math.pow(1 - Math.max(0, t), 3); // easeOutCubic
    if (!ball.renderPosition) ball.renderPosition = { x: 0, y: 0 };
    ball.renderPosition.x = flash.ballPos.x + (ball.position.x - flash.ballPos.x) * ease;
    ball.renderPosition.y = flash.ballPos.y + (ball.position.y - flash.ballPos.y) * ease;
  }
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
 * @param freezeNoCooldown - Absolute Zero set bonus: >0 = no re-freeze cooldown after thaw
 */
export function createGameLoop(
  game: CanvasGameState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D | null,
  parallaxTickRef: { current: ((ts: number) => void) | null | undefined } | null | undefined,
  callbacks: GameLoopCallbacks,
  autoFreezeDuration: number,
  freezeNoCooldown: number = 0,
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
    // Forward tick to MemoryParallaxLayer so it shares this rAF instead of owning
    // one. Frozen once the map is over (level complete / game over) so the
    // background code goes still with the board; it resumes when the next map's
    // loop starts (levelComplete resets to false on init).
    if (!game.levelComplete && !game.gameOver) {
      parallaxTickRef?.current?.(timestamp);
    }

    // Dissolve animation always runs regardless of gameOver/levelComplete state
    if (game.dissolve) {
      const d       = game.dissolve;
      const elapsed = (performance.now() - d.startTime) / 1000;
      const dur     = DISSOLVE_DURATION / 1000;
      // Reverse (run-intro assemble): play the same kinematics backwards, so
      // the tiles fly IN from their scattered end-state and settle in place.
      const anim    = d.reverse ? Math.max(0, dur - elapsed) : elapsed;

      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const tile of d.tiles) {
          const t        = Math.max(0, anim - tile.delay);
          const tMax     = dur - tile.delay;
          const progress = tMax > 0 ? Math.min(1, t / tMax) : 1;
          // Forward: shards fade out as they scatter. Reverse: they must stay
          // SOLID while flying together (the mirrored curve leaves them nearly
          // invisible for most of the flight and the assemble reads as a soft
          // fade instead of shards) - only a short global fade-in at the very
          // start stops the scattered cloud from popping in.
          const alpha    = d.reverse
            ? Math.max(0, Math.min(1, elapsed / 0.2))
            : Math.max(0, 1 - progress * 1.15);
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
      } else {
        // No 2D context (Pixi renderer): the renderer draws the tiles itself
        // from game.dissolve inside the normal render call.
        callbacks.render();
      }

      if (elapsed >= dur) {
        game.dissolve = null;
        if (d.reverse) {
          // Assemble finished: the tiles sit exactly where the live scene
          // draws them, so hand straight over to a normal frame (no blank).
          callbacks.render();
        } else if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
          // Pixi: present an EMPTY frame (the board has shattered away; a normal
          // render would repaint the drained sweep since shimmerStart is still set).
          callbacks.renderEmpty?.();
        }
        d.onComplete();
        return;
      }

      schedule();
      return;
    }

    if (game.gameOver || game.pushMode === "prompt") return;

    // After level complete, keep rendering until all lock animations finish and
    // the celebratory clear shimmer has swept the whole board.
    if (game.levelComplete) {
      if (game.assimilations.size > 0) {
        applyLockGlide(game, performance.now());
        for (const ball of game.balls) {
          if (ball.state === 'won') {
            const elapsed = performance.now() - ball.wonTime;
            ball.assimScale = Math.max(0, 1 - Math.max(0, elapsed - 50) / 180);
          }
        }
      }
      const shimmerActive =
        game.shimmerStart > 0 &&
        performance.now() < game.shimmerStart + LEVEL_CLEAR_SHIMMER_MS;
      // Freeze mode (dev/playground): render every frame through the sweep, then a
      // final clamped full-drain frame, and stop scheduling so the board holds.
      if (game.shimmerFrozen) {
        callbacks.render();
        if (shimmerActive) schedule();
        return;
      }
      if (game.assimilations.size > 0 || shimmerActive) {
        callbacks.render();
        schedule();
      }
      return;
    }

    // Deferred push prompt: the win condition was met while a lock flash was
    // still playing (see applyCut). Hold the world exactly as the prompt would
    // (no physics, input blocked via pushPromptPending) but keep rendering so
    // the flash and the lock glide play out, then open the modal.
    if (game.pushPromptPending) {
      const now = performance.now();
      let flashEnd = 0;
      for (const [, f] of game.assimilations) {
        flashEnd = Math.max(flashEnd, f.startTime + LOCK_TOTAL_DURATION);
      }
      if (now < flashEnd) {
        applyLockGlide(game, now);
        game.lastTime = timestamp;
        callbacks.render();
        schedule();
        return;
      }
      game.pushPromptPending = false;
      game.pushMode = "prompt";
      callbacks.onPushPrompt?.();
      callbacks.render();
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
          // Absolute Zero (freeze set bonus): no re-freeze cooldown after thaw.
          target.freezeReadyAt = freezeNoCooldown > 0
            ? now + durationMs
            : now + durationMs * (1 + FREEZE_COOLDOWN_MULTIPLIER);
          game.lastAutoFreezeAt = now;
        }
        // No eligible ball (all frozen/cooling) — leave the clock so it retries
        // next frame rather than skipping this scheduled tick entirely.
      }
    }

    let _physSteps = 0;
    const _physStart = performance.now();
    while (game.accumulator >= PHYSICS_STEP) {
      _physSteps++;

      // Time factor: tick the active-play clock (physics steps only, so pause,
      // menus and the push prompt never count) and step Scope Creep off it.
      // Death recovery is a forced pause, so it doesn't count either.
      if (!game.isRecovering) {
        const prevWholeSecond = Math.floor(game.activePlaySeconds);
        game.activePlaySeconds += PHYSICS_STEP;
        // Scope Creep drives the HUD chip alone; the map mutator's speed factor
        // (crunch/overclock) is folded into creepFactor so ball displacement AND
        // the aim-line predictor both see it, without muddying the creep readout.
        const creepF = creepFactor(game.activePlaySeconds, game.creepConfig);
        const creepPct = Math.round((creepF - 1) * 100);
        if (creepPct !== game.lastCreepPct) {
          game.lastCreepPct = creepPct;
          callbacks.onCreepStep?.(creepPct);
        }
        game.creepFactor = creepF * mutatorSpeedFactor(game.mapMutator, game.lockedBallsCount);
        // 1Hz clock tick to React (the countdown bar tweens between ticks).
        const wholeSecond = Math.floor(game.activePlaySeconds);
        if (wholeSecond !== prevWholeSecond) {
          callbacks.onActiveSecond?.(wholeSecond);
        }
      }

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

    // Pickups: expire stale tokens and roll spawns. Once per frame (not per
    // physics step) — all its timing keys off game.activePlaySeconds, so the
    // pause/prompt/menu holds above never advance a token's clock.
    updatePickups(game);

    // Treasure-chest loot gems: bounce them under gravity onto the first
    // surface below (obstacle top, fence, or floor). Same per-frame cadence as
    // pickups; culls itself on its active-play lifetime. game.walls already
    // holds obstacle edges, fences and board edges, so it IS the surface set.
    if (game.chestLoot && game.chestLoot.length > 0 && game.boardPolygon) {
      let floorY = -Infinity;
      for (const v of game.boardPolygon.vertices) if (v.y > floorY) floorY = v.y;
      const segments = game.walls.map(w => ({ x1: w.start.x, y1: w.start.y, x2: w.end.x, y2: w.end.y }));
      game.chestLoot = updateChestLoot(game.chestLoot, Math.min(dt, 0.05), { segments, floorY }, game.activePlaySeconds);
    }

    // Rainbow balls spit out a new ball on their own active-play timer. Once per
    // frame, outside the ball loop (it appends to game.balls). Same clock as
    // pickups, so it too pauses during holds/prompts/recovery.
    callbacks.spawnTimedBalls?.();

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

    // Safety net: the win condition is otherwise only evaluated in reaction to a
    // cut or a destroy, but the top bar shows CLEAR straight off the live
    // remaining-space state. Re-check every active frame (reached only during
    // normal play — the levelComplete / prompt / pending / gameOver states all
    // returned above) so the two can never disagree: if the space is at the goal
    // and the win is reachable, the map finishes here. Cheap — O(1) percent plus
    // O(balls), and the completion/prompt paths it calls all guard re-entry.
    callbacks.checkWinCondition?.();

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
    applyLockGlide(game, performance.now());

    const _physMs = performance.now() - _physStart;

    // Update wall impact visual effects (time-based)
    updateWallImpacts();

    const _renderStart = performance.now();
    callbacks.render();
    // Feed the perf overlay (physics-loop time vs render time vs frame delta).
    // Cheap and allocation-free; the overlay only paints when toggled on.
    recordFrame(dt * 1000, _physMs, performance.now() - _renderStart, _physSteps, game.balls.length);

    // Apply completed wall cut immediately (skip if level already finishing)
    if (!game.levelComplete && game.activeWall && game.activeWall.isComplete) {
      callbacks.applyCut(game.activeWall);
    }

    schedule();
  };

  return gameLoop;
}
