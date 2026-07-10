import { Region } from "@/types/game";
import { Vector2, vec2Normalize, pointInPolygon, Polygon } from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";

// ── Colour helpers ────────────────────────────────────────────────────────

export function hexToRgba(hex: string, alpha: number = 1): string {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── ID generators ─────────────────────────────────────────────────────────

let regionIdCounter = 0;
export function generateRegionId(): string {
  return `region-${++regionIdCounter}`;
}

let wallIdCounter = 0;
export function generateWallId(): string {
  return `wall-${++wallIdCounter}`;
}

// ── Direction helpers ─────────────────────────────────────────────────────

export function getRandomDirection(): Vector2 {
  const minAngle = 15 * (Math.PI / 180);
  const maxAngle = 75 * (Math.PI / 180);
  const quadrant = Math.floor(Math.random() * 4);
  const baseAngle = minAngle + Math.random() * (maxAngle - minAngle);
  const angle = baseAngle + (quadrant * Math.PI) / 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// ── Region lookup ─────────────────────────────────────────────────────────

export function findRegionContainingPoint(regions: Region[], x: number, y: number): Region | null {
  for (const region of regions) {
    if (pointInPolygon({ x, y }, region.polygon)) {
      return region;
    }
  }
  return null;
}

// ── Scoring helpers ───────────────────────────────────────────────────────

/** Legacy scoring — kept for compatibility; primary scoring uses the configurable system. */
export function computeLevelScore(basePoints: number, expectedCuts: number, actualCuts: number): number {
  let score: number;
  if (actualCuts <= expectedCuts) {
    score = basePoints + (expectedCuts - actualCuts);
  } else {
    score = basePoints - (actualCuts - expectedCuts);
  }
  return Math.max(0, score);
}

/** Legacy overcut bonus — now integrated into space optimisation. */
export function computeOvercutBonus(threshold: number, remaining: number, basePoints: number): number {
  const overshoot = Math.max(0, threshold - remaining);
  if (overshoot <= 0) return 0;
  const overcutRatio = overshoot / threshold;
  const bonus = Math.round(basePoints * 0.6 * Math.sqrt(overcutRatio));
  const maxBonus = Math.floor(0.5 * basePoints);
  return Math.min(bonus, maxBonus);
}

// ── Difficulty curves ─────────────────────────────────────────────────────

/** Wall speed in world units/second. Decreases per level (slower fence = harder). */
export function getWallSpeedBase(levelIndex: number, base = 1200, min = 750, perLevel = 50): number {
  return Math.max(min, Math.min(base, base - (levelIndex - 1) * perLevel));
}

/** Ball speed multiplier. Increases per level (faster balls = harder). */
export function getBallSpeedLevelMultiplier(levelIndex: number): number {
  return 1 + (levelIndex - 1) * 0.06;
}

// ── Ball trajectory ───────────────────────────────────────────────────────

interface CapsuleHit { t: number; nx: number; ny: number; }

/** Nearest forward hit (t > eps) of a UNIT-direction ray with a circle. */
function rayCircleFirstHit(
  ox: number, oy: number, dx: number, dy: number,
  cx: number, cy: number, R: number,
): number | null {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;        // dir is unit, so the quadratic's a = 1
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 > 1e-4) return t0;
  const t1 = -b + s;
  return t1 > 1e-4 ? t1 : null;
}

/**
 * Nearest forward hit of a UNIT-direction ray against the CAPSULE around
 * segment a–b with radius R — the surface swept by the CENTRE of a ball of
 * radius R as it rolls along the wall. This is exactly the model the real
 * collision uses (closest point on the segment, within radius R), so it
 * reflects at the correct angle on the flat sides AND rounds the endpoints and
 * corners the way the physics does. Returns the centre-contact distance `t` and
 * the outward surface normal, or null.
 */
function capsuleRayHit(
  ox: number, oy: number, dx: number, dy: number,
  ax: number, ay: number, bx: number, by: number, R: number,
): CapsuleHit | null {
  const sx = bx - ax, sy = by - ay;
  const segLen = Math.sqrt(sx * sx + sy * sy);
  let best: CapsuleHit | null = null;
  const consider = (t: number, nx: number, ny: number) => {
    if (t > 1e-4 && (!best || t < best.t)) best = { t, nx, ny };
  };

  if (segLen >= 1e-9) {
    const ux = sx / segLen, uy = sy / segLen;         // unit vector along the wall
    // Flat side facing the ray: its outward normal must oppose the ray dir.
    let onx = -uy, ony = ux;
    if (dx * onx + dy * ony > 0) { onx = -onx; ony = -ony; }
    // Ray vs the offset line through (a + R·outward) with direction u.
    const px = ax + onx * R, py = ay + ony * R;
    const denom = dx * uy - dy * ux;
    if (Math.abs(denom) > 1e-9) {
      const t = ((px - ox) * uy - (py - oy) * ux) / denom;
      if (t > 1e-4) {
        const hx = ox + t * dx, hy = oy + t * dy;
        const w = (hx - ax) * ux + (hy - ay) * uy;    // projection along the wall
        if (w >= 0 && w <= segLen) consider(t, onx, ony); // only the flat span
      }
    }
  }

  // Rounded end caps (the corners). A cap only counts where it sticks out past
  // the segment end — within the span the flat side is the true surface.
  const caps: Array<[number, number, number]> = [[ax, ay, -1], [bx, by, 1]];
  for (const [ex, ey, side] of caps) {
    const t = rayCircleFirstHit(ox, oy, dx, dy, ex, ey, R);
    if (t == null) continue;
    const hx = ox + t * dx, hy = oy + t * dy;
    if (segLen >= 1e-9) {
      const w = ((hx - ax) * sx + (hy - ay) * sy) / segLen;
      if (side < 0 && w > 0) continue;         // cap a: keep only w < 0
      if (side > 0 && w < segLen) continue;    // cap b: keep only w > segLen
    }
    const nx = hx - ex, ny = hy - ey;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    consider(t, nx / nl, ny / nl);
  }

  return best;
}

/**
 * Predict the ball's future path as centre-position waypoints by ray-casting
 * off the board edges, user fences and obstacle polygons. Each surface is
 * modelled as a capsule (see capsuleRayHit) whose radius matches the real
 * collision distance, so the preview reflects at the right angle, rounds
 * corners/fence-ends, and accounts for ball radius + wall thickness — matching
 * how the ball actually bounces.
 *
 * Note: this is a single-ball prediction; it does not model ball-to-ball
 * collisions (both balls are moving), so paths can still diverge once balls
 * meet. That is an inherent limit of a forward preview, not a bug here.
 */
export function computeBallTrajectory(
  ballPosition: Vector2,
  ballVelocity: Vector2,
  walls: Wall[],
  numBounces: number,
  ballRadius = 0,
  obstaclePolygons: Polygon[] = [],
): Vector2[] {
  const points: Vector2[] = [{ ...ballPosition }];
  const v = vec2Normalize(ballVelocity);
  let ox = ballPosition.x, oy = ballPosition.y;
  let dx = v.x, dy = v.y;
  if (dx === 0 && dy === 0) return points;

  // Build the collision surfaces once as capsule segments. Board edges use the
  // ball radius (matching the boardPolygon collision); user fences add half the
  // wall thickness (matching collideBallWithWall). Obstacle polygon edges use
  // the ball radius. Obstacle-boundary walls are skipped — handled via polygons.
  interface Seg { ax: number; ay: number; bx: number; by: number; R: number; id: string; }
  const segs: Seg[] = [];
  for (const wall of walls) {
    if (wall.id.startsWith('obstacle-')) continue;
    const R = wall.id.startsWith('board-') ? ballRadius : ballRadius + (wall.thickness ?? 0) / 2;
    segs.push({ ax: wall.start.x, ay: wall.start.y, bx: wall.end.x, by: wall.end.y, R, id: wall.id });
  }
  for (let pi = 0; pi < obstaclePolygons.length; pi++) {
    const vs = obstaclePolygons[pi].vertices;
    for (let i = 0; i < vs.length; i++) {
      const j = (i + 1) % vs.length;
      segs.push({ ax: vs[i].x, ay: vs[i].y, bx: vs[j].x, by: vs[j].y, R: ballRadius, id: `obs:${pi}:${i}` });
    }
  }

  let skipId = ""; // don't immediately re-hit the surface we just bounced off
  for (let bounce = 0; bounce < numBounces; bounce++) {
    let bestT = Infinity, bnx = 0, bny = 0, bestId = "";
    for (const s of segs) {
      if (s.id === skipId) continue;
      const hit = capsuleRayHit(ox, oy, dx, dy, s.ax, s.ay, s.bx, s.by, s.R);
      if (hit && hit.t < bestT) { bestT = hit.t; bnx = hit.nx; bny = hit.ny; bestId = s.id; }
    }
    if (!Number.isFinite(bestT)) break;

    // Waypoint = ball CENTRE at contact (distance R from the surface).
    const hx = ox + bestT * dx, hy = oy + bestT * dy;
    points.push({ x: hx, y: hy });

    // Reflect the direction about the surface normal (angle in = angle out).
    const dot = dx * bnx + dy * bny;
    dx -= 2 * dot * bnx;
    dy -= 2 * dot * bny;
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= dl; dy /= dl;

    ox = hx + dx * 1e-3; // nudge a hair off the surface to avoid self-hit
    oy = hy + dy * 1e-3;
    skipId = bestId;
  }

  return points;
}
