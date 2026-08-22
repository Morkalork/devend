/**
 * Shifting gravity (issue #77): balls fall, and they must never stop bouncing.
 *
 * The second half of that is the whole design problem. This game maintains
 * CONSTANT ball speed on purpose, from three places in updateBall: the universal
 * minimum-speed floor ("no active ball may move below its minimumSpeed for ANY
 * reason"), grey's wind-down, and yellow's variable speed. All three rescale the
 * velocity vector to an absolute target magnitude every frame.
 *
 * So the obvious implementation, `velocity.y += g * dt`, is erased the same
 * frame it happens. The conveyor mutator already documents the same discovery
 * from the other side: it moves the POSITION, "not a velocity change, so it
 * never compounds into speed".
 *
 * Gravity here is therefore a STEERING force, not an accelerating one. The
 * velocity direction bends toward "down" at a fixed angular rate; the magnitude
 * is never touched. Two things follow:
 *
 *   - Speed invariants survive untouched, so the floor, grey, yellow, purple,
 *     Scope Creep and MicroManager all keep working with no special cases.
 *   - "They must bounce" stops being a tuning problem and becomes structural.
 *     A ball at constant speed cannot come to rest, ever, whatever the angle.
 *
 * What it is NOT: projectile motion. There is no acceleration, no terminal
 * velocity, and no slowing on the way up. Paths arc and balls pool along the
 * floor and bounce off it, which is the read the issue asks for, but a physicist
 * would call it a curved path at constant speed rather than freefall.
 */
import type { Vector2 } from "@/types/game";

/** The cardinal pulls a phase can apply. "none" is a gravity-free stretch. */
export type GravityDirection = "down" | "up" | "left" | "right" | "none";

export interface GravityConfig {
  /** Radians per second the heading may bend. 0 disables the pull. */
  turnRate: number;
  /** Seconds each phase holds before the next one takes over. */
  period: number;
  /** Phases, cycled in order. Include "none" for ordinary stretches. */
  sequence: GravityDirection[];
}

export const DEFAULT_GRAVITY: GravityConfig = {
  turnRate: 1.2,
  period: 8,
  // Interleaved "none" phases are what make the map READ as shifting rather
  // than as permanently tilted: the contrast between falling and not falling is
  // the effect, and a map that always pulls one way is just a slanted board.
  sequence: ["down", "none", "left", "none", "up", "none", "right", "none"],
};

const UNIT: Record<Exclude<GravityDirection, "none">, Vector2> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * An authored gravity block, straight out of YAML: strings, not a checked union.
 * Narrowing happens in normaliseGravity, which is the only place that decides
 * what counts as a direction.
 */
export interface RawGravityConfig {
  turnRate?: number;
  period?: number;
  sequence?: string[];
}

/** Sanitise an authored config; a malformed one simply disables gravity. */
export function normaliseGravity(raw?: RawGravityConfig | null): GravityConfig | null {
  if (!raw) return null;
  const turnRate = Number.isFinite(raw.turnRate) ? Math.max(0, raw.turnRate as number) : DEFAULT_GRAVITY.turnRate;
  const period = Number.isFinite(raw.period) && (raw.period as number) > 0
    ? (raw.period as number) : DEFAULT_GRAVITY.period;
  const seq: GravityDirection[] = Array.isArray(raw.sequence) && raw.sequence.length > 0
    ? raw.sequence.filter((d): d is GravityDirection =>
        d === "none" || Object.prototype.hasOwnProperty.call(UNIT, d))
    : [...DEFAULT_GRAVITY.sequence];
  if (seq.length === 0 || turnRate <= 0) return null;
  return { turnRate, period, sequence: seq };
}

/**
 * The phase index at a moment in the map's ACTIVE play.
 *
 * Keyed off activePlaySeconds rather than wall clock so a paused game does not
 * drift and, more importantly, so a seeded Daily run shifts at the same moments
 * for every player. Same rule the map beats follow.
 */
export function gravityPhaseIndex(activeSeconds: number, cfg: GravityConfig): number {
  const t = Number.isFinite(activeSeconds) && activeSeconds > 0 ? activeSeconds : 0;
  return Math.floor(t / cfg.period) % cfg.sequence.length;
}

/** Which way the current phase pulls, or "none". */
export function gravityDirectionAt(activeSeconds: number, cfg: GravityConfig): GravityDirection {
  return cfg.sequence[gravityPhaseIndex(activeSeconds, cfg)];
}

/** The current pull as a unit vector, or null while gravity is off. */
export function gravityVectorAt(activeSeconds: number, cfg: GravityConfig): Vector2 | null {
  const dir = gravityDirectionAt(activeSeconds, cfg);
  return dir === "none" ? null : { ...UNIT[dir] };
}

/** Seconds until the pull changes, for the on-screen indicator. */
export function secondsToNextShift(activeSeconds: number, cfg: GravityConfig): number {
  const t = Number.isFinite(activeSeconds) && activeSeconds > 0 ? activeSeconds : 0;
  return cfg.period - (t % cfg.period);
}

/** Shortest signed angle from `a` to `b`, in (-PI, PI]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Bend `velocity` toward `pull` by at most `turnRate * dt` radians, returning a
 * NEW vector of exactly the same magnitude.
 *
 * Magnitude preservation is the contract, not an implementation detail: it is
 * what keeps this compatible with every speed rescaler in updateBall, and what
 * makes a resting ball impossible.
 */
export function steerToward(
  velocity: Vector2, pull: Vector2, turnRate: number, dt: number,
): Vector2 {
  const len = Math.hypot(velocity.x, velocity.y);
  if (len <= 1e-9) return { ...velocity };          // nothing to steer
  const pullLen = Math.hypot(pull.x, pull.y);
  if (pullLen <= 1e-9 || turnRate <= 0 || dt <= 0) return { ...velocity };

  const current = Math.atan2(velocity.y, velocity.x);
  const target = Math.atan2(pull.y, pull.x);
  const delta = angleDelta(current, target);
  const maxStep = turnRate * dt;
  const step = Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;

  const next = current + step;
  return { x: Math.cos(next) * len, y: Math.sin(next) * len };
}

/**
 * The whole per-frame operation: steer if a pull is active, otherwise leave the
 * velocity exactly as it was. Returns null when nothing should change, so the
 * caller can skip the write entirely.
 */
export function gravityStep(
  velocity: Vector2, activeSeconds: number, cfg: GravityConfig, dt: number,
  bendMultiplier = 1,
): Vector2 | null {
  const pull = gravityVectorAt(activeSeconds, cfg);
  if (!pull) return null;
  // Free Fall (Escape Velocity) can soften the bend. Guarded rather than
  // trusted: a zero or negative multiplier would stall the steer or invert the
  // pull, and gravity that quietly pushes the wrong way is worse than none.
  const scale = Number.isFinite(bendMultiplier) && bendMultiplier > 0 ? bendMultiplier : 1;
  const rate = cfg.turnRate * scale;
  if (rate <= 0) return null;
  return steerToward(velocity, pull, rate, dt);
}
