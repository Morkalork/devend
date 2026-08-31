import type { MapObjective } from "@/types/objective";
import type { WinCondition } from "@/types/winSpec";

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
/**
 * Bending is authored as a parameter and resolved into vertices at load, so a
 * bent wall stays a readable rect in map.yml and stays re-editable in the
 * admin. See src/lib/bend.ts.
 */
export type { BendAxis, BendFields } from "@/lib/bend";
export type { FenceZone } from "@/lib/physics/fenceZones";
import type { FenceZone } from "@/lib/physics/fenceZones";

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

/**
 * The bend parameters every solid entity can carry.
 *
 * Declared here rather than extending the lib type directly so the level schema
 * stays readable on its own, and kept structurally identical to BendFields -
 * bendFieldsMatchSchema in the tests is what stops the two drifting apart.
 */
export interface BendShapeFields {
  /** Whole-object bow along its long axis. 1 is a half turn; the editor clamps well inside that. */
  bend?: number;
  /** Which way the bow runs. Omitted means the longer side of the bounds. */
  bendAxis?: "auto" | "x" | "y";
  /** Per-edge bows for a polygon, parallel to `points`. Entry i bows point i to point i+1. */
  curves?: number[];
  /**
   * Whole-object turn, in degrees clockwise. A rect stays a rect in map.yml -
   * width, height and position all keep meaning - and the turn is applied when
   * the board is built, so it can be re-turned or resized later.
   */
  angle?: number;
}

// Base entity interface - extensible for future kinds
export interface BaseEntity {
  id: string;
  kind: string;
  shape: "rect" | "polygon" | "circle";
}

// Wall entity - carves away playable space (subtracted from regions like cuts)
export interface WallEntity extends BaseEntity, BendShapeFields {
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
  /**
   * Treasure chest (destruct-up, issue #38). A breakable that, when smashed,
   * instantly grants a run bonus. Implies `breakable`. Often hidden behind a
   * plain breakable wall the player must clear first.
   */
  chest?: boolean;
  /**
   * Hybrid reward pool for a chest: the smash rolls (seeded) within these
   * reward ids. Absent/empty = roll from the full default pool. See chests.ts.
   */
  chestRewards?: string[];
  /**
   * Phasing object (issue #64). When true the obstacle fades IN (solid) and OUT
   * (intangible) on a repeating cycle. While phased out, balls and fences pass
   * through it, and the phase-out emits a shockwave that flings any snagged /
   * entangled balls free (the boss-20 chain release loop).
   */
  isPhasing?: boolean;
  /** Seconds for one full in/out phasing cycle (default 10). */
  phaseCycleSeconds?: number;
  // ── Obstacles that do not stop every ball (see lib/physics/obstacleRules) ──
  /**
   * One-way membrane. Balls travelling roughly this way pass through; the other
   * way they bounce. The herding tool: drive a ball in and seal behind it.
   */
  oneWay?: "up" | "down" | "left" | "right";
  /**
   * Ball-type gate. Only these ball type ids may pass; everything else bounces.
   * Empty or absent leaves an ordinary solid wall.
   */
  passTypes?: string[];
}

// Combined entity type with shape
export type WallRectEntity = WallEntity & RectShape;
export type WallPolygonEntity = WallEntity & PolygonShape;
export type WallCircleEntity = WallEntity & CircleShape;
export type LevelEntity = WallRectEntity | WallPolygonEntity | WallCircleEntity | LevelMoverEntity | BoxRectEntity;

/** True when the entity is a wall with the mirror flag set. Movers can never be mirrors. */
export function isMirrorEntity(entity: LevelEntity): boolean {
  return entity.kind === "wall" && !!entity.mirror;
}

/**
 * A delivery box: four walls with one MEMBRANE side.
 *
 * A ball that crosses the membrane is inside for good, and the box counts it as
 * DELIVERED. Deliberately not "locked": the lock rule is that a ball only locks
 * in a genuinely sealed pocket, never one closed off by a gap too narrow for
 * it, and that rule is the game's core lesson. A ball that wandered into a box
 * has not been sealed by anyone, so it earns a different word and its own
 * counter.
 *
 * The verb is different too. Every lock in the game is "seal a ball where it
 * happens to be"; a delivery is "take a ball somewhere", which is the one thing
 * the one-way membrane was good for and nothing rewarded.
 *
 * Making the mouth hard to reach is the DESIGNER's job, not the mechanic's: put
 * a breakable over it, or a phasing cover, or a charge. Those compose already
 * and the box should not try to own them.
 */
export interface BoxEntity extends BaseEntity, BendShapeFields {
  kind: "box";
  /** Which side carries the membrane. Balls pass inward here and cannot leave. */
  mouth: "up" | "down" | "left" | "right";
  /** Deliveries it wants. A win can require this many. */
  capacity: number;
  /**
   * Hold the box's interior off the board until it is satisfied.
   *
   * Without this the box is a side quest: feeding it removes threats and makes
   * the rest of the map calmer, so the difficulty curve inverts as you do the
   * hard thing. Reserving the space makes the two halves need each other -
   * the same trick the circuit's sleepers use to stop waking them being
   * optional.
   */
  reserves?: boolean;
}
export type BoxRectEntity = BoxEntity & RectShape;

// ── Mover entities — obstacles that oscillate back and forth ──────────────
export interface MoverEntityBase extends BaseEntity, BendShapeFields {
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
  /**
   * How lit this map is: 1 (or absent) is the normal board, lower is darker,
   * down to MIN_MAP_LIGHT. A darkness you author, not a global one.
   *
   * It darkens the BOARD SURFACE only, through the wash (boardWash.ts), which
   * is a multiply - so live and captured space scale together and stay exactly
   * as distinguishable as ever. What a dark map takes away is your view of the
   * board at rest, which makes the light the balls carry the way you read it.
   * Obstacles and fences are drawn above the wash and stay visible, because a
   * map where you cannot see the walls is not a challenge.
   */
  light?: number;
  threadLockRequired?: number; // minimum number of balls that must be thread-locked to win
  /**
   * The map's win, stated outright.
   *
   * When absent, resolveWinSpec derives an equivalent spec from sizeThreshold,
   * threadLockRequired, the gate Colored Areas and `boss`, exactly as the old
   * hardcoded chain read them, so every existing map is unchanged. Authoring
   * this REPLACES that derivation, including the all-balls-locked shortcut: a
   * map that wants it has to list it under alsoWinIf, or a gate written here
   * could be walked around by simply locking everything.
   */
  win?: { require?: WinCondition[]; alsoWinIf?: WinCondition[] };
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
   * Ground that changes how fast a fence builds across it. speed < 1 slows the
   * cut, > 1 speeds it. The only mechanic that acts on the CUT rather than on
   * the balls or the space. See lib/physics/fenceZones.
   */
  fenceZones?: FenceZone[];
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
  /**
   * Gravity wells (issue #77): authored patches of the board that PULL.
   *
   * A ball flies normally until it enters one, bends toward the pull while it
   * is inside, and resumes ordinary motion the moment it leaves. That is the
   * whole point of doing it locally rather than globally: a universal pull
   * makes every ball's path knowable, which is corrosive in a game whose
   * tension is unpredictable motion in shrinking space. A well does the
   * opposite, because where a ball leaves depends on where and at what angle
   * it happened to enter.
   *
   * It is also structurally immune to the failure a global pull has. Given
   * long enough a ball's heading converges on the pull and it ends up
   * ping-ponging in a straight column; inside a well it always leaves first.
   */
  gravityWells?: GravityWell[];
  /**
   * Per-tier board-tilt chance for this map (0-1), overriding the 5-10% band
   * drawn at map start. Absent = the normal draw.
   *
   * The band is deliberately rare, which makes a tilt a surprise and makes it
   * impossible to AUTHOR one. A map built around the turn (act III's skill
   * check) has to be able to say "this one really does turn", the same way a
   * map can pin a mutator rather than hoping the roll delivers it. Still
   * subject to every other rule: the map needs a well for a tilt to mean
   * anything, and it must be past TILT_MIN_LEVEL.
   */
  tiltChance?: number;
  /**
   * Pin a mutator to this map instead of leaving it to the procedural roll, by
   * its `id` in public/mapMutators.yml.
   *
   * Boss maps could already force one; ordinary maps could not, so a mutator
   * could only ever be a random visitor. A set-piece built AROUND its mutator
   * (the shifting-gravity map of issue #77 is the case that needed this) has to
   * be able to author it, the same way LEVELDESIGN.md expects a map's Turn to
   * be authored rather than hoped for.
   *
   * An ID, not an inline MapMutator, because that is how every map.yml that has
   * ever used this field authored it. Typing it as the whole object made the
   * declaration and the data disagree with nothing to catch it: js-yaml casts
   * map.yml to LevelData unchecked, so `mutator: gravity` type-checked as a
   * MapMutator and shipped as a bare string. Every reader then got `undefined`
   * off it - the Specs card rendered its border and icon with no name or
   * description, and `behavior === "gravity"` was false, so the map that is
   * authored around a live pull never pulled at all.
   */
  mutator?: string;
  /**
   * Scripted "Turn" beats (LEVELDESIGN.md convention 3): threshold-triggered
   * one-shot events so the endgame differs from the opening. Generalizes boss
   * phases to ANY map. Each beat fires once when its space-remaining or
   * active-seconds threshold is crossed.
   */
  beats?: MapBeat[];
  /**
   * Colored Areas: typed var/let/const zones. A GATE area (the default) is a
   * required win condition; a `required: false` area is the optional greed hook
   * (bonus pay, no fail state). See ColoredArea.
   */
  coloredAreas?: ColoredArea[];
  /**
   * "Wire the Integration" circuit (a greed hook keyed on fence PLACEMENT):
   * route fences through the terminals to complete it and open a sealed bonus
   * vault. One per map. See CircuitConfig.
   */
  circuit?: CircuitConfig;
  /**
   * "Deploy Charge" fuses (a player-authored Turn keyed on fence PLACEMENT):
   * route a fence over a fuse to arm it, and after a telegraphed beat it blasts
   * away its target obstacle slab, reshaping the board. See ChargeConfig.
   */
  charges?: ChargeConfig[];
  /**
   * "Data Stream" seam (a greed hook keyed on fence PLACEMENT): draw a fence
   * ALONG the glowing vein to harvest it for scaled overtime / a freeze charge.
   * One per map. See DataStreamConfig.
   */
  dataStream?: DataStreamConfig;
  /**
   * Fence budget / "WIP Limit" (LEVELDESIGN.md modifier): the max number of
   * COMPLETED fences allowed on this map. Running out before the map is
   * finished loses a life and restarts the map. Only successful partitions
   * count (a fence a ball destroys mid-draw is free). Absent = unlimited.
   */
  fenceBudget?: number;
}

/**
 * A scripted map beat: fires ONCE when its threshold is crossed and applies its
 * effects. Any combination of effects may be set. The trigger mirrors BossPhase
 * (atSpaceRemaining / atSeconds).
 */
export interface MapBeat {
  id: string;
  /** Fire when space remaining (%) drops to or below this. */
  atSpaceRemaining?: number;
  /** Fire when active-play seconds reaches this (alternative/added trigger). */
  atSeconds?: number;
  /** Spawn this many extra balls ("adds") off live balls. */
  spawnAdds?: number;
  /** Force-break the destructible entity with this id (topples / reveals / rewards). */
  breakId?: string;
  /** One-time ball-speed spike, as a fraction added for the rest of the map (0.2 = +20%). */
  speedSpike?: number;
  /**
   * Telegraph label (an i18n key) shown as a warning banner when the beat is
   * about to fire, so the player is not ambushed (LEVELDESIGN.md: telegraph the
   * Turn). Absent = no banner (e.g. a breakId beat self-telegraphs by the wall
   * visibly breaking).
   */
  announce?: string;
  /**
   * Lead time (ms) to show the `announce` warning BEFORE the effect fires. Only
   * applies to time-triggered beats (atSeconds); space-triggered beats are
   * player-driven, so their warning shows as the effect lands. Default 1600.
   */
  leadMs?: number;
}

/** The dormant ball a circuit terminal boots when lit (issue #73). */
export interface DormantBallConfig {
  /** Where the ball sleeps (and springs to life from). World units. */
  x: number;
  y: number;
  /** Ball-type id (default: the map's normal selection picks one). */
  typeId?: string;
}

/**
 * A circuit terminal: a world point a fence routes through to LIGHT it, which
 * boots the dormant ball linked to it (issue #73).
 */
export interface CircuitTerminal {
  x: number;
  y: number;
  /** The dormant ball this terminal wakes when a fence lights it. */
  ball: DormantBallConfig;
}

/**
 * "Wire the Integration" (issue #73 rewrite): a set of terminals, each linked to
 * a DORMANT ball. Routing a fence within `radius` of a terminal lights it and
 * WAKES that terminal's ball (incremental - each terminal is independent). A
 * dormant ball reserves an uncapturable pocket, so you cannot clear its space
 * until you boot it and then trap it. Rotated with the map.
 */
export interface CircuitConfig {
  /** 1+ terminals, each booting its own dormant ball. */
  terminals: CircuitTerminal[];
  /** World-unit distance a fence segment must pass within to light a terminal. */
  radius: number;
  /** Telegraph i18n key flashed when a terminal boots its ball (optional). */
  announce?: string;
}

/**
 * "Deploy Charge" (LEVELDESIGN.md convention 3, a player-authored Turn): a fuse
 * sits on/beside an obstacle slab. Routing a fence within `radius` of the fuse
 * ARMS it; after `delaySeconds` of telegraph it DETONATES, destroying the target
 * obstacle (reopening its footprint as capturable space), flinging nearby balls,
 * and fracturing the player's own fences inside `blastRadius`. The target must be
 * a breakable obstacle entity (it carries a destructible descriptor). Rotated
 * with the map.
 */
export interface ChargeConfig {
  /** The fuse point a fence must pass within `radius` of to arm the charge. */
  fuse: { x: number; y: number };
  /** World-unit distance a fence segment must pass within to arm the fuse. */
  radius: number;
  /** Id of the breakable obstacle entity destroyed when the charge detonates. */
  targetId: string;
  /** Balls flung + player fences fractured within this of the blast (default 220). */
  blastRadius?: number;
  /** Telegraphed wind-up in active-play seconds between arming and blast (default 1.2). */
  delaySeconds?: number;
  /** Telegraph i18n key flashed when the charge detonates. */
  announce?: string;
}

/** What a harvested Data Stream pays. `value` is the payout for covering the
 *  WHOLE seam; partial coverage pays proportionally. */
export interface DataStreamReward {
  kind: "overtime" | "freezeCharge";
  value: number;
}

/**
 * "Data Stream" (LEVELDESIGN.md convention 2, a greed hook on fence PLACEMENT):
 * a glowing vein across the board. A fence drawn ALONG the seam (running within
 * `width` of it, not merely crossing it) harvests the spans it covers, paying
 * `reward` scaled by how much of the seam is covered. The seam is laid so
 * tracing it costs a looser seal or a hazard lane. Rotated with the map.
 */
export interface DataStreamConfig {
  /** The seam polyline (2+ world points). Each segment is harvested once. */
  path: { x: number; y: number }[];
  /** A fence running within this of a seam segment harvests that segment. */
  width: number;
  /** What full coverage pays (partial coverage pays proportionally). */
  reward: DataStreamReward;
  /** Telegraph i18n key flashed when a span is harvested. */
  announce?: string;
}

/**
 * A Colored Area: a typed, labelled zone where locking pays the kind's
 * multiplier. Three kinds, easiest to hardest:
 *   var (light pink, 1.5x) < let (light orange, 2x) < const (light teal, 3x).
 * By convention a var area is drawn largest (easiest), a const smallest.
 *
 * An area is either a GATE or a BONUS pocket (`required`), which is the single
 * authorable form of LEVELDESIGN.md's greed hook:
 * - GATE (default): a REQUIRED win condition. You win the map by locking a
 *   target ball inside one (boss map: the boss; else any ball); locking the
 *   target outside fails the map (lose a life, restart).
 * - BONUS (`required: false`): pure upside. Locking inside pays the multiplier,
 *   ignoring it costs nothing and the map is won the normal way.
 * The teaching arc runs bonus first (early maps: "the pink box pays more") and
 * gate later (L10's boss: "the pink box is the only way to ship it").
 */
export type AreaKind = "var" | "let" | "const";

/**
 * Which way a well pulls, in SCREEN space.
 *
 * Screen-absolute rather than map-relative is the load-bearing choice, and the
 * board tilt is why: a rigid rotation preserves every relationship inside it,
 * so a pull that turned with the map could never change how the map plays. Down
 * stays down while the board turns underneath it, and that gap is the entire
 * mechanic.
 *
 * With more than one direction available the gap gets richer rather than just
 * bigger. A map carrying several differently-aimed wells has its whole
 * relationship to gravity rearranged by one quarter turn, because each well
 * lands on a different one of its four possible bearings.
 */
export type WellPull = "down" | "up" | "left" | "right";

/**
 * A rectangular patch that bends any ball inside it toward a fixed direction.
 */
export interface GravityWell {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Radians per second the heading bends while inside. Strong and small beats
   * weak and large: a gentle wide well is a nudge nobody notices, a fierce
   * narrow one is a deflector you can aim a ball through on purpose.
   */
  turnRate?: number;
  /**
   * Which way it pulls (default "down", so every map authored before this
   * plays exactly as it did).
   *
   * The three new bearings are not merely rotations of the old one, because the
   * board has a floor and balls have somewhere to fall TO. "up" is a fountain
   * that holds balls off a surface; "left"/"right" are currents that sweep a
   * lane. Each also makes the well's arrow load-bearing: with one direction the
   * glyph was decoration telling you what you already knew.
   */
  pull?: WellPull;
  /**
   * Space remaining (%) at or below which the well WAKES. Absent = live from
   * the first frame.
   *
   * A dormant well is drawn the whole time, drained and inert, and starts
   * pulling when the board has been cleared down to this much. That is
   * LEVELDESIGN.md's "Turn" in well form: the endgame is not the opening, and
   * critically the player can SEE it coming and plan around it, which is the
   * difference between a turn and an ambush.
   *
   * Same units and comparison as MapBeat.atSpaceRemaining, deliberately: a map
   * author reading one already knows how to read the other.
   */
  activeFrom?: number;
}

export interface ColoredArea {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: AreaKind;
  /**
   * Win gate (default true). Set false for a bonus-only pocket: it still pays
   * the kind multiplier but never gates the win and never fails the map.
   */
  required?: boolean;
  /**
   * Runtime only (set by checkBallWonState, not authored): true once ANY ball
   * has been locked inside this area, so the renderers light it up to show the
   * zone is occupied/used. (The WIN gate itself still requires the target ball
   * in a GATE area; that's the separate game.coloredAreaSatisfied.) Reset per
   * map with game.coloredAreas.
   */
  satisfied?: boolean;
  /**
   * Runtime only: when `satisfied` flipped (performance.now()). Drives the
   * activation pulse, which is the only thing that tells a player mid-map that
   * their lock actually counted. Without a timestamp the renderer can only draw
   * a static "lit" state, which is indistinguishable from never having tried.
   */
  satisfiedAt?: number;
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
  /** Forced environmental modifier for the whole fight: a #54 mutator `id`. */
  mutator?: string;
  /** When true, Scope Creep runs from second 0 (no grace) for extra pressure. */
  creepFromStart?: boolean;
  /** Phase events fired as the fight escalates. */
  phases?: BossPhase[];
  /** The boss antagonist ball. When set, a distinct boss ball spawns and must be
   *  defeated (the objective should be `defeatBoss`). */
  bossBall?: BossBall;
}

/** The boss antagonist ("Release Candidate"): big, fast, spits minions, and takes
 *  `hp` traps to defeat (it breaks out of the first hp-1 traps, escalating). */
export interface BossBall {
  /** Traps needed to defeat it (each non-final trap makes it break out). Default 3. */
  hp?: number;
  /** Radius multiplier vs a normal ball (default 2). */
  radiusScale?: number;
  /** Speed multiplier vs a normal ball (default 1.2). */
  speedScale?: number;
  /** Fixed menacing colour (hex with #). Defaults to a boss red. */
  color?: string;
  /** Seconds between minion spits (0 = never spits). */
  spitIntervalSeconds?: number;
  /** Cap on total minions spit this map (default 4). */
  maxMinions?: number;
  // ── Multi-boss + attacks (issue #64) ─────────────────────────────────────
  /** How many boss balls spawn (default 1). 2 = an interlinked pair (L20/L35). */
  count?: number;
  /** Link the spawned boss balls together with a fence-breaking chain (a pair). */
  chained?: boolean;
  /** Periodic "wipe all player fences" attack: seconds between wipes (0 = never). */
  fenceWipeSeconds?: number;
  /** When true, spit minions are enlarged (radius x1.3) like the big-ball gift. */
  spawnEnlargedMinions?: boolean;
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
