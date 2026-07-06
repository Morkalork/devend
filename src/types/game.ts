import { Vector2, Polygon } from '@/lib/polygon';
import { BallEffectState } from '@/lib/ballEffects';

export type GameScreen = 'welcome' | 'tutorial' | 'game' | 'upgradeShop' | 'runDraft' | 'ascensionDraft' | 'result' | 'certificateStore' | 'loadouts' | 'options' | 'achievements' | 'admin' | 'mapBuilder' | 'animationTest';

/** Progress of the interactive "draw your first fence" tutorial on level 1. */
export type TutorialStep = 'showingHint' | 'waitingForSuccessfulCut' | 'completed';

export type { Vector2 };

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Polygon-based region for diagonal cuts
export interface Region {
  id: string;
  polygon: Polygon;
  estimatedArea?: number; // Grid-based area estimate for accurate calculations after cuts
  samplePoints?: Vector2[]; // Grid sample points for accurate rendering
}

export type BallState = 'active' | 'won';

export interface Ball {
  id: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  speed: number;
  baseSpeed: number; // original speed at init, used by MicroManager to compute proportional reduction
  topSpeed: number;
  color: string; // hex color with #
  regionId: string; // which region this ball is in
  rotation: number; // current rotation angle in radians for spinning effect
  flashIntensity: number; // 0-1, LEGACY - kept for compatibility, use effects instead
  effects: BallEffectState; // Visual effect state for pulse, wall hit, ball hit
  state: BallState; // 'active' = normal, 'won' = captured in small region
  wonSpinSpeed: number; // Spin speed when in WON state
  wonTime: number;      // timestamp when entering WON state
  assimScale: number;   // visual scale factor for assimilation animation (default 1.0)
  assimColorFade: number; // 0→1 fade from ball color to accent color (default 0)
  prevPosition?: Vector2;    // position at start of last fixed physics step (for interpolation)
  renderPosition?: Vector2;  // interpolated render position (set each frame, used by render only)
  trailPositions?: Vector2[]; // ring buffer of last N render positions for motion trail (world coords); slots reused in place
  trailHead?: number;         // ring-buffer write cursor (index of the next slot to overwrite)
  trailCount?: number;        // number of valid entries in the ring buffer (<= its length)
  // ── Feature Freeze upgrade (tap-to-freeze) ──────────────────────────────
  frozenUntil?: number;      // performance.now() timestamp until which the ball is held still (tap-frozen)
  freezeReadyAt?: number;    // performance.now() timestamp before which the ball cannot be re-frozen (cooldown)
  // ── Ball type / abilities (issue #37) ───────────────────────────────────
  typeId: string;            // ball-type id from ballTypes.ts (red, blue, yellow, …)
  ability: import('@/lib/ballTypes').BallAbility; // gameplay ability this ball carries
  lockMultiplier: number;    // lock-bonus multiplier when this ball is locked away
  spawnTime: number;         // performance.now() at map start — used by the grey "slow down" ability
  minimumSpeed: number;      // scaled speed floor; slow-down/slow-others/range never go below this
  speedReduction?: number;   // purple (slowOthers): scaled speed each struck ball loses per hit
  speedRange?: [number, number]; // yellow: current (scaled) [lo, hi] random-speed range; shrinks when slowed
  lastSpeedStepAt?: number;  // yellow: debounce so one contact changes speed once
}

// Diagonal growing wall - extends from origin in +/- direction
export interface GrowingWall {
  origin: Vector2;           // Starting point of the cut
  direction: Vector2;        // Normalized direction of the cut
  // Waypoint paths for mirror reflections: [origin, bounce1, ..., finalTarget]
  startWaypoints: Vector2[];   // Path in -direction
  endWaypoints: Vector2[];     // Path in +direction
  startSegmentIndex: number;   // Current segment being grown in startWaypoints
  endSegmentIndex: number;     // Current segment being grown in endWaypoints
  startPoint: Vector2;       // Current endpoint in -direction
  endPoint: Vector2;         // Current endpoint in +direction
  targetStart: Vector2;      // = last of startWaypoints
  targetEnd: Vector2;        // = last of endWaypoints
  thickness: number;
  isComplete: boolean;
  activeRegionId: string;    // the region this wall is growing in
  startTime?: number;        // performance.now() when growth began (for easing)
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
  totalScore?: number;
  levelScore?: number;
  cutCount?: number;
  expectedCuts?: number;
  basePoints?: number;
  // Ascension mode (post-final-level loop) — set when the run went past depth 0
  ascensionDepth?: number;
  loadoutNames?: string[];
}

// ── Lock / dissolve animation types (used by GameCanvas rendering) ────────

export interface LockDustParticle {
  angle: number;    // radians
  speed: number;    // world units / sec
  lifetime: number; // ms
  size: number;     // world units at birth (unused for streaks but kept for compat)
  lengthPx: number; // screen-space streak length in pixels
}

export interface LockFlashState {
  ballId: string;
  cellIndices: number[]; // space-grid cell indices (kept for centroid / dust origin)
  polygon: Vector2[];    // exact boundary polygon built from wall intersections
  centroid: Vector2;
  startTime: number;
  ballPos: Vector2;      // ball position at moment of lock
  ballColor: string;     // ball colour for dust tint
  particles: LockDustParticle[];
}

export interface DissolveTile {
  sx: number; sy: number; sw: number; sh: number; // source rect in captured canvas
  cx: number; cy: number;   // centre position at start
  vx: number; vy: number;   // initial velocity (px/s)
  rotSpeed: number;          // rad/s
  delay: number;             // seconds before tile starts moving
}

export interface DissolveState {
  captured: HTMLCanvasElement;
  tiles: DissolveTile[];
  startTime: number;
  onComplete: () => void;
}

// ── Destructible objects (issue #37 Phase 2: black ball) ──────────────────

/**
 * A breakable object: a mirror/mover (black ball only, issue #37) or a
 * breakable obstacle (any ball; issue #38). Hits accumulate to maxHits.
 */
export interface DestructibleState {
  id: string;                  // stable id (the level entity id)
  kind: 'mirror' | 'mover' | 'breakable';
  hits: number;                // accumulated hits, 0..maxHits
  maxHits: number;             // hits needed to destroy (3)
  lastHitAt: number;           // performance.now() of last counted hit (debounce)
  destroyed: boolean;          // queued/processed for removal
  destroyedBy?: string;        // id of the ball that landed the killing hit
  mirrorPolygon?: Polygon;     // mirror: reference into obstacle/mirror polygon arrays
  moverId?: string;            // mover: id of the MoverState
  // ── Breakable obstacles (issue #38) ──────────────────────────────────────
  obstaclePolygon?: Polygon;   // breakable: reference into obstaclePolygons
  objective?: boolean;         // breakable: smashing it awards more bonus
  dents?: Vector2[];           // world-space impact points — rendered as inward dents
  fenceStyle?: boolean;        // breakable: render as a barrier/fence line, not a block
  sealedCells?: number[];      // breakable gate: grid cells of the sealed area to reopen on break
}

/**
 * A stacked obstacle in the support graph (issue #38). When the thing it rests
 * on is removed, it topples (falls toward the board bottom and shatters).
 */
export interface StackObject {
  id: string;
  polygon: Polygon;            // reference into obstaclePolygons
  breakable: boolean;
  supporterId: string | null;  // id of the obstacle it rests on, or null = ground
  toppled: boolean;            // already falling/removed
}

/** An obstacle mid-collapse: its shape animates toward the board bottom. */
export interface FallingObject {
  vertices: Vector2[];         // world-space polygon (snapshot at fall start)
  color: string;               // hex with #
  startTime: number;
  durationMs: number;
  fallSpeed: number;           // initial downward speed (world units/sec)
  shattered?: boolean;         // guard so the landing debris is spawned only once
}

export interface ObjectDebrisParticle {
  x: number; y: number;        // world-space position at birth
  vx: number; vy: number;      // world units / sec
  rotation: number;
  rotSpeed: number;            // rad / sec
  size: number;                // world units
}

/** A short collapse animation spawned when a destructible is destroyed. */
export interface ObjectDebrisState {
  startTime: number;
  durationMs: number;
  color: string;               // hex with #
  particles: ObjectDebrisParticle[];
}

export interface LevelScoreData {
  levelNumber: number;
  levelId: string;
  cutCount: number;
  expectedCuts: number;
  basePoints: number;
  levelScore: number;
  remainingPercent: number;
  overcutBonus?: number;
  thresholdPercent?: number;
  pushFailed?: boolean; // true if player failed during push-your-luck mode
  pushBonus?: number; // bonus OT earned from push-your-luck area removal
  // New scoring system fields
  underParBonus?: number;
  spaceBonus?: number;
  spaceBonusRaw?: number;
  performanceMultiplier?: number;
  fencesUnderPar?: number;
  fencesOverPar?: number;
  extraPercent?: number;
  // Tier multiplier for score boost display
  tierMultiplier?: number;
  // Lock bonus from capturing balls
  lockBonus?: number;
  lockedBallsCount?: number;
  // Bonus from smashing breakable objects (issue #38)
  breakBonus?: number;
  // Interest gain from Venture Capital
  interestGain?: number;
}
