import { Vector2, Polygon } from '@/lib/polygon';
import { BallEffectState } from '@/lib/ballEffects';

export type GameScreen = 'welcome' | 'tutorial' | 'game' | 'upgradeShop' | 'doorDraft' | 'capstoneDraft' | 'runDraft' | 'ascensionDraft' | 'result' | 'certificateStore' | 'loadouts' | 'options' | 'achievements' | 'hallOfFame' | 'admin' | 'mapBuilder' | 'animationTest';

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
  // ── Rainbow ability (timed spawner) ─────────────────────────────────────
  spawnActiveSeconds?: number; // game.activePlaySeconds when this ball appeared (spawn-timer anchor)
  rainbowSpawnCount?: number;  // rainbow only: how many balls it has spit out so far
  // ── Boss ball (issue #56) ────────────────────────────────────────────────
  isBoss?: boolean;    // the boss antagonist ("Release Candidate")
  bossHp?: number;     // hits remaining; each trap costs one until the last locks it
  bossMaxHp?: number;  // starting HP, for the health bar
  bossFullRadius?: number; // radius at full HP; shrinks toward bossMinRadius as HP drains
  bossMinRadius?: number;  // radius at the last life = a normal ball's size
  // Break-out leap: after a non-fatal trap the boss arcs out of the pocket back
  // onto the open map instead of teleporting. Physics is skipped while airborne.
  bossLeapAt?: number; // performance.now() the leap began (undefined = not leaping)
  bossLeapLaunched?: boolean; // the launch whoosh has fired (once, after the wind-up)
  leapFromX?: number; leapFromY?: number; // arc start (where it was trapped)
  leapToX?: number;   leapToY?: number;   // arc end (open-space landing spot)
  // ── Mitosis birth (boss minion split-off, issue #56) ─────────────────────
  bornAt?: number;        // performance.now() when spawned; drives the grow-in animation
  bornRadius?: number;    // target radius the minion grows to (its full size)
  splitAnimAt?: number;   // performance.now() a split began; the boss stops dead and swells while it divides
  splitBaseRadius?: number; // the boss's pre-swell radius, restored when the division ends
  splitDirX?: number;     // unit direction the current bud emerges (drives the birth splash)
  splitDirY?: number;
  spitChargeStart?: number; // performance.now() a spit wind-up (telegraph) began
  bornSplashAt?: number;    // performance.now() the wet birth splash started (at the bud spawn)
  lastPanicAt?: number;     // performance.now() of the boss's last last-life panic lunge
  birthParentId?: string; // while set, this bud is attached to its parent and growing (mitosis)
  birthDirX?: number;     // unit direction from the parent it buds along / is released toward
  birthDirY?: number;
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
  cellIndices: number[]; // captured cells of the locked pocket (source for `contours`)
  contours: Vector2[][]; // Chaikin-smoothed outline loops of the pocket; the flash fills these (even-odd)
  centroid: Vector2;
  startTime: number;
  ballPos: Vector2;      // ball position at moment of lock
  ballColor: string;     // ball colour for dust tint
  particles: LockDustParticle[];
  /** True when this lock was the player's first-ever capture of this ball type
   *  (tutorial ball-types intel). Draws a rising "Info Unlocked" flash above the
   *  ball on top of the usual lock animation. */
  firstEncounter: boolean;
  /** True when the lock graded SUPERIOR (tight pocket; scoring-config.yml
   *  lockQuality). Draws a rising "Superior Lock" label like firstEncounter. */
  superior: boolean;
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
  /** True runs the tile animation backwards: the board ASSEMBLES from
   *  scattered tiles instead of shattering (run-start intro). */
  reverse?: boolean;
}

// ── Destructible objects (issue #37 Phase 2: black ball) ──────────────────

/**
 * A breakable object: a mirror/mover (black ball only, issue #37) or a
 * breakable obstacle (any ball; issue #38). Hits accumulate to maxHits.
 */
/**
 * A recorded impact on a breakable: where the ball struck (world space) and how
 * hard, as a depth multiplier (~0.5 light chip .. ~1.3 heavy smash) so the dent
 * and its cracks scale with the force of that particular hit.
 */
export interface ImpactDent {
  x: number;
  y: number;
  s: number;   // depth/size multiplier for this hit
}

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
  dents?: ImpactDent[];        // world-space impact points — rendered as inward dents
  fenceStyle?: boolean;        // breakable: render as a barrier/fence line, not a block
  sealedCells?: number[];      // breakable gate: grid cells of the sealed area to reopen on break
  chest?: boolean;             // treasure chest (#38): smashing it grants a run bonus
  chestRewards?: string[];     // chest: hybrid reward pool (empty/absent = full default pool)
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

/**
 * A loot gem flung from a smashed treasure chest (issue #38). Falls under
 * gravity and bounces off the board floor like a rubber ball (see chests.ts).
 * `reward` is an ability id (a catalogue key; kept as a string here to avoid a
 * types↔lib import cycle). Cosmetic only — the ability charge is granted on the
 * break, and the gem is coloured by the ability.
 */
/**
 * A transient full-board flash + ring burst played when a player ability fires
 * (issue #38), so the player always sees *something* happen even if their
 * current situation (one ball, already at the edge) shows no ball change.
 * `expand` = rings emanate outward (most abilities); false = converge inward
 * (Magnet). Rendered in both renderers, culled by lifetime.
 */
export interface AbilityFx {
  color: string;       // hex with '#', the ability's colour
  expand: boolean;     // true = rings grow outward, false = converge inward
  startTime: number;   // performance.now() at trigger
  durationMs: number;
  center: Vector2;     // world-space board centre
}

export interface ChestLoot {
  id: string;
  reward: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornActiveSeconds: number;   // active-play clock at spawn (lifetime anchor)
  settled: boolean;            // true once it has come to rest on the floor
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
  // Superior locks (tight pockets): count and their share of lockBonus, for
  // the results screen's Locks / Superior Locks split
  superiorLockCount?: number;
  superiorLockBonus?: number;
  // Bonus from smashing breakable objects (issue #38)
  breakBonus?: number;
  // Demolition multiplier applied to the map payout (×1.15 per smash, issue #38)
  breakMultiplier?: number;
  // Ship Early tempo bonus (folded under the cap like lock/push/break)
  shipEarlyBonus?: number;
  // Pickup overtime tokens claimed this map (paid AFTER the per-map cap)
  pickupBonus?: number;
  // Every pickup claimed this map (resolved effect + value), for the overlay's
  // hold-info list (issue #48)
  pickupsClaimed?: { effect: string; value: number }[];
  // Treasure-chest reward ids smashed this map, for the overlay summary (#38)
  chestRewards?: string[];
  // Free-store-item tokens claimed this map: each makes the next OPEN store's
  // cheapest offer free (carried by the session until consumed)
  freeShopItemsEarned?: number;
  // Active-play seconds to first meet the win condition (drives the row label)
  clearTimeSeconds?: number;
  // Map highscore (#45): set when this map's score beat its previous highscore.
  beatHighscore?: boolean;
  previousHighscore?: number; // the record that was beaten (for display)
  highscoreBonus?: number;    // extra score credited for beating it
  // True when the map was won by locking every ball (an auto-win). The board
  // fully drains once no ball is left in play, so "remaining space" is 0% and
  // meaningless here - the results screen hides the Remaining row.
  wonByAllLocked?: boolean;
}
