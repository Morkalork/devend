/**
 * ballTypes — the catalogue of ball "species" and their abilities.
 *
 * Issue #37: ball colour now communicates a ball's special ability. The map no
 * longer dictates which balls (or speeds) are used — the game derives them from
 * the level number and a per-map maximum. This module is the single source of
 * truth for both the engine (speeds, abilities, lock multipliers) and the
 * tutorial (descriptions).
 *
 * The catalogue is authored in `public/balls.yml` so it can be tweaked without a
 * rebuild; `loadBallTypes()` fetches and validates it. The hardcoded list below
 * is the built-in default/fallback used until the YAML loads (or if it fails to
 * parse), so the game always has a valid catalogue.
 *
 * Speeds are LITERAL flat world-units/second base values (issue decision: no
 * per-level scaling and no per-cut acceleration ramp). The `ballSpeedMultiplier`
 * upgrade still scales them at spawn time.
 */

import yaml from 'js-yaml';

export type BallAbility =
  | 'none'          // standard ball
  | 'variableSpeed' // yellow: cycles through fixed speeds on every surface contact
  | 'slowOthers'    // purple: each ball it clashes with loses speed (down to a floor)
  | 'moneyBall'     // green: locking it triples all subsequent locks this round
  | 'slowDown'      // grey: decays to a crawl over one minute
  | 'breakObjects'; // black: destroys mirrors/movers after repeated hits (Phase 2)

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
   * Not yet wired up — excluded from selection and the tutorial until its
   * full behaviour ships. The black ball's destructible-object ability lands
   * in Phase 2.
   */
  phase2?: boolean;
}

/** Built-in default catalogue — mirrors public/balls.yml; used as a fallback. */
const DEFAULT_BALL_TYPES: BallTypeDef[] = [
  {
    id: 'red',
    name: 'Red',
    color: '#ff5b5b',
    baseSpeed: 250,
    minimumSpeed: 150,
    unlockLevel: 1,
    lockMultiplier: 1,
    ability: 'none',
    description: 'A standard ball. No special behaviour — just bounces.',
  },
  {
    id: 'blue',
    name: 'Blue',
    color: '#00b4ff',
    baseSpeed: 250,
    minimumSpeed: 150,
    unlockLevel: 1,
    lockMultiplier: 1,
    ability: 'none',
    description: 'A standard ball, a touch faster than the red one.',
  },
  {
    id: 'yellow',
    name: 'Yellow',
    color: '#ffd93d',
    baseSpeed: 280,
    minimumSpeed: 150,
    unlockLevel: 5,
    lockMultiplier: 2,
    ability: 'variableSpeed',
    description: 'Variable speed: every surface it touches shifts it between 200 and 400.',
    speedRange: [200, 400],
  },
  {
    id: 'purple',
    name: 'Purple',
    color: '#b06bff',
    baseSpeed: 340,
    minimumSpeed: 150,
    unlockLevel: 10,
    lockMultiplier: 2,
    ability: 'slowOthers',
    speedReduction: 20,
    description: "Saps momentum: every ball it clashes with loses speed, down to the balls' minimum speed.",
  },
  {
    id: 'green',
    name: 'Green',
    color: '#00c853',
    baseSpeed: 300,
    minimumSpeed: 180,
    unlockLevel: 15,
    lockMultiplier: 2,
    ability: 'moneyBall',
    description: 'Money ball: locking it away triples the gains of every later lock this round.',
  },
  {
    id: 'grey',
    name: 'Grey',
    color: '#9aa3ad',
    baseSpeed: 200,
    minimumSpeed: 150,
    unlockLevel: 15,
    lockMultiplier: 1,
    ability: 'slowDown',
    description: 'Winds down: slows 10 speed every 5 seconds, down to its minimum speed.',
  },
  {
    id: 'black',
    name: 'Black',
    color: '#2b2f3a',
    baseSpeed: 200,
    minimumSpeed: 150,
    unlockLevel: 20,
    lockMultiplier: 4,
    ability: 'breakObjects',
    description: 'Wrecking ball: smashes mirrors and movers after three hits, losing a multiplier each time.',
  },
];

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

// ── Loading & validation from public/balls.yml ──────────────────────────────

const VALID_ABILITIES: ReadonlySet<string> = new Set<BallAbility>([
  'none', 'variableSpeed', 'slowOthers', 'moneyBall', 'slowDown', 'breakObjects',
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
    phase2: r.phase2 === true,
  };
}

/**
 * Load the ball catalogue from public/balls.yml, replacing the in-memory list.
 * Returns true on success; on any failure the built-in defaults are kept so the
 * game still runs. Safe to call repeatedly (re-reads the file, cache-busting).
 */
export async function loadBallTypes(): Promise<boolean> {
  try {
    const response = await fetch('/balls.yml', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load balls.yml: ${response.status}`);
    const data = yaml.load(await response.text()) as { balls?: unknown[] } | null;
    if (!data || !Array.isArray(data.balls)) throw new Error('Invalid balls.yml: missing `balls` array');

    const parsed = data.balls.map(parseBallTypeEntry).filter((b): b is BallTypeDef => b !== null);
    if (parsed.length === 0) throw new Error('balls.yml contained no valid ball types');

    liveBallTypes = parsed;
    ballTypeById = new Map(parsed.map(t => [t.id, t]));
    return true;
  } catch (err) {
    console.warn('[ballTypes] Falling back to built-in defaults:', err);
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

  const count = Math.max(1, Math.min(maxBalls, eligible.length));

  // Seeded Fisher–Yates shuffle of a copy, then take `count`.
  const rng = mulberry32(hashString(mapId));
  const pool = [...eligible];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
