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
import { updateBallEffects } from "@/lib/ballEffects";
import { advanceLamp } from "@/lib/lampBall";
import { tickChains } from "@/lib/physics/chain";
import { tickPhasing, collectPhasedOut } from "@/lib/physics/phasing";
import { tickCages } from "@/lib/physics/cage";
import { tickCharges } from "@/lib/physics/charge";
import { tickDrills } from "@/lib/physics/drill";
import { rebuildWallGrid } from "@/lib/physics/wallGrid";
import { handleBallCollisions } from "@/lib/physics/handleBallCollisions";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import { updateMoverControlFn } from "@/lib/physics/moverControl";
import { updatePickups } from "@/lib/pickups";
import { updateBugs } from "@/lib/physics/bugs";
import { updateChestLoot } from "@/lib/chests";
import { abilitySpeedFactor } from "@/lib/abilityEffects";
import { updateWallImpacts, updateObstacleImpacts } from "@/lib/wallImpactEffects";
import { launchPending, updateLauncherArming } from "@/lib/physics/launcher";
import { updateRubble } from "@/lib/physics/rubble";
import { applyLodestones } from "@/lib/physics/lodestone";
import { clearFreeze } from "@/lib/physics/updateFenceWall";
import { recordFrame, recordCut, recordBg } from "@/lib/rendering/perfStats";
import { collectDeliveries, releaseReservedSpace } from "@/lib/physics/deliveryBox";
import { simNow, advanceSimClock } from "@/lib/simClock";
import { createHoldClock } from "@/lib/holdClock";
import { anyLockFlashActive, lockFlashEnd } from "@/lib/lockFlash";
import { drainCommands, type CommandDeps } from "@/lib/net/commands";
import { startPairTurns } from "@/lib/net/pairTurn";
import { runStream } from "@/lib/runRng";

/**
 * The longest stretch a single frame may hand the simulation, in milliseconds.
 * A backgrounded tab returns with a gap of seconds; without this the board
 * would fast-forward through it. The accumulator has always clamped here; the
 * sim clock's hold frames use the same ceiling so the two cannot disagree.
 */
const MAX_FRAME_MS = 50;

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
   * Called every physics step: squash any bug a ball is now sitting on.
   *
   * A callback rather than a direct call, because applying a bug needs the
   * level's win spec, the run's modifiers and the lock callbacks - Ship It
   * closes a real pocket and the lock that follows is priced like any other.
   * The loop has none of those; GameCanvas has all of them.
   */
  squashBugs?: () => void;
  /**
   * Called every frame after the barrels are armed: tears down the shell of
   * any barrel that armed this frame (physics/launcherShell.ts).
   */
  settleLaunchers?: () => void;
  /** Fired when a "Deploy Charge" detonates this frame, to flash the payoff banner. */
  onChargeBlown?: (announce?: string) => void;
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
  /**
   * What an applied player command needs: the run's modifiers, and the few
   * callbacks that carry a result back to React. Read fresh each frame so a
   * modifier that changes mid-map (an ability firing, a pickup claimed) is
   * the one the next command sees.
   */
  commandDeps?: () => CommandDeps;
  /**
   * The lockstep session, when this map is being played by a pair.
   *
   * Absent in solo play, which is why nothing below changes for it. Present,
   * it decides which ticks may run: the loop still owns the accumulator and
   * the rendering, but a tick only happens once both devices' commands for it
   * are in. A tick that cannot run is a stutter, never a divergence, and the
   * frame is drawn anyway so the board does not appear to freeze.
   */
  lockstep?: () => import("@/lib/net/lockstep").LockstepSession | null;
  /** The map's number, for who opens it in a pair (net/pairTurn.ts). */
  levelNumber?: number;
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
  // Safety net: a single thrown frame must NOT kill the rAF loop (that reads as
  // a hard freeze, since schedule() below never runs). The wrapper `gameLoop`
  // catches, logs once, and reschedules, so a render/physics bug degrades to a
  // bad frame plus a console error instead of freezing the whole game.
  let loopErrorLogged = false;
  /**
   * Scratch surface list for chest-loot gravity, reused frame to frame.
   *
   * This was rebuilt with `game.walls.map(...)` on every frame a gem was in
   * flight - one fresh object per fence, board edge and obstacle edge, sixty
   * times a second - purely to reshape the same numbers the walls already hold.
   * Loot lands in a couple of seconds, but that is still hundreds of short-lived
   * objects per gem, which is exactly the garbage that shows up later as a
   * collection pause with nothing on screen to explain it.
   */
  const lootSegments: { x1: number; y1: number; x2: number; y2: number }[] = [];

  /**
   * Sim-clock bookkeeping for the frames that never reach the physics step.
   *
   * An active frame advances sim time one PHYSICS_STEP at a time inside the
   * step loop, which is what makes tick N the same instant on every device.
   * The hold frames (the dissolve/assemble, a finished level playing out its
   * locks, the deferred push prompt) run no steps at all, and their animations
   * still have to play, so they advance the clock by their own elapsed frame
   * time instead. `game.paused` deliberately advances nothing: with a modal up,
   * or a launcher wager open, the clock does not run.
   */
  const hold = createHoldClock(MAX_FRAME_MS);

  const gameLoopBody = (timestamp: number): void => {
    // Open the frame for the hold clock. Once, here, on EVERY frame - active
    // ones too, or the first hold after a spell of play would see the whole
    // stretch as one elapsed frame.
    //
    // This used to be a bare `lastFrameTs = timestamp` beside a reader that
    // moved the same cursor when it was asked, and the two cancelled: every
    // hold frame was worth exactly 0ms of sim time, so a finished map never
    // dissolved, its overlay never mounted and the board sat rendering one
    // frame for ever. See lib/holdClock for the whole story.
    hold.beginFrame(timestamp);
    // The watchdog's heartbeat. Stamped FIRST, before any of the guards below
    // can return, so "the loop body ran" is what it records - the loop being
    // deliberately held still counts as alive, and only a loop that is not
    // being called at all goes stale. See lib/loopWatchdog.
    game.loopFrameAt = timestamp;
    // Forward tick to MemoryParallaxLayer so it shares this rAF instead of owning
    // one. Frozen once the map is over (level complete / game over) so the
    // background code goes still with the board; it resumes when the next map's
    // loop starts (levelComplete resets to false on init).
    if (!game.levelComplete && !game.gameOver) {
      // Timed separately: this runs before the physics timer starts, so its cost
      // was counted by neither phys nor rend and showed up only as unattributable
      // `other` time.
      const _bgStart = performance.now();
      parallaxTickRef?.current?.(timestamp);
      recordBg(performance.now() - _bgStart);
    }

    // Dissolve animation always runs regardless of gameOver/levelComplete state
    if (game.dissolve) {
      advanceSimClock(hold.elapsed());
      const d       = game.dissolve;
      const elapsed = (simNow() - d.startTime) / 1000;
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

    // A modal/menu is up (game.paused mirrors the React `paused` prop): hold
    // physics here so nothing advances behind it. This is the self-halt that
    // catches the board finishing its intro assemble behind a still-open modal
    // (e.g. the "how to win" card), where the loop was (re)started after the
    // pause effect had already run. The pause effect reschedules on close.
    // Level-complete/game-over keep their own end-of-map animations below.
    if (game.paused && !game.levelComplete && !game.gameOver) {
      // A LAUNCHER hold is not a modal. Nothing covers the board and the player
      // is looking straight at it, aiming down the barrel - so this one keeps
      // drawing a static frame instead of stopping dead. Without it the hold
      // stops the loop before the map's first paint and the band, the cone and
      // the loaded balls hang over the page background with no board under them.
      //
      // Physics is still held: this returns before the step either way, so the
      // balls do not move and the clock does not run while the wager is open.
      if (launchPending(game)) {
        callbacks.render();
        schedule();
      }
      return;
    }

    if (game.gameOver || game.pushMode === "prompt") return;

    // Wall and obstacle deformations, advanced HERE rather than beside the
    // physics step further down.
    //
    // Several paths below render and return without ever reaching that step: a
    // completed level playing out its lock animations, and the deferred push
    // prompt holding the world still while a lock flash finishes. Both keep
    // drawing, so a bulge caught mid-rise stayed frozen at full deflection for
    // as long as the lock took, which is the one moment the board is held still
    // enough to stare at. They are time-based and idempotent, so running them
    // on every frame that draws anything is both correct and cheap.
    //
    // After the `paused` guard on purpose: with a modal up nothing should be
    // moving, deformations included.
    updateWallImpacts();
    updateObstacleImpacts();

    // After level complete, keep rendering until all lock animations finish and
    // the celebratory clear shimmer has swept the whole board.
    if (game.levelComplete) {
      advanceSimClock(hold.elapsed());
      if (game.assimilations.size > 0) {
        applyLockGlide(game, simNow());
        for (const ball of game.balls) {
          if (ball.state === 'won') {
            const elapsed = simNow() - ball.wonTime;
            ball.assimScale = Math.max(0, 1 - Math.max(0, elapsed - 50) / 180);
          }
        }
      }
      const shimmerActive =
        game.shimmerStart > 0 &&
        simNow() < game.shimmerStart + LEVEL_CLEAR_SHIMMER_MS;
      // Freeze mode (dev/playground): render every frame through the sweep, then a
      // final clamped full-drain frame, and stop scheduling so the board holds.
      if (game.shimmerFrozen) {
        callbacks.render();
        if (shimmerActive) schedule();
        return;
      }
      // A flash that has PLAYED OUT is not a reason to keep drawing. This read
      // `assimilations.size > 0`, and nothing ever removes a flash - the map
      // clears them all when the next one is built - so on any map where a ball
      // locked, a finished level rendered and rescheduled for ever behind the
      // results screen. See lib/lockFlash.
      if (anyLockFlashActive(game.assimilations.values(), simNow()) || shimmerActive) {
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
      advanceSimClock(hold.elapsed());
      const now = simNow();
      const flashEnd = lockFlashEnd(game.assimilations.values());
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
    game.accumulator += Math.min(dt, MAX_FRAME_MS / 1000);

    // Cron Job: on a fixed interval, freeze one random eligible ball. Reuses the
    // same frozenUntil/freezeReadyAt path as the tap-driven Feature Freeze, so
    // the physics loop below (and rendering) already hold and visualise it.
    if (autoFreezeDuration > 0 && !game.isRecovering) {
      const now = simNow();
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
          // Seeded: Cron Job picking a different ball on each device would
          // put the two boards on different paths within seconds.
          const target = eligible[Math.floor(runStream("autoFreeze")() * eligible.length)];
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

    // Player actions land HERE, at the top of the frame, before anything
    // moves. They used to land wherever the pointer handler happened to run,
    // which is the same instant in practice for one player and no instant at
    // all for two: a pair has to apply both devices' actions in one agreed
    // order, and this is that order.
    //
    // Solo, the queue is whatever this device's fingers put there and it is
    // drained now. In a pair the lockstep owns the queue: it fills it one tick
    // at a time inside the step loop below, from both devices' commands, and
    // this drain handles only what is already waiting.
    const deps = callbacks.commandDeps?.();
    const pair = callbacks.lockstep?.() ?? null;
    // A pair takes turns (net/pairTurn.ts). Started on the first pair frame,
    // before any tick, and identically on both phones since both read the same
    // map number; dropped the moment the pair ends and this player carries on
    // alone, or they would be left waiting for a partner's turn that never comes.
    if (pair) game.pairTurn ??= startPairTurns(callbacks.levelNumber ?? 1);
    else if (game.pairTurn) game.pairTurn = null;
    if (pair && !pair.beginFrame(game)) {
      // Waiting to be put back on the host's board. Draw, do not step.
      game.lastTime = timestamp;
      callbacks.render();
      schedule();
      return;
    }
    if (deps && !pair) drainCommands(game, deps);

    // Rebuild the wall spatial index once per frame. `game.walls` is immutable
    // across this frame's substeps (movers carry their own polygons; fences
    // only commit/break at frame boundaries), so one build serves every
    // substep and every ball. Cheap and reuses its buffers frame to frame.
    game.wallGrid = rebuildWallGrid(game.wallGrid ?? null, game.walls, game.boardPolygon);

    let _physSteps = 0;
    const _physStart = performance.now();
    while (game.accumulator >= PHYSICS_STEP) {
      // In a pair, a tick runs only when both devices' commands for it are in.
      // Refused means the partner's phone has not been heard from yet: leave
      // the accumulator where it is and draw; the tick will run next frame.
      if (pair) {
        if (!pair.tryReleaseTick(game)) {
          // The partner's commands for this tick are not in yet. Leaving the
          // accumulator alone looks harmless and is not: it keeps filling at
          // one frame per frame while nothing drains it, so a two-second wait
          // banks two seconds, and the moment the partner speaks the board
          // runs two hundred ticks in a single frame and every ball teleports.
          //
          // Held to one step instead. The pair resumes at the pace it stalled
          // at, which is what a stutter should look like.
          game.accumulator = Math.min(game.accumulator, PHYSICS_STEP);
          break;
        }
        if (deps) drainCommands(game, deps);
      }

      // One step of sim time per physics step: the whole point of the sim
      // clock. Advanced FIRST so everything this step stamps or compares sees
      // the instant the step lands on, not the one it left.
      advanceSimClock(PHYSICS_STEP * 1000);
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
        // The Slow All ability (#38) folds in here too, so ball displacement and
        // the aim-line predictor both see it; it self-reverts by clock expiry.
        game.creepFactor = creepF * mutatorSpeedFactor(game.mapMutator, game.lockedBallsCount) * abilitySpeedFactor(game) * (game.beatSpeedMult || 1);
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
      // Lodestone: one pass over the balls before they move, so every ball in
      // a cluster feels the same pull on the same frame rather than in the
      // order the list happens to be in.
      applyLodestones(game.balls, PHYSICS_STEP, game.frozenBallId ?? null);

      // Control Freak first: what the player is doing to a mover decides
      // whether the map gets to move it at all this step.
      updateMoverControlFn(PHYSICS_STEP, game, timestamp);
      updateMoversFn(PHYSICS_STEP, game);
      // Phasing obstacles (#64): update solid<->intangible BEFORE ball physics so
      // the phased-out collision skips this step read the current phase.
      tickPhasing(game, game.activePlaySeconds);
      // Cages own their mouths' phase, so this runs beside tickPhasing rather
      // than inside it: one of them knows the clock, the other knows whether a
      // ball is in the box.
      tickCages(game, simNow());

      // A freeze that outlived its window is lifted here, whatever happened to
      // its timer.
      //
      // The post-break freeze is normally released by a setTimeout kept in the
      // SHARED shake-timer ref, and several paths that know nothing about
      // freezing (applyCut, handleGameOver, the canvas cleanup) clear that ref
      // and install callbacks of their own. When that happens the release never
      // runs, `frozenBallId` stays set, and this loop plus updateBall both skip
      // that ball for the rest of the map: it stops dead in open space and
      // never moves again. Reported as balls stopping mid-air.
      //
      // The timer is still the normal path - the deadline is well past it - so
      // this only ever fires for a freeze that was going to be permanent.
      if (game.frozenBallId && game.frozenBallReleaseAt !== null
          && simNow() > game.frozenBallReleaseAt) {
        const stranded = game.balls.find(b => b.id === game.frozenBallId);
        if (stranded) {
          // Give back the velocity it was carrying. Without this the ball
          // restarts from the speed floor in an arbitrary direction, which is
          // a second, quieter way for the break to rob the player.
          if (game.frozenBallVelocity) stranded.velocity = { ...game.frozenBallVelocity };
          if (game.frozenBallPosition) stranded.position = { ...game.frozenBallPosition };
        }
        console.warn("[FREEZE] freeze outlived its window; released", game.frozenBallId);
        clearFreeze(game);
      }

      // Intangible phased-out obstacles are identical for every ball this step,
      // so compute the set once here instead of per ball inside updateBall.
      const phasedOut = collectPhasedOut(game);
      for (const ball of game.balls) {
        // WON balls keep full physics but visually disintegrate
        if (ball.state === 'won') {
          const elapsed = simNow() - ball.wonTime;
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
          // Its EFFECTS still run. A ball that stops moving has not stopped
          // being drawn, and an effect envelope that is not ticked does not
          // pause - it stops mid-curve and stays there. See the frozenUntil
          // note below, which is the same bug with a longer history.
          updateBallEffects(ball.effects, PHYSICS_STEP, simNow());
          continue;
        }

        // NO `continue` FOR A HELD BALL. updateBall owns that decision, and
        // owning it in two places is what shipped Bug Squash with no visible
        // squash at all.
        //
        // This line used to read:
        //
        //   if (ball.frozenUntil && simNow() < ball.frozenUntil) continue;
        //
        // and it skipped the ball before updateBall could be reached. updateBall
        // has its own held-ball branch which returns early AND ticks the ball's
        // effects, so the headless harness - which calls updateBall for every
        // ball unconditionally - animated a held ball correctly. The browser
        // never got there. A Bug Squash ball therefore held whatever envelope
        // value it had at the instant it stuck, which pinSquish sets to ZERO
        // before the ramp raises it, so the ball sat against the wall perfectly
        // round with its wall-hit halo frozen mid-decay around it.
        //
        // Every test passed throughout, because every test either called
        // updateBallEffects directly or drove the harness. The harness was
        // cited as the proof and was the one place that could not see the bug.
        updateBall(ball, PHYSICS_STEP, game, phasedOut);
      }
      handleBallCollisions(game);

      // Bugs squash with the ball pass, not the frame pass. A ball crosses more
      // than a bug's own diameter inside one 120Hz step, so a per-frame check
      // would miss exactly the fast balls that are the most satisfying thing to
      // squash one with - and "it went straight through it" is the one failure
      // this mechanic cannot have.
      callbacks.squashBugs?.();

      // Arm a barrel the frame it finishes emptying. After ball movement, so a
      // ball that left the interior this step counts as gone this step, and
      // before the win checks downstream, so the first frame a fence could be
      // drawn is the frame the interior is genuinely clear.
      updateLauncherArming(game);
      // The frame a barrel arms, its shell dematerializes. Right after arming,
      // so the ground the barrel stood on is playable the same frame a fence
      // first becomes legal.
      callbacks.settleLaunchers?.();

      // Pieces shed by breakables slide and fade (physics/rubble.ts). With the
      // ball pass, not the render pass: they deflect balls, so they are world
      // state, and a frame that skipped them would move balls against rubble
      // that had not moved.
      updateRubble(game, PHYSICS_STEP, simNow());

      // Deliveries: a ball that has crossed a box's membrane is taken out of
      // play and counted. Runs after ball movement so a ball that arrived this
      // step counts this step, and a satisfied box hands back the space it was
      // holding immediately rather than a frame later.
      for (const ev of collectDeliveries(game)) {
        if (ev.satisfied) releaseReservedSpace(game, ev.box);
      }
      // Chains (#64): solve the verlet rope AFTER ball physics so it reads the
      // balls' new positions, tethers/snags them, and sweeps fences.
      tickChains(game, PHYSICS_STEP, simNow());
      callbacks.updateWall(PHYSICS_STEP);
      game.accumulator -= PHYSICS_STEP;
      pair?.endTick(game);
    }

    // The Lamp: which ball is lighting the board. Once per frame rather than
    // per physics step, because it is a rendering fact, and because the only
    // thing that can change it is a ball leaving play, which cannot happen
    // twice inside one frame.
    game.lamp = advanceLamp(game.lamp, game.balls, game.gridRegions, simNow());

    // Pickups: expire stale tokens and roll spawns. Once per frame (not per
    // physics step) — all its timing keys off game.activePlaySeconds, so the
    // pause/prompt/menu holds above never advance a token's clock.
    updatePickups(game);

    // Bugs fly, age out and spawn. Once per frame like the tokens, and on the
    // same active-play clock, so a pause never advances a bug's life or moves
    // it across a board the player is not looking at.
    updateBugs(game, dt);

    // Treasure-chest loot gems: bounce them under gravity onto the first
    // surface below (obstacle top, fence, or floor). Same per-frame cadence as
    // pickups; culls itself on its active-play lifetime. game.walls already
    // holds obstacle edges, fences and board edges, so it IS the surface set.
    if (game.chestLoot && game.chestLoot.length > 0 && game.boardPolygon) {
      let floorY = -Infinity;
      for (const v of game.boardPolygon.vertices) if (v.y > floorY) floorY = v.y;
      // Refill the scratch buffer in place; entries are overwritten rather than
      // reallocated, and the array only ever grows to the largest wall count seen.
      lootSegments.length = game.walls.length;
      for (let i = 0; i < game.walls.length; i++) {
        const w = game.walls[i];
        const s = lootSegments[i];
        if (s) { s.x1 = w.start.x; s.y1 = w.start.y; s.x2 = w.end.x; s.y2 = w.end.y; }
        else lootSegments[i] = { x1: w.start.x, y1: w.start.y, x2: w.end.x, y2: w.end.y };
      }
      game.chestLoot = updateChestLoot(game.chestLoot, Math.min(dt, 0.05), { segments: lootSegments, floorY }, game.activePlaySeconds);
    }

    // Rainbow balls spit out a new ball on their own active-play timer. Once per
    // frame, outside the ball loop (it appends to game.balls). Same clock as
    // pickups, so it too pauses during holds/prompts/recovery.
    callbacks.spawnTimedBalls?.();

    // "Deploy Charge": detonate any armed fuse whose telegraph delay elapsed.
    // Runs BEFORE the wall-break + destroy passes below because a blast pushes
    // its target slab onto pendingDestroys and shredded fences onto
    // pendingWallBreaks, and we want both applied this same frame.
    tickCharges(game, { onChargeBlown: callbacks.onChargeBlown });
    // A drill fence eats whatever slab it is resting against.
    //
    // `dt`, the FRAME's own elapsed seconds - not PHYSICS_STEP. This block runs
    // once per frame, outside the fixed-step loop above, so a fixed step here
    // would be the exact bug the per-second rate exists to avoid: a 120Hz phone
    // would chew twice as fast as a 60Hz one, and it would only ever show up on
    // somebody else's device.
    tickDrills(game, dt);

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
    applyLockGlide(game, simNow());

    const _physMs = performance.now() - _physStart;

    const _renderStart = performance.now();
    callbacks.render();
    // Feed the perf overlay (physics-loop time vs render time vs frame delta).
    // Cheap and allocation-free; the overlay only paints when toggled on.
    recordFrame(dt * 1000, _physMs, performance.now() - _renderStart, _physSteps, game.balls.length);

    // Apply every completed wall cut immediately (skip if level already
    // finishing). applyCut removes the wall from activeWalls, so iterate a snapshot.
    if (!game.levelComplete && game.activeWalls.length > 0) {
      for (const w of [...game.activeWalls]) {
        if (game.levelComplete) break;
        if (w.isComplete) {
          // Timed separately: this runs after recordFrame above, so its cost
          // lands in the NEXT frame's delta and shows up as an unattributable
          // frame spike with a low render peak.
          const _cutStart = performance.now();
          callbacks.applyCut(w);
          recordCut(performance.now() - _cutStart);
        }
      }
    }

    schedule();
  };

  const gameLoop = (timestamp: number): void => {
    try {
      gameLoopBody(timestamp);
    } catch (err) {
      if (!loopErrorLogged) {
        loopErrorLogged = true;
        console.error("[gameLoop] frame threw; keeping the loop alive:", err);
      }
      schedule();
    }
  };

  return gameLoop;
}
