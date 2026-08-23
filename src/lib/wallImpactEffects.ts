// Wall Impact Effects System
// A gentle, DIRECTED bulge where a ball strikes a wall: the line eases outward
// (away from the ball) at the hit point, peaks, then relaxes smoothly. No
// oscillation — this replaces the earlier mass-spring ripple. Both renderers
// sample getEffectsAtPoint, so the bulge is shared between them.

import { Vector2, pointToSegmentDistance } from './polygon';
import {
  WALL_CIRCUITS_ENABLED,
  WALL_CORE_ALPHA,
  WALL_CENTERLINE_ALPHA,
  WALL_RENDER_THICKEN,
  buildWallSkeleton,
  circuitPalette,
} from './rendering/wallSkeleton';
import { taperFactor, buildFenceTaper } from './rendering/wallChains';

// Renderers sample this many points along a wall when a bulge is nearby.
export const N_NODES = 16;

/**
 * Peak outward push, in world units, at FULL strength.
 *
 * Was 6, which never showed. Strength is speed/400 and a standard ball runs at
 * 250, so a typical hit only ever asked for 6 x 0.625 = 3.8 units: about half
 * the wall's own 6-unit thickness, under two screen pixels on a phone, and gone
 * inside half a second. The effect was working exactly as written and was
 * simply below the resolution of the thing it was drawn on.
 *
 * Four rounds of play have bracketed this, and one of the readings turned out
 * to be contaminated. In order:
 *
 *   6  -> 3.8 units (0.63x thickness)  invisible
 *   14 -> 8.8 units (1.46x)            "great on everything except the frame"
 *   10 -> 6.3 units (1.04x)            wonky over a long session
 *   8  -> 5.0 units (0.83x)            barely visible
 *
 * The "wonky" reading is the contaminated one: the board's FRAME was still
 * deforming at the time, and a rubbery enclosure is a different complaint from
 * a rubbery fence. With the frame now rigid, that data point says nothing about
 * this constant, and the only clean readings left are 0.63x (too little) and
 * 1.46x (good). 12 lands at 1.25x, between the two.
 *
 * Expressed against WALL_THICKNESS deliberately: the ratio is what decides
 * whether this reads at all, so if walls are ever redrawn thicker, this is the
 * line to revisit.
 */
const BULGE_MAX_WORLD = 12;   // ~2x WALL_THICKNESS at full strength
const BULGE_TAU       = 85;   // ms to peak (soft, quick rise)
const BULGE_DURATION  = 520;  // ms total life (smooth relax)
const BULGE_SIGMA     = 40;   // spatial spread of the bump along the wall (world units)
const EDGE_TAPER      = 22;   // world units: bulge fades to 0 approaching the wall ends
// Feeds only the dead Canvas2D path below (renderWallPolyline); the Pixi
// renderer drew a hit flash from it briefly and no longer does.
const GLOW_DURATION   = 130;  // ms — brief hit flash
const GLOW_MAX        = 0.85;
const EFFECT_RADIUS   = 60;   // world units — cull radius / glow falloff
const MAX_IMPACTS     = 14;

export interface WallImpact {
  id: string;
  impactPoint: Vector2;
  impactT: number;      // fractional position of the hit along the wall (0..1)
  strength: number;
  dir: number;          // +/-1: which way along the normal the wall bulges (away from ball)
  startTime: number;
  glowIntensity: number;
  amp: number;          // current bulge amplitude (world units), refreshed each frame
  wallStart: Vector2;
  wallEnd: Vector2;
  wallLen: number;
  tx: number; ty: number; // unit tangent
  nx: number; ny: number; // unit normal
}

let activeImpacts: WallImpact[] = [];
let impactIdCounter = 0;

// Smooth impulse envelope: 0 at t=0, peaks to 1 at t=τ, decays gently after.
function bulgeEnvelope(elapsedMs: number): number {
  const x = elapsedMs / BULGE_TAU;
  return x * Math.exp(1 - x);
}

export function registerWallImpact(
  wallStart: Vector2,
  wallEnd: Vector2,
  impactPoint: Vector2,
  impactStrength = 1,
  ballPos?: Vector2,
): void {
  const strength = Math.max(0.4, Math.min(1, impactStrength));

  const dx = wallEnd.x - wallStart.x;
  const dy = wallEnd.y - wallStart.y;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  if (wallLen < 1) return;

  const tx = dx / wallLen;
  const ty = dy / wallLen;
  const nx = -ty;
  const ny =  tx;

  const impactT = Math.max(0, Math.min(1,
    ((impactPoint.x - wallStart.x) * tx + (impactPoint.y - wallStart.y) * ty) / wallLen,
  ));

  // Bulge AWAY from the ball: if the ball sits on the +normal side, push -normal.
  let dir = 1;
  if (ballPos) {
    const side = (ballPos.x - impactPoint.x) * nx + (ballPos.y - impactPoint.y) * ny;
    dir = side > 0 ? -1 : 1;
  }

  activeImpacts.push({
    id: `impact-${++impactIdCounter}`,
    impactPoint: { ...impactPoint },
    impactT,
    strength,
    dir,
    startTime: performance.now(),
    glowIntensity: GLOW_MAX * strength,
    amp: 0,
    wallStart: { ...wallStart },
    wallEnd: { ...wallEnd },
    wallLen,
    tx, ty, nx, ny,
  });
  if (activeImpacts.length > MAX_IMPACTS) activeImpacts.shift();
}

export function updateWallImpacts(): boolean {
  if (activeImpacts.length === 0) return false;

  const now = performance.now();

  activeImpacts = activeImpacts.filter(impact => {
    const elapsed = now - impact.startTime;

    // Glow decays quickly (a brief flash at the hit point).
    if (elapsed < GLOW_DURATION) {
      const p = elapsed / GLOW_DURATION;
      impact.glowIntensity = GLOW_MAX * impact.strength * (1 - p * p);
    } else {
      impact.glowIntensity = 0;
    }

    // Bulge amplitude follows the smooth rise/relax envelope.
    impact.amp = BULGE_MAX_WORLD * impact.strength * bulgeEnvelope(elapsed);

    return elapsed < BULGE_DURATION;
  });

  return activeImpacts.length > 0;
}

/** Gentle bulge displacement + glow at a world point (also used by the Pixi renderer). */
export function getEffectsAtPoint(
  queryPoint: Vector2,
  scale: number,
): { dx: number; dy: number; glow: number } {
  let totalDx = 0;
  let totalDy = 0;
  let totalGlow = 0;

  for (const impact of activeImpacts) {
    const distToImpact = Math.hypot(
      queryPoint.x - impact.impactPoint.x,
      queryPoint.y - impact.impactPoint.y,
    );
    if (distToImpact > EFFECT_RADIUS * 3) continue;

    // Signed distance along the wall from the hit point.
    const alongWorld = (queryPoint.x - impact.wallStart.x) * impact.tx
                     + (queryPoint.y - impact.wallStart.y) * impact.ty;
    const d = alongWorld - impact.impactT * impact.wallLen;

    // Gaussian bump centred on the hit, tapered to 0 near the wall's ends so the
    // bulge never detaches from a junction.
    const bump = Math.exp(-(d * d) / (2 * BULGE_SIGMA * BULGE_SIGMA));
    const distToEnd = Math.min(alongWorld, impact.wallLen - alongWorld);
    const taper = Math.max(0, Math.min(1, distToEnd / EDGE_TAPER));
    const disp = impact.dir * impact.amp * bump * taper;

    totalDx += impact.nx * disp * scale;
    totalDy += impact.ny * disp * scale;

    const falloff = Math.exp(-(distToImpact * distToImpact) / (2 * EFFECT_RADIUS * EFFECT_RADIUS));
    totalGlow = Math.max(totalGlow, impact.glowIntensity * falloff);
  }

  return { dx: totalDx, dy: totalDy, glow: totalGlow };
}

export function hasNearbyImpacts(wallStart: Vector2, wallEnd: Vector2): boolean {
  for (const impact of activeImpacts) {
    if (pointToSegmentDistance(impact.impactPoint, wallStart, wallEnd) < EFFECT_RADIUS * 1.5) {
      return true;
    }
  }
  return false;
}

/**
 * Stroke a whole connected wall run (fence chain or the board loop) as ONE
 * continuous neon path, so shared vertices become round *joins* instead of
 * overlapping round *caps* — the board reads as one coherent wall, not a pile
 * of segments. `screenPts`/`worldPts` are parallel arrays (>= 2 points); pass
 * `closed` for a loop (e.g. the board polygon).
 *
 * `taperLen` > 0 (screen px) flares the core/centerline into the wall at both
 * ends: it widens over that distance (widest at the contact) so the fence looks
 * like it splashed onto the wall and merged, not butted a point against it. Use
 * 0 for closed loops.
 */
export function renderWallPolyline(
  ctx: CanvasRenderingContext2D,
  screenPts: { x: number; y: number }[],
  worldPts: Vector2[],
  scale: number,
  baseColor: string,
  baseWidth: number,
  glowBoost = 0,
  closed = false,
  taperLen = 0,
  flareEnds: [boolean, boolean] = [true, true],
  greenOnly = false,
  skipGreen = false,
): void {
  if (screenPts.length < 2 || worldPts.length !== screenPts.length) return;

  // Thicken the drawn line only (physics thickness is untouched) so the circuit
  // skeleton has room to read.
  if (WALL_CIRCUITS_ENABLED) baseWidth *= WALL_RENDER_THICKEN;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Arc lengths along the run, for the root taper near the ends.
  const cum: number[] = [0];
  for (let i = 1; i < screenPts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(screenPts[i].x - screenPts[i - 1].x, screenPts[i].y - screenPts[i - 1].y);
  }
  const totalLen = cum[screenPts.length - 1];
  const rootAt = (pos: number) =>
    taperLen > 0 ? taperFactor(Math.min(pos, totalLen - pos), taperLen) : { w: 1, a: 1 };

  // Impact wobble: if any sub-segment has a nearby impact, resample the whole
  // run so the bulge eases along it; otherwise use the raw vertices.
  let hasImpact = false;
  if (activeImpacts.length > 0) {
    for (let s = 0; s < worldPts.length - 1; s++) {
      if (hasNearbyImpacts(worldPts[s], worldPts[s + 1])) { hasImpact = true; break; }
    }
  }

  let centers: { x: number; y: number }[];
  let maxGlow = 0;
  if (!hasImpact) {
    centers = screenPts;
  } else {
    const pts: { x: number; y: number }[] = [];
    for (let s = 0; s < worldPts.length - 1; s++) {
      const ws = worldPts[s], we = worldPts[s + 1];
      const ss = screenPts[s], es = screenPts[s + 1];
      const sdx = es.x - ss.x, sdy = es.y - ss.y;
      // Skip the shared vertex on all but the first sub-segment.
      for (let i = s === 0 ? 0 : 1; i <= N_NODES; i++) {
        const t = i / N_NODES;
        const { dx, dy, glow } = getEffectsAtPoint(
          { x: ws.x + (we.x - ws.x) * t, y: ws.y + (we.y - ws.y) * t }, scale,
        );
        pts.push({ x: ss.x + sdx * t + dx, y: ss.y + sdy * t + dy });
        if (glow > maxGlow) maxGlow = glow;
      }
    }
    centers = pts;
  }

  const buildPath = () => {
    ctx.beginPath();
    ctx.moveTo(centers[0].x, centers[0].y);
    for (let i = 1; i < centers.length; i++) ctx.lineTo(centers[i].x, centers[i].y);
    if (closed) ctx.closePath();
  };

  // Outer glow via additive compositing (amplified for freshly drawn walls).
  // Skipped on the green-only pass (which just relays the centerline on top so
  // fence-to-fence junctions merge — see the second fence pass in the renderer).
  if (!greenOnly) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Fence glow (taperLen > 0) uses butt end-caps so it doesn't bulge past a
  // fence-to-fence end (joins stay round). Wall ends are clipped anyway.
  ctx.lineCap = taperLen > 0 ? 'butt' : 'round';
  ctx.strokeStyle = baseColor;
  buildPath(); ctx.lineWidth = baseWidth * (2.8 + glowBoost * 2.5); ctx.globalAlpha = 0.10 + glowBoost * 0.22; ctx.stroke();
  buildPath(); ctx.lineWidth = baseWidth * (1.6 + glowBoost * 1.8); ctx.globalAlpha = 0.18 + glowBoost * 0.25; ctx.stroke();
  ctx.restore();
  }

  // Circuit "skeleton" (see wallSkeleton.ts), built per sub-segment but drawn
  // UNDER the border so the colored core/centerline veil it down to a hint.
  const pal = WALL_CIRCUITS_ENABLED ? circuitPalette(baseColor) : null;
  if (pal && !greenOnly) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let s = 0; s < worldPts.length - 1; s++) {
      const ss = screenPts[s], es = screenPts[s + 1];
      const ws = worldPts[s], we = worldPts[s + 1];
      // Fade + narrow the skeleton near the ends so it doesn't poke past the
      // rooted core.
      const rf = rootAt((cum[s] + cum[s + 1]) / 2);
      if (rf.a < 0.02) continue;
      const skel = buildWallSkeleton(ss.x, ss.y, es.x, es.y, scale, baseWidth / scale, ws.x, ws.y, we.x, we.y);
      if (!skel) continue; // short segments (e.g. a locked pocket's walls) carry no circuit
      ctx.strokeStyle = pal.trace;
      ctx.globalAlpha = pal.traceAlpha * rf.a;
      ctx.lineWidth = Math.max(1, baseWidth * pal.traceWidthFrac * rf.w);
      for (const tr of skel.traces) {
        ctx.beginPath();
        ctx.moveTo(tr[0], tr[1]);
        for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
        ctx.stroke();
      }
      for (const nd of skel.nodes) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = pal.viaAlpha * rf.a;
        ctx.fillStyle = pal.via;
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * rf.w, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = pal.sparkAlpha * rf.a;
        ctx.fillStyle = pal.spark;
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * rf.w * (nd.kind === 'via' ? 0.5 : 0.58), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // White-bright core + accent centerline — the colored border, kept mostly
  // opaque so the circuit beneath reads only as a hint coming through. With a
  // join flare, stroke it as short pieces so it widens into a splash where it
  // meets the wall at each end.
  const coreAlpha = pal ? WALL_CORE_ALPHA : 1;
  const centerAlpha = pal ? WALL_CENTERLINE_ALPHA : 1;
  if (taperLen > 0) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Overshoot ~1 drawn width so the core end lands past the clip boundary,
    // so the flare fills flush to the wall with no cap.
    const pieces = buildFenceTaper(screenPts, taperLen, baseWidth, flareEnds);
    // Near the wall the white border smoothly hands off to the wall's own white
    // (over ~1 wall-width, so no blunt notch), and the green centerline widens to
    // fill the flare as the white falls away — so the splash reads as solid green
    // merging in, not an empty glow blob. Away from the wall it's the normal
    // tube: full white core + 0.7x green centerline.
    const whiteFade = baseWidth * 1.0;
    const whiteFracAt = (dw: number) => { const s = Math.max(0, Math.min(1, dw / whiteFade)); return s * s * (3 - 2 * s); };
    if (!greenOnly) {
      ctx.strokeStyle = '#ffffff';
      for (const pc of pieces) {
        const wf = whiteFracAt(pc.dw);
        if (wf <= 0.002) continue;
        ctx.lineCap = pc.butt ? 'butt' : 'round';
        ctx.beginPath(); ctx.moveTo(pc.x1, pc.y1); ctx.lineTo(pc.x2, pc.y2);
        ctx.lineWidth = baseWidth * pc.w; ctx.globalAlpha = coreAlpha * wf; ctx.stroke();
      }
    }
    if (!skipGreen) {
      ctx.strokeStyle = baseColor;
      for (const pc of pieces) {
        ctx.lineCap = pc.butt ? 'butt' : 'round';
        ctx.beginPath(); ctx.moveTo(pc.x1, pc.y1); ctx.lineTo(pc.x2, pc.y2);
        ctx.lineWidth = baseWidth * pc.w * (1 - 0.3 * whiteFracAt(pc.dw)); ctx.globalAlpha = centerAlpha; ctx.stroke();
      }
    }
  } else {
    if (!greenOnly) { buildPath(); ctx.lineWidth = baseWidth * 1.0; ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = coreAlpha; ctx.stroke(); }
    if (!skipGreen) { buildPath(); ctx.lineWidth = baseWidth * 0.7; ctx.strokeStyle = baseColor; ctx.globalAlpha = centerAlpha; ctx.stroke(); }
  }

  // Fresh-wall bloom
  if (glowBoost > 0.05 && !greenOnly) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = taperLen > 0 ? 'butt' : 'round';
    buildPath();
    ctx.lineWidth = baseWidth * (3.5 + glowBoost * 3);
    ctx.strokeStyle = baseColor;
    ctx.globalAlpha = glowBoost * 0.18;
    ctx.stroke();
    ctx.restore();
  }

  // Impact wobble extra glow
  if (maxGlow > 0.05 && !greenOnly) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = taperLen > 0 ? 'butt' : 'round';
    buildPath();
    ctx.lineWidth = baseWidth * (1 + maxGlow * 2);
    ctx.strokeStyle = baseColor;
    ctx.globalAlpha = maxGlow * 0.65;
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}

/** Single-segment convenience wrapper around {@link renderWallPolyline}. */
export function renderWallWithEffects(
  ctx: CanvasRenderingContext2D,
  startScreen: { x: number; y: number },
  endScreen: { x: number; y: number },
  wallStart: Vector2,
  wallEnd: Vector2,
  scale: number,
  baseColor: string,
  baseWidth: number,
  glowBoost = 0,
): void {
  renderWallPolyline(ctx, [startScreen, endScreen], [wallStart, wallEnd], scale, baseColor, baseWidth, glowBoost);
}

export function clearWallImpacts(): void {
  activeImpacts = [];
}

export function getActiveImpactCount(): number {
  return activeImpacts.length;
}

// ── Obstacle bulge (radial) ─────────────────────────────────────────────────
// Walls are line segments, so their bulge is directional along the wall normal
// and tapers at the ends. A polygon obstacle has short edges and vertices at
// those ends, so that model would zero out. Instead an obstacle hit registers a
// RADIAL bulge: a soft dome centred on the hit point that pushes the boundary
// outward (away from the ball). Shares the rise/relax envelope with walls.

/**
 * Peak dent depth for an obstacle, in world units, at full strength.
 *
 * Was 6, which is exactly the value that was reported invisible for walls: a
 * standard ball asks for 3.8 units of it, so slab dents have been below the
 * threshold of visibility for their whole existence. Matched to the wall bulge
 * so a fence and a slab give by the same amount, which is what makes them read
 * as the same material rather than two effects that happen to coincide.
 */
const OBS_BULGE_MAX_WORLD = 12;  // peak outward push (world units) at full strength
const OBS_BULGE_SIGMA     = 26;  // radial falloff (world units)
const MAX_OBS_IMPACTS     = 10;

interface ObstacleImpact {
  point: Vector2;         // hit point (world)
  nx: number; ny: number; // outward push direction (unit, away from ball)
  strength: number;
  startTime: number;
  amp: number;            // current amplitude (world units), refreshed each frame
}

let obstacleImpacts: ObstacleImpact[] = [];

export function registerObstacleImpact(
  hitPoint: Vector2,
  outwardNx: number,
  outwardNy: number,
  strength = 1,
): void {
  const s = Math.max(0.4, Math.min(1, strength));
  // Light debounce: a ball pressing an edge re-registers every step; refresh the
  // nearest recent impact instead of stacking many overlapping domes.
  for (const o of obstacleImpacts) {
    const dx = o.point.x - hitPoint.x, dy = o.point.y - hitPoint.y;
    if (dx * dx + dy * dy < 100) { // within 10 world units
      o.startTime = performance.now();
      o.strength = Math.max(o.strength, s);
      o.nx = outwardNx; o.ny = outwardNy;
      return;
    }
  }
  obstacleImpacts.push({
    point: { ...hitPoint },
    nx: outwardNx, ny: outwardNy,
    strength: s,
    startTime: performance.now(),
    amp: 0,
  });
  if (obstacleImpacts.length > MAX_OBS_IMPACTS) obstacleImpacts.shift();
}

export function updateObstacleImpacts(): boolean {
  if (obstacleImpacts.length === 0) return false;
  const now = performance.now();
  obstacleImpacts = obstacleImpacts.filter(o => {
    const elapsed = now - o.startTime;
    o.amp = OBS_BULGE_MAX_WORLD * o.strength * bulgeEnvelope(elapsed);
    return elapsed < BULGE_DURATION;
  });
  return obstacleImpacts.length > 0;
}

export function anyObstacleImpactsActive(): boolean {
  return obstacleImpacts.length > 0;
}

/** Screen-space bulge displacement of a boundary point near obstacle hits. */
export function obstacleBulgeAt(
  worldX: number, worldY: number, scale: number,
): { dx: number; dy: number } {
  let dx = 0, dy = 0;
  for (const o of obstacleImpacts) {
    if (o.amp <= 0.001) continue;
    const ex = worldX - o.point.x, ey = worldY - o.point.y;
    const d2 = ex * ex + ey * ey;
    if (d2 > (OBS_BULGE_SIGMA * 3) ** 2) continue;
    const bump = Math.exp(-d2 / (2 * OBS_BULGE_SIGMA * OBS_BULGE_SIGMA));
    const disp = o.amp * bump * scale;
    dx += o.nx * disp;
    dy += o.ny * disp;
  }
  return { dx, dy };
}

export function clearObstacleImpacts(): void {
  obstacleImpacts = [];
}
