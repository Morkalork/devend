/**
 * Heading chevrons: where a held ball will go the moment it lets go.
 *
 * A frozen ball is a still image, and a still image of a circle says nothing
 * about which way it was travelling. That is fine for a tap-freeze, where the
 * player watched the ball arrive, and actively misleading for Cold Boot, which
 * hands you a board of motionless balls at map start and asks you to cut around
 * them without ever having seen one move.
 *
 * So: three chevrons trailing behind the ball, apexes pointing the way it is
 * headed, with a pulse that travels from the tail toward the ball so the cue
 * itself has a direction rather than merely an axis. Purely informational, and
 * pure geometry - the renderer does nothing but stroke what this returns.
 */

/** How many chevrons trail the ball. */
export const CHEVRON_COUNT = 3;
/** Full cycle of the travelling pulse. */
const PULSE_PERIOD_MS = 900;
/** Fraction of a cycle between one chevron's peak and the next's. */
const PULSE_STAGGER = 0.22;
/** Distance behind the ball centre of the nearest chevron, in ball radii. */
const FIRST_OFFSET_RADII = 1.35;
/** Gap between chevrons, in ball radii. */
const CHEVRON_GAP_RADII = 0.42;
/** Half the span of a chevron across the heading, in ball radii. */
const CHEVRON_HALF_WIDTH_RADII = 0.38;
/** How far the apex leads the wing tips, in ball radii. */
const CHEVRON_DEPTH_RADII = 0.3;
/** Alpha of a chevron at the bottom of the pulse, and at the top. */
const ALPHA_FLOOR = 0.12;
const ALPHA_PEAK = 0.62;
/** Below this speed there is no heading worth pointing at. */
const MIN_SPEED = 1;

/** One chevron: an apex and two wing tips, in world units, plus its alpha. */
export interface Chevron {
  apex: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
  alpha: number;
}

/**
 * The chevrons for a ball held at `centre`, travelling along `velocity`, at
 * time `now`. Empty when the ball has no usable heading, which is the caller's
 * whole "should I draw this" test.
 */
export function getHeadingChevrons(
  centre: { x: number; y: number },
  velocity: { x: number; y: number },
  radius: number,
  now: number,
): Chevron[] {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!(speed >= MIN_SPEED)) return [];

  // Unit heading, and the perpendicular the wings spread along.
  const hx = velocity.x / speed;
  const hy = velocity.y / speed;
  const px = -hy;
  const py = hx;

  const half = radius * CHEVRON_HALF_WIDTH_RADII;
  const depth = radius * CHEVRON_DEPTH_RADII;
  const chevrons: Chevron[] = [];

  for (let i = 0; i < CHEVRON_COUNT; i++) {
    // Behind the ball: the nearest chevron sits just clear of the body, the
    // rest fall away from it along the reverse heading.
    const back = radius * (FIRST_OFFSET_RADII + i * CHEVRON_GAP_RADII);
    const ax = centre.x - hx * (back - depth);
    const ay = centre.y - hy * (back - depth);
    const bx = centre.x - hx * back;
    const by = centre.y - hy * back;

    // The pulse peaks on the FARTHEST chevron first and arrives at the ball
    // last, so the animation runs the way the ball will.
    const phase = frac(now / PULSE_PERIOD_MS + i * PULSE_STAGGER);
    const swell = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
    // Fade with distance too: the cue should read as coming FROM the tail.
    const falloff = 1 - i * 0.18;

    chevrons.push({
      apex: { x: ax, y: ay },
      left: { x: bx + px * half, y: by + py * half },
      right: { x: bx - px * half, y: by - py * half },
      alpha: (ALPHA_FLOOR + (ALPHA_PEAK - ALPHA_FLOOR) * swell) * falloff,
    });
  }

  return chevrons;
}

function frac(v: number): number {
  return v - Math.floor(v);
}
