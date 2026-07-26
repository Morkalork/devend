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

// Renderers sample this many points along a wall when a bulge is nearby.
export const N_NODES = 16;

const BULGE_MAX_WORLD = 6;    // peak outward push (world units) at full strength
const BULGE_TAU       = 85;   // ms to peak (soft, quick rise)
const BULGE_DURATION  = 520;  // ms total life (smooth relax)
const BULGE_SIGMA     = 40;   // spatial spread of the bump along the wall (world units)
const EDGE_TAPER      = 22;   // world units: bulge fades to 0 approaching the wall ends
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
  const sdx = endScreen.x - startScreen.x;
  const sdy = endScreen.y - startScreen.y;
  const slen = Math.sqrt(sdx * sdx + sdy * sdy);
  if (slen < 0.001) return;

  // Thicken the drawn line only (physics thickness is untouched) so the circuit
  // skeleton has room to read.
  if (WALL_CIRCUITS_ENABLED) baseWidth *= WALL_RENDER_THICKEN;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let centers: { x: number; y: number }[];
  let maxGlow = 0;

  if (activeImpacts.length === 0 || !hasNearbyImpacts(wallStart, wallEnd)) {
    centers = [startScreen, endScreen];
  } else {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= N_NODES; i++) {
      const t = i / N_NODES;
      const wx = wallStart.x + (wallEnd.x - wallStart.x) * t;
      const wy = wallStart.y + (wallEnd.y - wallStart.y) * t;
      const { dx, dy, glow } = getEffectsAtPoint({ x: wx, y: wy }, scale);
      pts.push({ x: startScreen.x + sdx * t + dx, y: startScreen.y + sdy * t + dy });
      maxGlow = Math.max(maxGlow, glow);
    }
    centers = pts;
  }

  const buildPath = () => {
    ctx.beginPath();
    ctx.moveTo(centers[0].x, centers[0].y);
    for (let i = 1; i < centers.length; i++) ctx.lineTo(centers[i].x, centers[i].y);
  };

  // Circuit "skeleton" laid along the straight segment (see wallSkeleton.ts).
  // Deterministic + cached, so it's stable per wall. Drawn BENEATH the colored
  // border (below), so only a hint bleeds through the mostly-opaque core.
  const skel = WALL_CIRCUITS_ENABLED
    ? buildWallSkeleton(
        startScreen.x, startScreen.y, endScreen.x, endScreen.y,
        scale, baseWidth / scale,
        wallStart.x, wallStart.y, wallEnd.x, wallEnd.y,
      )
    : null;
  const pal = skel ? circuitPalette(baseColor) : null;

  // Outer glow via additive compositing (amplified for freshly drawn walls)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = baseColor;
  buildPath(); ctx.lineWidth = baseWidth * (2.8 + glowBoost * 2.5); ctx.globalAlpha = 0.10 + glowBoost * 0.22; ctx.stroke();
  buildPath(); ctx.lineWidth = baseWidth * (1.6 + glowBoost * 1.8); ctx.globalAlpha = 0.18 + glowBoost * 0.25; ctx.stroke();
  ctx.restore();

  // Circuit skeleton — glowing conductor traces + solder nodes, drawn UNDER the
  // border so the colored core/centerline veil it down to a faint hint.
  if (skel && pal) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.trace;
    ctx.globalAlpha = pal.traceAlpha;
    ctx.lineWidth = Math.max(1, baseWidth * pal.traceWidthFrac);
    for (const tr of skel.traces) {
      ctx.beginPath();
      ctx.moveTo(tr[0], tr[1]);
      for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
      ctx.stroke();
    }
    for (const nd of skel.nodes) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = pal.viaAlpha;
      ctx.fillStyle = pal.via;
      ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pal.sparkAlpha;
      ctx.fillStyle = pal.spark;
      ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * (nd.kind === 'via' ? 0.5 : 0.58), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // White-bright core + accent centerline — the colored border, kept mostly
  // opaque so the circuit beneath reads only as a hint coming through.
  buildPath(); ctx.lineWidth = baseWidth * 1.0; ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = skel ? WALL_CORE_ALPHA : 1; ctx.stroke();
  buildPath(); ctx.lineWidth = baseWidth * 0.7; ctx.strokeStyle = baseColor; ctx.globalAlpha = skel ? WALL_CENTERLINE_ALPHA : 1; ctx.stroke();

  // Fresh-wall bloom
  if (glowBoost > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    buildPath();
    ctx.lineWidth = baseWidth * (3.5 + glowBoost * 3);
    ctx.strokeStyle = baseColor;
    ctx.globalAlpha = glowBoost * 0.18;
    ctx.stroke();
    ctx.restore();
  }

  // Impact wobble extra glow
  if (maxGlow > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    buildPath();
    ctx.lineWidth = baseWidth * (1 + maxGlow * 2);
    ctx.strokeStyle = baseColor;
    ctx.globalAlpha = maxGlow * 0.65;
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = 1;
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

const OBS_BULGE_MAX_WORLD = 6;   // peak outward push (world units) at full strength
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
