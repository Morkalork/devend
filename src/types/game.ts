import { Vector2, Polygon } from '@/lib/polygon';
import { BallEffectState } from '@/lib/ballEffects';

export type GameScreen = 'welcome' | 'tutorial' | 'game' | 'upgradeShop' | 'result' | 'augmentStore' | 'options' | 'achievements' | 'admin' | 'mapBuilder' | 'animationTest';

export type { Vector2 };

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Polygon-based region for diagonal cuts
export interface Region {
  id: string;
  polygon: Polygon;
  estimatedArea?: number; // Grid-based area estimate for accurate calculations after cuts
  samplePoints?: Vector2[]; // Grid sample points for accurate rendering
}

export type BallState = 'active' | 'won';

export interface Ball {
  id: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  speed: number;
  baseSpeed: number; // original speed at init, used by MicroManager to compute proportional reduction
  topSpeed: number;
  color: string; // hex color with #
  regionId: string; // which region this ball is in
  rotation: number; // current rotation angle in radians for spinning effect
  flashIntensity: number; // 0-1, LEGACY - kept for compatibility, use effects instead
  effects: BallEffectState; // Visual effect state for pulse, wall hit, ball hit
  state: BallState; // 'active' = normal, 'won' = captured in small region
  wonSpinSpeed: number; // Spin speed when in WON state
  wonTime: number;      // timestamp when entering WON state
  assimScale: number;   // visual scale factor for assimilation animation (default 1.0)
  assimColorFade: number; // 0→1 fade from ball color to accent color (default 0)
  prevPosition?: Vector2;    // position at start of last fixed physics step (for interpolation)
  renderPosition?: Vector2;  // interpolated render position (set each frame, used by render only)
  trailPositions?: Vector2[]; // last N render positions for motion trail (screen-space world coords)
}

// Diagonal growing wall - extends from origin in +/- direction
export interface GrowingWall {
  origin: Vector2;           // Starting point of the cut
  direction: Vector2;        // Normalized direction of the cut
  // Waypoint paths for mirror reflections: [origin, bounce1, ..., finalTarget]
  startWaypoints: Vector2[];   // Path in -direction
  endWaypoints: Vector2[];     // Path in +direction
  startSegmentIndex: number;   // Current segment being grown in startWaypoints
  endSegmentIndex: number;     // Current segment being grown in endWaypoints
  startPoint: Vector2;       // Current endpoint in -direction
  endPoint: Vector2;         // Current endpoint in +direction
  targetStart: Vector2;      // = last of startWaypoints
  targetEnd: Vector2;        // = last of endWaypoints
  thickness: number;
  isComplete: boolean;
  activeRegionId: string;    // the region this wall is growing in
  startTime?: number;        // performance.now() when growth began (for easing)
}

export interface GameState {
  regions: Region[];
  originalArea: number;
  balls: Ball[];
  activeWall: GrowingWall | null;
  remainingPercent: number;
  isGameOver: boolean;
  isWin: boolean;
}

export interface SwipeData {
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

export interface GameResult {
  isWin: boolean;
  remainingPercent: number;
  levelId: string;
  levelNumber: number;
  completedAllLevels?: boolean;
  totalScore?: number;
  levelScore?: number;
  cutCount?: number;
  expectedCuts?: number;
  basePoints?: number;
}

export interface LevelScoreData {
  levelNumber: number;
  levelId: string;
  cutCount: number;
  expectedCuts: number;
  basePoints: number;
  levelScore: number;
  remainingPercent: number;
  overcutBonus?: number;
  thresholdPercent?: number;
  pushFailed?: boolean; // true if player failed during push-your-luck mode
  pushBonus?: number; // bonus OT earned from push-your-luck area removal
  // New scoring system fields
  underParBonus?: number;
  spaceBonus?: number;
  spaceBonusRaw?: number;
  performanceMultiplier?: number;
  fencesUnderPar?: number;
  fencesOverPar?: number;
  extraPercent?: number;
  // Tier multiplier for score boost display
  tierMultiplier?: number;
  // Lock bonus from capturing balls
  lockBonus?: number;
  lockedBallsCount?: number;
  // Interest gain from Venture Capital
  interestGain?: number;
}
