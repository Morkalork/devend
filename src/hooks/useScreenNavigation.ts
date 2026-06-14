/**
 * useScreenNavigation — which screen is currently visible.
 *
 * The app is a state-machine of full-screen views (see the GameScreen type
 * in src/types/game.ts). This hook owns the current screen plus the last
 * game result, and exposes one goToX() helper per screen. No game logic
 * lives here — that is useGameSession's job.
 */
import { useState, useCallback } from 'react';
import { GameScreen, GameResult } from '@/types/game';

export function useScreenNavigation() {
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

  const goToAscensionDraft = useCallback(() => {
    setCurrentScreen('ascensionDraft');
  }, []);

  const goToCertificateStore = useCallback(() => {
    setCurrentScreen('certificateStore');
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

  const goToAchievements = useCallback(() => {
    setCurrentScreen('achievements');
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
    goToAscensionDraft,
    goToCertificateStore,
    goToOptions,
    goToAchievements,
    goToAdmin,
    goToMapBuilder,
    goToAnimationTest,
  };
}
