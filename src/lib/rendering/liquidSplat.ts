/**
 * The liquid splat: a stuck ball drawn as something almost fluid, that melts
 * around whatever it is stuck to.
 *
 * ── Why the droplet was not enough ──────────────────────────────────────────
 *
 * splatShape.ts draws the approved silhouette against an INFINITE FLAT WALL
 * along the impact tangent. Mid-wall that is exactly right. At the end of a
 * fence, beside a second wall, or on a corner the ball bounced off, it is a
 * shape hanging in the air past the edge, with its flat face pressed against
 * nothing. A first attempt clamped the outline to the solids, like a sheet
 * draped over an edge; it left a stiff lip and a sharp notch where a corner dug
 * in, which is not the material. What was asked for is a ball that, while
 * stuck, behaves like a viscous blob: it wets any surface within reach and
 * flows along it, round corners and under edges.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 * The silhouette is the level set of a FIELD, not an outline:
 *
 *   BULK  a soft anisotropic blob around the ball's (sunk, slumped, spread)
 *         centre. On its own this is the droplet again.
 *   FILM  liquid that has run along the surfaces. Its thickness falls off with
 *         distance travelled ALONG THE SURFACE from the contact point (the
 *         geodesic distance splatScene.ts precomputes), not with distance from
 *         the centre. That one choice is what makes it pour round an edge
 *         instead of stopping at it.
 *
 * The field is zero inside every solid, and it is thresholded at whatever level
 * gives the liquid exactly the AREA the approved droplet has in this state, so
 * a ball never gains or loses material by being near an edge. Brightness is
 * thickness, so the shading follows for free: the filament is wherever the
 * field is deepest, and the tongue that runs round a corner is thinner than the
 * bulk and reads as film rather than as more ball.
 *
 * The constants were fitted numerically so that mid-wall, at full splat, the
 * liquid reproduces the approved droplet (1.77 diameters wide, 0.48 high) to
 * within a few percent at this grid resolution. The film reach is the longest
 * that fit: a longer one shows as a foot on a flat wall, and that shape was
 * already signed off.
 *
 * One thing the sketch never needed: the bulk is CUT OFF behind a solid. A
 * Gaussian does not know a fence is only six units thick, and mid-fence it
 * would put a faint second blob on the far side. So a texel the ball cannot
 * see from its own middle gets no bulk at all; only the film, which travels
 * along surfaces and so genuinely can reach round to the underside, is drawn
 * there.
 *
 * Everything is in CONTACT SPACE (see splatShape.ts): origin on the contact
 * point, +x along the wall, +y into it. Output is two RGBA images over one
 * grid: the body, and an additive glow that takes the corona's place.
 *
 * Pure, so it is testable without a canvas: the renderer uploads the arrays.
 */
import { splatOutline, type SplatState } from "@/lib/rendering/splatShape";
import { bulbStops, mixRgb, type Stop } from "@/lib/rendering/sleek/bulb";
import { insideSolid, type SplatScene } from "@/lib/splatScene";

// ── Viscosity: the three numbers that say how far it flows ──────────────────
/** Film thickness, in radii: the width of the wetting kernel on a surface. */
export const FILM_THICKNESS = 0.28;
/** Film strength relative to the bulk's peak. */
export const FILM_STRENGTH = 1.0;
/** How far the film runs along a surface: this much at contact, plus the spread term. */
export const FILM_REACH_MIN = 0.3;
export const FILM_REACH_SPREAD = 0.9;

// ── The bulk blob ───────────────────────────────────────────────────────────
const BULK = 1.0;
/** How much the blob widens along the wall at full spread. */
const BULK_SPREAD = 0.3;
/** How much it flattens along the normal at full slump. */
const BULK_FLAT = 0.25;
/** Where the film meets the bulk the two do not simply add: max plus a share of the min. */
const FILM_BLEND = 0.35;

// Same descent as splatShape.ts, so the bulk's centre is the droplet's core.
const CENTRE_DROP = 0.62;
const SLUMP = 0.30;
const PEEL_STRETCH = 0.22;
const PEEL_NARROW = 0.09;

// ── The grid ────────────────────────────────────────────────────────────────
/** Texels per ball radius. The ball is 8-22 screen pixels; 16 per radius resolves it, and the cost is per texel. */
export const TEXELS_PER_RADIUS = 16;
/** Grid extent in radii: along the wall either way, off the wall, and into it (for the underside of a lip). */
const SPAN_ALONG = 3.4;
const SPAN_OFF = 3.2;
const SPAN_INTO = 1.8;

/** Antialias band at the threshold, as a fraction of the iso level. */
const EDGE_BAND = 0.045;
/** Shading curve: thickness to gradient offset. Just above 1 keeps the filament small. */
const SHADE_GAMMA = 1.35;
/** Glow: peak alpha and how quickly it dies off below the threshold. */
const GLOW_ALPHA = 0.55;
const GLOW_FALLOFF = 0.42;
/** The glow is whitened like the corona: a pure-hue bloom over a pure-hue ball is invisible. */
const GLOW_WHITEN = 0.4;
/**
 * Where the bulk looks out from when deciding what is behind a solid, in radii
 * off the wall. Fixed rather than following the sinking centre, so the mask is
 * built once per scene; between a round ball's centre (1 R) and a slumped
 * one's (0.27 R) the set of texels a fence hides barely changes.
 */
const OCCLUDER_ORIGIN = 0.7;

/**
 * exp(-x) for x in [0, LUT_RANGE], tabulated. The film kernel is evaluated
 * tens of thousands of times a frame while a ball is squashing or reinflating,
 * and Math.exp is most of that cost; a table with linear steps this fine is
 * indistinguishable at 8 bits.
 */
const LUT_SIZE = 2048;
const LUT_RANGE = 7;
const EXP_LUT = new Float32Array(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) EXP_LUT[i] = Math.exp(-(i * LUT_RANGE) / LUT_SIZE);
const LUT_SCALE = LUT_SIZE / LUT_RANGE;
function expNeg(x: number): number {
  if (x >= LUT_RANGE) return 0;
  return EXP_LUT[(x * LUT_SCALE) | 0];
}

export interface LiquidImage {
  /** Grid size in texels. Fixed for a given radius, so buffers are reused frame to frame. */
  width: number;
  height: number;
  /** Contact-space position of the grid's top-left texel corner. */
  x0: number;
  y0: number;
  /** World units per texel. */
  texel: number;
  /** RGBA, straight (not premultiplied) alpha. */
  body: Uint8Array;
  glow: Uint8Array;
  /** Scratch: the field and the solids mask, kept so the mask is built once per scene. */
  field: Float32Array;
  /** Per texel: 0 open, 1 inside a solid, 2 behind one (no bulk, film allowed). */
  mask: Uint8Array;
  maskFor: SplatScene | null;
  /** The threshold and peak the last frame settled on (tests read them). */
  iso: number;
  peak: number;
  /**
   * Where the mass is: the body's alpha-weighted centroid, in contact space.
   * The shadow, the mark and the light pool follow this rather than the
   * ball's position, because on a corner the position is a radius out in the
   * air from where the liquid actually is.
   */
  cx: number;
  cy: number;
}

/** Allocate an image for a ball of this radius. */
export function createLiquidImage(radius: number): LiquidImage {
  const texel = radius / TEXELS_PER_RADIUS;
  const width = Math.ceil((2 * SPAN_ALONG * radius) / texel);
  const height = Math.ceil(((SPAN_OFF + SPAN_INTO) * radius) / texel);
  return {
    width, height,
    x0: -SPAN_ALONG * radius,
    y0: -SPAN_OFF * radius,
    texel,
    body: new Uint8Array(width * height * 4),
    glow: new Uint8Array(width * height * 4),
    field: new Float32Array(width * height),
    mask: new Uint8Array(width * height),
    maskFor: null,
    iso: 0,
    peak: 0,
    cx: 0,
    cy: -radius,
  };
}

/** Shoelace area of the droplet outline: the area the liquid is held to. */
export function dropletArea(s: SplatState, radius: number): number {
  const pts = splatOutline(s, radius);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Sample a gradient's stops at `offset` (0 centre, 1 rim). Returns packed RGB. */
export function sampleStops(stops: Stop[], offset: number): number {
  if (offset <= stops[0].offset) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (offset <= b.offset) {
      const t = (offset - a.offset) / (b.offset - a.offset || 1);
      return mixRgb(a.color, b.color, t);
    }
  }
  return stops[stops.length - 1].color;
}

/** True when segments a-b and c-d cross (proper intersection, or touching). */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) return false;
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return !((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0));
}

/**
 * Classify every texel against the scene: inside a solid, hidden behind one
 * from the ball's point of view, or open. Once per scene, because it depends
 * on nothing that moves.
 */
function buildMask(img: LiquidImage, scene: SplatScene, radius: number): void {
  const { width: W, height: H, x0, y0, texel, mask } = img;
  const ox = 0, oy = -OCCLUDER_ORIGIN * radius;
  // Should the viewpoint itself be buried (a contact deep in a re-entrant
  // shape), occlusion would hide everything; better to skip it than draw nothing.
  let originFree = true;
  for (const solid of scene.solids) if (insideSolid(ox, oy, solid)) { originFree = false; break; }
  for (let j = 0; j < H; j++) {
    const py = y0 + (j + 0.5) * texel;
    for (let i = 0; i < W; i++) {
      const px = x0 + (i + 0.5) * texel;
      let m = 0;
      for (const solid of scene.solids) {
        if (insideSolid(px, py, solid)) { m = 1; break; }
      }
      if (m === 0 && originFree) {
        outer: for (const solid of scene.solids) {
          for (let a = 0, b = solid.length - 1; a < solid.length; b = a++) {
            const p = solid[b], q = solid[a];
            if (segmentsCross(ox, oy, px, py, p.x, p.y, q.x, q.y)) { m = 2; break outer; }
          }
        }
      }
      mask[j * W + i] = m;
    }
  }
  img.maskFor = scene;
}

/**
 * Evaluate the field for this state and write both images.
 *
 * `scene` is what the ball is stuck to (splatScene.ts); `s` the four dials;
 * `color` the ball's packed RGB. The image must have been created for the same
 * radius. Returns the image for chaining.
 */
export function rasterizeLiquid(
  img: LiquidImage, scene: SplatScene, s: SplatState, radius: number, color: number,
): LiquidImage {
  const { width: W, height: H, x0, y0, texel, field: F } = img;
  const R = radius;

  // ── Bulk: the material centre sinks with contact and slumps with the mass ──
  const hc = R * (1 - CENTRE_DROP * s.d) * (1 - SLUMP * s.v);
  const st = R * BULK * (1 + BULK_SPREAD * s.w) * (1 - PEEL_NARROW * s.stretch);
  const sn = R * BULK * (1 - BULK_FLAT * s.v) * (1 + PEEL_STRETCH * s.stretch);
  const ist2 = 1 / (st * st), isn2 = 1 / (sn * sn);
  if (img.maskFor !== scene) buildMask(img, scene, R);
  const occluded = img.mask;
  for (let j = 0; j < H; j++) {
    const py = y0 + (j + 0.5) * texel;
    const v = py + hc;                       // distance from the centre along the normal
    const vv = v * v * isn2;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (occluded[k] === 2) { F[k] = 0; continue; }
      const u = x0 + (i + 0.5) * texel;
      F[k] = expNeg(u * u * ist2 + vv);
    }
  }

  // ── Film: wets the surfaces, thinning with distance travelled along them ──
  // Exists only once the ball has made contact, and draws back with the spread.
  const reach = R * (FILM_REACH_MIN + FILM_REACH_SPREAD * s.w) * s.d;
  const tau = R * FILM_THICKNESS;
  const strength = FILM_STRENGTH * s.d;
  if (strength > 0.001 && reach > texel) {
    const itau2 = 1 / (tau * tau);
    const ireach2 = 1 / (reach * reach);
    const kr = Math.ceil((2.6 * tau) / texel);
    const cutoff = 2.2 * reach;
    for (const q of scene.samples) {
      if (q.s > cutoff) continue;
      const a = strength * Math.exp(-q.s * q.s * ireach2);
      const ix = Math.round((q.x - x0) / texel), iy = Math.round((q.y - y0) / texel);
      const j0 = Math.max(0, iy - kr), j1 = Math.min(H, iy + kr);
      const i0 = Math.max(0, ix - kr), i1 = Math.min(W, ix + kr);
      for (let j = j0; j < j1; j++) {
        const ddy = y0 + (j + 0.5) * texel - q.y;
        for (let i = i0; i < i1; i++) {
          const ddx = x0 + (i + 0.5) * texel - q.x;
          // Only on the outside of the surface: a film does not soak through
          // a fence, and an isotropic kernel would (see SurfaceSample.nx).
          if (ddx * q.nx + ddy * q.ny < -texel * 0.25) continue;
          const f = a * expNeg((ddx * ddx + ddy * ddy) * itau2);
          const k = j * W + i;
          const b = F[k];
          F[k] = f > b ? f + b * FILM_BLEND : b + f * FILM_BLEND;
        }
      }
    }
  }

  // ── Nothing inside a solid, no bulk behind one. The mask is per scene. ────
  if (img.maskFor !== scene) buildMask(img, scene, R);
  let peak = 0;
  const { mask } = img;
  for (let k = 0; k < F.length; k++) {
    if (mask[k] === 1) F[k] = 0;
    else if (F[k] > peak) peak = F[k];
  }

  // ── Threshold: the liquid has exactly the droplet's area ──────────────────
  // The droplet is smaller than the round ball (about 0.76 of it at full
  // splat), the difference being the bulge toward the viewer that a top-down
  // drawing cannot show; a liquid that kept the whole disc's area came out
  // visibly too big.
  const target = dropletArea(s, R) / (texel * texel);
  let lo = 0, hi = peak;
  for (let it = 0; it < 16; it++) {
    const mid = (lo + hi) / 2;
    let area = 0;
    for (let k = 0; k < F.length; k++) if (F[k] > mid) area++;
    if (area > target) lo = mid; else hi = mid;
  }
  const iso = (lo + hi) / 2;
  img.iso = iso;
  img.peak = peak;

  // ── Paint ─────────────────────────────────────────────────────────────────
  const stops = bulbStops(color);
  const tint = mixRgb(color, 0xffffff, GLOW_WHITEN);
  const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
  const { body, glow } = img;
  const band = iso * EDGE_BAND;
  const range = peak - iso || 1;
  const igf = 1 / (GLOW_FALLOFF * GLOW_FALLOFF);
  let mx = 0, my = 0, mw = 0;
  for (let k = 0; k < F.length; k++) {
    const v = F[k];
    const o = k * 4;
    if (v > iso - band) {
      let tk = (v - iso) / range;
      tk = tk < 0 ? 0 : tk > 1 ? 1 : tk;
      const c = sampleStops(stops, 1 - Math.pow(tk, SHADE_GAMMA));
      let a = (v - (iso - band)) / (2 * band);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      body[o] = (c >> 16) & 255; body[o + 1] = (c >> 8) & 255; body[o + 2] = c & 255;
      body[o + 3] = Math.round(255 * a);
      // Thickness-weighted, so a thin tongue along a face does not drag the
      // centre off the bulk the way a plain area centroid would.
      const wgt = a * (0.3 + tk);
      mx += wgt * (k % W); my += wgt * ((k / W) | 0); mw += wgt;
    } else {
      body[o] = body[o + 1] = body[o + 2] = body[o + 3] = 0;
    }
    if (v > 0 && v < iso) {
      const g = 1 - v / iso;
      const a = GLOW_ALPHA * Math.exp(-g * g * igf);
      glow[o] = tr; glow[o + 1] = tg; glow[o + 2] = tb;
      glow[o + 3] = Math.round(255 * a);
    } else {
      glow[o] = glow[o + 1] = glow[o + 2] = glow[o + 3] = 0;
    }
  }
  if (mw > 0) {
    img.cx = x0 + (mx / mw + 0.5) * texel;
    img.cy = y0 + (my / mw + 0.5) * texel;
  } else {
    img.cx = 0;
    img.cy = -hc;
  }
  return img;
}

/** Bounding box of the opaque body, in contact space (tests and shadows). */
export function liquidBounds(img: LiquidImage): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
  for (let j = 0; j < img.height; j++) {
    for (let i = 0; i < img.width; i++) {
      if (img.body[(j * img.width + i) * 4 + 3] < 128) continue;
      if (i < minI) minI = i; if (i > maxI) maxI = i;
      if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
    }
  }
  if (minI === Infinity) return null;
  return {
    minX: img.x0 + minI * img.texel, maxX: img.x0 + (maxI + 1) * img.texel,
    minY: img.y0 + minJ * img.texel, maxY: img.y0 + (maxJ + 1) * img.texel,
  };
}
