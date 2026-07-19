import type { MapObjective } from "@/types/objective";
import type { MapMutator } from "@/types/mapMutator";

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
  /**
   * Procedural layout slots (issue #53). When present on a level >=
   * PROCEDURAL_MIN_LEVEL, each slot resolves through the run seed into concrete
   * entities appended to `entities`, so the board varies per run (and is shared
   * per Daily seed). Ignored on L1-10 and on levels with no slots. See
   * src/lib/mapSlots.ts.
   */
  slots?: EntitySlot[];
  /**
   * Boss encounter (issue #56). When set, this is a boss map: its objective is a
   * MANDATORY win gate, its mutator (if any) is forced, and its phases fire as
   * the fight escalates. Authored set-piece, so it bypasses the procedural roll.
   */
  boss?: BossConfig;
}

export interface LevelData {
  levels: LevelConfig[];
}

// ── Boss encounters (issue #56) ──────────────────────────────────────────────
// A boss is an authored map whose win condition is a MANDATORY objective (the
// #55 schema, promoted from optional to a win gate), optionally with a forced
// #54 mutator and threshold-triggered phases. Bosses live at levels 10/20/30/40
// and, being authored, bypass the level-11 procedural roll.

/** A threshold-triggered boss event (fires once when its condition is crossed). */
export interface BossPhase {
  id: string;
  /** Fire when space remaining (%) drops to or below this. */
  atSpaceRemaining?: number;
  /** Fire when active-play seconds reaches this (alternative trigger). */
  atSeconds?: number;
  /** Spawn this many extra balls ("adds") when the phase fires. */
  spawnAdds?: number;
}

/**
 * Boss configuration for a level. `objective` is the MANDATORY win gate (a map
 * is not cleared until the normal space threshold AND this are both met).
 * `mutator` (optional) is forced on for the whole fight. Both reuse the #54/#55
 * authored schemas directly (those are pure type modules, so no import cycle).
 */
export interface BossConfig {
  /** Boss name (English source of truth; locale override via content.bosses.<id>). */
  name: string;
  /** One-time intro card body text shown when the boss map first loads. */
  intro: string;
  /** The mandatory objective that gates the win (a #55 MapObjective). */
  objective: MapObjective;
  /** Forced environmental modifier for the whole fight (a #54 MapMutator). */
  mutator?: MapMutator;
  /** When true, Scope Creep runs from second 0 (no grace) for extra pressure. */
  creepFromStart?: boolean;
  /** Phase events fired as the fight escalates. */
  phases?: BossPhase[];
}

// ── Procedural slots (issue #53) ─────────────────────────────────────────────
// A map may declare `slots` instead of (or alongside) fixed `entities`. Each
// slot resolves, through the run seed, to one or more concrete entities: the
// same level number produces a structurally different board each run, yet is
// deterministic on a Daily seed (everyone plays the same generated board). Only
// levels >= PROCEDURAL_MIN_LEVEL resolve slots; L1-10 stay authored/fixed so the
// one-idea-per-map teaching cadence is preserved.

/**
 * A numeric field of a slot candidate. A plain number is fixed; a `[min, max]`
 * tuple is resolved by the run RNG (inclusive of both ends; integer fields like
 * `count` are rounded). Lets a designer mix discrete candidates with continuous
 * jitter.
 */
export type SlotValue = number | [number, number];

/**
 * One authored placement a slot may resolve to. Numeric fields accept a
 * `SlotValue` (fixed or ranged). `weight` biases the weighted pick among a
 * slot's candidates (default 1). Polygons are intentionally unsupported here:
 * ranged polygon vertices are hard to keep winnable, so author those as fixed
 * `entities`.
 */
export interface SlotCandidate {
  weight?: number;                       // relative pick weight (default 1)
  kind?: "wall" | "mover";               // default "wall"
  shape: "rect" | "circle";
  // rect fields
  x?: SlotValue; y?: SlotValue; width?: SlotValue; height?: SlotValue;
  // circle fields
  cx?: SlotValue; cy?: SlotValue; radius?: SlotValue;
  // wall flags (walls only)
  mirror?: boolean;
  breakable?: boolean;
  hitsToBreak?: number;
  objective?: boolean;
  fence?: boolean;
  // mover fields (movers only)
  axis?: "horizontal" | "vertical";
  range?: SlotValue;
  speed?: SlotValue;
  phase?: SlotValue;
}

/**
 * A single slot: rolls `chance` to appear at all, then emits `count` entities,
 * each a weighted pick from `candidates` with its ranged fields resolved.
 * Resolved entity ids are `${id}` (count 1) or `${id}-0`, `${id}-1`, ...
 */
export interface EntitySlot {
  id: string;
  chance?: number;         // 0-1 probability the slot yields anything (default 1)
  count?: SlotValue;       // how many entities to emit (default 1; range → int)
  candidates: SlotCandidate[];
}
