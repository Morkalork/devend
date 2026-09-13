/**
 * The web on the shell, and its shadow in the light.
 *
 * One pattern, drawn twice: as a MULTIPLY layer over the bulb (dark strands
 * in the ball's own hue, rolling with the ball's rotation) and as a shadow
 * punched out of the ball's light pool, magnified, because the light is
 * inside the ball and a pattern on the shell throws its shadow onto the
 * board. Both are baked ONCE and shared by every ball: the pattern is
 * monochrome and tinted per ball, so one texture serves every colour.
 *
 * The pattern itself is a cracked-shell web: sixteen seeded points in the
 * disc, each joined to its two nearest by a bowed strand, so the cells are
 * irregular and the lines never read as wire. Coarse on purpose (four to six cells across) so at a
 * nine-pixel radius it is texture rather than dirt; the layer's strength
 * also fades out below that size (ballLayer).
 */
import { Texture } from "pixi.js";

/** Bake sizes, in texture pixels. */
export const WEB_BAKE = 128;
export const WEB_POOL_BAKE = 256;
/** Brightness lift of the webbed pool, so the shadows do not simply dim the light. */
export const WEB_POOL_LIFT = 1.35;
/**
 * How much of the ball's rotation the web turns by. The physics spins the
 * ball at a rate that reads right for a solid; a pattern on a shell at that
 * rate is a whirl, so it turns at half. The pool's shadow uses the same
 * figure, so the two never drift apart.
 */
export const WEB_SPIN = 0.5;

let webTexture: Texture | null = null;
let webPoolTexture: Texture | null = null;

/** A tiny seeded generator, so the web is the same on every machine and in every test. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The strands, as a list of quadratic curves in a unit disc (-1..1). */
export function webStrands(seed = 7): { ax: number; ay: number; cx: number; cy: number; bx: number; by: number }[] {
  const rnd = lcg(seed);
  const pts: { x: number; y: number }[] = [];
  // Points spread over the disc, rejected when too close to one another so
  // the cells come out even-ish rather than clumped.
  let tries = 0;
  while (pts.length < 16 && tries++ < 400) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.92;
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 0.36)) pts.push(p);
  }
  const strands: { ax: number; ay: number; cx: number; cy: number; bx: number; by: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pts.length; i++) {
    const near = pts
      .map((q, j) => ({ j, d: Math.hypot(q.x - pts[i].x, q.y - pts[i].y) }))
      .filter(e => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = pts[i], b = pts[j];
      // Bow the strand a little to one side: straight lines read as wire.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y), ny = b.x - a.x;
      const bow = (rnd() - 0.5) * 0.9;
      strands.push({ ax: a.x, ay: a.y, cx: mx + nx * bow, cy: my + ny * bow, bx: b.x, by: b.y });
    }
  }
  return strands;
}

/**
 * Draw the strands onto a 2D context, mapping the unit disc onto a circle of
 * `radius` at (cx, cy). `width` is the strand width in pixels.
 */
export function drawWebStrands(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, width: number,
): void {
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  for (const s of webStrands()) {
    ctx.beginPath();
    ctx.moveTo(cx + s.ax * radius, cy + s.ay * radius);
    ctx.quadraticCurveTo(cx + s.cx * radius, cy + s.cy * radius, cx + s.bx * radius, cy + s.by * radius);
    ctx.stroke();
  }
}

/**
 * The web over the ball: white strands on transparent, to be tinted dark
 * and drawn with MULTIPLY. Clipped to the disc; the fan's transparent margin
 * outside the ball never shows a strand.
 */
export function webTex(): Texture {
  if (webTexture) return webTexture;
  const size = WEB_BAKE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (webTexture = Texture.WHITE);
  const half = size / 2;
  // The body texture's ball occupies 1/SPHERE_MARGIN of the bake; the fan
  // maps the ring at UV radius 0.5 to the silhouette pushed out by that same
  // margin, so a disc of radius half/1.14 here lands exactly on the ball.
  const ballR = half / 1.14;
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, ballR, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = size * 0.012;
  drawWebStrands(ctx, half, half, ballR, size * 0.02);
  ctx.restore();
  webTexture = Texture.from(canvas);
  return webTexture;
}

/**
 * The plain pool's stops, shared with the webbed pool so the two mix linearly.
 *
 * The tail is long and finely stepped on purpose: a pool that reaches zero in
 * three coarse stops shows the seam where it lands, and a ball's light ending
 * at a visible circle reads as a decal rather than as light. These follow a
 * near-exponential falloff all the way out.
 */
export const POOL_STOPS: [number, number][] = [
  [0, 0.55], [0.16, 0.60], [0.32, 0.40], [0.46, 0.25], [0.58, 0.16],
  [0.70, 0.09], [0.80, 0.05], [0.88, 0.025], [0.94, 0.01], [1, 0],
];

/**
 * The ball's light pool with the web's SHADOW in it: the plain radial pool
 * with the strands punched out, magnified to the pool's reach and blurred,
 * as a point light inside the shell would throw them. Rotated per ball by
 * the same angle as the web on the body, so the two roll together.
 */
export function webPoolTex(): Texture {
  if (webPoolTexture) return webPoolTexture;
  const size = WEB_POOL_BAKE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (webPoolTexture = Texture.WHITE);
  const half = size / 2;
  // A touch brighter than the plain pool: the strands take light away, and
  // the lit cells between them are what reads as a lantern. WEB_POOL_LIFT
  // roughly restores the average.
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [o, a] of POOL_STOPS) g.addColorStop(o, `rgba(255,255,255,${Math.min(1, a * WEB_POOL_LIFT)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // The shadow: strands magnified from the ball (1 radius) to the pool's
  // reach, taken OUT of the light rather than painted over it. Broad, because
  // on a phone the whole pool is forty pixels across and a hairline shadow
  // in a soft glow is no shadow at all.
  ctx.globalCompositeOperation = "destination-out";
  // The strands fade out toward the rim, where the light itself is fading:
  // a shadow cut all the way to the edge draws the edge, and the pool's
  // falloff has to stay soft.
  const cut = ctx.createRadialGradient(half, half, 0, half, half, half);
  cut.addColorStop(0, "rgba(0,0,0,1)");
  cut.addColorStop(0.5, "rgba(0,0,0,1)");
  cut.addColorStop(0.9, "rgba(0,0,0,0)");
  ctx.strokeStyle = cut;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = size * 0.006;
  drawWebStrands(ctx, half, half, half * 0.98, size * 0.018);
  ctx.globalCompositeOperation = "source-over";
  webPoolTexture = Texture.from(canvas);
  return webPoolTexture;
}

/** Drop both bakes (level change / resize). */
export function clearWebTextures(): void {
  webTexture?.destroy(true);
  webTexture = null;
  webPoolTexture?.destroy(true);
  webPoolTexture = null;
}
