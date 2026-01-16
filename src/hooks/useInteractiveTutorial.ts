import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'ball_breaker_seen_interactive_tutorial';

export type TutorialStep = 'showingHint' | 'waitingForSuccessfulCut' | 'completed';

export function useInteractiveTutorial() {
  const [hasSeenTutorial, setHasSeenTutorial] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [tutorialMode, setTutorialMode] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>('showingHint');
  const [forceReplay, setForceReplay] = useState(false);

  const markTutorialComplete = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
      setHasSeenTutorial(true);
    } catch {
      // localStorage might be unavailable
    }
    setTutorialMode(false);
    setTutorialStep('completed');
    setForceReplay(false);
  }, []);

  const startTutorialIfNeeded = useCallback(() => {
    // If force replay is active OR user hasn't seen tutorial, start it
    if (forceReplay || !hasSeenTutorial) {
      setTutorialMode(true);
      setTutorialStep('showingHint');
      return true;
    }
    return false;
  }, [forceReplay, hasSeenTutorial]);

  const replayTutorial = useCallback(() => {
    setForceReplay(true);
    setTutorialMode(true);
    setTutorialStep('showingHint');
  }, []);

  const advanceToWaitingForCut = useCallback(() => {
    setTutorialStep('waitingForSuccessfulCut');
  }, []);

  const exitTutorial = useCallback(() => {
    setTutorialMode(false);
    setTutorialStep('completed');
    setForceReplay(false);
  }, []);

  return {
    hasSeenTutorial,
    tutorialMode,
    tutorialStep,
    forceReplay,
    startTutorialIfNeeded,
    replayTutorial,
    markTutorialComplete,
    advanceToWaitingForCut,
    exitTutorial,
  };
}
