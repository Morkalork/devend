/**
 * useGameInput — attaches pointer event listeners to the game canvas.
 *
 * All three handlers operate directly on the mutable CanvasGameState ref;
 * they produce no React state changes except for the two UI setters.
 */

import { useEffect, RefObject } from "react";
import { CanvasGameState } from "@/types/gameState";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GrowingWall } from "@/types/game";
import {
  vec2Sub,
  vec2Length,
  vec2Normalize,
  pointToSegmentDistance,
} from "@/lib/polygon";
import { WALL_THICKNESS, castRayWithReflections } from "@/lib/wallGeometry";
import {
  BASE_SWIPE_MIN_DISTANCE,
} from "@/lib/gameConstants";
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  screenToWorld,
  isPointInBoard,
} from "@/lib/boardConstants";
import { isPositionActive } from "@/lib/spaceGrid";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { initAudio } from "@/lib/gameAudio";

export function useGameInput(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  gameRef: RefObject<CanvasGameState | null>,
  activeModifiers: GameModifiers,
  setCutCount: (n: number) => void,
  setIsPlayerDragging: (v: boolean) => void,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasCoords = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.round(window.devicePixelRatio || 1);
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

      if (game.gameOver || game.levelComplete || game.activeWall || game.pushMode === "prompt" || game.isRecovering)
        return;

      const { screenX, screenY } = getCanvasCoords(e);

      if (!isPointInBoard(screenX, screenY, game.boardRect)) return;

      const worldPos = screenToWorld(screenX, screenY, game.boardRect);

      if (!game.spaceGrid || !isPositionActive(game.spaceGrid, worldPos)) return;

      const region = findRegionContainingPoint(game.regions, worldPos.x, worldPos.y);
      if (!region) return;

      for (const w of game.walls) {
        const dist = pointToSegmentDistance(worldPos, w.start, w.end);
        if (dist < w.thickness * 2) return;
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
        !game.activeWall &&
        !game.gameOver &&
        !game.levelComplete &&
        !game.isRecovering &&
        game.pushMode !== "prompt"
      ) {
        const delta = vec2Sub(game.currentSwipePos, game.swipeStart);
        const dist  = vec2Length(delta);

        if (dist >= BASE_SWIPE_MIN_DISTANCE) {
          const direction = vec2Normalize(delta);
          const negDir    = { x: -direction.x, y: -direction.y };
          const forwardResult  = castRayWithReflections(game.swipeStart, direction, game.walls);
          const backwardResult = castRayWithReflections(game.swipeStart, negDir, game.walls);

          if (forwardResult && backwardResult) {
            const endWaypoints   = forwardResult.waypoints;
            const startWaypoints = backwardResult.waypoints;
            const targetEnd      = endWaypoints[endWaypoints.length - 1];
            const targetStart    = startWaypoints[startWaypoints.length - 1];

            game.wallCount += 1;
            setCutCount(game.wallCount);

            const isInstant = game.wallCount <= activeModifiers.instantFencesPerMap;

            game.activeWall = {
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
            } as GrowingWall;
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
  }, [canvasRef.current, activeModifiers.instantFencesPerMap]);
}
