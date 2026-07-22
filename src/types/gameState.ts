/**
 * CanvasGameState — the mutable game world held in GameCanvas's gameRef.
 *
 * All fields that change during gameplay live here. React state is kept
 * separately for UI-visible values; this object is never set via setState.
 */

import { SpaceGrid, GridRegion } from "@/lib/spaceGrid";
import { Region, Ball, GrowingWall, LockFlashState, DissolveState, DestructibleState, ObjectDebrisState, StackObject, FallingObject, ChestLoot } from "@/types/game";
import { Wall } from "@/lib/wallGeometry";
import { Polygon, Vector2 } from "@/lib/polygon";
import { BoardRect } from "@/lib/boardConstants";
import { MoverState } from "@/lib/physics/moverState";
import { ScopeCreepConfig } from "@/lib/scopeCreep";
import { ActiveMapMutator } from "@/types/mapMutator";
import { ActiveMapObjective } from "@/types/objective";
import { PickupState, PickupFeedback, PickupConfig, PickupEffect } from "@/types/pickups";

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
  /** Active-play seconds this level (physics steps only; pause/prompt/menu excluded). */
  activePlaySeconds: number;
  /** activePlaySeconds frozen the first moment the win condition was met (null = not yet). */
  clearedActiveSeconds: number | null;
  /**
   * Current ball displacement multiplier: Scope Creep folded with the map
   * mutator's speed factor (crunch/overclock). 1 = neither active. The trajectory
   * predictor reads this too, so mutator speed changes keep the aim line in sync.
   */
  creepFactor: number;
  /** Last Scope-Creep-only percent pushed to the HUD chip (decoupled from the
   *  mutator factor so the creep chip reads creep alone). -1 = not yet sent. */
  lastCreepPct: number;
  /** Scope Creep tuning, seeded from game-config.yml at init. */
  creepConfig: ScopeCreepConfig;
  /** Active per-map mutator (issue #54), or null. Rolled per map from the run
   *  seed; applied in the physics/scoring layer, not the GameModifiers merge. */
  mapMutator: ActiveMapMutator | null;
  /** Active per-map objective (issue #55), or null. Optional/non-failing goal
   *  read at clear to award a bonus under the per-map cap (evaluated purely from
   *  existing counters). On a boss map (issue #56) this same field holds the
   *  MANDATORY objective that gates the win. */
  objective: ActiveMapObjective | null;
  /** Boss phase ids already fired this map (issue #56), so each fires once. */
  bossFiredPhases: string[];
  // ── Boss ball HUD/fight state (issue #56) ─────────────────────────────────
  /** True while a boss ball is in play (drives the boss banner). */
  bossActive: boolean;
  /** Boss hits remaining (mirrors the boss ball's bossHp). */
  bossHp: number;
  /** Boss starting HP, for the health bar. */
  bossMaxHp: number;
  /** True once the boss's last HP is trapped (the mandatory win gate reads this). */
  bossDefeated: boolean;
  /** Minions the boss has spit this map (capped by the boss config). */
  bossMinionCount: number;
  /** Cron Job: performance.now() of the last auto-freeze (0 = clock not yet started this map). */
  lastAutoFreezeAt: number;

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
  /** Win condition met while a lock flash was still playing: the world is held
   *  (render-only, input blocked) until the flash ends, then the prompt opens. */
  pushPromptPending: boolean;
  bestRemainingPercent: number;
  pushStartPercent: number;
  levelClearedTime: number;
  /** performance.now() at which levelComplete was set — anchors the space
   *  bar's fade-out (unlike shimmerStart it is never scheduled in the future). */
  levelCompleteTime?: number;
  /** performance.now() at which the level-clear shimmer begins (0 = inactive). */
  shimmerStart: number;
  /** Dev/playground: hold the fully-drained frame after the shimmer instead of
   *  completing (loop stops, renderFrame clamps the drain to its end-state). */
  shimmerFrozen: boolean;

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
  /** Of lockedBallsCount, how many graded SUPERIOR (tight pocket; see
   *  scoring-config.yml lockQuality). */
  superiorLockCount: number;
  /** Of lockBonus, the hours earned by superior locks (for the results split). */
  superiorLockBonus: number;
  /** Green "money ball" multiplier applied to subsequent locks this map (default 1). */
  moneyMultiplier: number;
  /** ballSpeedMultiplier captured at map init — scales ability speed constants. */
  ballSpeedScale: number;

  // ── Animations ─────────────────────────────────────────────────────────
  assimilations: Map<string, LockFlashState>;
  dissolve: DissolveState | null;

  // ── Bonus cut tracking ─────────────────────────────────────────────────
  /** Cells removed by previous bonus cuts — excluded from wall-adjacency checks
   *  so new cuts don't treat old cut boundaries as real walls to push against. */
  bonusCutCells: Set<string>;

  // ── Lock rule (configurable, from game-config.yml `lock:`) ─────────────
  /** A ball locks when its region is <= this % of the win denominator. */
  lockWinThresholdPercent: number;
  /** The BASE threshold before upgrade bonuses (lockThresholdBonus). Superior
   *  locks grade against this, so widening the lock bar never widens theirs. */
  lockBaseThresholdPercent: number;
  /** A region with <= this many cells always locks its ball, ignoring the %
   *  (0 = disabled). Kills balls bouncing forever in a tiny sliver. */
  lockMinRegionCells: number;

  // ── Ascension fence durability ─────────────────────────────────────────
  /** Ball hits a new fence survives this level; null = fences indestructible. */
  fenceDurability: number | null;
  /** Fences whose durability hit 0 this frame, broken after the physics step. */
  pendingWallBreaks: Wall[];

  // ── Pickups (power-up tokens) ──────────────────────────────────────────
  /** Live tokens on the board. */
  pickups: PickupState[];
  /** Spawn/lifetime tuning seeded from game-config.yml; null = disabled this map. */
  pickupConfig: PickupConfig | null;
  /** Curated spawn anchors from map.yml (may be empty). */
  pickupSpots: Vector2[];
  /** game.activePlaySeconds of the last spawn roll. */
  lastPickupRollAt: number;
  /** Seeded-run roll keying (HIGHSCORES.md Phase D): context = "pickups:<map>"
   *  set at map init, index counts rolls so each draws a fresh generator. */
  pickupRollContext: string;
  pickupRollIndex: number;
  /** Overtime hours claimed from tokens this map — paid AFTER the per-map cap. */
  pickupOvertime: number;
  /** Comp Time tokens: hours added to THIS map's overtime cap. */
  pickupCapBonus: number;
  /** Free tap-to-freeze charges (work without the Feature Freeze upgrade). */
  freezeCharges: number;
  /** Free-store-item tokens claimed this map (issue #48): each makes the next
   *  OPEN store's cheapest offer free. Carried out via LevelScoreData. */
  freeShopItems: number;
  /** Every pickup claimed this map (resolved effect + value), for the
   *  level-complete overlay's hold-to-see-what-you-got list. */
  pickupsClaimedLog: { effect: PickupEffect; value: number }[];
  /** Seconds a freeze-charge tap holds (from the claimed token's value). */
  freezeChargeSeconds: number;
  /** Feature Freeze tap-freezes left THIS map (refills to freezeUsesPerMap each
   *  map). Separate from freezeCharges (pickup tokens). */
  freezeUsesRemaining: number;
  /** Cryo Protocol: pickup tokens spawned this map never expire (rendered iced
   *  over). Set from activeModifiers at map init. */
  freezePickups: boolean;
  /** Transient claim/waste markers (culled by updatePickups). */
  pickupFeedback: PickupFeedback[];

  // ── Destructible mirrors/movers (Phase 2: black ball) ──────────────────
  /** All mirrors/movers that can be broken by the black ball. */
  destructibles: DestructibleState[];
  /** Destructibles that reached 0 HP this frame, removed after the physics step. */
  pendingDestroys: DestructibleState[];
  /** Active collapse animations (rendered then culled). */
  objectDebris: ObjectDebrisState[];

  // ── Breakable obstacles + stacking (issue #38) ─────────────────────────
  /** Stack/support graph of obstacles, for toppling when a support breaks. */
  stackObjects: StackObject[];
  /** Obstacles currently animating their fall (rendered then culled). */
  fallingObjects: FallingObject[];
  /** Number of break-objective obstacles at level start. */
  objectivesTotal: number;
  /** Number of break-objective obstacles broken so far. */
  objectivesBroken: number;
  /** Bonus overtime hours earned by smashing breakable objects this level. */
  breakBonus: number;
  /**
   * Demolition multiplier (issue #38): starts at 1 and compounds ×1.15 for each
   * destructible smashed this map, scaling the whole pre-cap payout to offset
   * the ship-early time spent breaking things. Optional; treated as 1 if unset.
   */
  breakMultiplier?: number;
  /** True for one frame after a cut "duds" against a breakable structure. */
  lastDudAt: number;
  /** Bouncing loot gems from smashed treasure chests (issue #38; cosmetic). */
  chestLoot?: ChestLoot[];
  /** Reward ids collected from chests this map, for the completion overlay. */
  chestRewardsLog?: string[];
  /**
   * Run-wide ball-mass bonus snapshotted from activeModifiers at map init, plus
   * any "heavier balls" chest smashed this map. Read by the force model.
   */
  ballDensityBonus?: number;
}
