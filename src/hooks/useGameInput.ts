/**
 * useGameInput — attaches pointer event listeners to the game canvas.
 *
 * All three handlers operate directly on the mutable CanvasGameState ref;
 * they produce no React state changes except for the two UI setters.
 */

import { useEffect, RefObject } from "react";
import { CanvasGameState } from "@/types/gameState";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { Ball, GrowingWall } from "@/types/game";
import {
  vec2Sub,
  vec2Length,
  vec2Normalize,
} from "@/lib/polygon";
import { WALL_THICKNESS, castRayWithReflections } from "@/lib/wallGeometry";
import {
  BASE_SWIPE_MIN_DISTANCE,
  FREEZE_COOLDOWN_MULTIPLIER,
  FREEZE_TAP_SLOP,
} from "@/lib/gameConstants";
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
import { abilityFenceRushFactor } from "@/lib/abilityEffects";
import { initAudio } from "@/lib/gameAudio";

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

    const handlePointerDown = (e: PointerEvent) => {
      initAudio();

      const game = gameRef.current;
      if (!game) return;

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
          onAbilityTargetRef.current(game.armedAbility, screenToWorld(c.screenX, c.screenY, game.boardRect));
        } else {
          onAbilityTargetRef.current(null, null);
        }
        return;
      }

      // game.dissolve also covers the run-intro assemble: no cuts while the
      // board is still flying together (physics is held until it lands).
      if (game.gameOver || game.levelComplete || game.dissolve || game.pushMode === "prompt" || game.pushPromptPending || game.isRecovering)
        return;
      // At the concurrent-fence limit, no new cut can start.
      if (game.activeWalls.length >= concurrentFenceLimit(game, activeModifiers)) return;

      const { screenX, screenY } = getCanvasCoords(e);

      if (!isPointInBoard(screenX, screenY, game.boardRect)) return;

      const worldPos = screenToWorld(screenX, screenY, game.boardRect);

      if (!game.spaceGrid || !isPositionActive(game.spaceGrid, worldPos)) {
        if (import.meta.env.DEV) console.warn(`[cut-refused] start cell not active at (${worldPos.x | 0},${worldPos.y | 0}) - wrongly-captured cell?`);
        return;
      }

      const region = findRegionContainingPoint(game.regions, worldPos.x, worldPos.y);
      if (!region) {
        if (import.meta.env.DEV) console.warn(`[cut-refused] no region contains (${worldPos.x | 0},${worldPos.y | 0})`);
        return;
      }

      // Refuse only for walls that actually border the active region here. A fence
      // stranded in captured space (never pruned from game.walls) is invisible and
      // must not block a legal cut - see wallBlocksCutStart (ghost-wall fix).
      for (const w of game.walls) {
        if (wallBlocksCutStart(worldPos, w, game.spaceGrid)) {
          if (import.meta.env.DEV) console.warn(`[cut-refused] blocked by wall "${w.id}" at (${worldPos.x | 0},${worldPos.y | 0})`);
          return;
        }
      }

      game.swipeStart       = worldPos;
      game.swipeRegionId    = region.id;
      game.currentSwipePos  = worldPos;
      game.swipePointerId   = e.pointerId;
      setIsPlayerDragging(true);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const game = gameRef.current;
      if (!game) return;
      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete) return;
      if (e.pointerId !== game.swipePointerId) return;

      const { screenX, screenY } = getCanvasCoords(e);
      const worldPos = screenToWorld(screenX, screenY, game.boardRect);
      worldPos.x = Math.max(0, Math.min(BOARD_WIDTH, worldPos.x));
      worldPos.y = Math.max(0, Math.min(BOARD_HEIGHT, worldPos.y));

      game.currentSwipePos = worldPos;
    };

    const handlePointerUp = () => {
      const game = gameRef.current;
      if (!game) return;

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

        // Feature Freeze: a tap (movement below the cut threshold) on a ball
        // freezes it in place. Uses are LIMITED per map (game.freezeUsesRemaining,
        // refilled each map); once spent, a claimed pickup freeze charge is the
        // fallback. The cut path below is unreachable for taps, so no conflict.
        const featureFreeze = activeModifiers.ballFreezeDuration > 0 && (game.freezeUsesRemaining ?? 0) > 0;
        const hasFreezeCharge = (game.freezeCharges ?? 0) > 0;
        if (dist < BASE_SWIPE_MIN_DISTANCE && (featureFreeze || hasFreezeCharge)) {
          const tap = game.swipeStart;
          const now = performance.now();
          let target: Ball | null = null;
          let bestDist = Infinity;
          for (const ball of game.balls) {
            if (ball.state !== "active") continue;
            if (ball.regionId !== game.swipeRegionId) continue;
            if (ball.frozenUntil && now < ball.frozenUntil) continue;        // already frozen
            if (ball.freezeReadyAt && now < ball.freezeReadyAt) continue;    // on cooldown
            const d = vec2Length(vec2Sub(ball.position, tap));
            if (d <= ball.radius + FREEZE_TAP_SLOP && d < bestDist) {
              bestDist = d;
              target = ball;
            }
          }
          if (target) {
            // Spend a Feature Freeze use if one is available this map, else a
            // claimed pickup freeze charge.
            if (featureFreeze) { game.freezeUsesRemaining -= 1; setFreezeUsesRemaining(game.freezeUsesRemaining); }
            else game.freezeCharges -= 1;
            const durationMs = (featureFreeze
              ? activeModifiers.ballFreezeDuration
              : game.freezeChargeSeconds || 3) * 1000;
            // Cascade Freeze: a single tap also freezes the nearest eligible
            // balls in the region (the tapped ball plus `ballFreezeCount` more).
            const freezeCount = 1 + Math.max(0, Math.round(activeModifiers.ballFreezeCount));
            const eligible = game.balls.filter(b =>
              b.state === "active" &&
              b.regionId === game.swipeRegionId &&
              !(b.frozenUntil && now < b.frozenUntil) &&
              !(b.freezeReadyAt && now < b.freezeReadyAt)
            );
            eligible.sort((a, b) =>
              vec2Length(vec2Sub(a.position, target!.position)) -
              vec2Length(vec2Sub(b.position, target!.position))
            );
            for (const ball of eligible.slice(0, freezeCount)) {
              ball.frozenUntil   = now + durationMs;
              // Absolute Zero (freeze set bonus): no re-freeze cooldown, the
              // ball is tappable again the moment it thaws.
              ball.freezeReadyAt = activeModifiers.freezeNoCooldown > 0
                ? now + durationMs
                : now + durationMs * (1 + FREEZE_COOLDOWN_MULTIPLIER);
            }
            if (navigator.vibrate) navigator.vibrate(20);
          }
        } else if (dist >= BASE_SWIPE_MIN_DISTANCE) {
          const direction = vec2Normalize(delta);
          const negDir    = { x: -direction.x, y: -direction.y };
          const forwardResult  = castRayWithReflections(game.swipeStart, direction, game.walls);
          const backwardResult = castRayWithReflections(game.swipeStart, negDir, game.walls);

          if (forwardResult && backwardResult) {
            const endWaypoints   = forwardResult.waypoints;
            const startWaypoints = backwardResult.waypoints;
            const targetEnd      = endWaypoints[endWaypoints.length - 1];
            const targetStart    = startWaypoints[startWaypoints.length - 1];

            // Issue #38: you can't fence against a breakable structure — if the
            // cut would anchor on one, it "duds" (no wall, brief feedback).
            if (cutAnchorsBreakable(game, targetStart, targetEnd, WALL_THICKNESS + 6)) {
              game.lastDudAt = performance.now();
              if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
              game.swipeStart = null;
              game.swipeRegionId = null;
              game.currentSwipePos = null;
              game.swipePointerId = null;
              setIsPlayerDragging(false);
              return;
            }

            game.wallCount += 1;
            setCutCount(game.wallCount);

            const isInstant = game.wallCount <= activeModifiers.instantFencesPerMap;

            game.activeWalls.push({
              origin:             { ...game.swipeStart },
              direction,
              startWaypoints,
              endWaypoints,
              startSegmentIndex:  isInstant ? startWaypoints.length - 2 : 0,
              endSegmentIndex:    isInstant ? endWaypoints.length - 2 : 0,
              startPoint:         isInstant ? { ...targetStart   } : { ...game.swipeStart },
              endPoint:           isInstant ? { ...targetEnd     } : { ...game.swipeStart },
              targetStart,
              targetEnd,
              thickness:          WALL_THICKNESS,
              isComplete:         isInstant,
              activeRegionId:     game.swipeRegionId!,
              startTime:          isInstant ? undefined : performance.now(),
            } as GrowingWall);

            // Issue #35: record the swipe gesture so it can be drawn as a brief
            // fading afterglow, connecting the drawn fence to the player's input.
            game.swipeTrail = {
              start:     { ...game.swipeStart },
              end:       { ...game.currentSwipePos },
              createdAt: performance.now(),
            };
          }
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
      canvas.removeEventListener("pointerdown",  handlePointerDown);
      canvas.removeEventListener("pointermove",  handlePointerMove);
      canvas.removeEventListener("pointerup",    handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
    };
    // canvasRef.current is intentional: re-attach listeners if the canvas
    // element is replaced (e.g. HMR). The ref object itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef.current, activeModifiers.instantFencesPerMap, activeModifiers.ballFreezeDuration, activeModifiers.ballFreezeCount, activeModifiers.freezeNoCooldown, onAbilityTargetRef]);
}
