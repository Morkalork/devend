import { useCallback } from 'react';
import { useGameState } from '@/hooks/useGameState';
import { useLevelManager } from '@/hooks/useLevelManager';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';
import { GameResult } from '@/types/game';

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
    isLoading,
    error,
    loadLevels,
    advanceToNextLevel,
    resetToFirstLevel,
  } = useLevelManager();

  const handleStartGame = useCallback(async () => {
    const success = await loadLevels();
    if (success) {
      startGame();
    }
  }, [loadLevels, startGame]);

  const handleGameEnd = useCallback((result: GameResult) => {
    endGame(result);
  }, [endGame]);

  const handleLevelComplete = useCallback(() => {
    if (isLastLevel) {
      // All levels complete - show final win screen
      endGame({
        isWin: true,
        remainingPercent: 0,
        levelId: currentLevel?.id || '',
        levelNumber: currentLevelIndex + 1,
        completedAllLevels: true,
      });
    } else {
      // Advance to next level
      advanceToNextLevel();
    }
  }, [isLastLevel, advanceToNextLevel, endGame, currentLevel, currentLevelIndex]);

  const handlePlayAgain = useCallback(() => {
    resetToFirstLevel();
    startGame();
  }, [resetToFirstLevel, startGame]);

  const handleBackToWelcome = useCallback(() => {
    resetToFirstLevel();
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
    </>
  );
};

export default Index;
