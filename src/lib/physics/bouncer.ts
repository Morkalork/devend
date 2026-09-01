/**
 * The bouncer: a pop bumper, in a game that only had walls.
 *
 * Every solid on the board is currently PASSIVE. A ball arrives, the collision
 * resolver reflects it - `v - 2(v.n)n`, which preserves magnitude exactly - and
 * it leaves at the speed it came in. That is true of the board edge, of a
 * fence, of a pillar and of a mirror. Nothing on the board has ever given a
 * ball energy, so nothing on the board has ever felt like pinball.
 *
 * A bouncer is the one solid that does. It KICKS: the ball leaves faster than
 * it arrived, and it leaves radially outward from the bouncer's middle rather
 * than along the reflection of its approach. Both halves matter.
 *
 *   The GAIN is what separates it from the round pillars a map already has. A
 *   bouncer that only reflected would be a pillar with a different paint job.
 *
 *   The RADIAL kick is what makes it read as a bumper rather than a wall. A
 *   real pop bumper fires the ball away from itself whatever angle it arrived
 *   at, which is why a pinball table's bumper cluster scatters a ball instead
 *   of returning it along its own line. Specular reflection off a small circle
 *   is nearly a rebound straight back the way it came, which is the one
 *   behaviour that would make a cluster feel dead.
 *
 * ── The ceiling, which is not optional ──────────────────────────────────────
 *
 * Nothing in the engine damps a ball: `minimumSpeed` only ever scales speed UP,
 * bounces preserve magnitude, and there is no drag anywhere in src/lib/physics.
 * So a gain applied per hit COMPOUNDS, for the whole map, with no natural limit
 * - and collision is discrete. A ball is tested against a wall by distance from
 * its centre within `radius + thickness/2 + 2`, once per 1/120s step, so once it
 * travels more than twice that band in a step it can cross a fence without ever
 * being tested against it. At an 18-unit ball and a 6-unit fence that is about
 * 5520 units per second, and a 250-speed ball reaches it in roughly sixteen
 * hits at a 1.2x gain. Sixteen hits is an afternoon in a bumper cluster.
 *
 * Hence `maxSpeedScale`, and hence it is a multiple of the BALL's own base speed
 * rather than an absolute: a 340-speed purple and a 200-speed grey should be
 * allowed the same headroom relative to themselves, not the same absolute
 * ceiling that would be generous for one and a hard stop for the other.
 *
 * A ball already ABOVE its ceiling (a launcher shot at 3x arrives at one) is
 * redirected but never slowed. A bumper that braked a fast ball would be a
 * damper wearing a bumper's paint, and worse, it would make the launcher's
 * whole wager - "the speed is permanent" - quietly false.
 */
import type { Ball } from "@/types/game";
import type { Vector2 } from "@/lib/polygon";
import { BEARING_VECTOR, type Bearing } from "@/lib/physics/obstacleRules";

export interface BouncerSpec {
  id: string;
  /** Middle of the bouncer: the kick points from here to the ball. */
  centre: Vector2;
  /** Speed multiplier per hit. 1 makes it an ordinary (if oddly painted) wall. */
  kick: number;
  /** Ceiling, as a multiple of the ball's OWN base speed. */
  maxSpeedScale: number;
  /**
   * KICKER: fire along this fixed bearing instead of radially outward.
   *
   * The difference between a pop bumper and a slingshot, and it is the whole
   * reason to have both. A radial bouncer SCATTERS - which way a ball leaves
   * depends on where it happened to hit, so a cluster of them is a pinball
   * and not a plan. A kicker always fires the same way, so it can be aimed:
   * a designer can build a lane that feeds a ball somewhere on purpose, and a
   * player can learn it.
   */
  bearing?: Bearing;
}

/** Authoring defaults, so a map that just says `bouncer: true` gets a good one. */
export const BOUNCER_KICK = 1.25;
export const BOUNCER_MAX_SPEED_SCALE = 2.2;

/**
 * How long one bouncer ignores the same ball after kicking it, in ms.
 *
 * A ball resting in the collision band is resolved every step, so without this
 * a bouncer fires 120 times a second and the ball is at its ceiling instantly -
 * and the sound and the flash machine-gun with it. Long enough to be one event,
 * short enough that a genuine second approach is never swallowed: at the
 * ceiling speed a ball crosses its own diameter in about 7ms.
 */
export const BOUNCER_COOLDOWN_MS = 90;

/** How long a bouncer stays lit after firing, in ms. */
export const BOUNCER_FLASH_MS = 220;

/** Whether this bouncer is allowed to act on this ball right now. */
export function bouncerReady(ball: Ball, spec: BouncerSpec, now: number): boolean {
  if (ball.lastBouncerId !== spec.id) return true;
  return now - (ball.lastBouncerAt ?? -Infinity) >= BOUNCER_COOLDOWN_MS;
}

export interface BouncerHit {
  velocity: Vector2;
  speed: number;
  /** How hard it fired, 0..1, for the flash and the sound. */
  intensity: number;
}

/**
 * The velocity a ball leaves a bouncer with.
 *
 * Pure, and separated from updateBall for the usual reason: every failure here
 * looks fine in motion. A gain that never bites is a pillar; one that never
 * caps is a ball through a fence twenty seconds later, on a different part of
 * the board, with nothing to connect it back.
 */
export function bouncerKick(ball: Ball, spec: BouncerSpec): BouncerHit {
  const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  const base = ball.baseSpeed > 0 ? ball.baseSpeed : speed || 1;
  const ceiling = base * Math.max(1, spec.maxSpeedScale);

  // A KICKER fires along its bearing whatever the approach; a bouncer fires
  // outward from its middle. Everything below - the gain, the ceiling, the
  // never-slow rule - is identical, because the only thing that differs
  // between the two is which way "away" points.
  let dx: number, dy: number, len: number;
  if (spec.bearing) {
    const [bx, by] = BEARING_VECTOR[spec.bearing];
    dx = bx; dy = by; len = 1;
  } else {
    // Outward from the middle. A ball sitting exactly on the centre has no
    // outward direction to give, so it keeps the heading it had - never a zero
    // vector, which would strand it there for the rest of the map.
    dx = ball.position.x - spec.centre.x;
    dy = ball.position.y - spec.centre.y;
    len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = ball.velocity.x; dy = ball.velocity.y; len = speed; }
    if (len < 1e-6) { dx = 1; dy = 0; len = 1; }
  }

  // Never slower than it arrived: at or above the ceiling this is a pure
  // redirect. A bumper that braked a fast ball would be a damper in disguise.
  const wanted = speed * Math.max(1, spec.kick);
  const next = Math.max(speed, Math.min(wanted, ceiling));

  return {
    velocity: { x: (dx / len) * next, y: (dy / len) * next },
    speed: next,
    // What the player actually got, against what a full-power kick would give.
    intensity: speed > 0 ? Math.min(1, (next - speed) / Math.max(1e-6, speed * (spec.kick - 1))) : 1,
  };
}
