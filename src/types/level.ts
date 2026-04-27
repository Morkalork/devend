export interface BallConfig {
  id: string;
  initialSpeed: number;
  topSpeed: number;
  color: string; // 6-char hex without #
  radius?: number; // optional radius in world units, defaults to BASE_BALL_RADIUS
  startX?: number; // optional starting X position in world units
  startY?: number; // optional starting Y position in world units
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

// Circle shape for obstacles
export interface CircleShape {
  shape: "circle";
  cx: number;
  cy: number;
  radius: number;
}

export type EntityShape = RectShape | PolygonShape | CircleShape;

// Base entity interface - extensible for future kinds
export interface BaseEntity {
  id: string;
  kind: string;
  shape: "rect" | "polygon" | "circle";
}

// Wall entity - carves away playable space (subtracted from regions like cuts)
export interface WallEntity extends BaseEntity {
  kind: "wall";
  mirror?: boolean; // When true, growing fences reflect off this obstacle
}

// Combined entity type with shape
export type WallRectEntity = WallEntity & RectShape;
export type WallPolygonEntity = WallEntity & PolygonShape;
export type WallCircleEntity = WallEntity & CircleShape;
export type LevelEntity = WallRectEntity | WallPolygonEntity | WallCircleEntity | LevelMoverEntity;

// ── Mover entities — obstacles that oscillate back and forth ──────────────
export interface MoverEntityBase extends BaseEntity {
  kind: "mover";
  axis: "horizontal" | "vertical";
  range: number;   // total oscillation distance (moves ±range/2 from home center)
  speed: number;   // world units per second
  phase?: number;  // 0–1 starting phase: 0 = left/top extreme, 0.5 = center, 1 = right/bottom extreme
}
export type MoverRectEntity   = MoverEntityBase & RectShape;
export type MoverCircleEntity = MoverEntityBase & CircleShape;
export type LevelMoverEntity  = MoverRectEntity | MoverCircleEntity;

export interface LevelConfig {
  id: string;
  level: number; // logical level number (multiple maps can share the same level)
  sizeThreshold: number; // percentage
  expectedCuts: number; // expected number of cuts to complete the level
  points: number; // base points for the level
  variety?: number; // 0-100: controlled randomness for organic variation (default 0)
  randomShapes?: number; // 0-100: percentage of random mini-obstacles added (default 20)
  threadLockRequired?: number; // minimum number of balls that must be thread-locked to win
  balls: BallConfig[];
  entities?: LevelEntity[]; // optional array of entities (obstacles, etc.)
}

export interface LevelData {
  levels: LevelConfig[];
}
