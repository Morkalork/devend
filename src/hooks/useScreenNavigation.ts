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
import { hasPairInvite } from '@/lib/net/pairInvite';

export function useScreenNavigation() {
  // A guest who opened the host's QR link goes straight to the 2-Player screen,
  // which answers the invitation. Anywhere else, the game opens on the menu.
  const [currentScreen, setCurrentScreen] = useState<GameScreen>(
    () => hasPairInvite() ? 'pairLobby' : 'welcome',
  );
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

  const goToRunDraft = useCallback(() => {
    setCurrentScreen('runDraft');
  }, []);

  const goToDoorDraft = useCallback(() => {
    setCurrentScreen('doorDraft');
  }, []);

  const goToCapstoneDraft = useCallback(() => {
    setCurrentScreen('capstoneDraft');
  }, []);

  const goToTierDraft = useCallback(() => {
    setCurrentScreen('tierDraft');
  }, []);

  const goToAssignmentSummary = useCallback(() => {
    setCurrentScreen('assignmentSummary');
  }, []);

  const goToAscensionDraft = useCallback(() => {
    setCurrentScreen('ascensionDraft');
  }, []);

  const goToCertificateStore = useCallback(() => {
    setCurrentScreen('certificateStore');
  }, []);

  const goToLoadouts = useCallback(() => {
    setCurrentScreen('loadouts');
  }, []);

  const goToOptions = useCallback(() => {
    setCurrentScreen('options');
  }, []);

  /** Tenure pick (issue #75): shown before the loadout draft. */
  const goToTenureDraft = useCallback(() => {
    setCurrentScreen('tenureDraft');
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

  const goToUpgradeAtlas = useCallback(() => {
    setCurrentScreen('upgradeAtlas');
  }, []);

  const goToPairLoopback = useCallback(() => {
    setCurrentScreen('pairLoopback');
  }, []);

  const goToPairLobby = useCallback(() => {
    setCurrentScreen('pairLobby');
  }, []);

  const goToNearbyDiagnostics = useCallback(() => {
    setCurrentScreen('nearbyDiagnostics');
  }, []);

  const goToAchievements = useCallback(() => {
    setCurrentScreen('achievements');
  }, []);

  const goToHallOfFame = useCallback(() => {
    setCurrentScreen('hallOfFame');
  }, []);

  const goToJukebox = useCallback(() => {
    setCurrentScreen('jukebox');
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
    goToRunDraft,
    goToDoorDraft,
    goToCapstoneDraft,
    goToTierDraft,
    goToAssignmentSummary,
    goToAscensionDraft,
    goToCertificateStore,
    goToLoadouts,
    goToOptions,
    goToAchievements,
    goToHallOfFame,
    goToJukebox,
    goToTenureDraft,
    goToAdmin,
    goToMapBuilder,
    goToAnimationTest,
    goToUpgradeAtlas,
    goToPairLoopback,
    goToPairLobby,
    goToNearbyDiagnostics,
  };
}
