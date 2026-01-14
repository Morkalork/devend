import { useState, useCallback } from 'react';
import { GameScreen } from '@/types/game';

export function useGameState() {
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('welcome');
  const [lastResult, setLastResult] = useState<{ isWin: boolean; remainingPercent: number } | null>(null);

  const navigateTo = useCallback((screen: GameScreen) => {
    setCurrentScreen(screen);
  }, []);

  const startGame = useCallback(() => {
    setLastResult(null);
    setCurrentScreen('game');
  }, []);

  const endGame = useCallback((isWin: boolean, remainingPercent: number) => {
    setLastResult({ isWin, remainingPercent });
    setCurrentScreen('result');
  }, []);

  const goToWelcome = useCallback(() => {
    setCurrentScreen('welcome');
  }, []);

  const goToTutorial = useCallback(() => {
    setCurrentScreen('tutorial');
  }, []);

  return {
    currentScreen,
    lastResult,
    navigateTo,
    startGame,
    endGame,
    goToWelcome,
    goToTutorial,
  };
}
