export type GameScreen = 'welcome' | 'tutorial' | 'game' | 'result';

export interface Vector2 {
  x: number;
  y: number;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Region {
  id: string;
  bounds: Bounds;
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
}

export interface GrowingWall {
  origin: Vector2;
  orientation: 'horizontal' | 'vertical';
  startExtent: number;
  endExtent: number;
  thickness: number;
  isComplete: boolean;
  activeRegionId: string; // the region this wall is growing in
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
}
