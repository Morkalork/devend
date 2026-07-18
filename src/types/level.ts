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
  // ── Breakable obstacles (issue #38) ──────────────────────────────────────
  /** When true, balls break this obstacle by hitting it (any ball; black = half). */
  breakable?: boolean;
  /** Hits required to break (default 3). Black ball counts double. */
  hitsToBreak?: number;
  /** When true, smashing it awards more bonus (an intended target). */
  objective?: boolean;
  /** Render this breakable as a barrier/fence line rather than a solid block. */
  fence?: boolean;
  /**
   * A sealed-off area this breakable gates. Those cells start removed (locked /
   * uncuttable) and are re-opened as capturable space when the breakable breaks.
   */
  reveals?: { x: number; y: number; width: number; height: number };
}

// Combined entity type with shape
export type WallRectEntity = WallEntity & RectShape;
export type WallPolygonEntity = WallEntity & PolygonShape;
export type WallCircleEntity = WallEntity & CircleShape;
export type LevelEntity = WallRectEntity | WallPolygonEntity | WallCircleEntity | LevelMoverEntity;

/** True when the entity is a wall with the mirror flag set. Movers can never be mirrors. */
export function isMirrorEntity(entity: LevelEntity): boolean {
  return entity.kind === "wall" && !!entity.mirror;
}

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
  /**
   * Maximum balls this map spawns (issue #37). The game selects which ball
   * TYPES fill these slots based on the level's eligible types — the map no
   * longer dictates colours, speeds, or positions. Clamped to the number of
   * eligible types for the level.
   */
  maxBalls?: number;
  /**
   * Admin/testing override: spawn exactly these ball-type ids (in order,
   * duplicates allowed), bypassing the deterministic selection. Used by the
   * Playground "Balls" picker. Ignored when empty/absent.
   */
  ballTypeIds?: string[];
  /**
   * Legacy/admin: explicit ball definitions. No longer used by gameplay (the
   * game derives balls from `maxBalls` + level eligibility). Retained so the
   * dev map-builder keeps compiling; falls back to `.length` for maxBalls.
   */
  balls?: BallConfig[];
  entities?: LevelEntity[]; // optional array of entities (obstacles, etc.)
  /**
   * Hard map deadline in active-play seconds (issue: map time limit). When the
   * active-play clock reaches it the map is lost, regardless of lives. Defaults
   * to DEFAULT_MAP_TIME_LIMIT (60) when absent; a map may set a larger value.
   * Levels 1-3 (the tutorial band) ignore it entirely. Shares the Ship Early
   * countdown bar as its on-screen readout.
   */
  timeLimit?: number;
  /**
   * Pickup spawn-chance override for this map (0-1). Setting it also bypasses
   * the global start_level gate, so a teaching map can guarantee a token
   * (1.0) or a set-piece map can suppress them (0).
   */
  pickupChance?: number;
  /**
   * Curated anchor positions (world units) for pickup spawns: "random, but
   * thought through". A spawn roll prefers a free, still-playable spot from
   * this list and falls back to a random open cell when none qualifies.
   */
  pickupSpots?: { x: number; y: number }[];
}

export interface LevelData {
  levels: LevelConfig[];
}
