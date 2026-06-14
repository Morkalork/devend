import React from 'react';
import { LevelScoreData, GameResult } from '@/types/game';

export interface GameCallbacks {
  // React state setters
  setLockedBallsCount: (n: number) => void;
  setRemainingPercent: (n: number) => void;
  setTutorialCutMade: (v: boolean) => void;
  setPushMode: (m: 'none' | 'prompt' | 'pushing') => void;
  setClearedPercent: (n: number | null) => void;
  setScreenFlash: (f: 'none' | 'red') => void;
  setIsShaking: (v: boolean) => void;
  setIsRecovering: (v: boolean) => void;
  setWallShieldCount: (n: number) => void;
  setDisplayLives: (n: number) => void;
  // Outcome callbacks (wrap refs so extracted fns don't hold stale closures)
  onLevelComplete: (data: LevelScoreData) => void;
  onGameEnd: (result: GameResult) => void;
  onLivesChange: (n: number) => void;
  onTutorialCutSuccess?: () => void;
  // Lives ref access — updateWall needs mutable live value
  getLives: () => number;
  setLivesRef: (n: number) => void;
  // Timeout refs for debouncing flash / shake
  flashTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  shakeTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  // Canvas helpers (closures over offscreen canvases — can't be serialised)
  repaintRegionCanvas: () => void;
  collectAndDrawRemovedSamples: () => void;
  render: () => void;
  startDissolve: (onComplete: () => void, tint?: string) => void;
}
