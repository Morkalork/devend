import { useCallback, useState, lazy, Suspense, useEffect, useRef } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { useLevelManager } from '@/hooks/useLevelManager';
import { useUpgradeManager } from '@/hooks/useUpgradeManager';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { useTutorialManager } from '@/hooks/useTutorialManager';
import { useCheckpoint } from '@/hooks/useCheckpoint';
import { useAugmentManager } from '@/hooks/useAugmentManager';
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
import { Augment } from '@/types/augment';
import { MetaProgressionStats } from '@/types/metaProgression';

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

  // Augment system (persistent meta-progression with Augment Points)
  // Point earned callback for visual feedback
  const [showPointEarnedFlash, setShowPointEarnedFlash] = useState(false);
  const handleAugmentPointEarned = useCallback(() => {
    setShowPointEarnedFlash(true);
    setTimeout(() => setShowPointEarnedFlash(false), 1500);
  }, []);

  const {
    augments,
    totalAugmentPoints,
    augmentsOwned,
    totalLevelsCompleted,
    runLevelsCompleted,
    runPointsEarned,
    loadAugments,
    resetRunProgress,
    incrementRunLevel,
    finalizeRun,
    getRunProgress,
    purchaseAugmentStack,
    getOwnedAugments,
    getAugmentEffectValue,
    resetAllData: resetAugmentData,
  } = useAugmentManager({ onPointEarned: handleAugmentPointEarned });

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

  // Meta progression system for tracking unlocks
  const {
    stats: metaStats,
    unlockedIds,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    checkAndUnlock,
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

  // Track points awarded this run for display (computed from hook)
  const runPointsAwarded = runPointsEarned;
  
  // Track lives at start of level for perfect level detection
  const [livesAtLevelStart, setLivesAtLevelStart] = useState(BASE_LIVES);

  // Calculate modifiers to track bonus lives (including achievement bonuses)
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades, achievementBonuses);

  // Get owned augments for applying effects
  const ownedAugmentsList = getOwnedAugments();

  // Calculate starting lives from augments
  const getStartingLivesFromAugments = useCallback(() => {
    let bonusLives = 0;
    ownedAugmentsList.forEach(({ augment, stacks }) => {
      if (augment.effect.type === 'startingLivesBonus') {
        bonusLives += augment.effect.value * stacks;
      }
    });
    return BASE_LIVES + bonusLives;
  }, [ownedAugmentsList]);

  // Calculate starting level from augments (takes highest value)
  const getStartingLevelFromAugments = useCallback(() => {
    let maxStartingLevel = 1;
    ownedAugmentsList.forEach(({ augment, stacks }) => {
      if (augment.effect.type === 'startingLevelBonus' && stacks > 0) {
        // Take the highest starting level bonus
        maxStartingLevel = Math.max(maxStartingLevel, augment.effect.value);
      }
    });
    return maxStartingLevel;
  }, [ownedAugmentsList]);

  const handleStartGame = useCallback(async () => {
    // Load levels, upgrades, and augments in parallel
    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
      loadAugments(),
    ]);

    if (levelsSuccess && upgradesSuccess) {
      setTotalScore(0);
      setPendingLevelScore(null);
      setShowLevelComplete(false);
      setOwnedUpgradeIds([]);
      resetRunProgress(); // Reset in-run augment tracking

      // Calculate starting lives from owned augments
      const startingLives = getStartingLivesFromAugments();
      setCurrentLives(startingLives);
      setLivesAtLevelStart(startingLives);

      // Determine starting level: max of checkpoint, augment bonus, and ?level= query param
      const checkpointLevel = getStartingLevel();
      const augmentStartLevel = getStartingLevelFromAugments();
      const queryLevel = parseInt(new URLSearchParams(window.location.search).get('level') || '0', 10);
      const startingLevel = Math.max(checkpointLevel, augmentStartLevel, queryLevel || 0);

      if (startingLevel > 1) {
        // Start from higher level (convert 1-indexed level to 0-indexed)
        setLevelIndex(startingLevel - 1);
      } else {
        resetToFirstLevel();
      }

      startGame();
    }
  }, [loadLevels, loadUpgrades, loadAugments, startGame, getStartingLevel, setLevelIndex, resetToFirstLevel, getStartingLivesFromAugments, getStartingLevelFromAugments, resetRunProgress]);

  const handleGameEnd = useCallback((result: GameResult) => {
    // Save checkpoint if player made it past level 5
    if (!result.isWin) {
      saveCheckpoint(result.levelNumber);
    } else if (result.completedAllLevels) {
      // Clear checkpoint on full game completion
      clearCheckpoint();
    }
    
    // Finalize run and award Augment Points
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
    
    // Increment levels completed this run (tracked in augment manager)
    incrementRunLevel();
    
    // Check if level was completed without losing a life
    if (currentLives >= livesAtLevelStart) {
      recordPerfectLevel();
    }
    
    // Check and unlock any newly available augments
    checkAndUnlock(augments);

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
    
    // Reset lives at level start for next level
    setLivesAtLevelStart(currentLives);
  }, [totalScore, currentLevelIndex, recordLevelReached, recordFencesDrawn, recordPerfectLevel, checkAndUnlock, augments, currentLives, livesAtLevelStart, incrementRunLevel, activeModifiers.scoreInterestRate, checkAndCompleteAchievements, metaStats]);

  const handleContinueFromOverlay = useCallback(() => {
    setShowLevelComplete(false);
    
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

  const handlePurchaseUpgrade = useCallback((upgradeId: string, price: number) => {
    setTotalScore(prev => prev - price);
    setOwnedUpgradeIds(prev => [...prev, upgradeId]);
    
    // Check if this upgrade grants extra lives
    const upgrade = upgrades.find(u => u.id === upgradeId);
    const extraLives = upgrade?.modifiers?.extraLives;
    if (extraLives && typeof extraLives === 'number') {
      setCurrentLives(prev => prev + extraLives);
    }
  }, [upgrades]);

  const handleContinueFromShop = useCallback(() => {
    setPendingLevelScore(null);
    advanceToNextLevel();
    goToGame();
  }, [advanceToNextLevel, goToGame]);

  const handlePurchaseAugment = useCallback((augment: Augment) => {
    purchaseAugmentStack(augment);
  }, [purchaseAugmentStack]);

  const handlePlayAgain = useCallback(() => {
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setOwnedUpgradeIds([]);
    resetRunProgress(); // Reset in-run augment tracking
    
    // Calculate starting lives from owned augments
    const startingLives = getStartingLivesFromAugments();
    setCurrentLives(startingLives);
    setLivesAtLevelStart(startingLives);
    
    // Determine starting level: max of checkpoint and augment bonus
    const checkpointLevel = getStartingLevel();
    const augmentStartLevel = getStartingLevelFromAugments();
    const startingLevel = Math.max(checkpointLevel, augmentStartLevel);
    
    if (startingLevel > 1) {
      setLevelIndex(startingLevel - 1);
    } else {
      resetToFirstLevel();
    }
    
    startGame();
  }, [resetToFirstLevel, startGame, getStartingLevel, setLevelIndex, getStartingLivesFromAugments, getStartingLevelFromAugments, resetRunProgress]);

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
    await loadAugments();
    goToAugmentStore();
  }, [loadAugments, goToAugmentStore]);

  const handleAchievementsFromWelcome = useCallback(() => {
    goToAchievements();
  }, [goToAchievements]);

  const handleReEnableAllTutorials = useCallback(() => {
    resetAllTutorials();
  }, [resetAllTutorials]);

  const handleResetAugments = useCallback(() => {
    resetAugmentData();
    resetProgression();
  }, [resetAugmentData, resetProgression]);

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
        handlePurchaseAugment={handlePurchaseAugment}
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
        augments={augments}
        totalAugmentPoints={totalAugmentPoints}
        augmentsOwned={augmentsOwned}
        ownedAugmentsList={ownedAugmentsList}
        metaStats={metaStats}
        unlockedIds={unlockedIds}
        runPointsAwarded={runPointsAwarded}
        runLevelsCompleted={runLevelsCompleted}
        totalLevelsCompleted={totalLevelsCompleted}
        augmentProgress={getRunProgress()}
        extraShopItems={activeModifiers.extraShopItems}
        achievements={achievements}
        completedAchievementIds={completedAchievementIds}
        activatedAchievementIds={activatedAchievementIds}
        activateAchievement={activateAchievement}
        achievementBonuses={achievementBonuses}
        getClosestAchievements={getClosestAchievements}
        handleAchievementsFromWelcome={handleAchievementsFromWelcome}
        goToWelcomeFromAchievements={goToWelcome}
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
  currentLevel: any;
  currentLevelIndex: number;
  totalLevels: number;
  totalScore: number;
  currentLives: number;
  ownedUpgradeIds: string[];
  upgrades: any[];
  isLoading: boolean;
  error: string | null;
  showInGameTutorial: boolean;
  shouldShowStore: boolean;
  shouldShowAugment: boolean;
  lastResult: any;
  showLevelComplete: boolean;
  pendingLevelScore: LevelScoreData | null;
  handleStartGame: () => void;
  handleGameEnd: (result: GameResult) => void;
  handleLivesChange: (lives: number) => void;
  handleLevelComplete: (scoreData: LevelScoreData) => void;
  handleContinueFromOverlay: () => void;
  handlePurchaseUpgrade: (id: string, price: number) => void;
  canPurchaseUpgrade: (upgradeId: string, playerScore: number, ownedIds: string[]) => boolean;
  isUpgradeLocked: (upgradeId: string, ownedIds: string[]) => boolean;
  handleContinueFromShop: () => void;
  handlePlayAgain: () => void;
  handleBackToWelcome: () => void;
  handleAugmentsFromWelcome: () => void;
  handleReEnableAllTutorials: () => void;
  onFenceSeen: () => void;
  onStoreTutorialDismiss: () => void;
  onAugmentTutorialDismiss: () => void;
  handleResetAugments: () => void;
  handlePurchaseAugment: (augment: Augment) => void;
  goToWelcome: () => void;
  goToTutorial: () => void;
  goToOptions: () => void;
  goToAdmin: () => void;
  goToMapBuilder: () => void;
  goToAnimationTest: () => void;
  checkpointLevel?: number;
  checkpointRemainingMs?: number;
  augments: Augment[];
  totalAugmentPoints: number;
  augmentsOwned: Record<string, number>;
  ownedAugmentsList: { augment: Augment; stacks: number }[];
  metaStats: MetaProgressionStats;
  unlockedIds: string[];
  runPointsAwarded: number;
  runLevelsCompleted: number;
  totalLevelsCompleted: number;
  augmentProgress: AugmentProgress;
  extraShopItems: number;
  achievements: import('@/types/achievement').Achievement[];
  completedAchievementIds: string[];
  activatedAchievementIds: string[];
  activateAchievement: (id: string) => void;
  achievementBonuses: Partial<Record<string, number>>;
  getClosestAchievements: (stats: MetaProgressionStats) => import('@/types/achievement').Achievement[];
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
  handleBackToWelcome,
  handleAugmentsFromWelcome,
  handleReEnableAllTutorials,
  handleResetAugments,
  handlePurchaseAugment,
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
  augments,
  totalAugmentPoints,
  augmentsOwned,
  ownedAugmentsList,
  metaStats,
  unlockedIds,
  runPointsAwarded,
  runLevelsCompleted,
  totalLevelsCompleted,
  augmentProgress,
  extraShopItems,
  achievements,
  completedAchievementIds,
  activatedAchievementIds,
  activateAchievement,
  achievementBonuses,
  getClosestAchievements,
  handleAchievementsFromWelcome,
  goToWelcomeFromAchievements,
}: IndexContentProps) {
  const { accentHex } = useAccentColor();

  return (
    <>
      {currentScreen === 'welcome' && (
        <WelcomeScreen
          onStartGame={() => handleStartGame()}
          onTutorial={goToTutorial}
          onOptions={goToOptions}
          onAugments={handleAugmentsFromWelcome}
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
          hasAugments={Object.keys(augmentsOwned).length > 0 || totalAugmentPoints > 0}
          accentColor={accentHex}
        />
      )}
      {currentScreen === 'game' && currentLevel && (
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
        />
      )}
      {currentScreen === 'result' && lastResult && (
        <ResultScreen
          result={lastResult}
          onPlayAgain={handlePlayAgain}
          onBackToWelcome={handleBackToWelcome}
          accentColor={accentHex}
          ownedAugments={ownedAugmentsList}
          runPointsAwarded={runPointsAwarded}
          runLevelsCompleted={runLevelsCompleted}
        />
      )}
      {currentScreen === 'augmentStore' && (
        <AugmentStore
          augments={augments}
          totalAugmentPoints={totalAugmentPoints}
          augmentsOwned={augmentsOwned}
          unlockedIds={unlockedIds}
          metaStats={metaStats}
          onPurchase={handlePurchaseAugment}
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
      
      {/* Level Complete Overlay */}
      {showLevelComplete && pendingLevelScore && (
        <LevelCompleteOverlay
          scoreData={pendingLevelScore}
          totalScore={totalScore}
          onContinue={handleContinueFromOverlay}
          accentColor={accentHex}
        />
      )}
    </>
  );
}

export default Index;
