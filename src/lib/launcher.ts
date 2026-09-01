/**
 * The launcher: a plunger that fires the map's ball, and a wager on the map.
 *
 * A launcher map opens with its ball asleep in a three-sided cup. Nothing moves
 * until the player pulls back and lets go, and the pull decides two things at
 * once: which way the ball goes, and how fast it will travel FOR THE WHOLE MAP.
 *
 * ── Why the speed is permanent, and why that is the feature ────────────────
 *
 * Nothing in the engine damps a ball. `minimumSpeed` is a floor that only ever
 * scales speed up, wall bounces are specular (`v - 2(v·n)n`, which preserves
 * magnitude exactly), and there is no ceiling anywhere in src/lib/physics. A
 * ball fired at 2.5x is still travelling at 2.5x when it is locked.
 *
 * So this is not a pinball impulse that decays into an ordinary map. It is a
 * difficulty setting the player chooses, once, before the first fence, and then
 * has to live with. That is the whole reason it can be paid for.
 *
 * ── Why it pays on the base and not on the lock ────────────────────────────
 *
 * The obvious design is "a harder shot makes each lock worth more". It would
 * pay nothing. Lock quality banks into CRAFT, and Craft is a capped axis with
 * several routes to the same ceiling - see the note in lockCapacity.ts, where
 * `premiumAvailable` is fixed at `totalCapacity x (superiorMultiplier - 1)` and
 * zone and simultaneous locks are described as alternative routes rather than a
 * bigger axis. On any map where the player is already getting superior locks, a
 * launch bonus routed through lock quality would be added to a full axis and
 * clamped straight back off. The colored-area share shipped with exactly that
 * bug and displayed "+9h" for a contribution worth zero.
 *
 * The power multiplies the map's BASE instead, which is the one term no axis
 * ceiling can swallow. It is visible the moment you pull: the map's value rises
 * in the "Score: x / y" line before a single fence is drawn.
 *
 * The multiplier IS the power, deliberately. "Fire it at 2.5x and the map's
 * base pays 2.5x" is a rule a player can hold in their head while aiming, and
 * any slope constant in between would be a number nobody could feel.
 */
import type { Vector2 } from "@/types/game";
import { BEARING_VECTOR, type Bearing } from "@/lib/physics/obstacleRules";

/**
 * The side of the cup a launcher is open on, and therefore fires out of.
 *
 * An alias, not a new vocabulary. A launcher's facing, a membrane's bearing and
 * a well's pull are the same four values and rotate by the same rule; giving
 * this one its own union would let the four drift apart one edit at a time.
 */
export type LaunchFacing = Bearing;

/**
 * Unit vector for a facing.
 *
 * Reads the SAME table the one-way membranes use rather than restating it.
 * Screen coordinates, so "up" is negative y - and a second copy of that fact
 * is precisely how a launcher would come to fire out of its closed side on
 * some future edit while every test here still passed.
 */
export function bearingVector(facing: LaunchFacing): Vector2 {
  const [x, y] = BEARING_VECTOR[facing];
  return { x, y };
}

/** Weakest launch: the ball leaves at its ordinary speed and the base pays 1x. */
export const LAUNCH_MIN_POWER = 1;

/**
 * Strongest launch, as a multiple of the ball's own base speed.
 *
 * Three is a play-feel number bounded by a hard one. Collision against fences
 * is discrete - a position test per 1/120s step, not a swept volume - so a ball
 * that travels further in one step than the collision band is wide can cross a
 * fence without ever being tested against it. `maxSafeLaunchPower` computes
 * where that starts and a test pins this constant below it; at a red ball's 250
 * base speed the ceiling is around 22x, so 3 is not close to the edge. The cap
 * exists because 3x is already a hard map, not because 4x would tunnel.
 */
export const LAUNCH_MAX_POWER = 3;

/** Pull length, in world units, that reaches full power. */
export const LAUNCH_FULL_PULL = 220;

/**
 * Pull shorter than this fires nothing.
 *
 * A tap on the board is not a launch. Without a dead zone the ball leaves on
 * any stray touch - including the one a player makes while reading the board -
 * and a launch cannot be taken back.
 */
export const LAUNCH_DEAD_PULL = 24;

/**
 * How far off its facing a launcher can be aimed, in radians.
 *
 * Not zero, because a pure power slider wastes the other dimension of a drag
 * and makes every launcher map open the same way. Not free, because a launcher
 * that can fire anywhere is just a ball spawn with extra steps: the cup's
 * opening is a design statement about which part of the board this map wants
 * you to open with, and a 35 degree cone keeps that statement true while still
 * letting a player pick a lane.
 */
export const LAUNCH_SPREAD = (35 * Math.PI) / 180;

export interface LaunchAim {
  /** Unit vector the ball will leave along, already clamped to the cone. */
  direction: Vector2;
  /** Multiple of base speed, in [LAUNCH_MIN_POWER, LAUNCH_MAX_POWER]. */
  power: number;
  /** True when the aim wanted to go wider than the cone allows. */
  clamped: boolean;
}

/**
 * Read a pull into an aim.
 *
 * `pull` is the vector from where the finger went down to where it is now, so
 * the ball fires along its REVERSE: you draw the plunger back and it springs
 * forward, which is the gesture every slingshot in every game has taught.
 * Returns null for a pull too short to mean anything, which the caller shows as
 * "not yet a launch" rather than as a weak one.
 */
export function launchAim(pull: Vector2, facing: LaunchFacing): LaunchAim | null {
  const len = Math.hypot(pull.x, pull.y);
  if (!(len > LAUNCH_DEAD_PULL)) return null;

  const bearing = bearingVector(facing);
  // Fire opposite the pull.
  const wanted = { x: -pull.x / len, y: -pull.y / len };

  // Angle between the wanted heading and the cup's facing, signed so the clamp
  // knows which edge of the cone to fall back to.
  const base = Math.atan2(bearing.y, bearing.x);
  const want = Math.atan2(wanted.y, wanted.x);
  let delta = want - base;
  // Normalise to (-pi, pi] so a wrap across the branch cut does not read as a
  // huge deflection and slam the aim into the wrong edge of the cone.
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;

  const clamped = Math.abs(delta) > LAUNCH_SPREAD;
  const used = clamped ? Math.sign(delta) * LAUNCH_SPREAD : delta;
  const angle = base + used;

  const t = Math.min(1, (len - LAUNCH_DEAD_PULL) / (LAUNCH_FULL_PULL - LAUNCH_DEAD_PULL));
  const power = LAUNCH_MIN_POWER + t * (LAUNCH_MAX_POWER - LAUNCH_MIN_POWER);

  return { direction: { x: Math.cos(angle), y: Math.sin(angle) }, power, clamped };
}

/** Clamp any power to the legal range, for values arriving from config or a save. */
export function clampLaunchPower(power: number): number {
  if (!Number.isFinite(power)) return LAUNCH_MIN_POWER;
  return Math.max(LAUNCH_MIN_POWER, Math.min(LAUNCH_MAX_POWER, power));
}

/**
 * What the map's base is multiplied by for a launch at this power.
 *
 * The identity, on purpose - see the header. Kept as a function anyway because
 * it is the one place the rule is stated, and a caller that wants to change the
 * deal should have somewhere to change it.
 */
export function launchPayMultiplier(power: number): number {
  return clampLaunchPower(power);
}

/** The velocity a ball leaves the cup with. */
export function launchVelocity(aim: LaunchAim, baseSpeed: number): Vector2 {
  const speed = Math.max(1, baseSpeed) * clampLaunchPower(aim.power);
  return { x: aim.direction.x * speed, y: aim.direction.y * speed };
}

/**
 * The power at which discrete collision starts to be able to miss a fence.
 *
 * A ball is tested against a wall by distance from its centre to the segment,
 * within `radius + thickness/2 + 2`. Across one step it moves `speed * step`,
 * and the furthest it can be from the segment at both ends of a step while
 * still having crossed it is half that. So the band is safe while
 * `speed * step / 2 < radius + thickness/2 + 2`.
 *
 * Exported so the test can recompute it from the live constants: if PHYSICS_STEP
 * or WALL_THICKNESS ever changes, the guard moves with them instead of quietly
 * going stale.
 */
export function maxSafeLaunchPower(
  baseSpeed: number, ballRadius: number, physicsStep: number, wallThickness: number,
): number {
  const band = ballRadius + wallThickness / 2 + 2;
  const maxSpeed = (2 * band) / physicsStep;
  return maxSpeed / Math.max(1, baseSpeed);
}
