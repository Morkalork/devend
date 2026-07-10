import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import { calculateScore } from "@/lib/scoring";
import { playDeathSound } from "@/lib/gameAudio";
import { vibrateDeath } from "@/lib/gameHaptics";
import { polygonArea } from "@/lib/polygon";
import { getRemainingPercent } from "@/lib/spaceGrid";

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
    // Fold lock + push bonuses in before the cap (issue #43).
    const { levelScore, breakdown } = calculateScore(
      game.wallCount, level.expectedCuts, pushStartPercent,
      level.sizeThreshold, level.points, activeModifiers.scoreMultiplier, levelNumber,
      game.lockBonus + pushBonus, activeModifiers.spaceBonusMultiplier,
      activeModifiers.overtimeCapBonus,
    );

    callbacks.onLevelComplete({
      levelNumber, levelId: level.id, cutCount: game.wallCount,
      expectedCuts: level.expectedCuts, basePoints: level.points,
      levelScore,
      remainingPercent: percent, overcutBonus: 0,
      thresholdPercent: level.sizeThreshold, pushFailed: true, pushBonus,
      underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
      spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
      fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
      extraPercent: breakdown.extraPercent, lockBonus: game.lockBonus,
      lockedBallsCount: game.lockedBallsCount,
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
      cutCount: game.wallCount, expectedCuts: level.expectedCuts, basePoints: level.points,
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
  // Fold lock + push bonuses in before the cap (issue #43).
  const { levelScore, breakdown } = calculateScore(
    game.wallCount, level.expectedCuts, game.pushStartPercent ?? percent,
    level.sizeThreshold, level.points, activeModifiers.scoreMultiplier, levelNumber,
    game.lockBonus + pushBonus, activeModifiers.spaceBonusMultiplier,
    activeModifiers.overtimeCapBonus,
  );

  callbacks.onLevelComplete({
    levelNumber, levelId: level.id, cutCount: game.wallCount,
    expectedCuts: level.expectedCuts, basePoints: level.points,
    levelScore,
    remainingPercent: percent, overcutBonus: 0,
    thresholdPercent: level.sizeThreshold, pushFailed: true, pushBonus,
    underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
    spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
    fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
    extraPercent: breakdown.extraPercent, lockBonus: game.lockBonus,
    lockedBallsCount: game.lockedBallsCount,
  });
  callbacks.startDissolve(() => {}, 'rgba(160, 0, 0, 0.55)');
}
