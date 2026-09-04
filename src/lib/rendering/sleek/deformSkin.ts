/**
 * The geometry behind a deformable's face.
 *
 * Pure and separate from entityLayer for the reason bouncerRings is: the thing
 * a player has to read off this object before touching it is that it is SOFT,
 * and every failure of that cue looks like a perfectly good wall in motion. A
 * test can reach a function; it cannot reach a Graphics call.
 *
 * Two cues, doing two different jobs:
 *
 *   PLIES - inset contours inside the live face, like the layers of a crash
 *     mat. Present from the first frame, before anything has hit it, because
 *     "this one gives" is information the player needs BEFORE they aim at it.
 *
 *   The GHOST (drawn by entityLayer from the state's own `original`) - the
 *     outline as authored. It coincides exactly with the face while the wall is
 *     pristine and opens into a visible gap as dents accumulate. That gap IS
 *     the record: how far the wall has moved is how much speed it has drunk.
 */
import type { Vector2 } from "@/lib/polygon";
import { inwardMitres } from "@/lib/physics/deformable";

/** How many inset contours make up the padding. */
export const SKIN_PLIES = 2;
/**
 * World units between one ply and the next.
 *
 * Deeper than MAX_DENT, deliberately. A ply inside a full dent's reach would be
 * overtaken by the surface as it sank, and the object would look like it was
 * healing rather than wearing.
 */
export const SKIN_STEP = 9;
/**
 * Longest a mitre may run, as a multiple of the inset.
 *
 * At a sharp corner the two edge offsets meet a long way out and the mitre
 * spikes; clamped, the corner is simply cut off, which on a padding contour
 * reads as a rounded seam rather than as a fault.
 */
export const SKIN_MITRE_LIMIT = 2.5;
/**
 * Smallest fraction of the face's area a ply may enclose.
 *
 * The guard against an inverted contour, which is what a fixed inset does to a
 * small or thin object: past the point where opposite edges cross, the offset
 * polygon turns inside out and draws a bow-tie. Anything that would land under
 * this is not drawn at all. Fewer plies on a small pad is a quieter cue; an
 * inverted one is a broken object.
 */
export const SKIN_MIN_AREA = 0.15;

function signedArea(vs: Vector2[]): number {
  let a = 0;
  for (let i = 0; i < vs.length; i++) {
    const p = vs[i], q = vs[(i + 1) % vs.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * One contour, every edge pushed `inset` units inward.
 *
 * A true edge offset with mitred corners, NOT each vertex pulled toward the
 * middle - and it shares `inwardMitres` with the dent itself rather than
 * carrying a second copy of "which way is in". The difference only shows on an
 * elongated slab, and there it is the whole thing: pulling a corner of a 26x240
 * bar toward its centre moves it almost entirely ALONG the bar, so the padding
 * would land within a unit of the long edges and the cue would disappear on
 * exactly the shapes a level designer reaches for most.
 *
 * Returns null when the shape is too small to hold the inset - see
 * SKIN_MIN_AREA.
 */
export function insetOutline(vertices: Vector2[], inset: number): Vector2[] | null {
  const mitres = inwardMitres(vertices);
  if (!mitres) return null;
  const out = vertices.map((v, i) => {
    const m = mitres[i];
    const run = Math.min(SKIN_MITRE_LIMIT, m.run);
    return { x: v.x + m.x * inset * run, y: v.y + m.y * inset * run };
  });

  // Any edge that has REVERSED direction means the offset walked past the far
  // side of the shape. Checked before the area, because the classic inversion -
  // a square offset by more than its half-width - comes back as a bigger square
  // wound the same way, so area alone happily accepts a contour drawn inside
  // out and several times too large.
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ox = out[j].x - out[i].x, oy = out[j].y - out[i].y;
    const vx = vertices[j].x - vertices[i].x, vy = vertices[j].y - vertices[i].y;
    if (ox * vx + oy * vy <= 0) return null;
  }

  const a0 = signedArea(vertices), a1 = signedArea(out);
  // Sign flip = turned inside out; too small = about to.
  if (a0 === 0 || a1 * a0 <= 0 || Math.abs(a1) < Math.abs(a0) * SKIN_MIN_AREA) return null;
  return out;
}

/** The padding, outermost first. Shorter than `plies` - or empty - on an
 *  object too small to hold them. */
export function deformPlies(
  vertices: Vector2[],
  plies = SKIN_PLIES,
  step = SKIN_STEP,
): Vector2[][] {
  const out: Vector2[][] = [];
  for (let k = 1; k <= plies; k++) {
    const ply = insetOutline(vertices, k * step);
    if (!ply) break;
    out.push(ply);
  }
  return out;
}
