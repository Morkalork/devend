/**
 * ballTypes — the catalogue of ball "species" and their abilities.
 *
 * Issue #37: ball colour now communicates a ball's special ability. The map no
 * longer dictates which balls (or speeds) are used — the game derives them from
 * the level number and a per-map maximum. This module serves the catalogue to
 * both the engine (speeds, abilities, lock multipliers) and the tutorial
 * (descriptions).
 *
 * `public/balls.yml` is the ONLY authored source of the catalogue. It reaches
 * the game twice, through the same validator:
 *  - baked into the bundle at build time (the `?raw` import below), giving a
 *    synchronously available default that can never drift from the YAML;
 *  - fetched again at runtime by `loadBallTypes()`, so a deployed build's
 *    balls.yml can still be tweaked without a rebuild.
 * If both somehow yield nothing (malformed file), a one-ball last resort keeps
 * the game runnable.
 *
 * Speeds are LITERAL flat world-units/second base values (issue decision: no
 * per-level scaling and no per-cut acceleration ramp). The `ballSpeedMultiplier`
 * upgrade still scales them at spawn time.
 */

import yaml from 'js-yaml';
import ballsYamlRaw from '../../public/balls.yml?raw';

/**
 * Hard floor on how slow the upgrade/lock stack may make a ball: its effective
 * speed never drops below this fraction of its normal (type) base speed. Guards
 * against the ballSpeedMultiplier (Runtime Optimisation, certificates, slow
 * loadouts) compounding with the MicroManager per-lock reduction into an
 * unplayably slow game (issue #42). Per-ball `minimumSpeed` may floor higher.
 */
export const MIN_BALL_SPEED_FACTOR = 0.5;

/**
 * Combined slow-down factor from the ballSpeedMultiplier and the MicroManager
 * per-lock reduction, floored at MIN_BALL_SPEED_FACTOR. `microManagerFactor` is
 * 1 when no MicroManager reduction applies. Used by both the physics speed cap
 * and the bottom-bar readout so the number shown matches what the balls do.
 */
export function effectiveBallSpeedFactor(
  ballSpeedMultiplier: number,
  microManagerFactor: number,
): number {
  return Math.max(MIN_BALL_SPEED_FACTOR, ballSpeedMultiplier * microManagerFactor);
}

export type BallAbility =
  | 'none'          // standard ball
  | 'variableSpeed' // yellow: cycles through fixed speeds on every surface contact
  | 'slowOthers'    // purple: each ball it clashes with loses speed (down to a floor)
  | 'moneyBall'     // green: locking it triples all subsequent locks this round
  | 'slowDown'      // grey: decays to a crawl over one minute
  | 'breakObjects'  // black: destroys mirrors/movers after repeated hits (Phase 2)
  | 'rainbow';      // rainbow: fast, shifts hue, spits out a random eligible ball on a timer

export interface BallTypeDef {
  id: string;
  /** Display name (tutorial). */
  name: string;
  /** Hex colour WITH leading '#'. */
  color: string;
  /** Flat base speed in world units/second. */
  baseSpeed: number;
  /**
   * Speed floor for this ball. Speed-altering effects (the grey slow-down, a
   * purple's drain, a yellow's range) never push it below this.
   */
  minimumSpeed: number;
  /** Minimum completed-level number at which this ball becomes eligible. */
  unlockLevel: number;
  /** Lock-bonus multiplier when this ball is locked away. */
  lockMultiplier: number;
  ability: BallAbility;
  /**
   * `slowOthers` (purple) only: how much speed each ball it clashes with loses
   * per hit (clamped to that ball's `minimumSpeed`). Defaults to 0.
   */
  speedReduction?: number;
  /** One-line ability summary for the tutorial. */
  description: string;
  /**
   * Yellow only: `[lo, hi]`. On every surface contact the ball picks a new
   * random speed in this range (clamped to `minimumSpeed`). The range itself
   * shrinks when the ball is slowed (e.g. by a purple).
   */
  speedRange?: [number, number];
  /**
   * `rainbow` only: seconds between spit-outs. Every interval the ball spawns
   * one random OTHER eligible ball type (never another rainbow). Defaults to
   * DEFAULT_RAINBOW_SPAWN_INTERVAL.
   */
  spawnIntervalSeconds?: number;
  /**
   * Per-map appearance probability in [0,1], rolled deterministically from the
   * map id so a given map is always the same. Absent = always eligible (1).
   * Used to make the rainbow ball an occasional event rather than every map.
   */
  spawnChance?: number;
  /**
   * Not yet wired up — excluded from selection and the tutorial until its
   * full behaviour ships. The black ball's destructible-object ability lands
   * in Phase 2.
   */
  phase2?: boolean;
}

/** Default seconds between a rainbow ball's spit-outs. */
export const DEFAULT_RAINBOW_SPAWN_INTERVAL = 10;

// ── Parsing & validation (shared by the baked default and the runtime fetch) ─

const VALID_ABILITIES: ReadonlySet<string> = new Set<BallAbility>([
  'none', 'variableSpeed', 'slowOthers', 'moneyBall', 'slowDown', 'breakObjects', 'rainbow',
]);

/** Coerce one raw YAML entry into a BallTypeDef, or null if it's unusable. */
function parseBallTypeEntry(raw: unknown): BallTypeDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const id    = typeof r.id === 'string' ? r.id : null;
  const color = typeof r.color === 'string' ? r.color : null;
  if (!id || !color) return null;

  const baseSpeed = Number(r.baseSpeed);
  if (!Number.isFinite(baseSpeed) || baseSpeed <= 0) return null;

  // Floor for speed-altering effects. Defaults to baseSpeed (no slowing) if absent.
  const minimumSpeed = Number.isFinite(Number(r.minimumSpeed))
    ? Math.max(0, Number(r.minimumSpeed))
    : baseSpeed;

  const ability = typeof r.ability === 'string' && VALID_ABILITIES.has(r.ability)
    ? (r.ability as BallAbility)
    : 'none';

  let speedRange: [number, number] | undefined;
  if (Array.isArray(r.speedRange)) {
    const nums = r.speedRange.map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (nums.length >= 2) speedRange = [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  }

  const speedReduction = Number.isFinite(Number(r.speedReduction))
    ? Math.max(0, Number(r.speedReduction))
    : undefined;

  const spawnIntervalSeconds = Number.isFinite(Number(r.spawnIntervalSeconds)) && Number(r.spawnIntervalSeconds) > 0
    ? Number(r.spawnIntervalSeconds)
    : undefined;

  const spawnChance = Number.isFinite(Number(r.spawnChance))
    ? Math.max(0, Math.min(1, Number(r.spawnChance)))
    : undefined;

  return {
    id,
    name: typeof r.name === 'string' ? r.name : id,
    color,
    baseSpeed,
    minimumSpeed,
    unlockLevel: Number.isFinite(Number(r.unlockLevel)) ? Math.max(1, Math.round(Number(r.unlockLevel))) : 1,
    lockMultiplier: Number.isFinite(Number(r.lockMultiplier)) ? Number(r.lockMultiplier) : 1,
    ability,
    speedReduction,
    description: typeof r.description === 'string' ? r.description : '',
    speedRange,
    spawnIntervalSeconds,
    spawnChance,
    phase2: r.phase2 === true,
  };
}

/** Parse a balls.yml document into validated defs ([] on any failure). */
function parseCatalogue(text: string): BallTypeDef[] {
  try {
    const data = yaml.load(text) as { balls?: unknown[] } | null;
    if (!data || !Array.isArray(data.balls)) return [];
    return data.balls.map(parseBallTypeEntry).filter((b): b is BallTypeDef => b !== null);
  } catch {
    return [];
  }
}

/**
 * Default catalogue: public/balls.yml as it looked at BUILD time, run through
 * the same validator as the runtime fetch — one authored source, no drift.
 * The one-ball last resort only exists for a balls.yml so malformed it yields
 * zero valid entries; it keeps the game bootable rather than being a real
 * catalogue.
 */
const LAST_RESORT: BallTypeDef[] = [{
  id: 'red', name: 'Red', color: '#ff5b5b', baseSpeed: 250, minimumSpeed: 150,
  unlockLevel: 1, lockMultiplier: 1, ability: 'none',
  description: 'A standard ball. No special behaviour - just bounces.',
}];

const bakedCatalogue = parseCatalogue(ballsYamlRaw);
const DEFAULT_BALL_TYPES: BallTypeDef[] = bakedCatalogue.length > 0 ? bakedCatalogue : LAST_RESORT;

// ── Live catalogue (loaded from balls.yml, defaults until then) ─────────────

let liveBallTypes: BallTypeDef[] = DEFAULT_BALL_TYPES;
let ballTypeById = new Map(liveBallTypes.map(t => [t.id, t]));

/** All ball types currently in effect (default or YAML-loaded). */
export function getAllBallTypes(): BallTypeDef[] {
  return liveBallTypes;
}

export function getBallType(id: string): BallTypeDef | undefined {
  return ballTypeById.get(id);
}

/** Ball types currently implemented and shown to players (excludes phase-2 types). */
export function getImplementedBallTypes(): BallTypeDef[] {
  return liveBallTypes.filter(t => !t.phase2);
}

/** Ball types eligible to appear at the given (1-based) level number. */
export function getEligibleBallTypes(level: number): BallTypeDef[] {
  return liveBallTypes.filter(t => !t.phase2 && t.unlockLevel <= level);
}

/**
 * Eligible types a rainbow ball may spit out at this level: everything eligible
 * EXCEPT rainbow types themselves, so a spawned ball never spawns more (that is
 * what keeps the count linear instead of exponential).
 */
export function getSpawnableBallTypes(level: number): BallTypeDef[] {
  return getEligibleBallTypes(level).filter(t => t.ability !== 'rainbow');
}

// ── Runtime reload from the served public/balls.yml ─────────────────────────

/**
 * Re-fetch the ball catalogue from the SERVED public/balls.yml, replacing the
 * in-memory list — this is what lets a deployed build (or the dev server, via
 * the Playground) pick up YAML tweaks without a rebuild. Returns true on
 * success; on any failure the build-time catalogue stays in effect. Safe to
 * call repeatedly (re-reads the file, cache-busting).
 */
export async function loadBallTypes(): Promise<boolean> {
  try {
    const response = await fetch('/balls.yml', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load balls.yml: ${response.status}`);
    const parsed = parseCatalogue(await response.text());
    if (parsed.length === 0) throw new Error('balls.yml contained no valid ball types');

    liveBallTypes = parsed;
    ballTypeById = new Map(parsed.map(t => [t.id, t]));
    return true;
  } catch (err) {
    console.warn('[ballTypes] Keeping the build-time catalogue:', err);
    return false;
  }
}

// ── Deterministic per-map selection ────────────────────────────────────────
// A given map id always yields the same set of ball types (stable across runs),
// chosen from the types eligible at that level, capped at the map's maxBalls and
// at the number of eligible types (a map can never use more distinct types than
// are available). Distinct types only — no duplicate colours.

function hashString(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick the ball types a map will spawn. Deterministic in `mapId`.
 *
 * @param mapId   The level config id (e.g. "level-3b").
 * @param level   The logical level number used for eligibility.
 * @param maxBalls Maximum balls the map wants (clamped to eligible-type count).
 */
export function selectBallTypesForMap(
  mapId: string,
  level: number,
  maxBalls: number,
): BallTypeDef[] {
  const eligible = getEligibleBallTypes(level);
  if (eligible.length === 0) {
    const red = getBallType('red');
    return red ? [red] : [];
  }

  // Per-map appearance roll: a type with a spawnChance only joins this map's
  // pool when its deterministic per-map roll passes, making rare types (the
  // rainbow) an occasional event rather than every eligible map. Types without
  // a spawnChance are always in. Fall back to the full eligible set if the roll
  // happens to empty the pool.
  const rolled = eligible.filter(t =>
    t.spawnChance == null || mulberry32(hashString(`${mapId}:chance:${t.id}`))() < t.spawnChance,
  );
  const candidates = rolled.length > 0 ? rolled : eligible;

  const count = Math.max(1, Math.min(maxBalls, candidates.length));

  // Seeded Fisher–Yates shuffle of a copy, then take `count`.
  const rng = mulberry32(hashString(mapId));
  const pool = [...candidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
