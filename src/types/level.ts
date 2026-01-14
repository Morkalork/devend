export interface BallConfig {
  id: string;
  initialSpeed: number;
  topSpeed: number;
  color: string; // 6-char hex without #
}

export interface LevelConfig {
  id: string;
  backgroundColor: string; // 6-char hex without #
  rectangleColor: string; // 6-char hex without #
  sizeThreshold: number; // percentage
  expectedCuts: number; // expected number of cuts to complete the level
  points: number; // base points for the level
  balls: BallConfig[];
}

export interface LevelData {
  levels: LevelConfig[];
}
