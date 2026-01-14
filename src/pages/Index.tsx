import { useCallback, useState } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { useLevelManager } from '@/hooks/useLevelManager';
import { useUpgradeManager } from '@/hooks/useUpgradeManager';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import { GameResult, LevelScoreData } from '@/types/game';

const Index = () => {
  const { 
    currentScreen, 
    lastResult, 
    startGame, 
    endGame, 
    goToWelcome, 
    goToTutorial 
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

  const handleStartGame = useCallback(async () => {
    // Load both levels and upgrades in parallel
    const [levelsSuccess, upgradesSuccess] = await Promise.all([
      loadLevels(),
      loadUpgrades(),
    ]);
    
    if (levelsSuccess && upgradesSuccess) {
      setTotalScore(0);
      setPendingLevelScore(null);
      setShowLevelComplete(false);
      startGame();
    }
  }, [loadLevels, loadUpgrades, startGame]);

  const handleGameEnd = useCallback((result: GameResult) => {
    // For game over, include current total score
    endGame({
      ...result,
      totalScore,
    });
  }, [endGame, totalScore]);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    // Accumulate score
    const newTotalScore = totalScore + scoreData.levelScore;
    setTotalScore(newTotalScore);
    setPendingLevelScore(scoreData);
    setShowLevelComplete(true);
  }, [totalScore]);

  const handleContinueFromOverlay = useCallback(() => {
    setShowLevelComplete(false);
    setPendingLevelScore(null);
    
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
    } else {
      // Advance to next level
      advanceToNextLevel();
    }
  }, [isLastLevel, advanceToNextLevel, endGame, currentLevel, currentLevelIndex, totalScore, pendingLevelScore]);

  const handlePlayAgain = useCallback(() => {
    resetToFirstLevel();
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    startGame();
  }, [resetToFirstLevel, startGame]);

  const handleBackToWelcome = useCallback(() => {
    resetToFirstLevel();
    setTotalScore(0);
    setPendingLevelScore(null);
    setShowLevelComplete(false);
    goToWelcome();
  }, [resetToFirstLevel, goToWelcome]);

  return (
    <>
      {currentScreen === 'welcome' && (
        <WelcomeScreen 
          onStartGame={handleStartGame} 
          onTutorial={goToTutorial}
          isLoading={isLoading}
          error={error}
        />
      )}
      {currentScreen === 'tutorial' && (
        <TutorialScreen onBack={goToWelcome} />
      )}
      {currentScreen === 'game' && currentLevel && (
        <GameScreen 
          level={currentLevel}
          levelNumber={currentLevelIndex + 1}
          totalLevels={totalLevels}
          totalScore={totalScore}
          onGameEnd={handleGameEnd}
          onLevelComplete={handleLevelComplete}
        />
      )}
      {currentScreen === 'result' && lastResult && (
        <ResultScreen
          result={lastResult}
          onPlayAgain={handlePlayAgain}
          onBackToWelcome={handleBackToWelcome}
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
