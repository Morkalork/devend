/**
 * The Rubber Band: a slingshot the player places, anywhere, at a moment of
 * their choosing.
 *
 * The launcher is a barrel the MAP owns: it fires the roster it was loaded
 * with, once, before anything has happened. This is the same idea handed to the
 * player as an ability - a band you stretch across whatever is in front of you
 * and let go.
 *
 * ── One finger, and where the second one went ───────────────────────────────
 *
 * The first design used two fingers to set the band's two ends. It did not need
 * to: after the ability is armed the game already knows a drag is an aim rather
 * than a cut, and a single drag carries everything.
 *
 *   the START point       where the band sits
 *   the drag DIRECTION    the band lies perpendicular to it
 *   the two ANCHORS       start point, offset perpendicular by the half-width
 *   the drag LENGTH       the power
 *   the FIRE direction    opposite the pull, as every slingshot has taught
 *
 * The only thing the second finger bought was a player-set WIDTH, which is now
 * a constant - one less thing to control in a panic, and learnable in a way a
 * two-finger span is not. It also freed the gesture: a second finger already
 * means "cancel the cut I am drawing", and teaching it to also mean this would
 * have been two meanings for one action.
 *
 * ── Power is a wager, deliberately ─────────────────────────────────────────
 *
 * Nothing in the engine damps a ball, so a ball fired at 3x is still travelling
 * at 3x when you try to fence it twenty seconds later. That is not a side
 * effect to be tuned away, it is the deal: a full-power band smashes ANY
 * destructible in reach, and leaves you a very fast ball to deal with
 * afterwards. Freeze and slow are the answer, which is where the synergy is -
 * the ice abilities stop being a panic button and start being the setup for
 * this one.
 *
 * The cap exists only where correctness demands it. Collision is discrete, so a
 * ball travelling more than twice the collision band in one step can cross a
 * fence untested; BAND_MAX_POWER sits far below that, exactly as the launcher's
 * does.
 */
import type { Vector2 } from "@/lib/polygon";

/** Pull shorter than this is not a band. A tap must not spend a charge. */
export const BAND_DEAD_PULL = 24;
/** Pull length, in world units, that reaches full power. */
export const BAND_FULL_PULL = 220;
export const BAND_MIN_POWER = 1;
/**
 * Full power, as a multiple of a ball's base speed.
 *
 * The same 3 the launcher uses, and for the same reason: it is a play-feel
 * number bounded by a hard one (see maxSafeLaunchPower), not a number chosen
 * because 4 would break something.
 */
export const BAND_MAX_POWER = 3;
/**
 * Half the band's span, in world units.
 *
 * Fixed rather than player-set. Wide enough that aiming it is about WHICH balls
 * you want rather than whether you can touch any, narrow enough that "all of
 * them" is not the answer on a small board.
 */
export const BAND_HALF_WIDTH = 110;
/** How far in front of the band a ball is still caught by it. */
export const BAND_REACH = 70;

export interface BandShape {
  /** Where the band sits: under the finger, moving as it is pulled back. */
  centre: Vector2;
  /** Unit vector everything caught will be fired along. */
  heading: Vector2;
  /** The band's two ends, perpendicular to the heading. */
  a: Vector2;
  b: Vector2;
  /** 0..1 of full stretch, for the visuals and for damage. */
  powerT: number;
  /** Multiple of base speed a caught ball leaves at. */
  power: number;
}

/**
 * Read a drag into a band.
 *
 * `start` is where the finger went down and `current` is where it is now. The
 * band SITS at the finger and fires back toward the start, which is the
 * physical reading: you draw the band back and it snaps forward over whatever
 * was in front of it. Returns null below the dead zone, which the caller shows
 * as "not yet a band" rather than as a weak one.
 */
export function bandShape(start: Vector2, current: Vector2): BandShape | null {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const len = Math.hypot(dx, dy);
  if (!(len > BAND_DEAD_PULL)) return null;

  // Fired opposite the pull.
  const heading = { x: -dx / len, y: -dy / len };
  // The band lies across the pull: perpendicular to the heading.
  const px = -heading.y, py = heading.x;

  const t = Math.min(1, (len - BAND_DEAD_PULL) / (BAND_FULL_PULL - BAND_DEAD_PULL));
  return {
    centre: { x: current.x, y: current.y },
    heading,
    a: { x: current.x - px * BAND_HALF_WIDTH, y: current.y - py * BAND_HALF_WIDTH },
    b: { x: current.x + px * BAND_HALF_WIDTH, y: current.y + py * BAND_HALF_WIDTH },
    powerT: t,
    power: BAND_MIN_POWER + t * (BAND_MAX_POWER - BAND_MIN_POWER),
  };
}

/**
 * Is this point inside the band's sweep?
 *
 * The band is a rectangle: as wide as its span, as deep as BAND_REACH, and
 * lying IN FRONT of the band along the heading. In front rather than centred,
 * because the band snaps forward - something behind your finger is something
 * you have already pulled past, and catching it would make the highlight
 * disagree with the picture.
 */
export function inBandSweep(p: Vector2, shape: BandShape): boolean {
  const dx = p.x - shape.centre.x;
  const dy = p.y - shape.centre.y;
  const along = dx * shape.heading.x + dy * shape.heading.y;
  if (along < 0 || along > BAND_REACH) return false;
  const across = Math.abs(dx * -shape.heading.y + dy * shape.heading.x);
  return across <= BAND_HALF_WIDTH;
}

/**
 * Damage a band at this stretch does to an object of this integrity.
 *
 * Scaled to the OBJECT rather than to an absolute number, so "full power
 * destroys any destructible" is true by construction instead of true until
 * someone authors a tougher one. A gentle pull is worth one ordinary hit; a
 * full pull is worth exactly the object's whole budget, whatever that is.
 */
export function bandDamage(powerT: number, maxHits: number): number {
  const t = Math.max(0, Math.min(1, powerT));
  const budget = Math.max(1, maxHits);
  return 1 + t * (budget - 1);
}

/** The velocity a caught ball leaves with. */
export function bandVelocity(shape: BandShape, baseSpeed: number): Vector2 {
  const speed = Math.max(1, baseSpeed) * shape.power;
  return { x: shape.heading.x * speed, y: shape.heading.y * speed };
}
