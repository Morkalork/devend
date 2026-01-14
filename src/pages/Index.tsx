import { useGameState } from '@/hooks/useGameState';
import { WelcomeScreen } from '@/components/game/WelcomeScreen';
import { TutorialScreen } from '@/components/game/TutorialScreen';
import { GameScreen } from '@/components/game/GameScreen';
import { ResultScreen } from '@/components/game/ResultScreen';

const Index = () => {
  const { 
    currentScreen, 
    lastResult, 
    startGame, 
    endGame, 
    goToWelcome, 
    goToTutorial 
  } = useGameState();

  return (
    <>
      {currentScreen === 'welcome' && (
        <WelcomeScreen onStartGame={startGame} onTutorial={goToTutorial} />
      )}
      {currentScreen === 'tutorial' && (
        <TutorialScreen onBack={goToWelcome} />
      )}
      {currentScreen === 'game' && (
        <GameScreen onGameEnd={endGame} />
      )}
      {currentScreen === 'result' && lastResult && (
        <ResultScreen
          isWin={lastResult.isWin}
          remainingPercent={lastResult.remainingPercent}
          onPlayAgain={startGame}
          onBackToWelcome={goToWelcome}
        />
      )}
    </>
  );
};

export default Index;
