import { Region } from "@/types/game";
import { Vector2, vec2Normalize, pointInPolygon } from "@/lib/polygon";
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
 * Compute future ball path waypoints by ray-casting off solid walls.
 * Returns an array of points starting at ballPosition, with up to numBounces
 * additional reflection points. Ignores in-progress fences (completed walls only).
 */
export function computeBallTrajectory(
  ballPosition: { x: number; y: number },
  ballVelocity: { x: number; y: number },
  walls: Wall[],
  numBounces: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [{ ...ballPosition }];
  let origin = { ...ballPosition };
  let dir = vec2Normalize(ballVelocity);
  let excludeId: string | undefined;

  for (let bounce = 0; bounce < numBounces; bounce++) {
    let bestT = Infinity;
    let bestNormal: { x: number; y: number } | null = null;
    let bestId: string | undefined;

    for (const wall of walls) {
      if (wall.id === excludeId) continue;

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
        bestId = wall.id;
        const len = Math.sqrt(ex * ex + ey * ey);
        let nx = -ey / len;
        let ny =  ex / len;
        if (dir.x * nx + dir.y * ny > 0) { nx = -nx; ny = -ny; }
        bestNormal = { x: nx, y: ny };
      }
    }

    if (bestNormal === null) break;

    const hitPoint = { x: origin.x + bestT * dir.x, y: origin.y + bestT * dir.y };
    points.push(hitPoint);

    const dot = dir.x * bestNormal.x + dir.y * bestNormal.y;
    dir = { x: dir.x - 2 * dot * bestNormal.x, y: dir.y - 2 * dot * bestNormal.y };
    origin = { x: hitPoint.x + dir.x * 0.5, y: hitPoint.y + dir.y * 0.5 };
    excludeId = bestId;
  }

  return points;
}
