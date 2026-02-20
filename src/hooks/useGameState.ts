import { useState, useCallback } from 'react';
import { GameScreen, GameResult } from '@/types/game';

export function useGameState() {
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('welcome');
  const [lastResult, setLastResult] = useState<GameResult | null>(null);

  const navigateTo = useCallback((screen: GameScreen) => {
    setCurrentScreen(screen);
  }, []);

  const startGame = useCallback(() => {
    setLastResult(null);
    setCurrentScreen('game');
  }, []);

  const endGame = useCallback((result: GameResult) => {
    setLastResult(result);
    setCurrentScreen('result');
  }, []);

  const goToWelcome = useCallback(() => {
    setCurrentScreen('welcome');
  }, []);

  const goToTutorial = useCallback(() => {
    setCurrentScreen('tutorial');
  }, []);

  const goToUpgradeShop = useCallback(() => {
    setCurrentScreen('upgradeShop');
  }, []);

  const goToGame = useCallback(() => {
    setCurrentScreen('game');
  }, []);

  const goToAugmentStore = useCallback(() => {
    setCurrentScreen('augmentStore');
  }, []);

  const goToOptions = useCallback(() => {
    setCurrentScreen('options');
  }, []);

  const goToAdmin = useCallback(() => {
    setCurrentScreen('admin');
  }, []);

  const goToMapBuilder = useCallback(() => {
    setCurrentScreen('mapBuilder');
  }, []);

  const goToAnimationTest = useCallback(() => {
    setCurrentScreen('animationTest');
  }, []);

  return {
    currentScreen,
    lastResult,
    navigateTo,
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
    goToAnimationTest,
  };
}
