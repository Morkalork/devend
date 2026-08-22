/**
 * CanvasGameState — the mutable game world held in GameCanvas's gameRef.
 *
 * All fields that change during gameplay live here. React state is kept
 * separately for UI-visible values; this object is never set via setState.
 */

import { SpaceGrid, GridRegion } from "@/lib/spaceGrid";
import { Region, Ball, GrowingWall, LockFlashState, DissolveState, DestructibleState, ObjectDebrisState, StackObject, FallingObject, ChestLoot, AbilityFx, ChainState, PhasingObjectState, SlowArea } from "@/types/game";
import { Wall } from "@/lib/wallGeometry";
import { WallGrid } from "@/lib/physics/wallGrid";
import { Polygon, Vector2 } from "@/lib/polygon";
import { BoardRect } from "@/lib/boardConstants";
import { MoverState } from "@/lib/physics/moverState";
import { ScopeCreepConfig } from "@/lib/scopeCreep";
import { ActiveMapMutator } from "@/types/mapMutator";
import type { GravityWell } from "@/types/level";
import type { GravityConfig } from "@/lib/physics/gravity";
import type { TiltState } from "@/lib/boardTilt";
import { ColoredArea } from "@/types/level";
import { ActiveMapObjective } from "@/types/objective";
import { PickupState, PickupFeedback, PickupConfig, PickupEffect } from "@/types/pickups";

/** A circuit terminal in world space with its runtime lit state (issue #73). */
export interface CircuitRuntimeTerminal {
  x: number;
  y: number;
  radius: number;
  lit: boolean;
  /** Id of the dormant ball this terminal boots when lit. */
  ballId: string;
}

/**
 * "Wire the Integration" runtime state (issue #73 rewrite): terminals the player
 * lights by routing fences through them; each lit terminal WAKES its dormant
 * ball. No vault - the payoff is booting the ball so its reserved space can be
 * cleared.
 */
export interface CircuitRuntime {
  terminals: CircuitRuntimeTerminal[];
  /** i18n telegraph key flashed when a terminal boots its ball (optional). */
  announce?: string;
}

/**
 * "Deploy Charge" runtime state: a fuse the player arms by routing a fence over
 * it, which after a telegraphed delay detonates its target obstacle slab.
 */
export interface ChargeRuntime {
  /** Fuse point (world space). */
  fuse: { x: number; y: number };
  /** Arm distance: a fence segment within this of the fuse arms it. */
  radius: number;
  /** Id of the breakable obstacle destroyed on detonation. */
  targetId: string;
  /** Balls flung + player fences fractured within this of the blast. */
  blastRadius: number;
  /** Telegraphed wind-up (active-play seconds) between arming and detonation. */
  delaySeconds: number;
  /** active-play seconds when the fuse was armed, or null while unarmed. */
  armedAt: number | null;
  /** True once it has detonated (spent). */
  blown: boolean;
  /** i18n telegraph key flashed on detonation (optional). */
  announce?: string;
}

/**
 * "Data Stream" runtime state: the seam polyline and which of its segments the
 * player has already harvested by running a fence along them.
 */
export interface DataStreamRuntime {
  path: { x: number; y: number }[];
  width: number;
  reward: { kind: "overtime" | "freezeCharge"; value: number };
  /** One flag per seam segment (path.length - 1); true once harvested. */
  harvested: boolean[];
  /** Accumulated coverage fraction toward the next whole freeze charge. */
  freezeProgress: number;
  announce?: string;
}

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
  /** Spatial index over `walls`, rebuilt once per frame for the ball collision
   *  broad-phase (see wallGrid.ts). Absent until the first frame builds it. */
  wallGrid?: WallGrid | null;
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
  /** Fences currently growing. Usually one; the concurrent-fence limit
   *  (1 + additionalConcurrentFences, +1 while Fence Overclock is active) lets
   *  more than one grow at once (#38). */
  activeWalls: GrowingWall[];

  // ── Game flags ─────────────────────────────────────────────────────────
  gameOver: boolean;
  levelComplete: boolean;
  /**
   * Mirror of the React `paused` prop (a modal/menu is up). The loop self-halts
   * on the next frame while set, so physics never advances behind a modal even
   * when the loop was (re)started by the intro assemble AFTER the pause effect
   * already ran. The pause effect restarts the loop when this clears.
   */
  paused: boolean;

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
   * Remaining space % as the last cut left it, measured BEFORE any lock on that
   * cut drained the board. Lets an all-balls-locked win say whether the size
   * threshold was also met on its own merits, rather than as a side effect of
   * the lock capturing everything.
   */
  percentBeforeLocks?: number;
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
  /** Resolved gravity schedule while a `gravity` mutator is active (issue #77).
   *  Null on every other map. See src/lib/physics/gravity.ts. */
  gravityConfig?: GravityConfig | null;
  /** Active per-map objective (issue #55), or null. Optional/non-failing goal
   *  read at clear to award a bonus under the per-map cap (evaluated purely from
   *  existing counters). On a boss map (issue #56) this same field holds the
   *  MANDATORY objective that gates the win. */
  objective: ActiveMapObjective | null;
  /** Boss phase ids already fired this map (issue #56), so each fires once. */
  bossFiredPhases: string[];
  /** Map-beat ids already fired this map (LEVELDESIGN.md Turn), so each fires once. */
  firedBeats: string[];
  /** Map-beat ids whose telegraph warning has shown, so each warns once. */
  warnedBeats: string[];
  /**
   * Beats triggered but held back until their telegraph has had its lead time
   * (mapBeats.ts). Due times are in activePlaySeconds, so a pause never eats
   * the warning. Empty on maps whose beats carry no `announce`.
   */
  pendingBeats: { id: string; dueActiveSeconds: number }[];
  /**
   * Colored Areas for this map (gate AND bonus), in world space, already
   * rotated (mapRotation). Gate-only consumers filter with gateAreas().
   */
  coloredAreas: ColoredArea[];
  /** Authored gravity wells for this map (issue #77), already map-rotated. */
  gravityWells?: GravityWell[];
  /**
   * Free Fall (Escape Velocity): how hard gravity bends headings this map, as a
   * multiplier on the authored turn rate. 1 = as authored, below 1 = straighter.
   *
   * Copied onto the state from activeModifiers at map init, the same way
   * freezePickups is, because updateBall runs per ball per frame and is handed
   * the game rather than the modifier bundle.
   */
  gravityBendMultiplier?: number;
  /**
   * Space remaining (%) as of the last resolved cut. Undefined until the first
   * one lands, which readers must treat as a full board rather than as zero.
   *
   * Lives on the state because a dormant gravity well wakes on cleared space
   * and is evaluated per ball per frame, deep inside updateBall, where the
   * cut-resolution callbacks that normally carry this number cannot reach.
   */
  spaceRemainingPercent?: number;
  /** Sporadic board tilts: the current turn, mid-ease included (#77). */
  boardTilt?: TiltState;
  /** Per-tier tilt chance, drawn once at map start so it cannot be learned. */
  tiltChance?: number;
  /** Progress tiers whose roll has already happened, so none rolls twice. */
  firedTiltTiers?: number[];
  /** A target ball has been locked inside a GATE Colored Area (the win gate). */
  coloredAreaSatisfied: boolean;
  /** "Wire the Integration" circuit runtime for this map (null = no circuit). */
  circuit: CircuitRuntime | null;
  /** "Deploy Charge" fuses for this map (empty = none). */
  charges: ChargeRuntime[];
  /** "Data Stream" seam for this map (null = none). */
  dataStream: DataStreamRuntime | null;
  /** Cumulative ball-speed multiplier from map-beat speed spikes (1 = none).
   *  Folded into creepFactor each frame like the mutator/ability factors. */
  beatSpeedMult: number;
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

  // ── Chains + phasing (issue #64) ─────────────────────────────────────────
  /** Chains linking ball pairs (boss pair chain + yellow/purple gift chains). */
  chains: ChainState[];
  /** Phasing obstacles toggling solid<->intangible on a cycle. */
  phasingObjects: PhasingObjectState[];

  // ── Layout ─────────────────────────────────────────────────────────────
  screenSize: { width: number; height: number };
  boardRect: BoardRect;

  // ── Visuals ────────────────────────────────────────────────────────────
  backgroundColor: string;
  regionColor: string;

  // ── Scoring / progression ──────────────────────────────────────────────
  wallCount: number;
  /** COMPLETED fences (successful partitions) this map, for the fence budget. */
  completedCuts: number;
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
  /** This map's base points (level.points), the map's overtime scale. Used to
   *  size overtime pickups proportionately to the map instead of a flat pittance. */
  mapBasePoints: number;
  /** Number of balls locked this level (for lock-bonus multiplier). */
  lockedBallsCount: number;
  lockBonus: number;
  /** Of lockedBallsCount, how many graded SUPERIOR (tight pocket; see
   *  scoring-config.yml lockQuality). */
  superiorLockCount: number;
  /** Of lockBonus, the hours earned by superior locks (for the results split). */
  superiorLockBonus: number;
  /** Locks credited to a Colored Area this map (issue: areas were invisible). */
  zoneLockCount: number;
  /** Overtime the Colored Area multipliers ADDED, over the same locks unzoned. */
  zoneLockBonus: number;
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
  /** Persistent badges left in a lock area for each power-up CLAIMED by a lock
   *  (issue #59): their icon stays put in the pocket for the rest of the map so
   *  you can see what you banked. Reset each map. `bornActiveSeconds` anchors a
   *  brief pop-in on the active-play clock. */
  pickupLockMarkers?: { effect: PickupEffect; x: number; y: number; bornActiveSeconds: number }[];
  /** Short-lived bursts where a white "tappable" ball was tapped away (#57),
   *  for a quick pop-and-vanish. `startTime` is performance.now(). */
  ballPops?: { x: number; y: number; color: string; startTime: number }[];

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
  /** Ability ids granted by chests this map, for the completion overlay. */
  chestRewardsLog?: string[];
  /**
   * Slow Areas placed this map, in world space. Permanent for the map and
   * cleared with it, which is what distinguishes them from Slow All: one is a
   * placement decision that lasts, the other a timing decision that does not.
   */
  slowAreas?: SlowArea[];
  /**
   * Ability ids the player currently holds a charge of, mirrored from the
   * session each frame. The chest roll needs it to honour the slot cap, and it
   * runs deep inside the physics step where the session's React state cannot
   * reach.
   */
  heldAbilityIds?: string[];
  /** How many DISTINCT abilities may be held at once (ascension can tighten). */
  abilitySlots?: number;
  /** Slow All ability (#38): active-play second the global slow expires at. */
  abilitySlowUntil?: number;
  /** Slow All ability: creepFactor multiplier while the slow is active (<1). */
  abilitySlowMult?: number;
  /** Fence Overclock ability: active-play second the fence rush expires at. */
  abilityFenceRushUntil?: number;
  /** Fence Overclock: fence-growth-speed multiplier while active (>1 = faster). */
  abilityFenceRushMult?: number;
  /** Fence Shield ability: active-play second growing fences stop taking hits at. */
  abilityFenceShieldUntil?: number;
  /**
   * Territory claimed by the cut that just landed, flashed once and culled.
   *
   * Capturing space is the game's main verb and was the only thing on the board
   * with no reaction at all: the fill simply changed colour on the next redraw.
   * Locking a ball got a flash; claiming the ground around it got nothing.
   */
  claimFlashes?: { contours: Vector2[][]; startTime: number }[];
  /** Transient ability-fired flash/ring bursts (#38); rendered then culled. */
  abilityFx?: AbilityFx[];
  /** A targeted ability (Magnet) armed and awaiting a board tap; else null. Read
   *  by the input handler to consume the next tap as the target point. */
  armedAbility?: string | null;
  /** Where a Magnet was last fired: a fading magnet icon is drawn here (#38). */
  magnetMarker?: { x: number; y: number; startTime: number };
}
