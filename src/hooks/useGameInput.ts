/**
 * useGameInput — attaches pointer event listeners to the game canvas.
 *
 * All three handlers operate directly on the mutable CanvasGameState ref;
 * they produce no React state changes except for the two UI setters.
 */

import { useEffect, RefObject } from "react";
import { boardAngleFor } from "@/lib/boardTilt";
import { CanvasGameState } from "@/types/gameState";
import { boardEntityAt, type BoardEntityHit } from "@/lib/boardEntityInfo";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { Ball, GrowingWall, Vector2 } from "@/types/game";
import {
  vec2Sub,
  vec2Length,
  vec2Normalize,
} from "@/lib/polygon";
import { STANDARD_FENCE_ID, getFenceType } from "@/lib/fences";
import { WALL_THICKNESS, castRayWithReflections } from "@/lib/wallGeometry";
import {
  BASE_SWIPE_MIN_DISTANCE,
  FREEZE_COOLDOWN_MULTIPLIER,
  FREEZE_TAP_SLOP,
  SUPERIOR_LOCK_DURATION,
} from "@/lib/gameConstants";
import { fencesBlockedByLauncher } from "@/lib/physics/launcher";
import { loadedSlingAt, slingShape, fireSlingFence } from "@/lib/physics/slingFence";
import { moverAt, railParam, railReading, releaseMover } from "@/lib/physics/moverControl";
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  screenToWorld,
  isPointInBoard,
  getDevicePixelRatio,
} from "@/lib/boardConstants";
import { isPositionActive } from "@/lib/spaceGrid";
import { wallBlocksCutStart } from "@/lib/physics/cutStart";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { bentDrawnPath, joinProjection, outgoingDirection, incomingDirection } from "@/lib/physics/bentCut";
import type { GameMessageId } from "@/lib/gameMessages";
import { abilityFenceRushFactor } from "@/lib/abilityEffects";
import { isTappableBall } from "@/lib/ballTypes";
import { initAudio } from "@/lib/gameAudio";
import { enqueueCommand, freezeTargetAt, LOCAL_PLAYER } from "@/lib/net/commands";
import { simNow } from "@/lib/simClock";

/**
 * The board's current rotation (issue #77), recomputed rather than cached.
 *
 * The renderer derives its angle from the same pure function and the same
 * activePlaySeconds, so the two cannot drift: a tap is always un-turned by
 * exactly the angle the board was drawn at. Caching it on the game state would
 * introduce a frame of skew between what is on screen and where a fence lands.
 */
/**
 * Bent-fence drag sampling (#66). Points closer together than the spacing add
 * nothing the simplifier can use; the cap is a ceiling on a very long slow drag
 * so the buffer cannot grow without bound.
 */
const SWIPE_SAMPLE_SPACING = 12;
const MAX_SWIPE_SAMPLES = 256;

function boardTilt(game: CanvasGameState): number {
  return boardAngleFor(game.activePlaySeconds, game.gravityConfig, game.boardTilt);
}

/** How many fences may grow at once: 1, plus the additionalConcurrentFences
 *  modifier, plus one while Fence Overclock is active (#38). */
function concurrentFenceLimit(game: CanvasGameState, activeModifiers: GameModifiers): number {
  const extra = Math.max(0, Math.round(activeModifiers.additionalConcurrentFences));
  return 1 + extra + (abilityFenceRushFactor(game) > 1 ? 1 : 0);
}

export function useGameInput(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  gameRef: RefObject<CanvasGameState | null>,
  activeModifiers: GameModifiers,
  setCutCount: (n: number) => void,
  setIsPlayerDragging: (v: boolean) => void,
  setFreezeUsesRemaining: (n: number) => void,
  /** Targeted-ability tap handler (Magnet): consumes the next board tap as the
   *  point. Read from a ref so the listeners can stay wired once. */
  onAbilityTargetRef?: RefObject<((id: string | null, pos: { x: number; y: number } | null) => void) | null>,
  /** Press-and-hold on a superior-lock star: opens the lock explainer. Read from
   *  a ref so the listeners stay wired once. */
  onSuperiorInfoRef?: RefObject<(() => void) | null>,
  /** Tap on a white "tappable" ball (#57): the input layer removes it; this runs
   *  the side effects (pop, ball-count, sound). Read from a ref. */
  onTapRemoveRef?: RefObject<((info: { x: number; y: number; color: string }) => void) | null>,
  /** Press-and-hold on a board object: opens its explainer. Read from a ref so
   *  the listeners stay wired once. */
  onEntityInfoRef?: RefObject<((hit: BoardEntityHit) => void) | null>,
  /**
   * Say why a cut was refused.
   *
   * Every refusal below used to be a bare `return`, or a console.warn the
   * player will never see. From their side the fence simply did not appear,
   * which reads as a bug rather than a rule. Read from a ref so the listeners
   * stay wired once.
   */
  onMessageRef?: RefObject<((id: GameMessageId) => void) | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasCoords = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      // Derive the CSS→physical ratio from the canvas itself rather than
      // getDevicePixelRatio(): exact under both renderers (the Pixi path runs
      // at native DPR, above the 2D path's capped ratio) and mid-DPR-ramp.
      const dpr = rect.width > 0 ? canvas.width / rect.width : getDevicePixelRatio();
      return { screenX: (e.clientX - rect.left) * dpr, screenY: (e.clientY - rect.top) * dpr };
    };

    // Press-and-hold on a superior-lock star (the persistent gold badge) opens
    // the lock explainer. The star is canvas-drawn, so hit-test the pointer in
    // world space against superior pockets whose star has already faded in.
    const HOLD_MS = 450;                 // matches the standard explainer gesture
    const STAR_HIT_RADIUS = 28;          // world units, generous for touch
    const HOLD_MOVE_SLOP = 12;           // world units; moving past this cancels
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let holdPointerId: number | null = null;
    let holdStartWorld: { x: number; y: number } | null = null;

    /**
     * What THIS device's finger is doing, as opposed to what the game state is
     * doing about it.
     *
     * The two used to be the same thing: a grab wrote game.moverDrag and the
     * move handler read the pointer id back out of it. They cannot be the same
     * thing any more. A grab is now a command, applied at the top of the next
     * frame, and in a pair the game state may be holding the OTHER player's
     * mover; neither tells this device whether its own finger is down. So the
     * pointer layer keeps its own record and the simulation keeps its own.
     */
    let gesture:
      | { kind: "mover"; pointerId: number; moverId: string }
      | { kind: "sling"; pointerId: number }
      | null = null;

    const clearHold = () => {
      if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
      holdPointerId = null;
      holdStartWorld = null;
    };

    // Nearest superior-lock star under a world point, or null. Only counts stars
    // that have finished fading in (elapsed >= SUPERIOR_LOCK_DURATION).
    const superiorStarAt = (game: CanvasGameState, world: { x: number; y: number }): boolean => {
      const now = simNow();
      for (const [, flash] of game.assimilations) {
        if (!flash.superior) continue;
        if (now - flash.startTime < SUPERIOR_LOCK_DURATION) continue;
        const dx = world.x - flash.centroid.x;
        const dy = world.y - flash.centroid.y;
        if (dx * dx + dy * dy <= STAR_HIT_RADIUS * STAR_HIT_RADIUS) return true;
      }
      return false;
    };

    const handlePointerDown = (e: PointerEvent) => {
      initAudio();

      const game = gameRef.current;
      if (!game) return;

      // Second-finger cancel, for a Redeploy pull. The same meaning the second
      // finger already has for a cut, and it must come first: a throw that
      // cannot be called off is a throw nobody dares start.
      if (game.slingDrag && gesture?.kind === "sling" && e.pointerId !== gesture.pointerId) {
        // A pull that has not been let go is still only a drawing on this
        // device, so calling it off touches nothing the other player can see.
        game.slingDrag = null;
        gesture = null;
        if (navigator.vibrate) navigator.vibrate(30);
        return;
      }

      // Second-finger cancel for a mover grab, with the meaning the second
      // finger already has everywhere else. A grab that cannot be called off is
      // a grab nobody dares start on a bumper.
      if (gesture?.kind === "mover" && e.pointerId !== gesture.pointerId) {
        // A held mover IS simulation state (the physics step drives it), so
        // letting go has to travel as a command even when it fires nothing.
        enqueueCommand(game, { kind: "moverRelease", player: LOCAL_PLAYER, cancel: true });
        gesture = null;
        if (navigator.vibrate) navigator.vibrate(30);
        return;
      }

      // Second-finger cancel: if a swipe is in progress and a different pointer comes down, cancel it
      if (game.swipeStart && game.swipePointerId !== null && e.pointerId !== game.swipePointerId) {
        game.swipeStart       = null;
        game.swipeRegionId    = null;
        game.currentSwipePos  = null;
        game.swipePointerId   = null;
        setIsPlayerDragging(false);
        if (navigator.vibrate) navigator.vibrate(30);
        return;
      }

      // Targeted ability armed (Magnet): consume this tap as the target point.
      // A tap outside the board cancels. Handled before the cut/guard logic so
      // it works during normal play regardless of active cell / region.
      if (game.armedAbility && onAbilityTargetRef?.current) {
        const c = getCanvasCoords(e);
        if (isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          onAbilityTargetRef.current(game.armedAbility, screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game)));
        } else {
          onAbilityTargetRef.current(null, null);
        }
        return;
      }

      // game.dissolve also covers the run-intro assemble: no cuts while the
      // board is still flying together (physics is held until it lands).
      if (game.gameOver || game.levelComplete || game.dissolve || game.pushMode === "prompt" || game.pushPromptPending || game.isRecovering)
        return;

      // No fence until every barrel has finished ejecting. A cut during the
      // drain would seal balls the shot is mid-way through firing, which is the
      // exact mistake the lock-inside rule fails the map for - so it is refused
      // here rather than punished there. (Before firing the loop is already
      // paused; this also covers the drain window, when it is not.)
      if (fencesBlockedByLauncher(game)) {
        onMessageRef?.current?.("launcherLoaded");
        return;
      }

      // No loot-collect branch here any more. A smashed chest grants its reward
      // on the smash (destructibles.ts), so the gem it drops is a receipt, not a
      // target - and a tap near one starts a fence like a tap anywhere else,
      // rather than being swallowed by a gem the player was not aiming for.

      // Press-and-hold opens an explainer. Checked before the cut logic so the
      // press arms a hold instead of a fence.
      //
      // A superior-lock star wins over whatever it is drawn on top of; otherwise
      // the hold explains the board object under the finger. Both share one
      // timer, so a press can only ever arm one of them.
      {
        const c = getCanvasCoords(e);
        if (isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
          const star = onSuperiorInfoRef?.current ? superiorStarAt(game, w) : null;
          const entity = star ? null : (onEntityInfoRef?.current ? boardEntityAt(game, w.x, w.y) : null);
          if (star || entity) {
            clearHold();
            holdPointerId = e.pointerId;
            holdStartWorld = w;
            holdTimer = setTimeout(() => {
              holdTimer = null;
              if (navigator.vibrate) navigator.vibrate(20);
              if (star) onSuperiorInfoRef?.current?.();
              else if (entity) onEntityInfoRef?.current?.(entity);
              clearHold();
            }, HOLD_MS);
            // Arming a hold must NOT block the cut: the player may simply be
            // starting a fence from a point that happens to sit on an obstacle,
            // and that is the common case. The fence begins as usual below; the
            // first movement past the slop cancels the hold. Only the star
            // returns early, because a star is never a place you start a cut.
            if (star) return;
          }
        }
      }

      // A press on a loaded Redeploy fence GRABS it instead of starting a cut.
      //
      // Deliberately before the fence-limit check: pulling a fence back is not
      // drawing one, and refusing the throw because a fence happens to be
      // growing elsewhere would be a rule about the wrong thing. It is also
      // ahead of the cut path because that path would refuse this press
      // anyway - a press on a fence is "wall in the way" - so the gesture
      // replaces a refusal rather than competing with a cut.
      {
        const c = getCanvasCoords(e);
        if (isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
          const sling = loadedSlingAt(game, w);
          if (sling) {
            clearHold();
            game.slingDrag = {
              wallId: sling.id, start: w, current: w, pointerId: e.pointerId,
            };
            gesture = { kind: "sling", pointerId: e.pointerId };
            return;
          }
        }
      }

      // A press on a MOVER takes hold of it (Control Freak). Placed here for
      // the same reason the sling grab is: this press would be refused by the
      // cut path anyway (a press on an obstacle is "wall in the way"), so the
      // gesture replaces a refusal rather than competing with a cut, and the
      // one control the game has stays the fence.
      //
      // The finger is the cost. While it is on a mover it is not drawing, which
      // is why the brake needs no ration of its own: holding a hazard still and
      // carving the board are the same hand.
      {
        const grabbing = activeModifiers.moverBrake > 0 || activeModifiers.moverDrive > 0;
        const c = getCanvasCoords(e);
        if (grabbing && isPointInBoard(c.screenX, c.screenY, game.boardRect)) {
          const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
          const mover = moverAt(game, w.x, w.y);
          // Refused where the finger is when someone already holds it. Solo,
          // that someone is this player's own other finger, which the
          // second-finger cancel above has already dealt with.
          if (mover && !game.moverDrag) {
            clearHold();
            gesture = { kind: "mover", pointerId: e.pointerId, moverId: mover.id };
            enqueueCommand(game, {
              kind: "moverGrab",
              player: LOCAL_PLAYER,
              moverId: mover.id,
              pointer: { ...w },
              driveMultiplier: activeModifiers.moverDrive,
              canDerail: activeModifiers.moverDerailPerMap > 0 && game.moverDerailsRemaining > 0,
              canBand: activeModifiers.moverBandPerMap > 0 && game.moverBandsRemaining > 0,
            });
            return;
          }
        }
      }

      // At the concurrent-fence limit, no new cut can start.
      if (game.activeWalls.length >= concurrentFenceLimit(game, activeModifiers)) {
        onMessageRef?.current?.("fenceLimit");
        return;
      }

      const { screenX, screenY } = getCanvasCoords(e);

      if (!isPointInBoard(screenX, screenY, game.boardRect)) return;

      const worldPos = screenToWorld(screenX, screenY, game.boardRect, boardTilt(game));

      if (!game.spaceGrid || !isPositionActive(game.spaceGrid, worldPos)) {
        if (import.meta.env.DEV) console.warn(`[cut-refused] start cell not active at (${worldPos.x | 0},${worldPos.y | 0}) - wrongly-captured cell?`);
        onMessageRef?.current?.("capturedStart");
        return;
      }

      const region = findRegionContainingPoint(game.regions, worldPos.x, worldPos.y);
      if (!region) {
        if (import.meta.env.DEV) console.warn(`[cut-refused] no region contains (${worldPos.x | 0},${worldPos.y | 0})`);
        // Same thing from the player's side as starting on captured ground:
        // there is nothing here to cut. Naming the internal difference would
        // explain the code rather than the game.
        onMessageRef?.current?.("capturedStart");
        return;
      }

      // Refuse only for walls that actually border the active region here. A fence
      // stranded in captured space (never pruned from game.walls) is invisible and
      // must not block a legal cut - see wallBlocksCutStart (ghost-wall fix).
      for (const w of game.walls) {
        if (wallBlocksCutStart(worldPos, w, game.spaceGrid)) {
          if (import.meta.env.DEV) console.warn(`[cut-refused] blocked by wall "${w.id}" at (${worldPos.x | 0},${worldPos.y | 0})`);
          onMessageRef?.current?.("wallInTheWay");
          return;
        }
      }

      game.swipeStart       = worldPos;
      game.swipeRegionId    = region.id;
      game.currentSwipePos  = worldPos;
      game.swipePath        = [{ ...worldPos }];
      game.swipePointerId   = e.pointerId;
      setIsPlayerDragging(true);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const game = gameRef.current;
      if (!game) return;

      // A superior-star hold is cancelled once the finger drifts past the slop.
      if (holdStartWorld !== null && e.pointerId === holdPointerId) {
        const c = getCanvasCoords(e);
        const w = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
        const dx = w.x - holdStartWorld.x, dy = w.y - holdStartWorld.y;
        if (dx * dx + dy * dy > HOLD_MOVE_SLOP * HOLD_MOVE_SLOP) clearHold();
      }

      // A mover under the finger. Only the pointer is written here: turning it
      // into a position on the rail is the physics step's job, so input stays
      // ignorant of rails and physics stays the only author of where a mover is.
      if (gesture?.kind === "mover" && e.pointerId === gesture.pointerId) {
        const c = getCanvasCoords(e);
        enqueueCommand(game, {
          kind: "moverMove",
          player: LOCAL_PLAYER,
          pointer: screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game)),
        });
        return;
      }

      // A Redeploy fence being pulled back. Unclamped to the board on purpose:
      // the pull is a direction and a length, and clamping it at the edge would
      // silently cap the power of a throw aimed from near the frame.
      if (game.slingDrag && gesture?.kind === "sling" && e.pointerId === gesture.pointerId) {
        const c = getCanvasCoords(e);
        game.slingDrag.current = screenToWorld(c.screenX, c.screenY, game.boardRect, boardTilt(game));
        return;
      }

      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete) return;
      if (e.pointerId !== game.swipePointerId) return;

      const { screenX, screenY } = getCanvasCoords(e);
      const worldPos = screenToWorld(screenX, screenY, game.boardRect, boardTilt(game));
      worldPos.x = Math.max(0, Math.min(BOARD_WIDTH, worldPos.x));
      worldPos.y = Math.max(0, Math.min(BOARD_HEIGHT, worldPos.y));

      game.currentSwipePos = worldPos;
      // Sample the path for bent fences (#66). Thinned by distance rather than
      // by frame: a slow drag emits a point per frame and would fill the buffer
      // with samples the simplifier throws away anyway, and a fast one on a
      // 120Hz phone would still be sampled finely enough to see its corners.
      const path = game.swipePath;
      const last = path[path.length - 1];
      if (!last || (worldPos.x - last.x) ** 2 + (worldPos.y - last.y) ** 2 >= SWIPE_SAMPLE_SPACING ** 2) {
        if (path.length < MAX_SWIPE_SAMPLES) path.push({ ...worldPos });
      }
    };

    const handlePointerUp = () => {
      const game = gameRef.current;
      if (!game) return;

      // Releasing before the hold fires cancels the star explainer (a star press
      // never set swipeStart, so the cut block below is a no-op for it).
      clearHold();

      // Let go of a mover. With a bumper fitted this fires the snap; without
      // one the mover simply stays where it was parked and resumes patrolling
      // from there.
      if (gesture?.kind === "mover") {
        gesture = null;
        enqueueCommand(game, { kind: "moverRelease", player: LOCAL_PLAYER });
        return;
      }

      // Let go of a Redeploy fence: it snaps forward and throws.
      const drag = game.slingDrag;
      if (drag && gesture?.kind === "sling") {
        game.slingDrag = null;
        gesture = null;
        enqueueCommand(game, {
          kind: "slingRelease",
          player: LOCAL_PLAYER,
          wallId: drag.wallId,
          pull: { x: drag.current.x - drag.start.x, y: drag.current.y - drag.start.y },
        });
        return;
      }

      if (
        game.swipeStart &&
        game.swipeRegionId &&
        game.currentSwipePos &&
        game.activeWalls.length < concurrentFenceLimit(game, activeModifiers) &&
        !game.gameOver &&
        !game.levelComplete &&
        !game.isRecovering &&
        game.pushMode !== "prompt" &&
        !game.pushPromptPending
      ) {
        const delta = vec2Sub(game.currentSwipePos, game.swipeStart);
        const dist  = vec2Length(delta);

        // Tappable ball (#57): a tap on a WHITE ball removes it for no points -
        // a relief valve, or the alternative to working for its big lock.
        // Checked BEFORE the freeze block (which skips white balls) and
        // regardless of freeze charges: tap-to-remove is the white ball's own
        // interaction, decided by ball type.
        if (dist < BASE_SWIPE_MIN_DISTANCE && onTapRemoveRef?.current) {
          const tap = game.swipeStart;
          let target: Ball | null = null;
          let bestDist = Infinity;
          for (const ball of game.balls) {
            if (ball.state !== "active") continue;
            if (ball.regionId !== game.swipeRegionId) continue;
            if (!isTappableBall(ball.ability)) continue;
            const d = vec2Length(vec2Sub(ball.position, tap));
            if (d <= ball.radius + FREEZE_TAP_SLOP && d < bestDist) { bestDist = d; target = ball; }
          }
          if (target) {
            // The ball is named, not described: by the time the command is
            // applied the board has moved on a frame, and "the ball nearest
            // this point" would no longer be the ball the player tapped.
            enqueueCommand(game, { kind: "tapRemove", player: LOCAL_PLAYER, ballId: target.id });
            game.swipeStart = null; game.swipeRegionId = null;
            game.currentSwipePos = null; game.swipePointerId = null;
            setIsPlayerDragging(false);
            return;
          }
        }

        // Feature Freeze: a tap (movement below the cut threshold) on a ball
        // freezes it in place. Uses are LIMITED per map (game.freezeUsesRemaining,
        // refilled each map); once spent, a claimed pickup freeze charge is the
        // fallback. The cut path below is unreachable for taps, so no conflict.
        const featureFreeze = activeModifiers.ballFreezeDuration > 0 && (game.freezeUsesRemaining ?? 0) > 0;
        const hasFreezeCharge = (game.freezeCharges ?? 0) > 0;
        if (dist < BASE_SWIPE_MIN_DISTANCE && (featureFreeze || hasFreezeCharge)) {
          // Only worth sending if it would land on something. Which ball, and
          // which of its neighbours go with it, is settled when the command is
          // applied, off state both devices share.
          if (freezeTargetAt(game, game.swipeStart, game.swipeRegionId)) {
            enqueueCommand(game, {
              kind: "freezeTap",
              player: LOCAL_PLAYER,
              at: { ...game.swipeStart },
              regionId: game.swipeRegionId,
              // A Feature Freeze use is spent before a stored charge, as it was
              // when this lived here: the per-map allowance expires with the
              // map and the charge does not.
              useCharge: !featureFreeze,
            });
          }
        } else if (dist >= BASE_SWIPE_MIN_DISTANCE) {
          // Bent fences (#66): keep the SHAPE of the drag and project only its
          // two loose ends. `bent` is null without the loadout, for a drag that
          // was straight after all, or for one the fence cannot follow (a
          // fold-back), and every one of those falls back to the straight cut
          // the swipe has always given rather than refusing the gesture.
          // The rays are cast where the command is applied, not here: both
          // devices hold the same walls at that tick and will land the fence in
          // the same place. What travels is the drag itself.
          const bent = bentDrawnPath(game);
          enqueueCommand(game, {
            kind: "cut",
            player: LOCAL_PLAYER,
            start: { ...game.swipeStart },
            end: { ...game.currentSwipePos },
            path: bent ? bent.map(p => ({ ...p })) : null,
            regionId: game.swipeRegionId,
            fenceTypeId: game.selectedFenceTypeId ?? STANDARD_FENCE_ID,
          });
        }
      }

      game.swipeStart       = null;
      game.swipeRegionId    = null;
      game.currentSwipePos  = null;
      game.swipePointerId   = null;
      setIsPlayerDragging(false);
    };

    canvas.addEventListener("pointerdown",  handlePointerDown);
    canvas.addEventListener("pointermove",  handlePointerMove);
    canvas.addEventListener("pointerup",    handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);

    return () => {
      clearHold();
      canvas.removeEventListener("pointerdown",  handlePointerDown);
      canvas.removeEventListener("pointermove",  handlePointerMove);
      canvas.removeEventListener("pointerup",    handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
    };
    // canvasRef.current is intentional: re-attach listeners if the canvas
    // element is replaced (e.g. HMR). The ref object itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef.current, activeModifiers.instantFencesPerMap, activeModifiers.ballFreezeDuration, activeModifiers.ballFreezeCount, activeModifiers.freezeNoCooldown, onAbilityTargetRef, onSuperiorInfoRef, onTapRemoveRef]);
}
