export interface BallConfig {
  id: string;
  initialSpeed: number;
  topSpeed: number;
  color: string; // 6-char hex without #
}

// Entity shape types
export interface RectShape {
  shape: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonShape {
  shape: "polygon";
  points: [number, number][]; // array of [x, y] world coordinates
}

export type EntityShape = RectShape | PolygonShape;

// Base entity interface - extensible for future kinds
export interface BaseEntity {
  id: string;
  kind: string;
  shape: "rect" | "polygon";
}

// Obstacle entity - carves away playable space
export interface ObstacleEntity extends BaseEntity {
  kind: "obstacle";
}

// Combined entity type with shape
export type ObstacleRectEntity = ObstacleEntity & RectShape;
export type ObstaclePolygonEntity = ObstacleEntity & PolygonShape;
export type LevelEntity = ObstacleRectEntity | ObstaclePolygonEntity;

export interface LevelConfig {
  id: string;
  sizeThreshold: number; // percentage
  expectedCuts: number; // expected number of cuts to complete the level
  points: number; // base points for the level
  balls: BallConfig[];
  entities?: LevelEntity[]; // optional array of entities (obstacles, etc.)
}

export interface LevelData {
  levels: LevelConfig[];
}
