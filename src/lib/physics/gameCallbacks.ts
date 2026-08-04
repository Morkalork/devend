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
  /** Completed-fence count changed (for the fence-budget HUD). */
  setCompletedCuts?: (n: number) => void;
  /** Boss ball state changed (issue #56): a hit (hp drops) or defeat, so the boss
   *  banner can mirror HP and flash. Optional (bare game states omit it). */
  onBossState?: (hp: number, maxHp: number, defeated: boolean) => void;
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
  /** Time ran out with lives to spare: the map is lost for ONE life and must be
   *  restarted fresh (the session remounts the current level). Only fired when
   *  a life remains; at zero lives the normal game-over path runs instead. */
  onMapTimedOut?: () => void;
  onTutorialCutSuccess?: () => void;
  /** Fired once per ball the instant it locks, with its ball-type id (#tutorial
   *  encountered-ball-types tracking). Returns true iff this was the player's
   *  first-ever lock of that type, so the caller can flash "Info Unlocked".
   *  Optional: tests/tools that build a bare CanvasGameState can omit it. */
  onBallTypeLocked?: (typeId: string) => boolean;
  /** Fired when the ball count changes mid-map (a Fork pickup split a ball),
   *  so the Ship Early countdown bar rescales its per-ball windows. */
  onBallCountChanged?: (count: number) => void;
  /** Fired when a "Wire the Integration" circuit completes and its vault opens,
   *  so the UI can flash the telegraph banner + play a sound. Optional. */
  onCircuitComplete?: (announce?: string) => void;
  /** Fired when a "Deploy Charge" fuse is armed by a routed fence, so the UI can
   *  flash the wind-up telegraph banner. Optional. */
  onChargeArmed?: (announce?: string) => void;
  /** Fired when a "Deploy Charge" detonates its target slab, for the payoff
   *  banner. Optional. */
  onChargeBlown?: (announce?: string) => void;
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
