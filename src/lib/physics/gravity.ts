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
 * frame it happens. The removed conveyor mutator had found the same thing from
 * the other side and moved the POSITION instead - which avoided the rescalers,
 * but let a strong enough current hold a ball against a wall, since the ball's
 * own motion and the current were then being arbitrated by the collision
 * clamp. Steering the heading avoids both traps.
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
  /**
   * Pull by ACCELERATING instead of steering: real falling, reported as weird
   * without it (see the "what it is NOT" note at the top of this file).
   *
   * Off by default, and every existing map leaves it off, because the steering
   * model is what the speed rescalers were built around. Turning it on is a
   * different physics with a different set of things that can go wrong, so it
   * is a per-map decision rather than a global one.
   */
  accelerate: boolean;
  /** World units per second squared, when accelerating. */
  strength: number;
  /**
   * Terminal speed, as a multiple of the ball's own base speed.
   *
   * Freefall needs a ceiling or a bouncy floor turns into a pump: each landing
   * adds what the fall added and nothing ever takes it out. 2.2 is not a new
   * number, it is the ceiling fenceTouch and the bouncers already use, so a
   * ball on a gravity map tops out where a ball off one does.
   */
  topSpeedScale: number;
}

export const DEFAULT_GRAVITY: GravityConfig = {
  turnRate: 1.2,
  period: 8,
  accelerate: false,
  strength: 300,
  topSpeedScale: 2.2,
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
  accelerate?: boolean;
  strength?: number;
  topSpeedScale?: number;
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
  const accelerate = raw.accelerate === true;
  const strength = Number.isFinite(raw.strength) && (raw.strength as number) > 0
    ? (raw.strength as number) : DEFAULT_GRAVITY.strength;
  const topSpeedScale = Number.isFinite(raw.topSpeedScale) && (raw.topSpeedScale as number) > 1
    ? (raw.topSpeedScale as number) : DEFAULT_GRAVITY.topSpeedScale;
  // turnRate gates the STEERING model only. An accelerating map does not use it,
  // and demanding one anyway would make `turnRate: 0` silently disable a pull
  // that has nothing to do with turning.
  if (seq.length === 0) return null;
  if (!accelerate && turnRate <= 0) return null;
  return { turnRate, period, sequence: seq, accelerate, strength, topSpeedScale };
}

/**
 * The phase index at a moment in the map's ACTIVE play.
 *
 * Keyed off activePlaySeconds rather than wall clock so a paused game does not
 * drift and, more importantly, so a seeded Daily run shifts at the same moments
 * for every player. Same rule the map beats follow.
 */
export function gravityPhaseIndex(activeSeconds: number, cfg: GravityConfig): number {
  return gravityPhaseCount(activeSeconds, cfg) % cfg.sequence.length;
}

/**
 * How many phases have BEGUN since the map started, NOT folded into the
 * sequence length.
 *
 * The modulo index above cannot answer "what came before this one?": index 0 at
 * t=0 and index 0 one full cycle later are the same number, and the board tilt
 * reads the previous phase to know what it is turning FROM. Counting from the
 * map's start is what tells those two cases apart, so it is exported rather
 * than re-derived beside the tilt, where it would be a second statement of the
 * same fact and free to drift from this one.
 */
export function gravityPhaseCount(activeSeconds: number, cfg: GravityConfig): number {
  const t = Number.isFinite(activeSeconds) && activeSeconds > 0 ? activeSeconds : 0;
  return Math.floor(t / cfg.period);
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
  /** The ball's own base speed, for the terminal clamp. Accelerating maps only. */
  baseSpeed = 0,
): Vector2 | null {
  const pull = gravityVectorAt(activeSeconds, cfg);
  if (!pull) return null;
  if (cfg.accelerate) return accelerateToward(velocity, pull, cfg, dt, bendMultiplier, baseSpeed);
  // Free Fall (Escape Velocity) can soften the bend. Guarded rather than
  // trusted: a zero or negative multiplier would stall the steer or invert the
  // pull, and gravity that quietly pushes the wrong way is worse than none.
  const scale = Number.isFinite(bendMultiplier) && bendMultiplier > 0 ? bendMultiplier : 1;
  const rate = cfg.turnRate * scale;
  if (rate <= 0) return null;
  return steerToward(velocity, pull, rate, dt);
}

/**
 * Real falling: add `strength * dt` along the pull and let the magnitude go
 * where it goes, clamped at terminal.
 *
 * The opposite trade from steerToward, and worth stating plainly because the
 * top of this file spends thirty lines arguing for the other one. Steering
 * keeps every speed rescaler in updateBall working by never touching the
 * magnitude; accelerating touches nothing BUT the magnitude, so those rescalers
 * are now in the loop. That is survivable and mostly desirable:
 *
 *   - The universal minimum-speed floor still applies, so a ball at the top of
 *     its arc is nudged along rather than hanging. Freefall would have it pause
 *     there; this game's "no ball may come to rest" rule outranks that, and the
 *     nudge is small next to a fall.
 *   - Grey's wind-down and yellow's re-roll still rescale on contact. A ball
 *     with a speed ABILITY on an accelerating map is having two things done to
 *     its magnitude, and the ability wins on the frames it fires. Level 14
 *     spawns red and blue, neither of which does this.
 *
 * The terminal clamp is what stops a bouncy floor becoming a pump. It scales
 * the whole vector rather than the added component, so a ball at terminal still
 * steers into the fall instead of freezing its heading.
 */
function accelerateToward(
  velocity: Vector2, pull: Vector2, cfg: GravityConfig, dt: number,
  bendMultiplier: number, baseSpeed: number,
): Vector2 | null {
  if (!(dt > 0)) return null;
  // Free Fall softens a bend; on an accelerating map the same line softens the
  // pull, which is the same promise ("gravity affects you less") kept in the
  // model that map is actually running.
  const scale = Number.isFinite(bendMultiplier) && bendMultiplier > 0 ? bendMultiplier : 1;
  const dv = cfg.strength * scale * dt;
  if (!(dv > 0)) return null;

  const next = { x: velocity.x + pull.x * dv, y: velocity.y + pull.y * dv };
  const speed = Math.hypot(next.x, next.y);
  const terminal = baseSpeed > 0 ? baseSpeed * cfg.topSpeedScale : 0;
  if (terminal > 0 && speed > terminal) {
    const r = terminal / speed;
    return { x: next.x * r, y: next.y * r };
  }
  return next;
}

/**
 * How sharply an accelerating pull is bending a path RIGHT NOW, in radians per
 * second, for anything that has to reason about curvature rather than apply it.
 *
 * Only the component of the pull across the heading turns it; the component
 * along it just changes speed. Exported because the path preview marches in
 * chords sized by exactly this, and a preview that guessed at the number would
 * be the drifted forecast that steerHeading exists to prevent.
 */
export function accelTurnRate(
  velocity: Vector2, pull: Vector2, strength: number,
): number {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!(speed > 1e-6) || !(strength > 0)) return 0;
  const cross = Math.abs(velocity.x * pull.y - velocity.y * pull.x) / speed;
  return (strength * cross) / speed;
}
