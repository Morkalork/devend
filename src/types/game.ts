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

export interface Ball {
  position: Vector2;
  velocity: Vector2;
  radius: number;
  speed: number;
}

export interface GrowingWall {
  origin: Vector2;
  orientation: 'horizontal' | 'vertical';
  startExtent: number;
  endExtent: number;
  thickness: number;
  isComplete: boolean;
}

export interface GameState {
  arena: Bounds;
  originalArea: number;
  ball: Ball;
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
