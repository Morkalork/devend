/**
 * The splat silhouette: what a ball's outline is while it is pressed against
 * something.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Squash used to be an ELLIPSE: one scale along the impact normal, another
 * across, applied about the ball's centre. An ellipse squeezes symmetrically,
 * so the face away from the wall flattens exactly as much as the face touching
 * it. That is a rubber ball under pressure, and no amount of turning it up
 * makes it read as anything else - it was tried, twice, and reported both
 * times as "there is no squash".
 *
 * What a soft body actually does is different in kind, not degree: the contact
 * face goes FLAT and WIDE, the mass slumps down onto it, and the far side keeps
 * most of its roundness. That is what this file draws. Option "droplet", picked
 * from three sketched silhouettes: widest exactly at the wall, tapering to a
 * domed top, like a drop of something thick on glass.
 *
 * ── The frame ───────────────────────────────────────────────────────────────
 *
 * Everything here is in CONTACT SPACE, which has nothing to do with the board:
 *
 *   - the origin is the point on the wall the ball is touching
 *   - +y is INTO the wall, so the ball occupies negative y
 *   - +x runs along the wall
 *   - an undeformed ball is a circle of radius R centred at (0, -R)
 *
 * The caller rotates that onto the real impact normal. Keeping the maths in a
 * frame where "the wall" is a horizontal line at y = 0 is the whole reason the
 * clamp below is one line instead of a projection.
 */

/**
 * Ring vertices in the outline. High enough that a 60-unit boss ball's
 * silhouette has no visible facets (the sagitta at 48 segments is ~0.13 world
 * units) and low enough to be free at seven balls a frame.
 */
export const SPLAT_SEGMENTS = 48;

/**
 * How far the ball's centre travels toward the wall at full splat, in radii.
 * This is what creates the flat contact face: past this depth the circle's
 * lower cap is below the wall, and the clamp flattens it against the surface.
 */
const CENTRE_DROP = 0.62;

/** Height lost at full slump, as a fraction. 0.30 lands the top at ~0.48 diameters. */
const SLUMP = 0.30;

/** Peak sideways spread at full splat, as a fraction of the local radius. */
const SPREAD = 0.92;

/** Stretch along the normal as the ball peels away, and the matching narrowing. */
const PEEL_STRETCH = 0.22;
const PEEL_NARROW = 0.09;

/**
 * How the spread falls off with height: full at the wall, gone at the crown.
 * The exponent is what makes it a DROPLET rather than a barrel - just above 1,
 * so the widest point sits hard against the wall and the taper starts at once.
 */
function spreadAtHeight(h: number): number {
  return Math.pow(1 - h, 1.2);
}

/**
 * How deformed the ball is, as four independent 0..1 dials. They are separate
 * rather than one number because the whole point of the motion is that they
 * move at DIFFERENT times: the contact face forms before the mass slumps, and
 * on the way out the top lifts before the footprint lets go.
 */
export interface SplatState {
  /** Contact: how far the centre has pushed toward the wall. Makes the flat face. */
  d: number;
  /** Slump: how much height has been lost. */
  v: number;
  /** Spread: how far the mass has flowed sideways along the wall. */
  w: number;
  /** Peel: stretch along the normal as it leaves. Only non-zero on the way out. */
  stretch: number;
}

/** A ball at rest: a plain circle. */
export const ROUND: SplatState = { d: 0, v: 0, w: 0, stretch: 0 };

/** True when the state would draw anything other than a circle. */
export function isDeformed(s: SplatState): boolean {
  return s.d > 0.001 || s.v > 0.001 || s.w > 0.001 || Math.abs(s.stretch) > 0.001;
}

/** One vertex of the outline, in contact space. */
export interface SplatPoint {
  /** Position along the wall. */
  x: number;
  /** Position into the wall (negative = off the wall, toward the ball). */
  y: number;
  /** Angle on the UNDEFORMED circle this vertex came from, for texture mapping. */
  theta: number;
}

/**
 * The outline, counter-clockwise from the crown, in contact space.
 *
 * Every vertex keeps the angle it started at, because the texture has to be
 * mapped from the ROUND ball: a vertex that has slid to the side still shows
 * the part of the sphere it always showed, which is what makes the highlight
 * and the shading travel with the deformation instead of sitting still while
 * the outline moves under them.
 */
export function splatOutline(
  s: SplatState, radius: number, segments = SPLAT_SEGMENTS,
): SplatPoint[] {
  const R = radius;
  // The centre sinks toward the wall, which is what pushes the lower cap
  // through the surface and gives us something to flatten.
  const cy = -R + s.d * R * CENTRE_DROP;
  // Height of the crown above the wall after the slump. Everything scales
  // about the wall, not about the centre, so the contact face stays put.
  const height = -(cy - R) * (1 - s.v * SLUMP);
  const points: SplatPoint[] = [];

  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    let x = Math.sin(theta) * R;
    let y = cy - Math.cos(theta) * R;   // theta 0 is the crown

    // THE CONTACT FACE. Anything that would be inside the wall is on it
    // instead, which turns the circle's lower cap into a flat chord. This one
    // line is the difference between a splat and a squeezed circle.
    if (y > 0) y = 0;

    y *= (1 - s.v * SLUMP);

    // Spread is weighted by height, so the mass pools at the wall and the
    // crown keeps its shape.
    const h = height > 0 ? Math.min(1, Math.max(0, -y / height)) : 0;
    x *= (1 + s.w * SPREAD * spreadAtHeight(h));

    // Peeling off: taller along the normal, narrower across.
    y *= (1 + s.stretch * PEEL_STRETCH);
    x *= (1 - s.stretch * PEEL_NARROW);

    points.push({ x, y, theta });
  }
  return points;
}

/**
 * The BULB'S FILAMENT, in contact space: where the sphere's centre ends up
 * once the ball has deformed.
 *
 * The renderer pins the texture's white-hot core to a single vertex, and that
 * vertex used to sit on the outline's CENTROID. A centroid is a property of a
 * silhouette, not of the material: it drifts sideways with the footprint and
 * lags the mass on the way in, so the filament slid around inside a ball that
 * had not moved. The core is a MATERIAL POINT - the middle of the sphere - and
 * it goes through the same transform as every vertex, so it is computed from
 * the same chain rather than measured off the result.
 *
 * The chain, minus two steps that do not apply to a point on the axis inside
 * the body: the wall CLAMP (the core never reaches the wall, so it is never on
 * it) and the SPREAD (weighted by distance from the axis, and the core is on
 * the axis, so it is zero there).
 */
export function splatCore(s: SplatState, radius: number): { x: number; y: number } {
  const cy = -radius + s.d * radius * CENTRE_DROP;
  return { x: 0, y: cy * (1 - s.v * SLUMP) * (1 + s.stretch * PEEL_STRETCH) };
}

/** Summary numbers a caller can size other things from (shadows, tests). */
export interface SplatMetrics {
  /** Widest point, in world units. */
  width: number;
  /** Crown height above the wall, in world units. */
  height: number;
  /** Length of the flat face actually touching the wall, in world units. */
  contact: number;
  /** Centroid, in contact space: where the mass is. */
  cx: number;
  cy: number;
}

/** Measure an outline. Cheap enough to call per frame; no allocation beyond the object. */
export function splatMetrics(points: SplatPoint[]): SplatMetrics {
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  let sx = 0, sy = 0, contactMin = Infinity, contactMax = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    sx += p.x; sy += p.y;
    // On the wall (within a hair of it) means part of the contact face.
    if (p.y > -1e-6) {
      if (p.x < contactMin) contactMin = p.x;
      if (p.x > contactMax) contactMax = p.x;
    }
  }
  return {
    width: maxX - minX,
    height: -minY,
    contact: contactMax >= contactMin ? contactMax - contactMin : 0,
    cx: sx / points.length,
    cy: sy / points.length,
  };
}
