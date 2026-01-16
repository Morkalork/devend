import { useCallback, useState } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { useLevelManager } from '@/hooks/useLevelManager';
import { useUpgradeManager } from '@/hooks/useUpgradeManager';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { useHighscores } from '@/hooks/useHighscores';
import { useInteractiveTutorial } from '@/hooks/useInteractiveTutorial';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { OptionsScreen } from '@/components/game/OptionsScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { HighscoresScreen } from '@/components/game/HighscoresScreen';
import { GameResult, LevelScoreData } from '@/types/game';

const BASE_LIVES = 2;

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
      
      // Check if we need to start interactive tutorial
      if (forceInteractiveTutorial) {
        replayTutorial();
      } else {
        startTutorialIfNeeded();
      }
      
      startGame();
    }
  }, [loadLevels, loadUpgrades, startGame, startTutorialIfNeeded, replayTutorial]);

  const handleGameEnd = useCallback((result: GameResult) => {
    // For game over, include current total score and remaining lives
    endGame({
      ...result,
      totalScore,
    });
  }, [endGame, totalScore]);

  const handleLivesChange = useCallback((newLives: number) => {
    setCurrentLives(newLives);
    // Game over handling is done in GameCanvas with a delay for visual feedback
  }, []);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    // Accumulate score
    const newTotalScore = totalScore + scoreData.levelScore;
    setTotalScore(newTotalScore);
    setPendingLevelScore(scoreData);
    setShowLevelComplete(true);
  }, [totalScore]);

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
    resetToFirstLevel();
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    setOwnedUpgradeIds([]);
    setCurrentLives(BASE_LIVES);
    startGame();
  }, [resetToFirstLevel, startGame]);

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

  return (
    <>
      {currentScreen === 'welcome' && (
        <WelcomeScreen 
          onStartGame={() => handleStartGame(false)} 
          onTutorial={goToTutorial}
          onOptions={goToOptions}
          onHighscores={handleHighscoresFromWelcome}
          isLoading={isLoading}
          error={error}
        />
      )}
      {currentScreen === 'tutorial' && (
        <TutorialScreen onBack={goToWelcome} />
      )}
      {currentScreen === 'options' && (
        <OptionsScreen
          onBack={goToWelcome}
          onReplayTutorial={handleReplayInteractiveTutorial}
          onClearHighscores={handleClearHighscoresFromOptions}
          hasHighscores={highscores.length > 0}
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
        />
      )}
      {currentScreen === 'result' && lastResult && (
        <ResultScreen
          result={lastResult}
          onPlayAgain={handlePlayAgain}
          onBackToWelcome={handleBackToWelcome}
          onSaveHighscore={handleSaveHighscore}
          onViewHighscores={goToHighscores}
        />
      )}
      {currentScreen === 'highscores' && (
        <HighscoresScreen
          highscores={highscores}
          onBack={goToWelcome}
          onClear={clearHighscores}
        />
      )}
      
      {/* Level Complete Overlay */}
      {showLevelComplete && pendingLevelScore && (
        <LevelCompleteOverlay
          scoreData={pendingLevelScore}
          totalScore={totalScore}
          onContinue={handleContinueFromOverlay}
        />
      )}
    </>
  );
};

export default Index;
