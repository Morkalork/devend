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

/**
 * Compute future ball path waypoints by ray-casting off solid walls and
 * obstacle polygons.  Handles each obstacle as a whole unit so adjacent
 * polygon edges never cause false double-bounces, and uses outward-facing
 * normals with back-face culling so interior faces are ignored.
 *
 * @param ballRadius - Ball radius in world units; used to offset the bounce
 *   point so the preview lands where the ball surface first contacts the wall.
 * @param obstaclePolygons - Obstacle polygon list from CanvasGameState.
 *   Walls with isObstacleBoundary are skipped in the wall loop and handled
 *   here at the polygon level instead.
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
  let origin = { ...ballPosition };
  let dir = vec2Normalize(ballVelocity);
  let lastHitWallId: string | undefined;
  let lastHitObstacleIdx = -1;

  for (let bounce = 0; bounce < numBounces; bounce++) {
    let bestT = Infinity;
    let bestNormal: Vector2 | null = null;
    let bestWallId: string | undefined;
    let bestObstacleIdx = -1;

    // ── Board-edge and fence walls ────────────────────────────────────────
    for (const wall of walls) {
      // Obstacle boundary walls are handled per-polygon below
      if (wall.isObstacleBoundary) continue;
      if (wall.id === lastHitWallId) continue;

      const ex = wall.end.x - wall.start.x;
      const ey = wall.end.y - wall.start.y;
      const denom = dir.x * ey - dir.y * ex;
      if (Math.abs(denom) < 1e-9) continue;

      const wx = wall.start.x - origin.x;
      const wy = wall.start.y - origin.y;
      const t = (wx * ey - wy * ex) / denom;
      const u = (wx * dir.y - wy * dir.x) / denom;

      if (t > 1e-4 && u >= 0 && u <= 1 && t < bestT) {
        bestT = t;
        bestWallId = wall.id;
        bestObstacleIdx = -1;
        const len = Math.sqrt(ex * ex + ey * ey);
        let nx = -ey / len;
        let ny =  ex / len;
        if (dir.x * nx + dir.y * ny > 0) { nx = -nx; ny = -ny; }
        bestNormal = { x: nx, y: ny };
      }
    }

    // ── Obstacle polygons (ball is outside, bounces off outer surface) ────
    for (let pi = 0; pi < obstaclePolygons.length; pi++) {
      if (pi === lastHitObstacleIdx) continue;
      const poly = obstaclePolygons[pi];

      for (let i = 0; i < poly.vertices.length; i++) {
        const j = (i + 1) % poly.vertices.length;
        const p1 = poly.vertices[i];
        const p2 = poly.vertices[j];

        const ex = p2.x - p1.x;
        const ey = p2.y - p1.y;
        const denom = dir.x * ey - dir.y * ex;
        if (Math.abs(denom) < 1e-9) continue;

        const wx = p1.x - origin.x;
        const wy = p1.y - origin.y;
        const t = (wx * ey - wy * ex) / denom;
        const u = (wx * dir.y - wy * dir.x) / denom;

        if (t <= 1e-4 || u < 0 || u > 1 || t >= bestT) continue;

        // Compute normal and orient it to point away from the polygon
        // (toward the side the ray originates from).
        const len = Math.sqrt(ex * ex + ey * ey);
        let nx = -ey / len;
        let ny =  ex / len;
        const midX = p1.x + ex * 0.5;
        const midY = p1.y + ey * 0.5;
        if (nx * (origin.x - midX) + ny * (origin.y - midY) < 0) { nx = -nx; ny = -ny; }

        // Back-face cull: skip edges whose outward normal faces away from the ray
        if (dir.x * nx + dir.y * ny > -1e-6) continue;

        bestT = t;
        bestWallId = undefined;
        bestObstacleIdx = pi;
        bestNormal = { x: nx, y: ny };
      }
    }

    if (!bestNormal) break;

    // Place the bounce point where the ball surface first contacts the surface
    const tEffective = Math.max(1e-4, bestT - ballRadius);
    const hitPoint: Vector2 = {
      x: origin.x + tEffective * dir.x,
      y: origin.y + tEffective * dir.y,
    };
    points.push(hitPoint);

    // Reflect direction
    const dot = dir.x * bestNormal.x + dir.y * bestNormal.y;
    dir = vec2Normalize({
      x: dir.x - 2 * dot * bestNormal.x,
      y: dir.y - 2 * dot * bestNormal.y,
    });

    // Nudge past the collision surface to avoid immediate re-intersection
    const nudge = Math.max(ballRadius + 1, 3);
    origin = {
      x: hitPoint.x + dir.x * nudge,
      y: hitPoint.y + dir.y * nudge,
    };

    lastHitWallId = bestWallId;
    lastHitObstacleIdx = bestObstacleIdx;
  }

  return points;
}
