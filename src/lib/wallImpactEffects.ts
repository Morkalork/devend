// Wall Impact Effects System
// Mass-spring chain physics for wall wobble: a ripple propagates outward
// from the hit point and settles organically, replacing the old sinusoidal approximation.

import { Vector2, pointToSegmentDistance } from './polygon';

const N_NODES = 16;          // spring nodes per impact
const SPRING_K   = 180;      // spring restoring stiffness
const DAMPING    = 0.85;     // per-frame velocity multiplier (0→instant stop, 1→no damping)
const COUPLING_C = 0.4;      // neighbour displacement coupling strength
const INITIAL_VEL_SCALE = 28; // maps impact strength (0-1) → initial node velocity
const GLOW_DURATION   = 120; // ms
const GLOW_MAX        = 0.85;
const EFFECT_RADIUS   = 50;  // world units — spatial spread for glow lookup
const MAX_IMPACTS     = 12;

interface SpringNode {
  d: number; // displacement (world units perpendicular to wall)
  v: number; // velocity
}

export interface WallImpact {
  id: string;
  impactPoint: Vector2;
  strength: number;
  startTime: number;
  lastUpdateTime: number;
  glowIntensity: number;
  nodes: SpringNode[];
  wallStart: Vector2;
  wallEnd: Vector2;
  wallLen: number;
  // cached wall tangent/normal
  tx: number; ty: number; // unit tangent
  nx: number; ny: number; // unit normal (outward)
}

let activeImpacts: WallImpact[] = [];
let impactIdCounter = 0;

export function registerWallImpact(
  wallStart: Vector2,
  wallEnd: Vector2,
  impactPoint: Vector2,
  impactStrength = 1,
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

  // Find which node is nearest the impact point along the wall
  const impactT = Math.max(0, Math.min(1,
    ((impactPoint.x - wallStart.x) * tx + (impactPoint.y - wallStart.y) * ty) / wallLen,
  ));
  const nearestNode = Math.round(impactT * (N_NODES - 1));

  const nodes: SpringNode[] = Array.from({ length: N_NODES }, () => ({ d: 0, v: 0 }));
  nodes[nearestNode].v = INITIAL_VEL_SCALE * strength;

  const impact: WallImpact = {
    id: `impact-${++impactIdCounter}`,
    impactPoint: { ...impactPoint },
    strength,
    startTime: performance.now(),
    lastUpdateTime: performance.now(),
    glowIntensity: GLOW_MAX * strength,
    nodes,
    wallStart: { ...wallStart },
    wallEnd: { ...wallEnd },
    wallLen,
    tx, ty, nx, ny,
  };

  activeImpacts.push(impact);
  if (activeImpacts.length > MAX_IMPACTS) activeImpacts.shift();
}

export function updateWallImpacts(): boolean {
  if (activeImpacts.length === 0) return false;

  const now = performance.now();

  activeImpacts = activeImpacts.filter(impact => {
    const elapsed = now - impact.startTime;
    const dt = Math.min((now - impact.lastUpdateTime) / 1000, 0.05);
    impact.lastUpdateTime = now;

    // Glow decays quickly
    if (elapsed < GLOW_DURATION) {
      const p = elapsed / GLOW_DURATION;
      impact.glowIntensity = GLOW_MAX * impact.strength * (1 - p * p);
    } else {
      impact.glowIntensity = 0;
    }

    // Spring-chain physics: Euler step
    const { nodes } = impact;
    const accel = new Float32Array(N_NODES);

    for (let i = 0; i < N_NODES; i++) {
      const restoring = -SPRING_K * nodes[i].d;
      const leftCoupling  = i > 0          ? COUPLING_C * (nodes[i - 1].d - nodes[i].d) : 0;
      const rightCoupling = i < N_NODES - 1 ? COUPLING_C * (nodes[i + 1].d - nodes[i].d) : 0;
      accel[i] = restoring + leftCoupling + rightCoupling;
    }

    let maxActivity = 0;
    for (let i = 0; i < N_NODES; i++) {
      nodes[i].v = nodes[i].v * DAMPING + accel[i] * dt;
      nodes[i].d += nodes[i].v * dt;
      maxActivity = Math.max(maxActivity, Math.abs(nodes[i].v), Math.abs(nodes[i].d));
    }

    // Pin endpoint nodes — wall ends are anchored to intersecting walls, not free to move
    nodes[0].d = 0; nodes[0].v = 0;
    nodes[N_NODES - 1].d = 0; nodes[N_NODES - 1].v = 0;

    // Remove when all motion settles and glow is gone
    return maxActivity > 0.01 || impact.glowIntensity > 0.01;
  });

  return activeImpacts.length > 0;
}

function getEffectsAtPoint(
  queryPoint: Vector2,
  scale: number,
): { dx: number; dy: number; glow: number } {
  let totalDx = 0;
  let totalDy = 0;
  let totalGlow = 0;

  for (const impact of activeImpacts) {
    // Squared distance for quick rejection
    const qx = queryPoint.x - impact.wallStart.x;
    const qy = queryPoint.y - impact.wallStart.y;
    // Distance from query point to impact (approximate — use impact point for glow)
    const distToImpact = Math.sqrt(
      (queryPoint.x - impact.impactPoint.x) ** 2 +
      (queryPoint.y - impact.impactPoint.y) ** 2,
    );
    if (distToImpact > EFFECT_RADIUS * 3) continue;

    // Project query point onto wall to find its fractional position → node index
    const tAlong = Math.max(0, Math.min(1,
      (qx * impact.tx + qy * impact.ty) / impact.wallLen,
    ));
    const nodeF = tAlong * (N_NODES - 1);
    const nodeA = Math.floor(nodeF);
    const nodeB = Math.min(nodeA + 1, N_NODES - 1);
    const blend = nodeF - nodeA;
    const disp = impact.nodes[nodeA].d * (1 - blend) + impact.nodes[nodeB].d * blend;

    // Apply displacement perpendicular to wall
    totalDx += impact.nx * disp * scale;
    totalDy += impact.ny * disp * scale;

    // Glow spatial falloff
    const falloff = Math.exp(-(distToImpact * distToImpact) / (2 * EFFECT_RADIUS * EFFECT_RADIUS));
    totalGlow = Math.max(totalGlow, impact.glowIntensity * falloff);
  }

  return { dx: totalDx, dy: totalDy, glow: totalGlow };
}

function hasNearbyImpacts(wallStart: Vector2, wallEnd: Vector2): boolean {
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
): void {
  // Render fence as a FILLED POLYGON (not a stroked line).
  // This eliminates butt-cap corner nubs at wall junctions — the polygon clips
  // perfectly at any angle against ctx.clip() (boardRect or region polygon).
  const hw = baseWidth / 2;
  const sdx = endScreen.x - startScreen.x;
  const sdy = endScreen.y - startScreen.y;
  const slen = Math.sqrt(sdx * sdx + sdy * sdy);
  if (slen < 0.001) return;

  // Perpendicular half-width vector (scaled)
  const px = -sdy / slen * hw;
  const py =  sdx / slen * hw;

  // Local helper: fill a closed polygon from a centerline array + perp half-width vector
  const fillPoly = (
    centers: { x: number; y: number }[],
    perpX: number, perpY: number,
  ) => {
    const n = centers.length;
    ctx.beginPath();
    ctx.moveTo(centers[0].x + perpX, centers[0].y + perpY);
    for (let i = 1; i < n; i++) ctx.lineTo(centers[i].x + perpX, centers[i].y + perpY);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(centers[i].x - perpX, centers[i].y - perpY);
    ctx.closePath();
    ctx.fill();
    // Stroke over the filled edge to eliminate diagonal anti-aliasing staircase artifacts.
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  if (activeImpacts.length === 0 || !hasNearbyImpacts(wallStart, wallEnd)) {
    // Static: fill a square-capped rectangle — extend each end by hw in the
    // tangential direction so adjacent perpendicular walls overlap at corners,
    // eliminating the triangular notch that butt-ended rectangles leave.
    const ecx = sdx / slen * hw, ecy = sdy / slen * hw;
    fillPoly(
      [
        { x: startScreen.x - ecx, y: startScreen.y - ecy },
        { x: endScreen.x   + ecx, y: endScreen.y   + ecy },
      ],
      px, py,
    );
    return;
  }

  // Wobbly: spring-chain nodes displace the fence centerline; build polygon from those
  const centers: { x: number; y: number }[] = [];
  let maxGlow = 0;

  for (let i = 0; i <= N_NODES; i++) {
    const t = i / N_NODES;
    const wx = wallStart.x + (wallEnd.x - wallStart.x) * t;
    const wy = wallStart.y + (wallEnd.y - wallStart.y) * t;
    const sx = startScreen.x + sdx * t;
    const sy = startScreen.y + sdy * t;
    const { dx, dy, glow } = getEffectsAtPoint({ x: wx, y: wy }, scale);
    centers.push({ x: sx + dx, y: sy + dy });
    maxGlow = Math.max(maxGlow, glow);
  }

  // Square-cap extension for wobbly wall too (same tangential extension).
  const ecx = sdx / slen * hw, ecy = sdy / slen * hw;
  const first = centers[0], last = centers[centers.length - 1];
  centers.unshift({ x: first.x - ecx, y: first.y - ecy });
  centers.push   ({ x: last.x  + ecx, y: last.y  + ecy });

  fillPoly(centers, px, py);

  if (maxGlow > 0.05) {
    const hwGlow = baseWidth * (1 + maxGlow * 1.5) / 2;
    const gx = -sdy / slen * hwGlow;
    const gy =  sdx / slen * hwGlow;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = baseColor;
    ctx.globalAlpha = maxGlow * 0.8;
    fillPoly(centers, gx, gy);
    ctx.restore();
  }
}

export function clearWallImpacts(): void {
  activeImpacts = [];
}

export function getActiveImpactCount(): number {
  return activeImpacts.length;
}
