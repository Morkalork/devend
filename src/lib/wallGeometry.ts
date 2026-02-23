// Wall Geometry System
// Provides utilities for wall-based game board representation
// All walls are identical in behavior and appearance

import { Vector2, Polygon, pointInPolygon, vec2Sub, vec2Add, vec2Scale, vec2Normalize, vec2Distance, vec2Dot, vec2Reflect, lineSegmentIntersection, pointToSegmentDistance } from "./polygon";

export interface Wall {
  id: string;
  start: Vector2;
  end: Vector2;
  thickness: number;
  isMirror?: boolean;
}

export interface WallVertex {
  x: number;
  y: number;
  wallIds: string[]; // Walls that meet at this vertex
}

// Uniform wall thickness for the entire game (world units)
export const WALL_THICKNESS = 6;

// Wall rendering color (CRT green)
export const WALL_COLOR = "#00ff44";

/**
 * Creates walls from a polygon's edges
 */
export function createWallsFromPolygon(polygon: Polygon, idPrefix: string, isMirror?: boolean): Wall[] {
  const walls: Wall[] = [];
  const { vertices } = polygon;

  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const wall: Wall = {
      id: `${idPrefix}-edge-${i}`,
      start: { ...vertices[i] },
      end: { ...vertices[j] },
      thickness: WALL_THICKNESS,
    };
    if (isMirror) wall.isMirror = true;
    walls.push(wall);
  }

  return walls;
}

/**
 * Find all wall intersection/termination points within region bounds
 */
export function findWallIntersections(walls: Wall[]): WallVertex[] {
  const vertices: WallVertex[] = [];
  const epsilon = 0.5;
  
  // Collect all wall endpoints
  for (const wall of walls) {
    addOrMergeVertex(vertices, wall.start, wall.id, epsilon);
    addOrMergeVertex(vertices, wall.end, wall.id, epsilon);
  }
  
  // Find intersections between walls
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const intersection = lineSegmentIntersection(
        walls[i].start, walls[i].end,
        walls[j].start, walls[j].end
      );
      
      if (intersection) {
        addOrMergeVertex(vertices, intersection, walls[i].id, epsilon);
        addOrMergeVertex(vertices, intersection, walls[j].id, epsilon);
      }
    }
  }
  
  return vertices;
}

function addOrMergeVertex(vertices: WallVertex[], point: Vector2, wallId: string, epsilon: number): void {
  for (const v of vertices) {
    if (vec2Distance({ x: v.x, y: v.y }, point) < epsilon) {
      if (!v.wallIds.includes(wallId)) {
        v.wallIds.push(wallId);
      }
      return;
    }
  }
  
  vertices.push({
    x: point.x,
    y: point.y,
    wallIds: [wallId],
  });
}

/**
 * Find the closest wall intersection from a point in a direction
 */
export function findWallTermination(
  origin: Vector2,
  direction: Vector2,
  walls: Wall[],
  excludeWallId?: string
): { point: Vector2; wallId: string; distance: number } | null {
  let closest: { point: Vector2; wallId: string; distance: number } | null = null;
  
  for (const wall of walls) {
    if (wall.id === excludeWallId) continue;
    
    // Cast ray in direction and check intersection with wall segment
    const rayEnd = {
      x: origin.x + direction.x * 10000,
      y: origin.y + direction.y * 10000,
    };
    
    const intersection = lineSegmentIntersection(origin, rayEnd, wall.start, wall.end);
    
    if (intersection) {
      const dist = vec2Distance(origin, intersection);
      if (dist > 0.1 && (!closest || dist < closest.distance)) {
        closest = {
          point: intersection,
          wallId: wall.id,
          distance: dist,
        };
      }
    }
  }
  
  return closest;
}

/**
 * Check if a point is "inside" the playable area defined by walls
 * Uses flood-fill style point classification
 */
export function isPointInPlayableArea(
  point: Vector2,
  samplePoints: Vector2[],
  gridSize: number
): boolean {
  // Check if point is close to any sample point
  const halfGrid = gridSize / 2;
  for (const sample of samplePoints) {
    if (
      point.x >= sample.x - halfGrid && point.x <= sample.x + halfGrid &&
      point.y >= sample.y - halfGrid && point.y <= sample.y + halfGrid
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate distance from point to nearest wall
 */
export function distanceToNearestWall(point: Vector2, walls: Wall[]): number {
  let minDist = Infinity;
  
  for (const wall of walls) {
    const dist = pointToSegmentDistance(point, wall.start, wall.end);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  
  return minDist;
}

/**
 * Check if a line segment intersects any wall
 */
export function lineIntersectsWalls(
  p1: Vector2,
  p2: Vector2,
  walls: Wall[],
  excludeWallIds: string[] = []
): boolean {
  for (const wall of walls) {
    if (excludeWallIds.includes(wall.id)) continue;
    
    if (lineSegmentIntersection(p1, p2, wall.start, wall.end)) {
      return true;
    }
    
    // Also check if line passes within wall thickness
    const midPoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const dist = pointToSegmentDistance(midPoint, wall.start, wall.end);
    
    if (dist < wall.thickness / 2) {
      // Check if we're crossing the wall
      const wallDir = vec2Normalize(vec2Sub(wall.end, wall.start));
      const perpDir = { x: -wallDir.y, y: wallDir.x };
      const proj1 = (p1.x - wall.start.x) * perpDir.x + (p1.y - wall.start.y) * perpDir.y;
      const proj2 = (p2.x - wall.start.x) * perpDir.x + (p2.y - wall.start.y) * perpDir.y;
      
      if ((proj1 > 0 && proj2 < 0) || (proj1 < 0 && proj2 > 0)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Cast a ray from origin in direction, reflecting off mirror walls up to maxBounces times.
 * Returns waypoints array [origin, bounce1, ..., finalHitPoint] and the final wall id.
 */
export function castRayWithReflections(
  origin: Vector2,
  direction: Vector2,
  walls: Wall[],
  maxBounces: number = 3
): { waypoints: Vector2[]; finalWallId: string } | null {
  const waypoints: Vector2[] = [{ ...origin }];
  let currentOrigin = { ...origin };
  let currentDir = { ...direction };
  let bounces = 0;

  for (;;) {
    const hit = findWallTermination(currentOrigin, currentDir, walls);
    if (!hit) return null;

    waypoints.push({ ...hit.point });

    // Find the wall we hit to check if it's a mirror
    const hitWall = walls.find(w => w.id === hit.wallId);
    if (!hitWall || !hitWall.isMirror || bounces >= maxBounces) {
      // Terminal hit — return result
      return { waypoints, finalWallId: hit.wallId };
    }

    // Reflect off mirror
    bounces++;
    const wallDir = vec2Normalize(vec2Sub(hitWall.end, hitWall.start));
    const normal: Vector2 = { x: -wallDir.y, y: wallDir.x };

    // Ensure normal faces toward incoming ray (dot product with incoming dir should be negative)
    const dotCheck = vec2Dot(currentDir, normal);
    const effectiveNormal = dotCheck > 0 ? { x: -normal.x, y: -normal.y } : normal;

    currentDir = vec2Reflect(currentDir, effectiveNormal);
    // Nudge origin past mirror surface to avoid re-hitting the same wall
    currentOrigin = vec2Add(hit.point, vec2Scale(currentDir, 0.5));
  }
}
