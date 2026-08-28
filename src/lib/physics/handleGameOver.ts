import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import { calculateScore, getShipEarlyPercent } from "@/lib/scoring";
import { readLockAxes } from "@/lib/lockCapacity";
import { effectivePar } from "@/lib/par";
import { isTimingExempt } from "@/lib/mapTiming";
import { playDeathSound } from "@/lib/gameAudio";
import { vibrateDeath } from "@/lib/gameHaptics";
import { polygonArea } from "@/lib/polygon";
import { getRemainingPercent } from "@/lib/spaceGrid";
import type { MapFailure } from "@/lib/mapFailure";

export function getCombinedArea(game: CanvasGameState): number {
  if (game.spaceGrid) {
    let activeCount = 0;
    for (let i = 0; i < game.spaceGrid.cells.length; i++) {
      if (game.spaceGrid.cells[i] === 0) activeCount++;
    }
    return activeCount * game.spaceGrid.cellSize * game.spaceGrid.cellSize;
  }
  return game.regions.reduce((sum, r) => sum + (r.estimatedArea ?? polygonArea(r.polygon)), 0);
}

export function handleGameOverFn(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  callbacks: GameCallbacks,
  /**
   * Why the map was lost, when the caller knows. Optional because the ordinary
   * death (a ball through your fence) is a hazard the player watched happen and
   * needs no sentence; every WIN-CONDITION failure passes one, and the result
   * screen says so rather than showing a bare GAME OVER.
   */
  failure?: MapFailure,
): void {
  game.gameOver = true;
  playDeathSound();
  vibrateDeath();
  const percent = Math.round((getCombinedArea(game) / game.originalArea) * 100);

  if (game.pushMode === "pushing") {
    const pushStartPercent = game.bestRemainingPercent;
    const areaAtPushStart = game.pushStartPercent ?? pushStartPercent;
    const areaCleared = Math.max(0, areaAtPushStart - percent);
    const chunkSize = areaAtPushStart * 0.25;
    const pushBonus = chunkSize > 0
      ? Math.round(Math.floor(areaCleared / chunkSize) * activeModifiers.pushBonusMultiplier)
      : 0;
    // Ship Early: the threshold was met before the push began, so the earned
    // tempo bonus survives a failed push (pushing is never taxed). Disabled on
    // the tutorial band (levels 1-3).
    const shipEarlyPercent = isTimingExempt(levelNumber)
      ? 0
      : getShipEarlyPercent(game.clearedActiveSeconds, game.balls.length, activeModifiers.shipEarlySecondsPerBall);
    // Fold lock + push in before the cap (issue #43); ship-early pays a percent
    // above the cap (the tempo bonus survives a failed push, never taxed).
    const { levelScore, breakdown, shipEarlyBonus } = calculateScore(
      game.wallCount, effectivePar(level.expectedCuts, activeModifiers), pushStartPercent, level.sizeThreshold, level.points, {
        scoreMultiplier: activeModifiers.scoreMultiplier,
      underParBonusMultiplier: activeModifiers.underParBonusMultiplier,
        locks: readLockAxes(game),
        tempoCeilingMultiplier: activeModifiers.shipEarlyBonusMultiplier,
      greedBonus: pushBonus,
        spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
        flatBonus: activeModifiers.overtimeCapBonus,
        shipEarlyPercent,
      },
    );

    callbacks.onLevelComplete({
      levelNumber, levelId: level.id, cutCount: game.wallCount,
      expectedCuts: effectivePar(level.expectedCuts, activeModifiers), basePoints: level.points,
      levelScore,
      remainingPercent: percent, overcutBonus: 0,
      thresholdPercent: level.sizeThreshold, pushFailed: true, pushBonus,
      underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
      spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
      fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
      extraPercent: breakdown.extraPercent, axes: breakdown.axes, lockBonus: game.lockBonus,
      lockedBallsCount: game.lockedBallsCount,
      superiorLockCount: game.superiorLockCount, superiorLockBonus: game.superiorLockBonus,
      shipEarlyBonus, clearTimeSeconds: game.clearedActiveSeconds ?? undefined,
      pickupsClaimed: (game.pickupsClaimedLog && game.pickupsClaimedLog.length > 0) ? [...game.pickupsClaimedLog] : undefined,
    });
    callbacks.startDissolve(() => {}, 'rgba(160, 0, 0, 0.55)');
    return;
  }

  if (callbacks.flashTimeoutRef.current) clearTimeout(callbacks.flashTimeoutRef.current);
  if (callbacks.shakeTimeoutRef.current) clearTimeout(callbacks.shakeTimeoutRef.current);
  callbacks.setScreenFlash("red");
  callbacks.setIsShaking(true);

  callbacks.shakeTimeoutRef.current = setTimeout(() => {
    callbacks.shakeTimeoutRef.current = null;
    callbacks.setScreenFlash("none");
    callbacks.setIsShaking(false);
    callbacks.onGameEnd({
      isWin: false, remainingPercent: percent, levelId: level.id, levelNumber,
      cutCount: game.wallCount, expectedCuts: effectivePar(level.expectedCuts, activeModifiers), basePoints: level.points,
      failure,
    });
  }, 1000);
}

export function handlePushFailedFn(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  callbacks: GameCallbacks,
): void {
  game.gameOver = true;
  const percent = Math.round((getCombinedArea(game) / game.originalArea) * 100);

  const areaAtPushStart = game.pushStartPercent ?? percent;
  const areaCleared = Math.max(0, areaAtPushStart - percent);
  const chunkSize = areaAtPushStart * 0.25;
  const pushBonus = chunkSize > 0
    ? Math.round(Math.floor(areaCleared / chunkSize) * activeModifiers.pushBonusMultiplier)
    : 0;
  // Ship Early: threshold met before the push, so the bonus survives the fail
  // (disabled on the tutorial band, levels 1-3).
  const shipEarlyPercent = isTimingExempt(levelNumber)
    ? 0
    : getShipEarlyPercent(game.clearedActiveSeconds, game.balls.length, activeModifiers.shipEarlySecondsPerBall);
  // Fold lock + push in before the cap (issue #43); ship-early pays a percent
  // above the cap (the tempo bonus survives a failed push, never taxed).
  const { levelScore, breakdown, shipEarlyBonus } = calculateScore(
    game.wallCount, effectivePar(level.expectedCuts, activeModifiers), game.pushStartPercent ?? percent, level.sizeThreshold, level.points, {
      scoreMultiplier: activeModifiers.scoreMultiplier,
      underParBonusMultiplier: activeModifiers.underParBonusMultiplier,
      locks: readLockAxes(game),
        tempoCeilingMultiplier: activeModifiers.shipEarlyBonusMultiplier,
      greedBonus: pushBonus,
      spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
      flatBonus: activeModifiers.overtimeCapBonus,
      shipEarlyPercent,
    },
  );

  callbacks.onLevelComplete({
    levelNumber, levelId: level.id, cutCount: game.wallCount,
    expectedCuts: effectivePar(level.expectedCuts, activeModifiers), basePoints: level.points,
    levelScore,
    remainingPercent: percent, overcutBonus: 0,
    thresholdPercent: level.sizeThreshold, pushFailed: true, pushBonus,
    underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
    spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
    fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
    extraPercent: breakdown.extraPercent, axes: breakdown.axes, lockBonus: game.lockBonus,
    lockedBallsCount: game.lockedBallsCount,
    superiorLockCount: game.superiorLockCount, superiorLockBonus: game.superiorLockBonus,
    shipEarlyBonus, clearTimeSeconds: game.clearedActiveSeconds ?? undefined,
    pickupsClaimed: (game.pickupsClaimedLog && game.pickupsClaimedLog.length > 0) ? [...game.pickupsClaimedLog] : undefined,
  });
  callbacks.startDissolve(() => {}, 'rgba(160, 0, 0, 0.55)');
}
