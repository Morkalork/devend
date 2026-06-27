/**
 * CanvasGameState — the mutable game world held in GameCanvas's gameRef.
 *
 * All fields that change during gameplay live here. React state is kept
 * separately for UI-visible values; this object is never set via setState.
 */

import { SpaceGrid, GridRegion } from "@/lib/spaceGrid";
import { Region, Ball, GrowingWall, LockFlashState, DissolveState } from "@/types/game";
import { Wall } from "@/lib/wallGeometry";
import { Polygon, Vector2 } from "@/lib/polygon";
import { BoardRect } from "@/lib/boardConstants";
import { MoverState } from "@/lib/physics/moverState";

export interface CanvasGameState {
  // ── Space model ────────────────────────────────────────────────────────
  /** Authoritative 2D grid model for space ownership. */
  spaceGrid: SpaceGrid | null;
  /** Current connected regions derived from the space grid. */
  gridRegions: GridRegion[];
  /** Legacy polygon regions — kept for rendering compatibility. */
  regions: Region[];

  // ── Geometry ───────────────────────────────────────────────────────────
  /** All walls: board edges, obstacles, and user-drawn fences. */
  walls: Wall[];
  /** Obstacle polygons used to clip user-drawn walls. */
  obstaclePolygons: Polygon[];
  /** Mirror obstacle polygons (rendered in distinct cyan). */
  mirrorPolygons: Polygon[];
  /** Original board boundary polygon for ball collision. */
  boardPolygon: Polygon | null;
  /** Total original board area (world units²). */
  originalArea: number;
  /** Playable area after subtracting obstacles at init. */
  basePlayableArea: number;

  // ── Entities ───────────────────────────────────────────────────────────
  balls: Ball[];
  movers: MoverState[];
  activeWall: GrowingWall | null;

  // ── Game flags ─────────────────────────────────────────────────────────
  gameOver: boolean;
  levelComplete: boolean;

  // ── Input / swipe ──────────────────────────────────────────────────────
  swipeStart: Vector2 | null;
  swipeRegionId: string | null;
  currentSwipePos: Vector2 | null;
  /** Pointer ID that initiated the current swipe. */
  swipePointerId: number | null;
  /** Last completed cut gesture, rendered as a brief fading afterglow (issue #35). */
  swipeTrail: { start: Vector2; end: Vector2; createdAt: number } | null;

  // ── Timing / loop ──────────────────────────────────────────────────────
  lastTime: number;
  accumulator: number;
  animationId: number;
  gameLoopFn: ((timestamp: number) => void) | null;

  // ── Layout ─────────────────────────────────────────────────────────────
  screenSize: { width: number; height: number };
  boardRect: BoardRect;

  // ── Visuals ────────────────────────────────────────────────────────────
  backgroundColor: string;
  regionColor: string;

  // ── Scoring / progression ──────────────────────────────────────────────
  wallCount: number;
  wallShieldsRemaining: number;
  fastestBallId: string | null;

  // ── Push-your-luck ─────────────────────────────────────────────────────
  pushMode: "none" | "prompt" | "pushing";
  bestRemainingPercent: number;
  pushStartPercent: number;
  levelClearedTime: number;

  // ── Recovery state ─────────────────────────────────────────────────────
  isRecovering: boolean;
  recoveryEndTime: number;
  initialSamplePoints: Vector2[];

  // ── Frozen ball (post-fence collision) ────────────────────────────────
  frozenBallId: string | null;
  frozenBallVelocity: Vector2 | null;
  frozenBallPosition: Vector2 | null;

  // ── Lock bonus ─────────────────────────────────────────────────────────
  /** Number of balls locked this level (for lock-bonus multiplier). */
  lockedBallsCount: number;
  lockBonus: number;

  // ── Animations ─────────────────────────────────────────────────────────
  assimilations: Map<string, LockFlashState>;
  dissolve: DissolveState | null;

  // ── Bonus cut tracking ─────────────────────────────────────────────────
  /** Cells removed by previous bonus cuts — excluded from wall-adjacency checks
   *  so new cuts don't treat old cut boundaries as real walls to push against. */
  bonusCutCells: Set<string>;

  // ── Ascension fence durability ─────────────────────────────────────────
  /** Ball hits a new fence survives this level; null = fences indestructible. */
  fenceDurability: number | null;
  /** Fences whose durability hit 0 this frame, broken after the physics step. */
  pendingWallBreaks: Wall[];
}
