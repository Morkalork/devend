import { useCallback, useState, lazy, Suspense, useEffect } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { useLevelManager } from '@/hooks/useLevelManager';
import { useUpgradeManager } from '@/hooks/useUpgradeManager';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { useHighscores } from '@/hooks/useHighscores';
import { useInteractiveTutorial } from '@/hooks/useInteractiveTutorial';
import { useCheckpoint, getTierScoreMultiplier } from '@/hooks/useCheckpoint';
import { AccentColorProvider, useAccentColor } from '@/contexts/AccentColorContext';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { OptionsScreen } from '@/components/game/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { HighscoresScreen } from '@/components/game/HighscoresScreen';
import { GameResult, LevelScoreData } from '@/types/game';

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
    goToHighscores,
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
  } = useUpgradeManager();

  // Combined loading and error states
  const isLoading = isLoadingLevels || isLoadingUpgrades;
  const error = levelError || upgradeError;

  // Score tracking
  const [totalScore, setTotalScore] = useState(0);
  const [pendingLevelScore, setPendingLevelScore] = useState<LevelScoreData | null>(null);
  const [showLevelComplete, setShowLevelComplete] = useState(false);
  
  // Owned upgrades tracking
  const [ownedUpgradeIds, setOwnedUpgradeIds] = useState<string[]>([]);
  
  // Lives tracking (persists across levels in a run)
  const [currentLives, setCurrentLives] = useState(BASE_LIVES);

  // Highscores management
  const { highscores, add: addHighscore, clear: clearHighscores, refresh: refreshHighscores } = useHighscores();

  // Interactive tutorial management
  const {
    tutorialMode,
    tutorialStep,
    startTutorialIfNeeded,
    replayTutorial,
    markTutorialComplete,
    advanceToWaitingForCut,
    exitTutorial,
  } = useInteractiveTutorial();

  // Checkpoint system for 10-minute tier restart
  const {
    hasActiveCheckpoint,
    isLoaded: checkpointLoaded,
    saveCheckpoint,
    clearCheckpoint,
    getStartingLevel,
    getRemainingTimeMs,
  } = useCheckpoint();

  // Calculate modifiers to track bonus lives
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades);

  const handleStartGame = useCallback(async (forceInteractiveTutorial = false) => {
    // Load both levels and upgrades in parallel
    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
    ]);
    
    if (levelsSuccess && upgradesSuccess) {
      setTotalScore(0);
      setPendingLevelScore(null);
      setShowLevelComplete(false);
      setOwnedUpgradeIds([]);
      setCurrentLives(BASE_LIVES); // Reset lives at start of new run
      
      // Check for active checkpoint and start from checkpoint level
      const startingLevel = getStartingLevel();
      if (startingLevel > 1) {
        // Start from checkpoint (convert 1-indexed level to 0-indexed)
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
  }, [loadLevels, loadUpgrades, startGame, startTutorialIfNeeded, replayTutorial, getStartingLevel, setLevelIndex, resetToFirstLevel]);

  const handleGameEnd = useCallback((result: GameResult) => {
    // Save checkpoint if player made it past level 5
    if (!result.isWin) {
      saveCheckpoint(result.levelNumber);
    } else if (result.completedAllLevels) {
      // Clear checkpoint on full game completion
      clearCheckpoint();
    }
    
    // For game over, include current total score and remaining lives
    endGame({
      ...result,
      totalScore,
    });
  }, [endGame, totalScore, saveCheckpoint, clearCheckpoint]);

  const handleLivesChange = useCallback((newLives: number) => {
    setCurrentLives(newLives);
    // Game over handling is done in GameCanvas with a delay for visual feedback
  }, []);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    // Apply tier score multiplier (10% boost per tier beyond first)
    const currentLevelNum = currentLevelIndex + 1;
    const tierMultiplier = getTierScoreMultiplier(currentLevelNum);
    const boostedLevelScore = Math.floor(scoreData.levelScore * tierMultiplier);
    
    // Accumulate score with tier boost applied
    const newTotalScore = totalScore + boostedLevelScore;
    setTotalScore(newTotalScore);
    setPendingLevelScore({
      ...scoreData,
      levelScore: boostedLevelScore,
      tierMultiplier, // Pass for display purposes
    });
    setShowLevelComplete(true);
  }, [totalScore, currentLevelIndex]);

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
    
    // Check if this upgrade grants lives
    const upgrade = upgrades.find(u => u.id === upgradeId);
    if (upgrade?.modifiers?.lives) {
      setCurrentLives(prev => prev + upgrade.modifiers.lives!);
    }
  }, [upgrades]);

  const handleContinueFromShop = useCallback(() => {
    setPendingLevelScore(null);
    advanceToNextLevel();
    goToGame();
  }, [advanceToNextLevel, goToGame]);

  const handlePlayAgain = useCallback(() => {
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setOwnedUpgradeIds([]);
    setCurrentLives(BASE_LIVES);
    
    // Respect checkpoint system - start from checkpoint level if available
    const startingLevel = getStartingLevel();
    if (startingLevel > 1) {
      setLevelIndex(startingLevel - 1);
    } else {
      resetToFirstLevel();
    }
    
    startGame();
  }, [resetToFirstLevel, startGame, getStartingLevel, setLevelIndex]);

  const handleBackToWelcome = useCallback(() => {
    resetToFirstLevel();
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setOwnedUpgradeIds([]);
    setCurrentLives(BASE_LIVES);
    goToWelcome();
  }, [resetToFirstLevel, goToWelcome]);

  const handleSaveHighscore = useCallback((name: string) => {
    if (!lastResult) return;
    
    addHighscore({
      name,
      level: lastResult.levelNumber,
      totalScore: lastResult.totalScore ?? 0,
      dateTime: new Date().toISOString(),
    });
  }, [lastResult, addHighscore]);

  const handleHighscoresFromWelcome = useCallback(() => {
    refreshHighscores();
    goToHighscores();
  }, [refreshHighscores, goToHighscores]);

  const handleReplayInteractiveTutorial = useCallback(() => {
    handleStartGame(true); // Force tutorial mode
  }, [handleStartGame]);

  const handleClearHighscoresFromOptions = useCallback(() => {
    clearHighscores();
  }, [clearHighscores]);

  // Get checkpoint info for welcome screen
  const checkpointStartLevel = getStartingLevel();
  const checkpointRemaining = getRemainingTimeMs();

  // Use checkpoint level for accent color when not actively playing
  // This ensures menus reflect the player's progression tier
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
        highscores={highscores}
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
        handleSaveHighscore={handleSaveHighscore}
        handleHighscoresFromWelcome={handleHighscoresFromWelcome}
        handleReplayInteractiveTutorial={handleReplayInteractiveTutorial}
        clearHighscores={clearHighscores}
        goToWelcome={goToWelcome}
        goToTutorial={goToTutorial}
        goToOptions={goToOptions}
        goToHighscores={goToHighscores}
        goToAdmin={goToAdmin}
        goToMapBuilder={goToMapBuilder}
        markTutorialComplete={markTutorialComplete}
        checkpointLevel={checkpointStartLevel}
        checkpointRemainingMs={checkpointRemaining}
      />
    </AccentColorProvider>
  );
};

// Separate component to access accent color context
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
  highscores: any[];
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
  handleContinueFromShop: () => void;
  handlePlayAgain: () => void;
  handleBackToWelcome: () => void;
  handleSaveHighscore: (name: string) => void;
  handleHighscoresFromWelcome: () => void;
  handleReplayInteractiveTutorial: () => void;
  clearHighscores: () => void;
  goToWelcome: () => void;
  goToTutorial: () => void;
  goToOptions: () => void;
  goToHighscores: () => void;
  goToAdmin: () => void;
  goToMapBuilder: () => void;
  markTutorialComplete: () => void;
  checkpointLevel?: number;
  checkpointRemainingMs?: number;
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
  highscores,
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
  handleContinueFromShop,
  handlePlayAgain,
  handleBackToWelcome,
  handleSaveHighscore,
  handleHighscoresFromWelcome,
  handleReplayInteractiveTutorial,
  clearHighscores,
  goToWelcome,
  goToTutorial,
  goToOptions,
  goToHighscores,
  goToAdmin,
  goToMapBuilder,
  markTutorialComplete,
  checkpointLevel,
  checkpointRemainingMs,
}: IndexContentProps) {
  const { accentHex } = useAccentColor();

  return (
    <>
      {currentScreen === 'welcome' && (
        <WelcomeScreen 
          onStartGame={() => handleStartGame(false)} 
          onTutorial={goToTutorial}
          onOptions={goToOptions}
          onHighscores={handleHighscoresFromWelcome}
          onAdmin={import.meta.env.DEV || new URLSearchParams(window.location.search).get('admin') === 'true' ? goToAdmin : undefined}
          isLoading={isLoading}
          error={error}
          accentColor={accentHex}
          checkpointLevel={checkpointLevel}
          checkpointRemainingMs={checkpointRemainingMs}
        />
      )}
      {currentScreen === 'tutorial' && (
        <TutorialScreen onBack={goToWelcome} accentColor={accentHex} />
      )}
      {currentScreen === 'options' && (
        <OptionsScreen
          onBack={goToWelcome}
          onReplayTutorial={handleReplayInteractiveTutorial}
          onClearHighscores={clearHighscores}
          hasHighscores={highscores.length > 0}
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
        />
      )}
      {currentScreen === 'upgradeShop' && (
        <UpgradeShop
          playerPoints={totalScore}
          levelNumber={currentLevelIndex + 1}
          upgrades={upgrades}
          ownedUpgradeIds={ownedUpgradeIds}
          onPurchase={handlePurchaseUpgrade}
          onContinue={handleContinueFromShop}
          accentColor={accentHex}
        />
      )}
      {currentScreen === 'result' && lastResult && (
        <ResultScreen
          result={lastResult}
          onPlayAgain={handlePlayAgain}
          onBackToWelcome={handleBackToWelcome}
          onSaveHighscore={handleSaveHighscore}
          onViewHighscores={goToHighscores}
          accentColor={accentHex}
        />
      )}
      {currentScreen === 'highscores' && (
        <HighscoresScreen
          highscores={highscores}
          onBack={goToWelcome}
          onClear={clearHighscores}
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
