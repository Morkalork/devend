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

/**
 * Unit vector the muzzle actually points along: the facing, turned by the cup's
 * own angle.
 *
 * A launcher is authored as an axis-aligned rect plus an `angle`, exactly like
 * every other entity that can be turned, so `facing` names which SIDE is open
 * and the angle says where that side ends up pointing. Reading only the facing
 * is what made every launcher fire along an axis: a cup drawn at 20 degrees
 * still shot straight right, and the barrel and the shot disagreed on screen.
 */
export function muzzleVector(facing: LaunchFacing, angleDeg = 0): Vector2 {
  const base = bearingVector(facing);
  if (!angleDeg) return base;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: base.x * cos - base.y * sin, y: base.x * sin + base.y * cos };
}

/**
 * The rubber band across the closed end of the cup, in world units.
 *
 * The band is the thing you actually pull, so it has to be a real segment on
 * the board rather than a decoration: it spans the back wall, perpendicular to
 * the muzzle, and the balls rest against it. `inner` is the cup's interior and
 * the returned points are its two back corners, turned with the cup.
 */
export function bandEnds(
  inner: { x: number; y: number; width: number; height: number },
  facing: LaunchFacing,
  angleDeg = 0,
): { a: Vector2; b: Vector2 } {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  const dir = muzzleVector(facing, angleDeg);
  // Back along the barrel, then out to both sides of it.
  const halfLength = (Math.abs(dir.x) > Math.abs(dir.y) ? inner.width : inner.height) / 2;
  const halfWidth = (Math.abs(dir.x) > Math.abs(dir.y) ? inner.height : inner.width) / 2;
  const backX = cx - dir.x * halfLength;
  const backY = cy - dir.y * halfLength;
  // Perpendicular to the muzzle.
  const px = -dir.y, py = dir.x;
  return {
    a: { x: backX - px * halfWidth, y: backY - py * halfWidth },
    b: { x: backX + px * halfWidth, y: backY + py * halfWidth },
  };
}

/** The midpoint of the band: where the pull is anchored. */
export function bandAnchor(
  inner: { x: number; y: number; width: number; height: number },
  facing: LaunchFacing,
  angleDeg = 0,
): Vector2 {
  const { a, b } = bandEnds(inner, facing, angleDeg);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
 * ── Why the shot has no aim any more ───────────────────────────────────────
 *
 * It used to: a 35 degree cone, and the argument for it was that "a pure power
 * slider wastes the other dimension of a drag and makes every launcher map open
 * the same way". That is true and it was worth less than what it cost.
 *
 * The cost is the barrel holds the whole roster. Every ball fired on one line
 * at one speed would travel as a single column forever - nothing here damps
 * anything - so the shot FANNED them across the cone to break them apart, and
 * the preview drew one line while three balls left on three different ones.
 * Reported as exactly that: "because there are often more than one ball in
 * there, it seldom shows what you get... otherwise all you get is chaos."
 *
 * A preview that lies about the one irreversible decision on the map is worse
 * than a decision with one dimension instead of two. So the shot goes straight
 * out of the barrel, every ball on that line, and the only thing the pull
 * decides is how fast - which is the thing that was always being paid for
 * anyway (see the payout note above). The balls come apart because they are
 * STACKED down the barrel and leave the muzzle one after another, which is the
 * same separation the fan was reaching for and is visible in the tube before a
 * finger is on the band.
 *
 * Past the muzzle nothing about them is special: ordinary balls, ordinary
 * bounces, and the first fence the player draws is what breaks the column up.
 */

export interface LaunchAim {
  /** Unit vector the ball will leave along: the barrel's own line, always. */
  direction: Vector2;
  /** Multiple of base speed, in [LAUNCH_MIN_POWER, LAUNCH_MAX_POWER]. */
  power: number;
}

/**
 * Read a pull into an aim.
 *
 * `pull` is the vector from where the finger went down to where it is now, and
 * only the part of it that STRETCHES THE BAND counts: the component pointing
 * back down the barrel. Pull straight back and the band draws fully; pull
 * across the barrel and it barely draws at all, which is what a band strung
 * across a cup actually does and what keeps the slingshot gesture honest now
 * that the direction is not up for negotiation.
 *
 * Returns null for a pull too short to mean anything, which the caller shows as
 * "not yet a launch" rather than as a weak one. A sideways drag reads as that
 * too, rather than as a full-power shot the player never asked for.
 */
export function launchAim(
  pull: Vector2, facing: LaunchFacing, angleDeg = 0,
): LaunchAim | null {
  const bearing = muzzleVector(facing, angleDeg);
  // How far the band is drawn: the pull projected onto the reverse of the
  // muzzle. Negative (a push toward the muzzle) is no draw at all.
  const draw = -(pull.x * bearing.x + pull.y * bearing.y);
  if (!(draw > LAUNCH_DEAD_PULL)) return null;

  const t = Math.min(1, (draw - LAUNCH_DEAD_PULL) / (LAUNCH_FULL_PULL - LAUNCH_DEAD_PULL));
  const power = LAUNCH_MIN_POWER + t * (LAUNCH_MAX_POWER - LAUNCH_MIN_POWER);

  return { direction: bearing, power };
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

// ── Where the shot actually goes ───────────────────────────────────────────

/** The authored fields a runway check needs. Any launcher entity satisfies it. */
export interface LauncherPlacement {
  x: number; y: number; width: number; height: number;
  facing: LaunchFacing;
  angle?: number;
}

/** An axis-aligned box a shot can run into. */
export interface Blocker {
  x: number; y: number; width: number; height: number;
  /**
   * A breakable does NOT stop a shot for the purposes of this warning.
   *
   * It is a price, not a door - and a launched ball is the best thing you can
   * pay it with, since impact damage goes as `speed^1.6`, so a ball fired at 2x
   * hits about three times as hard. Level 6 is the map whose whole lesson is
   * the breakable, and the barrel aimed into its bowed wall was flagged as
   * "fires into a wall" with 135 units of runway; ignoring the breakable it has
   * 707. The warning was refusing the one map where the shot most obviously
   * makes sense.
   */
  breakable?: boolean;
}

/**
 * Where the muzzle sits and which way it points.
 *
 * The origin is the centre pushed out along the barrel by half its length,
 * which is the mouth of the tube rather than the middle of the rect. A shot
 * traced from the centre would start INSIDE the barrel and report the barrel's
 * own back wall as the first thing it hits.
 */
export function muzzleRay(cup: LauncherPlacement): { origin: Vector2; direction: Vector2 } {
  const direction = muzzleVector(cup.facing, cup.angle);
  const cx = cup.x + cup.width / 2;
  const cy = cup.y + cup.height / 2;
  const reach = (Math.abs(direction.x) > Math.abs(direction.y) ? cup.width : cup.height) / 2;
  return {
    origin: { x: cx + direction.x * reach, y: cy + direction.y * reach },
    direction,
  };
}

/** Distance along a ray to the arena edge. Infinity is impossible: it is a box. */
function distanceToArenaEdge(
  origin: Vector2, dir: Vector2, width: number, height: number, margin: number,
): number {
  const runX = dir.x > 0 ? (width - margin - origin.x) / dir.x
    : dir.x < 0 ? (origin.x - margin) / -dir.x
    : Infinity;
  const runY = dir.y > 0 ? (height - margin - origin.y) / dir.y
    : dir.y < 0 ? (origin.y - margin) / -dir.y
    : Infinity;
  return Math.max(0, Math.min(runX, runY));
}

/** Distance along a ray to an axis-aligned box, or Infinity if it never hits. */
function distanceToBox(origin: Vector2, dir: Vector2, b: Blocker): number {
  // Slab method. A zero component means the ray is parallel to that pair of
  // slabs, so it only ever hits if it already lies between them.
  let near = -Infinity, far = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [origin.x, dir.x, b.x, b.x + b.width],
    [origin.y, dir.y, b.y, b.y + b.height],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    const t1 = (lo - o) / d, t2 = (hi - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  if (far < near || far < 0) return Infinity;
  return Math.max(0, near);
}

/**
 * How far a straight shot travels before it meets something.
 *
 * The number behind the editor's "this fires into a wall" warning, and behind
 * the map.yml guard, deliberately the SAME function for both. A designer who is
 * told a barrel is fine and then ships a map the test rejects has been told two
 * different things by two copies of one rule.
 *
 * Blockers are treated as their bounding boxes. That is approximate for a
 * circle or a bent shape, and it is the right approximation here: this drives a
 * warning, and a warning that fires slightly early costs a designer a glance,
 * while one that fires slightly late costs them a map that cannot be played.
 *
 * Breakables are skipped entirely. See the note on Blocker: firing into one is
 * a legitimate opening, and on the breakable-teaching map it is the point.
 *
 * The straight shot is no longer the worst case, it is the ONLY case. When
 * there was an aim cone this measured the centre line and argued that a blocked
 * one might still be playable off to the side; the shot leaves down the barrel
 * now, so what this measures and what the player gets are the same line.
 */
export function launcherRunway(
  cup: LauncherPlacement,
  blockers: ReadonlyArray<Blocker>,
  bounds: { width: number; height: number; margin: number },
): number {
  const { origin, direction } = muzzleRay(cup);
  let shortest = distanceToArenaEdge(
    origin, direction, bounds.width, bounds.height, bounds.margin,
  );
  for (const b of blockers) {
    if (b.breakable) continue;   // a price, not a door - see Blocker
    shortest = Math.min(shortest, distanceToBox(origin, direction, b));
  }
  return shortest;
}

/**
 * Runway below which a barrel is judged to be firing into something.
 *
 * A fraction of the board rather than a flat distance, so it means the same
 * thing if the board is ever resized. A quarter of the board is roughly "the
 * ball gets clear of the launcher's own neighbourhood before it has to turn".
 */
export const MIN_LAUNCH_RUNWAY_FRACTION = 0.25;
