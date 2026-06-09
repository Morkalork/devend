import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useLevelManager } from './useLevelManager';
import { useUpgradeManager } from './useUpgradeManager';
import { useActiveModifiers, mergeBonuses } from './useActiveModifiers';
import { useTutorialManager } from './useTutorialManager';
import { useCheckpoint } from './useCheckpoint';
import { useCheckpointManager } from './useCheckpointManager';
import { useCertificateManager } from './useCertificateManager';
import { useMetaProgression } from './useMetaProgression';
import { useAchievementManager } from './useAchievementManager';
import { useGameState } from './useGameState';
import { GameResult, LevelScoreData } from '@/types/game';
import { Certificate } from '@/types/certificate';

const BASE_LIVES = 3;

export function useGameSession(nav: ReturnType<typeof useGameState>) {
  const {
    currentLevel,
    currentLevelIndex,
    totalLevels,
    isLastLevel,
    isLoading: isLoadingLevels,
    error: levelError,
    loadLevels,
    advanceToNextLevel,
    resetToFirstLevel,
    setLevelIndex,
  } = useLevelManager();

  const {
    upgrades,
    isLoading: isLoadingUpgrades,
    error: upgradeError,
    loadUpgrades,
    canPurchase: canPurchaseUpgrade,
    isLocked: isUpgradeLocked,
  } = useUpgradeManager();

  const isLoading = isLoadingLevels || isLoadingUpgrades;
  const error = levelError || upgradeError;

  const [totalScore, setTotalScore] = useState(0);
  const [pendingLevelScore, setPendingLevelScore] = useState<LevelScoreData | null>(null);
  const [showLevelComplete, setShowLevelComplete] = useState(false);
  const [ownedUpgradeIds, setOwnedUpgradeIds] = useState<string[]>([]);
  const [currentLives, setCurrentLives] = useState(BASE_LIVES);
  const [livesAtLevelStart, setLivesAtLevelStart] = useState(BASE_LIVES);
  const [cumulativeLockedBalls, setCumulativeLockedBalls] = useState(0);
  const [shopUnlockedCerts, setShopUnlockedCerts] = useState<Certificate[]>([]);
  const [pendingCertUnlocks, setPendingCertUnlocks] = useState<Certificate[]>([]);

  const handleAugmentPointEarned = useCallback(() => {
    // Visual flash handled by consumer; cert manager calls this on point award
  }, []);

  const {
    certificates,
    totalAugmentPoints,
    certLevelsOwned,
    unlockedCertIds,
    maxTierCounts,
    runLevelsCompleted,
    runPointsEarned: runPointsAwarded,
    loadCertificates,
    resetRunProgress,
    incrementRunLevel,
    finalizeRun,
    runProgress,
    certBonuses,
    getCertStartingLevel,
    purchaseCertLevel,
    recordMaxTierPurchase,
    checkAchievementUnlocks,
    takePendingUnlocks,
    resetAllData: resetCertData,
  } = useCertificateManager({ onPointEarned: handleAugmentPointEarned });

  const {
    shouldShowFence,
    shouldShowStore,
    shouldShowAugment,
    shouldShowMover,
    shouldShowInfoPanels,
    markFenceSeen,
    markStoreSeen,
    markAugmentSeen,
    markMoverSeen,
    markInfoPanelsSeen,
    resetAllTutorials,
  } = useTutorialManager();

  const {
    saveCheckpoint,
    clearCheckpoint,
    getStartingLevel,
    getRemainingTimeMs,
  } = useCheckpoint();

  const {
    saveCheckpoint: saveRunCheckpoint,
    clearCheckpoints: clearRunCheckpoints,
  } = useCheckpointManager();

  const {
    stats: metaStats,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    resetProgression,
  } = useMetaProgression();

  const {
    achievements,
    completedIds: completedAchievementIds,
    activatedIds: activatedAchievementIds,
    bonusModifiers: achievementBonuses,
    checkAndComplete: checkAndCompleteAchievements,
    activateAchievement,
  } = useAchievementManager();

  const mergedBonuses = useMemo(() => mergeBonuses(achievementBonuses, certBonuses), [achievementBonuses, certBonuses]);
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, mergedBonuses);

  const certSourceIds = useMemo(
    () => new Set(certificates.map(c => c.sourceUpgradeId).filter((id): id is string => id != null)),
    [certificates]
  );

  const handleStartGame = useCallback(async (forceLevel?: number) => {
    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
      loadCertificates(),
    ]);

    if (levelsSuccess && upgradesSuccess) {
      setTotalScore(0);
      setPendingLevelScore(null);
      setShowLevelComplete(false);
      setOwnedUpgradeIds([]);
      resetRunProgress();

      const certBonusLives = (certBonuses.extraLives as number | undefined) ?? 0;
      const startingLives = BASE_LIVES + certBonusLives;
      setCurrentLives(startingLives);
      setLivesAtLevelStart(startingLives);

      if (forceLevel !== undefined) {
        setLevelIndex(forceLevel - 1);
      } else {
        const checkpointLevel = getStartingLevel();
        const certStartLevel = getCertStartingLevel();
        const queryLevel = parseInt(new URLSearchParams(window.location.search).get('level') || '0', 10);
        if (queryLevel > 0) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        const startingLevel = Math.max(checkpointLevel, certStartLevel, queryLevel || 0);
        if (startingLevel > 1) {
          setLevelIndex(startingLevel - 1);
        } else {
          resetToFirstLevel();
        }
      }

      nav.startGame();
    }
  }, [loadLevels, loadUpgrades, loadCertificates, nav.startGame, getStartingLevel, setLevelIndex, resetToFirstLevel, certBonuses, getCertStartingLevel, resetRunProgress]);

  const handleGameEnd = useCallback((result: GameResult) => {
    if (!result.isWin) {
      saveCheckpoint(result.levelNumber);
    } else if (result.completedAllLevels) {
      clearCheckpoint();
    }
    finalizeRun();
    nav.endGame({ ...result, totalScore });
  }, [nav.endGame, totalScore, saveCheckpoint, clearCheckpoint, finalizeRun]);

  const handleLivesChange = useCallback((newLives: number) => {
    const livesLost = currentLives - newLives;
    if (livesLost > 0) recordLivesLost(livesLost);
    setCurrentLives(newLives);
  }, [currentLives, recordLivesLost]);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    const currentLevelNum = currentLevelIndex + 1;
    recordLevelReached(currentLevelNum);
    recordFencesDrawn(scoreData.cutCount || 0);
    incrementRunLevel();

    if (currentLives >= livesAtLevelStart) recordPerfectLevel();

    const projectedStats = {
      highestLevelReached: Math.max(metaStats.highestLevelReached, currentLevelNum),
      totalFencesDrawn: metaStats.totalFencesDrawn + (scoreData.cutCount || 0),
      totalLevelsCompletedWithoutLoss:
        currentLives >= livesAtLevelStart
          ? metaStats.totalLevelsCompletedWithoutLoss + 1
          : metaStats.totalLevelsCompletedWithoutLoss,
      totalLivesLost: metaStats.totalLivesLost,
    };
    checkAndCompleteAchievements(projectedStats);

    const levelOvertime = scoreData.levelScore;
    const interestGain = activeModifiers.scoreInterestRate > 0
      ? Math.min(8, Math.floor(totalScore * activeModifiers.scoreInterestRate))
      : 0;

    setTotalScore(totalScore + levelOvertime + interestGain);
    setPendingLevelScore({ ...scoreData, levelScore: levelOvertime, tierMultiplier: 1, interestGain });
    setShowLevelComplete(true);

    if (scoreData.lockedBallsCount && scoreData.lockedBallsCount > 0) {
      setCumulativeLockedBalls(prev => prev + scoreData.lockedBallsCount!);
    }

    setLivesAtLevelStart(currentLives);
  }, [totalScore, currentLevelIndex, recordLevelReached, recordFencesDrawn, recordPerfectLevel, currentLives, livesAtLevelStart, incrementRunLevel, activeModifiers.scoreInterestRate, checkAndCompleteAchievements, metaStats]);

  const handleContinueFromOverlay = useCallback(() => {
    setShowLevelComplete(false);
    setPendingCertUnlocks([]);
    if (isLastLevel) {
      nav.endGame({
        isWin: true,
        remainingPercent: pendingLevelScore?.remainingPercent || 0,
        levelId: currentLevel?.id || '',
        levelNumber: currentLevelIndex + 1,
        completedAllLevels: true,
        totalScore,
        levelScore: pendingLevelScore?.levelScore,
        cutCount: pendingLevelScore?.cutCount,
        expectedCuts: pendingLevelScore?.expectedCuts,
        basePoints: pendingLevelScore?.basePoints,
      });
      setPendingLevelScore(null);
    } else {
      nav.goToUpgradeShop();
    }
  }, [isLastLevel, nav.endGame, nav.goToUpgradeShop, currentLevel, currentLevelIndex, totalScore, pendingLevelScore]);

  const handlePurchaseUpgrade = useCallback((upgradeId: string, price: number) => {
    setTotalScore(prev => prev - price);
    setOwnedUpgradeIds(prev => [...prev, upgradeId]);

    const upgrade = upgrades.find(u => u.id === upgradeId);
    const extraLives = upgrade?.modifiers?.extraLives;
    if (extraLives && typeof extraLives === 'number') {
      setCurrentLives(prev => prev + extraLives);
    }

    if (certSourceIds.has(upgradeId)) {
      const unlocks = recordMaxTierPurchase(upgradeId);
      if (unlocks.length > 0) setShopUnlockedCerts(prev => [...prev, ...unlocks]);
    }
  }, [upgrades, certSourceIds, recordMaxTierPurchase]);

  const handleContinueFromShop = useCallback(() => {
    const nextLevelNumber = currentLevelIndex + 2;
    if (nextLevelNumber % 5 === 0) {
      saveRunCheckpoint({ level: nextLevelNumber, totalScore, ownedUpgradeIds, lives: currentLives, savedAt: Date.now() });
    }
    const pendingUnlocks = takePendingUnlocks();
    if (pendingUnlocks.length > 0) setPendingCertUnlocks(pendingUnlocks);
    setShopUnlockedCerts([]);
    setPendingLevelScore(null);
    advanceToNextLevel();
    nav.goToGame();
  }, [currentLevelIndex, totalScore, ownedUpgradeIds, currentLives, saveRunCheckpoint, advanceToNextLevel, nav.goToGame, takePendingUnlocks]);

  const handlePurchaseCertLevel = useCallback((certId: string, targetLevel: number) => {
    purchaseCertLevel(certId, targetLevel);
  }, [purchaseCertLevel]);

  const handlePlayAgain = useCallback((startLevel?: number) => {
    setTotalScore(0);
    setOwnedUpgradeIds([]);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setCumulativeLockedBalls(0);
    resetRunProgress();

    const certBonusLives = certBonuses.extraLives ?? 0;
    const startingLives = BASE_LIVES + certBonusLives;
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);

    if (startLevel !== undefined) {
      setLevelIndex(startLevel - 1);
    } else {
      clearRunCheckpoints();
      const checkpointLevel = getStartingLevel();
      const certStartLevel = getCertStartingLevel();
      const level = Math.max(checkpointLevel, certStartLevel);
      if (level > 1) {
        setLevelIndex(level - 1);
      } else {
        resetToFirstLevel();
      }
    }

    nav.startGame();
  }, [resetToFirstLevel, nav.startGame, getStartingLevel, setLevelIndex, certBonuses, getCertStartingLevel, resetRunProgress, clearRunCheckpoints]);

  const handleBackToWelcome = useCallback(() => {
    resetToFirstLevel();
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setOwnedUpgradeIds([]);
    setCurrentLives(BASE_LIVES);
    resetRunProgress();
    nav.goToWelcome();
  }, [resetToFirstLevel, nav.goToWelcome, resetRunProgress]);

  const handleAugmentsFromWelcome = useCallback(async () => {
    await loadCertificates();
    nav.goToAugmentStore();
  }, [loadCertificates, nav.goToAugmentStore]);

  const handleReEnableAllTutorials = useCallback(() => {
    resetAllTutorials();
  }, [resetAllTutorials]);

  const handleResetAugments = useCallback(() => {
    resetCertData();
    resetProgression();
  }, [resetCertData, resetProgression]);

  // Sync completed achievements into cert manager for achievement-locked certs
  useEffect(() => {
    if (completedAchievementIds.length > 0) {
      checkAchievementUnlocks(completedAchievementIds);
    }
  }, [completedAchievementIds, checkAchievementUnlocks]);

  // Auto-start when ?level= query param is present
  const levelQueryHandled = useRef(false);
  useEffect(() => {
    if (levelQueryHandled.current) return;
    const levelParam = new URLSearchParams(window.location.search).get('level');
    if (levelParam && parseInt(levelParam, 10) > 0) {
      levelQueryHandled.current = true;
      handleStartGame();
    }
  }, [handleStartGame]);

  return {
    // Level state
    currentLevel,
    currentLevelIndex,
    totalLevels,
    // Loading
    isLoading,
    error,
    // Run state
    totalScore,
    currentLives,
    ownedUpgradeIds,
    showLevelComplete,
    pendingLevelScore,
    cumulativeLockedBalls,
    // Upgrades
    upgrades,
    canPurchaseUpgrade,
    isUpgradeLocked,
    // Tutorial flags
    showInGameTutorial: shouldShowFence,
    shouldShowStore,
    shouldShowAugment,
    showMoverTutorial: shouldShowMover,
    showInfoPanelsTutorial: shouldShowInfoPanels,
    markFenceSeen,
    markStoreSeen,
    markAugmentSeen,
    markMoverSeen,
    markInfoPanelsSeen,
    // Certificates
    certificates,
    totalAugmentPoints,
    certLevelsOwned,
    unlockedCertIds,
    maxTierCounts,
    shopUnlockedCerts,
    pendingCertUnlocks,
    // Achievements
    achievements,
    completedAchievementIds,
    activatedAchievementIds,
    activateAchievement,
    // Meta progression
    metaStats,
    runPointsAwarded,
    runLevelsCompleted,
    // Modifiers / bonuses
    activeModifiers,
    achievementBonuses: mergedBonuses,
    augmentProgress: runProgress,
    // Checkpoint (for welcome screen display)
    checkpointStartLevel: getStartingLevel(),
    checkpointRemaining: getRemainingTimeMs(),
    // Callbacks
    handleStartGame,
    handleGameEnd,
    handleLivesChange,
    handleLevelComplete,
    handleContinueFromOverlay,
    handlePurchaseUpgrade,
    handleContinueFromShop,
    handlePurchaseCertLevel,
    handlePlayAgain,
    handleBackToWelcome,
    handleAugmentsFromWelcome,
    handleReEnableAllTutorials,
    handleResetAugments,
  };
}
