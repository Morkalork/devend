import { Vector2, Polygon } from '@/lib/polygon';
import { BallEffectState } from '@/lib/ballEffects';

export type GameScreen = 'welcome' | 'tutorial' | 'game' | 'upgradeShop' | 'result' | 'augmentStore' | 'options' | 'admin' | 'mapBuilder';

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

export interface Ball {
  id: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  speed: number;
  topSpeed: number;
  color: string; // hex color with #
  regionId: string; // which region this ball is in
  rotation: number; // current rotation angle in radians for spinning effect
  flashIntensity: number; // 0-1, LEGACY - kept for compatibility, use effects instead
  effects: BallEffectState; // Visual effect state for pulse, wall hit, ball hit
}

// Diagonal growing wall - extends from origin in +/- direction
export interface GrowingWall {
  origin: Vector2;           // Starting point of the cut
  direction: Vector2;        // Normalized direction of the cut
  startPoint: Vector2;       // Current endpoint in -direction
  endPoint: Vector2;         // Current endpoint in +direction
  targetStart: Vector2;      // Target intersection in -direction
  targetEnd: Vector2;        // Target intersection in +direction
  thickness: number;
  isComplete: boolean;
  activeRegionId: string;    // the region this wall is growing in
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
  // New scoring system fields
  fenceBonus?: number;
  spaceBonus?: number;
  spaceBonusRaw?: number;
  penaltyMultiplier?: number;
  fencesUnderPar?: number;
  fencesOverPar?: number;
  extraPercent?: number;
  // Tier multiplier for score boost display
  tierMultiplier?: number;
}
