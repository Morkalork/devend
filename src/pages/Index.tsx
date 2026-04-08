import { useCallback, useState, lazy, Suspense, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameState } from '@/hooks/useGameState';
import { useLevelManager } from '@/hooks/useLevelManager';
import { useUpgradeManager } from '@/hooks/useUpgradeManager';
import { useActiveModifiers, mergeBonuses, GameModifiers } from '@/hooks/useActiveModifiers';
import { useTutorialManager } from '@/hooks/useTutorialManager';
import { useCheckpoint } from '@/hooks/useCheckpoint';
import { useCheckpointManager } from '@/hooks/useCheckpointManager';
import { useCertificateManager } from '@/hooks/useCertificateManager';
import { useMetaProgression } from '@/hooks/useMetaProgression';
import { useAchievementManager } from '@/hooks/useAchievementManager';
import { AccentColorProvider, useAccentColor } from '@/contexts/AccentColorContext';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { OptionsScreen } from '@/components/game/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { AugmentStore } from '@/components/game/AugmentStore';
import { AchievementsScreen } from '@/components/game/AchievementsScreen';
import { GameResult, LevelScoreData } from '@/types/game';
import { LevelConfig } from '@/types/level';
import { UpgradeConfig } from '@/types/upgrade';
import { Certificate } from '@/types/certificate';

// Lazy load admin components (dev-only)
const AdminScreen = lazy(() => import('@/components/admin/AdminScreen').then(m => ({ default: m.AdminScreen })));
const MapBuilder = lazy(() => import('@/components/admin/MapBuilder').then(m => ({ default: m.MapBuilder })));
const PlaygroundScreen = lazy(() => import('@/components/admin/PlaygroundScreen').then(m => ({ default: m.PlaygroundScreen })));

const BASE_LIVES = 3;

const Index = () => {
  const {
    currentScreen,
    lastResult,
    startGame,
    endGame,
    goToWelcome,
    goToTutorial,
    goToUpgradeShop,
    goToGame,
    goToAugmentStore,
    goToOptions,
    goToAchievements,
    goToAdmin,
    goToMapBuilder,
    goToAnimationTest,
  } = useGameState();

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

  // Combined loading and error states
  const isLoading = isLoadingLevels || isLoadingUpgrades;
  const error = levelError || upgradeError;

  // Score tracking
  const [totalScore, setTotalScore] = useState(0);
  const [pendingLevelScore, setPendingLevelScore] = useState<LevelScoreData | null>(null);
  const [showLevelComplete, setShowLevelComplete] = useState(false);
  
  // Owned upgrades tracking (per-run upgrades from shop)
  const [ownedUpgradeIds, setOwnedUpgradeIds] = useState<string[]>([]);
  
  // Lives tracking (persists across levels in a run)
  const [currentLives, setCurrentLives] = useState(BASE_LIVES);

  // Cumulative locked balls across all maps in the current run (for MicroManager)
  const [cumulativeLockedBalls, setCumulativeLockedBalls] = useState(0);

  // Certificate system (persistent meta-progression)
  // Point earned callback for visual feedback
  const [_showPointEarnedFlash, setShowPointEarnedFlash] = useState(false);
  const handleAugmentPointEarned = useCallback(() => {
    setShowPointEarnedFlash(true);
    setTimeout(() => setShowPointEarnedFlash(false), 1500);
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

  // Tutorial management
  const {
    shouldShowFence,
    shouldShowStore,
    shouldShowAugment,
    markFenceSeen,
    markStoreSeen,
    markAugmentSeen,
    resetAllTutorials,
  } = useTutorialManager();

  const showInGameTutorial = shouldShowFence;

  // Checkpoint system for 10-minute tier restart
  const {
    saveCheckpoint,
    clearCheckpoint,
    getStartingLevel,
    getRemainingTimeMs,
  } = useCheckpoint();

  // Persistent run checkpoints (levels 5, 10, 15, …)
  const {
    saveCheckpoint: saveRunCheckpoint,
    clearCheckpoints: clearRunCheckpoints,
  } = useCheckpointManager();

  // Meta progression system for tracking unlocks
  const {
    stats: metaStats,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    resetProgression,
  } = useMetaProgression();

  // Achievement system
  const {
    achievements,
    completedIds: completedAchievementIds,
    activatedIds: activatedAchievementIds,
    bonusModifiers: achievementBonuses,
    checkAndComplete: checkAndCompleteAchievements,
    activateAchievement,
    getClosestAchievements,
  } = useAchievementManager();

  // Track lives at start of level for perfect level detection
  const [livesAtLevelStart, setLivesAtLevelStart] = useState(BASE_LIVES);

  // Merge cert bonuses with achievement bonuses for modifier pipeline
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mergedBonuses = useMemo(() => mergeBonuses(achievementBonuses as any, certBonuses as any), [achievementBonuses, certBonuses]);

  // Calculate modifiers (including achievement + certificate bonuses)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, mergedBonuses as any);

  const augmentProgress = runProgress;

  // State for cert unlocks shown in shop banner and next LevelCompleteOverlay
  const [shopUnlockedCerts, setShopUnlockedCerts] = useState<Certificate[]>([]);
  const [pendingCertUnlocks, setPendingCertUnlocks] = useState<Certificate[]>([]);

  const handleStartGame = useCallback(async (forceLevel?: number) => {
    // Load levels, upgrades, and certificates in parallel
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
      resetRunProgress(); // Reset in-run cert tracking

      // Starting lives: base + any extraLives bonus from certs
      const certBonusLives = (certBonuses.extraLives as number | undefined) ?? 0;
      const startingLives = BASE_LIVES + certBonusLives;
      setCurrentLives(startingLives);
      setLivesAtLevelStart(startingLives);

      if (forceLevel !== undefined) {
        setLevelIndex(forceLevel - 1);
      } else {
        // Determine starting level: max of checkpoint, cert bonus, and ?level= query param
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

      startGame();
    }
  }, [loadLevels, loadUpgrades, loadCertificates, startGame, getStartingLevel, setLevelIndex, resetToFirstLevel, certBonuses, getCertStartingLevel, resetRunProgress]);

  const handleGameEnd = useCallback((result: GameResult) => {
    // Save checkpoint if player made it past level 5
    if (!result.isWin) {
      saveCheckpoint(result.levelNumber);
    } else if (result.completedAllLevels) {
      // Clear checkpoint on full game completion
      clearCheckpoint();
    }
    
    // Finalize run and award Certificate Hours
    finalizeRun();
    
    // For game over, include current total score
    endGame({
      ...result,
      totalScore: totalScore,
    });
  }, [endGame, totalScore, saveCheckpoint, clearCheckpoint, finalizeRun]);

  const handleLivesChange = useCallback((newLives: number) => {
    const livesLost = currentLives - newLives;
    if (livesLost > 0) {
      recordLivesLost(livesLost);
    }
    setCurrentLives(newLives);
  }, [currentLives, recordLivesLost]);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    // Track meta progression stats
    const currentLevelNum = currentLevelIndex + 1;
    recordLevelReached(currentLevelNum);
    recordFencesDrawn(scoreData.cutCount || 0);
    
    // Increment levels completed this run (tracked in cert manager)
    incrementRunLevel();

    // Check if level was completed without losing a life
    if (currentLives >= livesAtLevelStart) {
      recordPerfectLevel();
    }

    // Check achievement progress against projected updated stats
    // (metaStats state hasn't flushed yet, so compute expected values inline)
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
    
    // No tier multiplier - overtime values are already tight
    const levelOvertime = scoreData.levelScore;
    
    // Apply interest on unused overtime (capped at 8h per map)
    let interestGain = 0;
    if (activeModifiers.scoreInterestRate > 0) {
      interestGain = Math.min(8, Math.floor(totalScore * activeModifiers.scoreInterestRate));
    }
    
    const newTotalScore = totalScore + levelOvertime + interestGain;
    setTotalScore(newTotalScore);
    setPendingLevelScore({
      ...scoreData,
      levelScore: levelOvertime,
      tierMultiplier: 1,
      interestGain,
    });
    setShowLevelComplete(true);

    // Accumulate locked balls for MicroManager persistence across maps
    if (scoreData.lockedBallsCount && scoreData.lockedBallsCount > 0) {
      setCumulativeLockedBalls(prev => prev + scoreData.lockedBallsCount!);
    }

    // Reset lives at level start for next level
    setLivesAtLevelStart(currentLives);
  }, [totalScore, currentLevelIndex, recordLevelReached, recordFencesDrawn, recordPerfectLevel, currentLives, livesAtLevelStart, incrementRunLevel, activeModifiers.scoreInterestRate, checkAndCompleteAchievements, metaStats]);

  const handleContinueFromOverlay = useCallback(() => {
    setShowLevelComplete(false);
    setPendingCertUnlocks([]);
    if (isLastLevel) {
      // All levels complete - show final win screen
      endGame({
        isWin: true,
        remainingPercent: pendingLevelScore?.remainingPercent || 0,
        levelId: currentLevel?.id || '',
        levelNumber: currentLevelIndex + 1,
        completedAllLevels: true,
        totalScore: totalScore,
        levelScore: pendingLevelScore?.levelScore,
        cutCount: pendingLevelScore?.cutCount,
        expectedCuts: pendingLevelScore?.expectedCuts,
        basePoints: pendingLevelScore?.basePoints,
      });
      setPendingLevelScore(null);
    } else {
      // Go to upgrade shop before next level
      goToUpgradeShop();
    }
  }, [isLastLevel, endGame, currentLevel, currentLevelIndex, totalScore, pendingLevelScore, goToUpgradeShop]);

  // Set of upgrade IDs that, when purchased, should trigger cert unlock tracking
  const certSourceIds = useMemo(
    () => new Set(certificates.map(c => c.sourceUpgradeId).filter((id): id is string => id != null)),
    [certificates]
  );

  const handlePurchaseUpgrade = useCallback((upgradeId: string, price: number) => {
    setTotalScore(prev => prev - price);
    setOwnedUpgradeIds(prev => [...prev, upgradeId]);

    // Check if this upgrade grants extra lives
    const upgrade = upgrades.find(u => u.id === upgradeId);
    const extraLives = upgrade?.modifiers?.extraLives;
    if (extraLives && typeof extraLives === 'number') {
      setCurrentLives(prev => prev + extraLives);
    }

    // Track max-tier cert unlock
    if (certSourceIds.has(upgradeId)) {
      const unlocks = recordMaxTierPurchase(upgradeId);
      if (unlocks.length > 0) {
        setShopUnlockedCerts(prev => [...prev, ...unlocks]);
      }
    }
  }, [upgrades, certSourceIds, recordMaxTierPurchase]);

  const handleContinueFromShop = useCallback(() => {
    const nextLevelNumber = currentLevelIndex + 2; // 1-based
    if (nextLevelNumber % 5 === 0) {
      saveRunCheckpoint({
        level: nextLevelNumber,
        totalScore,
        ownedUpgradeIds,
        lives: currentLives,
        savedAt: Date.now(),
      });
    }
    // Capture any cert unlocks from this shop session for next LevelCompleteOverlay
    const pendingUnlocks = takePendingUnlocks();
    if (pendingUnlocks.length > 0) {
      setPendingCertUnlocks(pendingUnlocks);
    }
    setShopUnlockedCerts([]);
    setPendingLevelScore(null);
    advanceToNextLevel();
    goToGame();
  }, [currentLevelIndex, totalScore, ownedUpgradeIds, currentLives, saveRunCheckpoint, advanceToNextLevel, goToGame, takePendingUnlocks]);

  const handlePurchaseCertLevel = useCallback((certId: string, targetLevel: number) => {
    purchaseCertLevel(certId, targetLevel);
  }, [purchaseCertLevel]);

  const handlePlayAgain = useCallback((startLevel?: number) => {
    // Always do a full reset — score, upgrades, lives, locked balls
    setTotalScore(0);
    setOwnedUpgradeIds([]);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setCumulativeLockedBalls(0);
    resetRunProgress();

    const certBonusLives = (certBonuses as any).extraLives ?? 0;
    const startingLives = BASE_LIVES + certBonusLives;
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);

    if (startLevel !== undefined) {
      // Continue / Continue From… — fresh run starting at this level
      setLevelIndex(startLevel - 1); // convert 1-based to 0-based
    } else {
      // New Game — clear checkpoints, apply 10-min checkpoint + cert bonus
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

    startGame();
  }, [resetToFirstLevel, startGame, getStartingLevel, setLevelIndex, certBonuses, getCertStartingLevel, resetRunProgress, clearRunCheckpoints]);

  const handleBackToWelcome = useCallback(() => {
    resetToFirstLevel();
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setOwnedUpgradeIds([]);
    setCurrentLives(BASE_LIVES);
    resetRunProgress(); // Reset in-run augment tracking
    goToWelcome();
  }, [resetToFirstLevel, goToWelcome, resetRunProgress]);

  const handleAugmentsFromWelcome = useCallback(async () => {
    await loadCertificates();
    goToAugmentStore();
  }, [loadCertificates, goToAugmentStore]);

  const handleAchievementsFromWelcome = useCallback(() => {
    goToAchievements();
  }, [goToAchievements]);

  const handleReEnableAllTutorials = useCallback(() => {
    resetAllTutorials();
  }, [resetAllTutorials]);

  const handleResetAugments = useCallback(() => {
    resetCertData();
    resetProgression();
  }, [resetCertData, resetProgression]);

  // Sync achievement unlocks to cert manager whenever completed achievements change
  useEffect(() => {
    if (completedAchievementIds.length > 0) {
      checkAchievementUnlocks(completedAchievementIds);
    }
  }, [completedAchievementIds, checkAchievementUnlocks]);

  // Auto-start game if ?level= query param is present
  const levelQueryHandled = useRef(false);
  useEffect(() => {
    if (levelQueryHandled.current) return;
    const levelParam = new URLSearchParams(window.location.search).get('level');
    if (levelParam && parseInt(levelParam, 10) > 0) {
      levelQueryHandled.current = true;
      handleStartGame();
    }
  }, [handleStartGame]);

  // Get checkpoint info for welcome screen
  const checkpointStartLevel = getStartingLevel();
  const checkpointRemaining = getRemainingTimeMs();

  // Use checkpoint level for accent color when not actively playing
  const displayLevel = currentScreen === 'game' 
    ? currentLevelIndex + 1 
    : checkpointStartLevel;

  return (
    <AccentColorProvider currentLevel={displayLevel}>
      <IndexContent
        currentScreen={currentScreen}
        currentLevel={currentLevel}
        currentLevelIndex={currentLevelIndex}
        totalLevels={totalLevels}
        totalScore={totalScore}
        currentLives={currentLives}
        ownedUpgradeIds={ownedUpgradeIds}
        upgrades={upgrades}
        isLoading={isLoading}
        error={error}
        showInGameTutorial={showInGameTutorial}
        shouldShowStore={shouldShowStore}
        shouldShowAugment={shouldShowAugment}
        lastResult={lastResult}
        showLevelComplete={showLevelComplete}
        pendingLevelScore={pendingLevelScore}
        handleStartGame={handleStartGame}
        handleGameEnd={handleGameEnd}
        handleLivesChange={handleLivesChange}
        handleLevelComplete={handleLevelComplete}
        handleContinueFromOverlay={handleContinueFromOverlay}
        handlePurchaseUpgrade={handlePurchaseUpgrade}
        handleContinueFromShop={handleContinueFromShop}
        handlePlayAgain={handlePlayAgain}
        handleBackToWelcome={handleBackToWelcome}
        handleAugmentsFromWelcome={handleAugmentsFromWelcome}
        handleReEnableAllTutorials={handleReEnableAllTutorials}
        handleResetAugments={handleResetAugments}
        canPurchaseUpgrade={canPurchaseUpgrade}
        isUpgradeLocked={isUpgradeLocked}
        handlePurchaseCertLevel={handlePurchaseCertLevel}
        goToWelcome={goToWelcome}
        goToTutorial={goToTutorial}
        goToOptions={goToOptions}
        goToAdmin={goToAdmin}
        goToMapBuilder={goToMapBuilder}
        goToAnimationTest={goToAnimationTest}
        onFenceSeen={markFenceSeen}
        onStoreTutorialDismiss={markStoreSeen}
        onAugmentTutorialDismiss={markAugmentSeen}
        checkpointLevel={checkpointStartLevel}
        checkpointRemainingMs={checkpointRemaining}
        certificates={certificates}
        totalAugmentPoints={totalAugmentPoints}
        certLevelsOwned={certLevelsOwned}
        unlockedCertIds={unlockedCertIds}
        maxTierCounts={maxTierCounts}
        metaStats={metaStats}
        runPointsAwarded={runPointsAwarded}
        runLevelsCompleted={runLevelsCompleted}
        shopUnlockedCerts={shopUnlockedCerts}
        pendingCertUnlocks={pendingCertUnlocks}

        augmentProgress={augmentProgress}
        extraShopItems={activeModifiers.extraShopItems}
        achievements={achievements}
        completedAchievementIds={completedAchievementIds}
        activatedAchievementIds={activatedAchievementIds}
        activateAchievement={activateAchievement}
        achievementBonuses={mergedBonuses}
        activeModifiers={activeModifiers}

        handleAchievementsFromWelcome={handleAchievementsFromWelcome}
        goToWelcomeFromAchievements={goToWelcome}

        cumulativeLockedBalls={cumulativeLockedBalls}
      />
    </AccentColorProvider>
  );
};

// Separate component to access accent color context
interface AugmentProgress {
  levelsCompleted: number;
  levelsToNextPoint: number;
  progressInCurrentPoint: number;
  pointsEarned: number;
  levelsPerPoint: number;
}

interface IndexContentProps {
  currentScreen: string;
  currentLevel: LevelConfig | null;
  currentLevelIndex: number;
  totalLevels: number;
  totalScore: number;
  currentLives: number;
  ownedUpgradeIds: string[];
  upgrades: UpgradeConfig[];
  isLoading: boolean;
  error: string | null;
  showInGameTutorial: boolean;
  shouldShowStore: boolean;
  shouldShowAugment: boolean;
  lastResult: GameResult | null;
  showLevelComplete: boolean;
  pendingLevelScore: LevelScoreData | null;
  handleStartGame: (forceLevel?: number) => void;
  handleGameEnd: (result: GameResult) => void;
  handleLivesChange: (lives: number) => void;
  handleLevelComplete: (scoreData: LevelScoreData) => void;
  handleContinueFromOverlay: () => void;
  handlePurchaseUpgrade: (id: string, price: number) => void;
  canPurchaseUpgrade: (upgradeId: string, playerScore: number, ownedIds: string[]) => boolean;
  isUpgradeLocked: (upgradeId: string, ownedIds: string[]) => boolean;
  handleContinueFromShop: () => void;
  handlePlayAgain: (startLevel?: number) => void;
  cumulativeLockedBalls: number;
  handleBackToWelcome: () => void;
  handleAugmentsFromWelcome: () => void;
  handleReEnableAllTutorials: () => void;
  onFenceSeen: () => void;
  onStoreTutorialDismiss: () => void;
  onAugmentTutorialDismiss: () => void;
  handleResetAugments: () => void;
  handlePurchaseCertLevel: (certId: string, targetLevel: number) => void;
  goToWelcome: () => void;
  goToTutorial: () => void;
  goToOptions: () => void;
  goToAdmin: () => void;
  goToMapBuilder: () => void;
  goToAnimationTest: () => void;
  checkpointLevel?: number;
  checkpointRemainingMs?: number;
  certificates: Certificate[];
  totalAugmentPoints: number;
  certLevelsOwned: Record<string, number>;
  unlockedCertIds: string[];
  maxTierCounts: Record<string, number>;
  metaStats: import('@/types/metaProgression').MetaProgressionStats;
  runPointsAwarded: number;
  runLevelsCompleted: number;
  shopUnlockedCerts: Certificate[];
  pendingCertUnlocks: Certificate[];

  augmentProgress: AugmentProgress;
  extraShopItems: number;
  achievements: import('@/types/achievement').Achievement[];
  completedAchievementIds: string[];
  activatedAchievementIds: string[];
  activateAchievement: (id: string) => void;
  achievementBonuses: Partial<Record<string, number>>;
  activeModifiers: GameModifiers;
  handleAchievementsFromWelcome: () => void;
  goToWelcomeFromAchievements: () => void;
}

function IndexContent({
  currentScreen,
  currentLevel,
  currentLevelIndex,
  totalLevels,
  totalScore,
  currentLives,
  ownedUpgradeIds,
  upgrades,
  isLoading,
  error,
  showInGameTutorial,
  shouldShowStore,
  shouldShowAugment,
  lastResult,
  showLevelComplete,
  pendingLevelScore,
  handleStartGame,
  handleGameEnd,
  handleLivesChange,
  handleLevelComplete,
  handleContinueFromOverlay,
  handlePurchaseUpgrade,
  canPurchaseUpgrade,
  isUpgradeLocked,
  handleContinueFromShop,
  handlePlayAgain,
  cumulativeLockedBalls,
  handleBackToWelcome,
  handleAugmentsFromWelcome,
  handleReEnableAllTutorials,
  handleResetAugments,
  handlePurchaseCertLevel,
  goToWelcome,
  goToTutorial,
  goToOptions,
  goToAdmin,
  goToMapBuilder,
  goToAnimationTest,
  onFenceSeen,
  onStoreTutorialDismiss,
  onAugmentTutorialDismiss,
  checkpointLevel,
  checkpointRemainingMs,
  certificates,
  totalAugmentPoints,
  certLevelsOwned,
  unlockedCertIds,
  maxTierCounts,
  metaStats,
  runPointsAwarded,
  runLevelsCompleted,
  shopUnlockedCerts,
  pendingCertUnlocks,
  augmentProgress,
  extraShopItems,
  achievements,
  completedAchievementIds,
  activatedAchievementIds,
  activateAchievement,
  achievementBonuses,
  activeModifiers,
  handleAchievementsFromWelcome,
  goToWelcomeFromAchievements,
}: IndexContentProps) {
  const { accentHex } = useAccentColor();

  // Screen order for determining slide direction (higher = further forward in flow)
  const SCREEN_ORDER: Record<string, number> = {
    welcome: 0, tutorial: 1, options: 1, achievements: 1,
    game: 2, upgradeShop: 3, augmentStore: 3, result: 4,
  };
  const prevScreenRef   = useRef(currentScreen);
  const transitionDirRef = useRef(1);
  if (prevScreenRef.current !== currentScreen) {
    const prevOrder = SCREEN_ORDER[prevScreenRef.current] ?? 0;
    const currOrder = SCREEN_ORDER[currentScreen] ?? 0;
    transitionDirRef.current = currOrder >= prevOrder ? 1 : -1;
    prevScreenRef.current = currentScreen;
  }
  const slideVariants = {
    enter:  (d: number) => ({ x: d > 0 ? '100%' : '-100%' }),
    center: { x: 0 },
    exit:   (d: number) => ({ x: d < 0 ? '100%' : '-100%' }),
  };

  return (
    <>
      <div style={{ position: 'relative', overflow: 'hidden', height: '100dvh', width: '100%' }}>
        <AnimatePresence mode="wait" custom={transitionDirRef.current}>
          <motion.div
            key={currentScreen}
            custom={transitionDirRef.current}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ willChange: 'transform', position: 'relative', width: '100%', height: '100dvh' }}
          >
      {currentScreen === 'welcome' && (
        <WelcomeScreen
          onStartGame={() => handleStartGame()}
          onStartFromLevel={checkpointLevel && checkpointLevel > 1 && checkpointRemainingMs && checkpointRemainingMs > 0 ? (level) => handleStartGame(level) : undefined}
          onTutorial={goToTutorial}
          onOptions={goToOptions}
          onAugments={
            Object.values(maxTierCounts).some(c => c > 0) || unlockedCertIds.length > 0 || Object.keys(certLevelsOwned).length > 0
              ? handleAugmentsFromWelcome
              : undefined
          }
          onAchievements={handleAchievementsFromWelcome}
          onAdmin={import.meta.env.DEV || new URLSearchParams(window.location.search).get('admin') === 'true' ? goToAdmin : undefined}
          isLoading={isLoading}
          error={error}
          accentColor={accentHex}
          checkpointLevel={checkpointLevel}
          checkpointRemainingMs={checkpointRemainingMs}
          totalAugmentPoints={totalAugmentPoints}
          completedAchievementCount={completedAchievementIds.length}
        />
      )}
      {currentScreen === 'tutorial' && (
        <TutorialScreen onBack={goToWelcome} accentColor={accentHex} />
      )}
      {currentScreen === 'options' && (
        <OptionsScreen
          onBack={goToWelcome}
          onReEnableTutorials={handleReEnableAllTutorials}
          onResetAugments={handleResetAugments}
          hasAugments={Object.keys(certLevelsOwned).length > 0 || totalAugmentPoints > 0}
          accentColor={accentHex}
        />
      )}
      {currentScreen === 'game' && currentLevel && !showLevelComplete && (
        <GameScreen
          level={currentLevel}
          levelNumber={currentLevelIndex + 1}
          totalLevels={totalLevels}
          totalScore={totalScore}
          ownedUpgradeIds={ownedUpgradeIds}
          upgrades={upgrades}
          lives={currentLives}
          onLivesChange={handleLivesChange}
          onGameEnd={handleGameEnd}
          onLevelComplete={handleLevelComplete}
          onMainMenu={handleBackToWelcome}
          onRestart={handlePlayAgain}
          showInGameTutorial={showInGameTutorial && currentLevelIndex === 0}
          onFenceSeen={onFenceSeen}
          accentColor={accentHex}
          augmentProgress={augmentProgress}
          achievementBonuses={achievementBonuses}
          activeModifiers={activeModifiers}
          cumulativeLockedBalls={cumulativeLockedBalls}
        />
      )}
      {currentScreen === 'upgradeShop' && (
        <UpgradeShop
          playerPoints={totalScore}
          upgrades={upgrades}
          ownedUpgradeIds={ownedUpgradeIds}
          completedLevel={currentLevelIndex + 1}
          canPurchase={canPurchaseUpgrade}
          isLocked={isUpgradeLocked}
          onPurchase={handlePurchaseUpgrade}
          onContinue={handleContinueFromShop}
          accentColor={accentHex}
          extraShopItems={extraShopItems}
          showTutorial={shouldShowStore}
          onTutorialDismiss={onStoreTutorialDismiss}
          newlyUnlockedCerts={shopUnlockedCerts}
        />
      )}
      {currentScreen === 'result' && lastResult && (
        <ResultScreen
          result={lastResult}
          onMainMenu={goToWelcome}
          accentColor={accentHex}
          runPointsAwarded={runPointsAwarded}
          runLevelsCompleted={runLevelsCompleted}
        />
      )}
      {currentScreen === 'augmentStore' && (
        <AugmentStore
          certificates={certificates}
          totalAugmentPoints={totalAugmentPoints}
          certLevelsOwned={certLevelsOwned}
          unlockedCertIds={unlockedCertIds}
          maxTierCounts={maxTierCounts}
          onPurchaseCertLevel={handlePurchaseCertLevel}
          onBack={goToWelcome}
          accentColor={accentHex}
          showTutorial={shouldShowAugment}
          onTutorialDismiss={onAugmentTutorialDismiss}
        />
      )}
      {currentScreen === 'achievements' && (
        <AchievementsScreen
          achievements={achievements}
          completedIds={completedAchievementIds}
          activatedIds={activatedAchievementIds}
          metaStats={metaStats}
          onActivate={activateAchievement}
          onBack={goToWelcomeFromAchievements}
          accentColor={accentHex}
        />
      )}

      {/* Dev-only Admin screens */}
      {import.meta.env.DEV && currentScreen === 'admin' && (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
          <AdminScreen onBack={goToWelcome} onMapBuilder={goToMapBuilder} onAnimationTest={goToAnimationTest} />
        </Suspense>
      )}
      {import.meta.env.DEV && currentScreen === 'mapBuilder' && (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
          <MapBuilder onBack={goToAdmin} />
        </Suspense>
      )}
      {import.meta.env.DEV && currentScreen === 'animationTest' && (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
          <PlaygroundScreen onBack={goToAdmin} accentColor={accentHex} />
        </Suspense>
      )}
      
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Level Complete Overlay — fixed layer, stays outside the slide container */}
      {showLevelComplete && pendingLevelScore && (
        <LevelCompleteOverlay
          scoreData={pendingLevelScore}
          totalScore={totalScore}
          onContinue={handleContinueFromOverlay}
          accentColor={accentHex}
          newlyUnlockedCerts={pendingCertUnlocks}
        />
      )}
    </>
  );
}

export default Index;
