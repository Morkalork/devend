/**
 * The heading cue: where a held ball will go the moment it lets go.
 *
 * A frozen ball is a still image, and a still image of a circle says nothing
 * about which way it was travelling. That is a nuisance for a tap-freeze, where
 * the player watched the ball arrive, and it is the whole product for Cold
 * Boot, which hands you a board of motionless balls at map start and asks you
 * to cut around them without ever having seen one move. Reported as exactly
 * that: "still doesn't show the direction of the balls when they are initially
 * frozen. Without this, it loses value."
 *
 * ── Why this is the second attempt ─────────────────────────────────────────
 *
 * The first was three small chevrons trailing BEHIND the ball, and its own test
 * file stated the goal it failed at: "stays subtle: never opaque, never
 * invisible", capped at alpha 0.7, drawn 0.38 radii wide at 1.4px. Put on a
 * board and photographed, that is a two-pixel grey smudge at the edge of a ball
 * whose own bloom is brighter than it. It was not too loud and quietly wrong;
 * it was inaudible, which for an informational cue is the same as absent.
 *
 * Two things changed, both deliberate reversals:
 *
 *   IT POINTS FROM THE BALL, NOT BEHIND IT. A trail behind reads as exhaust -
 *   where something HAS been - and has to be decoded before it answers the
 *   question. A lance ahead of the ball with a head on the end is the answer
 *   itself: that is where this is going. The pulse runs outward along it, for
 *   the same reason.
 *
 *   IT IS LOUD. Three radii long, a head nearly a radius across, and alpha that
 *   peaks at full. This is not decoration competing for attention with the
 *   board; it is the entire value of an upgrade the player paid for, and it is
 *   on screen only while a ball is held - a state that lasts seconds and that
 *   the player themselves caused.
 *
 * ── What it deliberately is not ────────────────────────────────────────────
 *
 * Not a trajectory. It is a straight ray of fixed length: no bounces, no
 * gravity bend, no steering. Predicting the path is what the SCRUM Master
 * family is for (seven upgrades, a whole chain, fxLayer.drawTrajectory), and a
 * freeze that quietly included it would delete that family's reason to exist.
 * This says which way the ball is pointed and nothing more, which is the one
 * fact a still image loses.
 *
 * Pure geometry - the renderer strokes what this returns and decides nothing.
 */

export interface Pt { x: number; y: number; }

/** Where the shaft starts, in ball radii from the centre: clear of the body. */
const SHAFT_START_RADII = 1.25;
/** Where it ends. Long enough to read at a glance on a phone. */
const SHAFT_END_RADII = 4.2;
/** Half the span of the head across the heading, in ball radii. */
const HEAD_HALF_WIDTH_RADII = 0.72;
/** How far the head's wings trail behind its point, in ball radii. */
const HEAD_DEPTH_RADII = 0.9;

/** Full cycle of the pulse that runs out along the lance. */
const PULSE_PERIOD_MS = 1100;
/** Alpha at the bottom of the pulse, and at the top. */
const ALPHA_FLOOR = 0.7;
const ALPHA_PEAK = 1;

/** Below this speed there is no heading worth pointing at. */
const MIN_SPEED = 1;

/** One heading cue: a shaft out of the ball and a head on the end of it. */
export interface HeadingCue {
  shaft: { from: Pt; to: Pt };
  head: { apex: Pt; left: Pt; right: Pt };
  /** 0..1, pulsing. The renderer's only job beyond stroking the geometry. */
  alpha: number;
}

/**
 * The cue for a ball held at `centre`, travelling along `velocity`, at `now`.
 *
 * Null when the ball has no usable heading, which is the caller's whole
 * "should I draw this" test. Sizes are in the same units as `radius`, so the
 * caller passes screen-space centre and radius and gets screen-space geometry.
 */
export function getHeadingCue(
  centre: Pt,
  velocity: Pt,
  radius: number,
  now: number,
): HeadingCue | null {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!(speed >= MIN_SPEED)) return null;

  // Unit heading, and the perpendicular the head spreads along.
  const hx = velocity.x / speed;
  const hy = velocity.y / speed;
  const px = -hy;
  const py = hx;

  const start = radius * SHAFT_START_RADII;
  const end = radius * SHAFT_END_RADII;
  const half = radius * HEAD_HALF_WIDTH_RADII;
  const depth = radius * HEAD_DEPTH_RADII;

  const apex = { x: centre.x + hx * end, y: centre.y + hy * end };
  const backX = centre.x + hx * (end - depth);
  const backY = centre.y + hy * (end - depth);

  // One pulse for the whole cue rather than a stagger across parts: the shape
  // already carries the direction, so the animation's only job is to say "this
  // is live" without turning into a second thing to read.
  const phase = frac(now / PULSE_PERIOD_MS);
  const swell = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;

  return {
    shaft: {
      from: { x: centre.x + hx * start, y: centre.y + hy * start },
      // Stops where the head begins, so the two are one shape rather than a
      // line with an arrow sitting on top of it.
      to: { x: backX, y: backY },
    },
    head: {
      apex,
      left: { x: backX + px * half, y: backY + py * half },
      right: { x: backX - px * half, y: backY - py * half },
    },
    alpha: ALPHA_FLOOR + (ALPHA_PEAK - ALPHA_FLOOR) * swell,
  };
}

function frac(v: number): number {
  return v - Math.floor(v);
}
