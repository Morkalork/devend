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
/**
 * Two hits closer than this along the same wall are ONE impact.
 *
 * Half a sigma: closer than that the bumps are effectively the same bulge, and
 * letting both live meant a ball bouncing in a corner stacked give on give.
 */
const COALESCE_ALONG  = BULGE_SIGMA * 0.5;
/**
 * Hard ceiling on the TOTAL displacement at any point, in world units.
 *
 * Impacts sum, and nothing bounded the sum: fourteen may be live at once, so a
 * busy corner could reach a hundred-plus units of give and bend a fence into a
 * curve. Capped at one impact's peak, the effect stays what it was asked to be
 * - a sign that a ball hit here - however many balls are hitting.
 */
const BULGE_TOTAL_MAX = BULGE_MAX_WORLD;
const EDGE_TAPER      = 22;   // world units: bulge fades to 0 approaching the wall ends
const EFFECT_RADIUS   = 60;   // world units — how far an impact is culled at
const MAX_IMPACTS     = 14;

export interface WallImpact {
  id: string;
  impactPoint: Vector2;
  impactT: number;      // fractional position of the hit along the wall (0..1)
  strength: number;
  dir: number;          // +/-1: which way along the normal the wall bulges (away from ball)
  startTime: number;
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

  // A ball rattling in a pocket hits the same fence several times inside one
  // impact's 520ms life, and every hit used to push its own bump. Because the
  // displacements SUM, three overlapping bumps meant three times the give, and
  // a fast ball in a tight corner bent whole fences into curves. Refreshing the
  // nearby one instead keeps a flurry reading as one live impact, which is what
  // this effect was ever meant to be.
  const now = performance.now();
  for (const live of activeImpacts) {
    if (live.dir !== dir) continue;
    if (Math.abs(live.impactT * live.wallLen - impactT * wallLen) > COALESCE_ALONG) continue;
    if (Math.hypot(live.wallStart.x - wallStart.x, live.wallStart.y - wallStart.y) > 1) continue;
    // Restart its envelope and take the harder of the two hits, so a heavy
    // second strike still reads as heavier than the graze before it.
    live.startTime = now;
    live.strength = Math.max(live.strength, strength);
    live.impactPoint = { ...impactPoint };
    live.impactT = impactT;
    return;
  }

  activeImpacts.push({
    id: `impact-${++impactIdCounter}`,
    impactPoint: { ...impactPoint },
    impactT,
    strength,
    dir,
    startTime: now,
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

    // Bulge amplitude follows the smooth rise/relax envelope.
    impact.amp = BULGE_MAX_WORLD * impact.strength * bulgeEnvelope(elapsed);

    return elapsed < BULGE_DURATION;
  });

  return activeImpacts.length > 0;
}

/** The bulge displacement at a world point. */
export function getEffectsAtPoint(
  queryPoint: Vector2,
  scale: number,
): { dx: number; dy: number } {
  let totalDx = 0;
  let totalDy = 0;

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

    totalDx += impact.nx * disp;
    totalDy += impact.ny * disp;

  }

  // Clamp the SUM, then scale. Clamping in world units keeps the ceiling the
  // same physical give whatever the board is zoomed to, which is the whole
  // point of the constant being in world units in the first place.
  const mag = Math.hypot(totalDx, totalDy);
  if (mag > BULGE_TOTAL_MAX) {
    const k = BULGE_TOTAL_MAX / mag;
    totalDx *= k;
    totalDy *= k;
  }

  return { dx: totalDx * scale, dy: totalDy * scale };
}

export function hasNearbyImpacts(wallStart: Vector2, wallEnd: Vector2): boolean {
  for (const impact of activeImpacts) {
    if (pointToSegmentDistance(impact.impactPoint, wallStart, wallEnd) < EFFECT_RADIUS * 1.5) {
      return true;
    }
  }
  return false;
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
const OBS_COALESCE        = OBS_BULGE_SIGMA * 0.5;  // two hits inside this are one
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
    // Matched to the dome's own falloff rather than a round number: two hits
    // closer than half a sigma are the same dome, and letting both live is how
    // a ball pressing a corner stacked give on give.
    if (dx * dx + dy * dy < OBS_COALESCE * OBS_COALESCE) {
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
    const disp = o.amp * bump;
    dx += o.nx * disp;
    dy += o.ny * disp;
  }
  // Same ceiling as the fences, for the same reason: these sum too, and an
  // obstacle taking several hits at once should read as struck, not as melting.
  const mag = Math.hypot(dx, dy);
  const k = mag > OBS_BULGE_MAX_WORLD ? OBS_BULGE_MAX_WORLD / mag : 1;
  return { dx: dx * k * scale, dy: dy * k * scale };
}

export function clearObstacleImpacts(): void {
  obstacleImpacts = [];
}
