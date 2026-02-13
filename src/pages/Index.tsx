import { useCallback, useState, lazy, Suspense, useEffect, useRef } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { useLevelManager } from '@/hooks/useLevelManager';
import { useUpgradeManager } from '@/hooks/useUpgradeManager';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { useInteractiveTutorial } from '@/hooks/useInteractiveTutorial';
import { useCheckpoint, getTierScoreMultiplier } from '@/hooks/useCheckpoint';
import { useAugmentManager } from '@/hooks/useAugmentManager';
import { useMetaProgression } from '@/hooks/useMetaProgression';
import { AccentColorProvider, useAccentColor } from '@/contexts/AccentColorContext';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { OptionsScreen } from '@/components/game/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { AugmentStore } from '@/components/game/AugmentStore';
import { GameResult, LevelScoreData } from '@/types/game';
import { Augment } from '@/types/augment';
import { MetaProgressionStats } from '@/types/metaProgression';

// Lazy load admin components (dev-only)
const AdminScreen = lazy(() => import('@/components/admin/AdminScreen').then(m => ({ default: m.AdminScreen })));
const MapBuilder = lazy(() => import('@/components/admin/MapBuilder').then(m => ({ default: m.MapBuilder })));

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
    goToAdmin,
    goToMapBuilder,
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

  // Interactive tutorial management
  const {
    tutorialMode,
    tutorialStep,
    startTutorialIfNeeded,
    replayTutorial,
    markTutorialComplete,
  } = useInteractiveTutorial();

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

  // Track points awarded this run for display (computed from hook)
  const runPointsAwarded = runPointsEarned;
  
  // Track lives at start of level for perfect level detection
  const [livesAtLevelStart, setLivesAtLevelStart] = useState(BASE_LIVES);

  // Calculate modifiers to track bonus lives
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades);

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

  const handleStartGame = useCallback(async (forceInteractiveTutorial = false) => {
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
      
      // Determine starting level: max of checkpoint and augment bonus
      const checkpointLevel = getStartingLevel();
      const augmentStartLevel = getStartingLevelFromAugments();
      const startingLevel = Math.max(checkpointLevel, augmentStartLevel);
      
      if (startingLevel > 1) {
        // Start from higher level (convert 1-indexed level to 0-indexed)
        setLevelIndex(startingLevel - 1);
      } else {
        resetToFirstLevel();
      }
      
      // Check if we need to start interactive tutorial
      if (forceInteractiveTutorial) {
        replayTutorial();
      } else {
        // Only start tutorial if starting from level 1
        if (startingLevel === 1) {
          startTutorialIfNeeded();
        }
      }
      
      startGame();
    }
  }, [loadLevels, loadUpgrades, loadAugments, startGame, startTutorialIfNeeded, replayTutorial, getStartingLevel, setLevelIndex, resetToFirstLevel, getStartingLivesFromAugments, getStartingLevelFromAugments, resetRunProgress]);

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
    
    // Apply tier score multiplier (10% boost per tier beyond first)
    const tierMultiplier = getTierScoreMultiplier(currentLevelNum);
    const boostedLevelScore = Math.floor(scoreData.levelScore * tierMultiplier);
    
    // Accumulate score with tier boost applied
    const newTotalScore = totalScore + boostedLevelScore;
    setTotalScore(newTotalScore);
    setPendingLevelScore({
      ...scoreData,
      levelScore: boostedLevelScore,
      tierMultiplier,
    });
    setShowLevelComplete(true);
    
    // Reset lives at level start for next level
    setLivesAtLevelStart(currentLives);
  }, [totalScore, currentLevelIndex, recordLevelReached, recordFencesDrawn, recordPerfectLevel, checkAndUnlock, augments, currentLives, livesAtLevelStart, incrementRunLevel]);

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

  const handleReplayInteractiveTutorial = useCallback(() => {
    handleStartGame(true);
  }, [handleStartGame]);

  const handleResetAugments = useCallback(() => {
    resetAugmentData();
    resetProgression();
  }, [resetAugmentData, resetProgression]);

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
        tutorialMode={tutorialMode}
        tutorialStep={tutorialStep}
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
        handleReplayInteractiveTutorial={handleReplayInteractiveTutorial}
        handleResetAugments={handleResetAugments}
        canPurchaseUpgrade={canPurchaseUpgrade}
        isUpgradeLocked={isUpgradeLocked}
        handlePurchaseAugment={handlePurchaseAugment}
        goToWelcome={goToWelcome}
        goToTutorial={goToTutorial}
        goToOptions={goToOptions}
        goToAdmin={goToAdmin}
        goToMapBuilder={goToMapBuilder}
        markTutorialComplete={markTutorialComplete}
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
  tutorialMode: boolean;
  tutorialStep: any;
  lastResult: any;
  showLevelComplete: boolean;
  pendingLevelScore: LevelScoreData | null;
  handleStartGame: (force?: boolean) => void;
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
  handleReplayInteractiveTutorial: () => void;
  handleResetAugments: () => void;
  handlePurchaseAugment: (augment: Augment) => void;
  goToWelcome: () => void;
  goToTutorial: () => void;
  goToOptions: () => void;
  goToAdmin: () => void;
  goToMapBuilder: () => void;
  markTutorialComplete: () => void;
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
  tutorialMode,
  tutorialStep,
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
  handleReplayInteractiveTutorial,
  handleResetAugments,
  handlePurchaseAugment,
  goToWelcome,
  goToTutorial,
  goToOptions,
  goToAdmin,
  goToMapBuilder,
  markTutorialComplete,
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
}: IndexContentProps) {
  const { accentHex } = useAccentColor();

  return (
    <>
      {currentScreen === 'welcome' && (
        <WelcomeScreen 
          onStartGame={() => handleStartGame(false)} 
          onTutorial={goToTutorial}
          onOptions={goToOptions}
          onAugments={handleAugmentsFromWelcome}
          onAdmin={import.meta.env.DEV || new URLSearchParams(window.location.search).get('admin') === 'true' ? goToAdmin : undefined}
          isLoading={isLoading}
          error={error}
          accentColor={accentHex}
          checkpointLevel={checkpointLevel}
          checkpointRemainingMs={checkpointRemainingMs}
          totalAugmentPoints={totalAugmentPoints}
        />
      )}
      {currentScreen === 'tutorial' && (
        <TutorialScreen onBack={goToWelcome} accentColor={accentHex} />
      )}
      {currentScreen === 'options' && (
        <OptionsScreen
          onBack={goToWelcome}
          onReplayTutorial={handleReplayInteractiveTutorial}
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
          tutorialMode={tutorialMode && currentLevelIndex === 0}
          tutorialStep={tutorialStep}
          onTutorialCutSuccess={markTutorialComplete}
          accentColor={accentHex}
          augmentProgress={augmentProgress}
        />
      )}
      {currentScreen === 'upgradeShop' && (
        <UpgradeShop
          playerPoints={totalScore}
          upgrades={upgrades}
          ownedUpgradeIds={ownedUpgradeIds}
          canPurchase={canPurchaseUpgrade}
          isLocked={isUpgradeLocked}
          onPurchase={handlePurchaseUpgrade}
          onContinue={handleContinueFromShop}
          accentColor={accentHex}
          extraShopItems={extraShopItems}
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
        />
      )}
      
      {/* Dev-only Admin screens */}
      {import.meta.env.DEV && currentScreen === 'admin' && (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
          <AdminScreen onBack={goToWelcome} onMapBuilder={goToMapBuilder} />
        </Suspense>
      )}
      {import.meta.env.DEV && currentScreen === 'mapBuilder' && (
        <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
          <MapBuilder onBack={goToAdmin} />
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
