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
  /** Fired the instant the map is won (before the clear shimmer), so the UI can
   *  freeze the scrolling-code background. */
  onMapComplete?: () => void;
  /** Dev/playground: when true, play the clear shimmer then freeze on the drained
   *  frame instead of firing onLevelComplete / starting the dissolve. */
  freezeOnComplete?: () => boolean;
  onGameEnd: (result: GameResult) => void;
  onLivesChange: (n: number) => void;
  onTutorialCutSuccess?: () => void;
  /** Fired once per ball the instant it locks, with its ball-type id (#tutorial
   *  encountered-ball-types tracking). Returns true iff this was the player's
   *  first-ever lock of that type, so the caller can flash "Info Unlocked".
   *  Optional: tests/tools that build a bare CanvasGameState can omit it. */
  onBallTypeLocked?: (typeId: string) => boolean;
  /** Fired when the ball count changes mid-map (a Fork pickup split a ball),
   *  so the Ship Early countdown bar rescales its per-ball windows. */
  onBallCountChanged?: (count: number) => void;
  // Lives ref access — updateWall needs mutable live value
  getLives: () => number;
  setLivesRef: (n: number) => void;
  /** Run's banked overtime (totalScore), for the overtimePercent pickup (#52). */
  getBankedOvertime?: () => number;
  // Timeout refs for debouncing flash / shake
  flashTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  shakeTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  // Canvas helpers (closures over offscreen canvases — can't be serialised)
  repaintRegionCanvas: () => void;
  collectAndDrawRemovedSamples: () => void;
  render: () => void;
  startDissolve: (onComplete: () => void, tint?: string) => void;
}
