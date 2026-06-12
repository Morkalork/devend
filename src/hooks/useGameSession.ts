/**
 * useGameSession — the single orchestrator for one player session.
 *
 * Index.tsx calls this once and passes the result down to every screen.
 * It wires together all the smaller managers:
 *   - useLevelManager        levels from public/map.yml, current level index
 *   - useUpgradeManager      shop upgrades from public/upgrades.yml
 *   - useMutatorManager      Ascension mutators from public/mutators.yml
 *   - useCertificateManager  certificates + Certificate Hours (meta currency)
 *   - useTutorialManager     one-time tutorial flags
 *   - useContinueCheckpoint  the 10-minute 'Continue' checkpoint
 *   - useCheckpointSnapshots saved per-level snapshots for the level picker
 *   - useMetaProgression     lifetime stats (fences drawn, lives lost, …)
 *   - useAchievementManager  achievements + their gameplay bonuses
 *
 * It also owns run-scoped state (score, lives, owned upgrades) and the
 * handle* callbacks that screens invoke to advance the game flow.
 */
import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useLevelManager } from './useLevelManager';
import { useUpgradeManager } from './useUpgradeManager';
import { useMutatorManager } from './useMutatorManager';
import { useActiveModifiers, mergeBonuses, GameModifiers } from './useActiveModifiers';
import { useTutorialManager } from './useTutorialManager';
import { useContinueCheckpoint } from './useContinueCheckpoint';
import { useCheckpointSnapshots } from './useCheckpointSnapshots';
import { useCertificateManager } from './useCertificateManager';
import { useMetaProgression } from './useMetaProgression';
import { useAchievementManager } from './useAchievementManager';
import { useScreenNavigation } from './useScreenNavigation';
import { GameResult, LevelScoreData } from '@/types/game';
import { Certificate } from '@/types/certificate';

const BASE_LIVES = 3;

export function useGameSession(nav: ReturnType<typeof useScreenNavigation>) {
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

  const {
    mutators,
    mutatorLookup,
    ascensionConfig,
    loadMutators,
  } = useMutatorManager();

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

  // Ascension mode: after the final level the player may loop back to level 1
  // with a drafted mutator. Depth 0 = first pass through the levels.
  const [ascensionDepth, setAscensionDepth] = useState(0);
  const [draftedMutatorIds, setDraftedMutatorIds] = useState<string[]>([]);

  // Snapshot of the just-finalized run for the result screen (finalizeRun
  // resets the live counters, so the result screen can't read those).
  const [lastRunSummary, setLastRunSummary] = useState<{ levelsCompleted: number; hoursAwarded: number } | null>(null);

  const handleCertificateHourEarned = useCallback(() => {
    // Visual flash handled by consumer; cert manager calls this on point award
  }, []);

  const {
    certificates,
    totalCertificateHours,
    certLevelsOwned,
    unlockedCertIds,
    maxTierCounts,
    lifetimeHoursSpent,
    runLevelsCompleted,
    runHoursEarned: runHoursAwarded,
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
  } = useCertificateManager({ onHourEarned: handleCertificateHourEarned });

  const {
    shouldShowFence,
    shouldShowStore,
    shouldShowCertStore,
    shouldShowMover,
    shouldShowInfoPanels,
    shouldShowAscension,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markInfoPanelsSeen,
    markAscensionSeen,
    resetAllTutorials,
  } = useTutorialManager();

  const {
    saveCheckpoint,
    clearCheckpoint,
    getStartingLevel,
    getRemainingTimeMs,
  } = useContinueCheckpoint();

  const {
    saveCheckpoint: saveRunCheckpoint,
    clearCheckpoints: clearRunCheckpoints,
  } = useCheckpointSnapshots();

  const {
    stats: metaStats,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    recordAscensionDepth,
    recordPushBonusBanked,
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

  // Drafted mutators + the baseline per-depth speed ramp, folded into the
  // same bonus map the achievements/certificates use.
  const mutatorBonuses = useMemo(() => {
    let bonuses: Partial<Record<keyof GameModifiers, number>> | undefined;
    for (const id of draftedMutatorIds) {
      const mutator = mutatorLookup.get(id);
      if (mutator) bonuses = mergeBonuses(bonuses, mutator.modifiers as Partial<Record<keyof GameModifiers, number>>);
    }
    if (ascensionDepth > 0) {
      bonuses = mergeBonuses(bonuses, {
        ballSpeedMultiplier: Math.pow(ascensionConfig.speedRampPerDepth, ascensionDepth),
      });
    }
    return bonuses;
  }, [draftedMutatorIds, mutatorLookup, ascensionDepth, ascensionConfig.speedRampPerDepth]);

  const mergedBonuses = useMemo(
    () => mergeBonuses(mergeBonuses(achievementBonuses, certBonuses), mutatorBonuses),
    [achievementBonuses, certBonuses, mutatorBonuses]
  );
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, mergedBonuses);

  const activeMutators = useMemo(
    () => draftedMutatorIds.map(id => mutatorLookup.get(id)).filter((m): m is NonNullable<typeof m> => m != null),
    [draftedMutatorIds, mutatorLookup]
  );

  // Ascension rule: fences wear out after a number of ball hits — generous on
  // early levels, brutal late, plus the Defensive Programming upgrade bonus.
  // null at depth 0 = indestructible fences (the normal game).
  const fenceDurability = useMemo(() => {
    if (ascensionDepth === 0) return null;
    const levelNumber = currentLevelIndex + 1;
    const t = totalLevels > 1 ? Math.min(1, (levelNumber - 1) / (totalLevels - 1)) : 0;
    const base = Math.round(
      ascensionConfig.fenceDurabilityBase +
      (ascensionConfig.fenceDurabilityAtFinal - ascensionConfig.fenceDurabilityBase) * t
    );
    return Math.max(1, base + activeModifiers.fenceDurabilityBonus);
  }, [ascensionDepth, currentLevelIndex, totalLevels, ascensionConfig, activeModifiers.fenceDurabilityBonus]);

  const certSourceIds = useMemo(
    () => new Set(certificates.map(c => c.sourceUpgradeId).filter((id): id is string => id != null)),
    [certificates]
  );

  const handleStartGame = useCallback(async (forceLevel?: number) => {
    // Mutators only matter past the final level, so their load result does
    // not gate starting a run.
    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
      loadCertificates(),
      loadMutators(),
    ]);

    if (levelsSuccess && upgradesSuccess) {
      setTotalScore(0);
      setPendingLevelScore(null);
      setShowLevelComplete(false);
      setOwnedUpgradeIds([]);
      setAscensionDepth(0);
      setDraftedMutatorIds([]);
      setLastRunSummary(null);
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
  }, [loadLevels, loadUpgrades, loadCertificates, loadMutators, nav.startGame, getStartingLevel, setLevelIndex, resetToFirstLevel, certBonuses, getCertStartingLevel, resetRunProgress]);

  const handleGameEnd = useCallback((result: GameResult) => {
    if (!result.isWin) {
      // Ascension runs are bank-or-bust: no Continue checkpoint past depth 0.
      if (ascensionDepth === 0) saveCheckpoint(result.levelNumber);
    } else if (result.completedAllLevels) {
      clearCheckpoint();
    }
    const levelsCompleted = runLevelsCompleted;
    const hoursAwarded = finalizeRun(activeModifiers.extraCertificateHours);
    setLastRunSummary({ levelsCompleted, hoursAwarded });
    nav.endGame({
      ...result,
      totalScore,
      ascensionDepth: ascensionDepth > 0 ? ascensionDepth : undefined,
      mutatorNames: ascensionDepth > 0 ? activeMutators.map(m => m.name) : undefined,
    });
  }, [nav.endGame, totalScore, saveCheckpoint, clearCheckpoint, finalizeRun, ascensionDepth, runLevelsCompleted, activeModifiers.extraCertificateHours, activeMutators]);

  const handleLivesChange = useCallback((newLives: number) => {
    const livesLost = currentLives - newLives;
    if (livesLost > 0) recordLivesLost(livesLost);
    setCurrentLives(newLives);
  }, [currentLives, recordLivesLost]);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    const currentLevelNum = currentLevelIndex + 1;
    recordLevelReached(currentLevelNum);
    recordFencesDrawn(scoreData.cutCount || 0);
    // Levels completed while ascended count more toward Certificate Hours
    incrementRunLevel(1 + ascensionDepth);

    if (currentLives >= livesAtLevelStart) recordPerfectLevel();

    // Survived a push-your-luck round and banked the bonus (failed pushes
    // also carry a pushBonus, so check the flag too)
    const bankedPush = (scoreData.pushBonus ?? 0) > 0 && !scoreData.pushFailed;
    if (bankedPush) recordPushBonusBanked();

    const projectedStats = {
      highestLevelReached: Math.max(metaStats.highestLevelReached, currentLevelNum),
      totalFencesDrawn: metaStats.totalFencesDrawn + (scoreData.cutCount || 0),
      totalLevelsCompletedWithoutLoss:
        currentLives >= livesAtLevelStart
          ? metaStats.totalLevelsCompletedWithoutLoss + 1
          : metaStats.totalLevelsCompletedWithoutLoss,
      totalLivesLost: metaStats.totalLivesLost,
      deepestAscension: Math.max(metaStats.deepestAscension, ascensionDepth),
      pushBonusesBanked: metaStats.pushBonusesBanked + (bankedPush ? 1 : 0),
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
  }, [totalScore, currentLevelIndex, recordLevelReached, recordFencesDrawn, recordPerfectLevel, recordPushBonusBanked, currentLives, livesAtLevelStart, incrementRunLevel, ascensionDepth, activeModifiers.scoreInterestRate, checkAndCompleteAchievements, metaStats]);

  const handleContinueFromOverlay = useCallback(() => {
    setShowLevelComplete(false);
    setPendingCertUnlocks([]);
    if (isLastLevel) {
      // Beat the final level: offer the ascend-or-retire choice. The pending
      // level score is kept so handleRetire can put it on the result screen.
      nav.goToAscensionDraft();
    } else {
      nav.goToUpgradeShop();
    }
  }, [isLastLevel, nav.goToAscensionDraft, nav.goToUpgradeShop]);

  /** Ascend: draft a mutator and loop back to level 1 at depth + 1. */
  const handleAscend = useCallback((mutatorId: string) => {
    const newDepth = ascensionDepth + 1;
    setDraftedMutatorIds(prev => [...prev, mutatorId]);
    setAscensionDepth(newDepth);
    recordAscensionDepth(newDepth);

    // Refill lives to the run's starting value (never down), then apply the
    // drafted mutator's life delta once — same as buying an extraLives upgrade.
    const startingLives = BASE_LIVES + ((certBonuses.extraLives as number | undefined) ?? 0);
    const livesDelta = mutatorLookup.get(mutatorId)?.modifiers.extraLives ?? 0;
    const refilled = Math.max(1, Math.max(currentLives, startingLives) + livesDelta);
    setCurrentLives(refilled);
    setLivesAtLevelStart(refilled);

    setPendingLevelScore(null);
    resetToFirstLevel(); // also re-randomizes the level variants for the new loop
    nav.goToGame();
  }, [ascensionDepth, recordAscensionDepth, certBonuses, mutatorLookup, currentLives, resetToFirstLevel, nav.goToGame]);

  /** Retire: bank the run and show the result screen. */
  const handleRetire = useCallback(() => {
    clearCheckpoint();
    const levelsCompleted = runLevelsCompleted;
    const hoursAwarded = finalizeRun(activeModifiers.extraCertificateHours);
    setLastRunSummary({ levelsCompleted, hoursAwarded });
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
      ascensionDepth: ascensionDepth > 0 ? ascensionDepth : undefined,
      mutatorNames: ascensionDepth > 0 ? activeMutators.map(m => m.name) : undefined,
    });
    setPendingLevelScore(null);
  }, [clearCheckpoint, runLevelsCompleted, finalizeRun, activeModifiers.extraCertificateHours, nav.endGame, pendingLevelScore, currentLevel, currentLevelIndex, totalScore, ascensionDepth, activeMutators]);

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
    // Level-picker snapshots only describe depth-0 runs, so skip them while ascended
    if (nextLevelNumber % 5 === 0 && ascensionDepth === 0) {
      saveRunCheckpoint({ level: nextLevelNumber, totalScore, ownedUpgradeIds, lives: currentLives, savedAt: Date.now() });
    }
    const pendingUnlocks = takePendingUnlocks();
    if (pendingUnlocks.length > 0) setPendingCertUnlocks(pendingUnlocks);
    setShopUnlockedCerts([]);
    setPendingLevelScore(null);
    advanceToNextLevel();
    nav.goToGame();
  }, [currentLevelIndex, totalScore, ownedUpgradeIds, currentLives, ascensionDepth, saveRunCheckpoint, advanceToNextLevel, nav.goToGame, takePendingUnlocks]);

  const handlePurchaseCertLevel = useCallback((certId: string, targetLevel: number) => {
    purchaseCertLevel(certId, targetLevel);
  }, [purchaseCertLevel]);

  const handlePlayAgain = useCallback((startLevel?: number) => {
    setTotalScore(0);
    setOwnedUpgradeIds([]);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setCumulativeLockedBalls(0);
    setAscensionDepth(0);
    setDraftedMutatorIds([]);
    setLastRunSummary(null);
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
    setAscensionDepth(0);
    setDraftedMutatorIds([]);
    resetRunProgress();
    nav.goToWelcome();
  }, [resetToFirstLevel, nav.goToWelcome, resetRunProgress]);

  const handleOpenCertificateStore = useCallback(async () => {
    // Upgrades too: locked-cert tooltips name the upgrade that unlocks them,
    // and the catalogue isn't loaded yet when entering from the welcome screen.
    await Promise.all([loadCertificates(), loadUpgrades()]);
    nav.goToCertificateStore();
  }, [loadCertificates, loadUpgrades, nav.goToCertificateStore]);

  const handleReEnableAllTutorials = useCallback(() => {
    resetAllTutorials();
  }, [resetAllTutorials]);

  const handleResetCertificates = useCallback(() => {
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
    shouldShowCertStore,
    showMoverTutorial: shouldShowMover,
    showInfoPanelsTutorial: shouldShowInfoPanels,
    shouldShowAscension,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markInfoPanelsSeen,
    markAscensionSeen,
    // Certificates
    certificates,
    totalCertificateHours,
    certLevelsOwned,
    unlockedCertIds,
    maxTierCounts,
    lifetimeHoursSpent,
    shopUnlockedCerts,
    pendingCertUnlocks,
    // Achievements
    achievements,
    completedAchievementIds,
    activatedAchievementIds,
    activateAchievement,
    // Meta progression
    metaStats,
    runHoursAwarded,
    runLevelsCompleted,
    lastRunHoursAwarded: lastRunSummary?.hoursAwarded ?? 0,
    lastRunLevelsCompleted: lastRunSummary?.levelsCompleted ?? 0,
    // Ascension mode
    ascensionDepth,
    mutators,
    draftedMutatorIds,
    activeMutators,
    fenceDurability,
    // Modifiers / bonuses
    activeModifiers,
    achievementBonuses: mergedBonuses,
    certificateProgress: runProgress,
    // Checkpoint (for welcome screen display)
    checkpointStartLevel: getStartingLevel(),
    checkpointRemaining: getRemainingTimeMs(),
    // Callbacks
    handleStartGame,
    handleGameEnd,
    handleLivesChange,
    handleLevelComplete,
    handleContinueFromOverlay,
    handleAscend,
    handleRetire,
    handlePurchaseUpgrade,
    handleContinueFromShop,
    handlePurchaseCertLevel,
    handlePlayAgain,
    handleBackToWelcome,
    handleOpenCertificateStore,
    handleReEnableAllTutorials,
    handleResetCertificates,
  };
}
