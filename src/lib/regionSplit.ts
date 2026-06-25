import {
  Polygon,
  Vector2,
  pointInPolygon,
  pointToSegmentDistance,
  lineSegmentIntersection,
} from "@/lib/polygon";
import { Ball, Region } from "@/types/game";
import { Wall } from "@/lib/wallGeometry";

export const SAMPLE_GRID_SIZE = 15;

export function findSubRegionsGrid(
  region: Region,
  balls: Ball[],
  walls: Wall[],
): { samples: Vector2[]; hasBalls: boolean }[] {
  const bounds = {
    minX: Math.min(...region.polygon.vertices.map(v => v.x)),
    maxX: Math.max(...region.polygon.vertices.map(v => v.x)),
    minY: Math.min(...region.polygon.vertices.map(v => v.y)),
    maxY: Math.max(...region.polygon.vertices.map(v => v.y)),
  };

  const wallSegments: { p1: Vector2; p2: Vector2; wallId: string }[] = [];
  for (const wall of walls) {
    wallSegments.push({ p1: wall.start, p2: wall.end, wallId: wall.id });
  }

  const samplePoints: Vector2[] = [];
  const pointIndices: Map<string, number> = new Map();

  for (let x = bounds.minX + SAMPLE_GRID_SIZE / 2; x < bounds.maxX; x += SAMPLE_GRID_SIZE) {
    for (let y = bounds.minY + SAMPLE_GRID_SIZE / 2; y < bounds.maxY; y += SAMPLE_GRID_SIZE) {
      const point = { x, y };
      if (!pointInPolygon(point, region.polygon)) continue;

      let tooCloseToWall = false;
      for (const wall of walls) {
        if (wall.id.startsWith("board-")) continue;
        const dist = pointToSegmentDistance(point, wall.start, wall.end);
        if (dist < wall.thickness) { tooCloseToWall = true; break; }
      }
      if (tooCloseToWall) continue;

      const key = `${Math.round(x)},${Math.round(y)}`;
      pointIndices.set(key, samplePoints.length);
      samplePoints.push(point);
    }
  }

  if (samplePoints.length === 0) return [];

  const adjacency: Set<number>[] = samplePoints.map(() => new Set());

  for (let i = 0; i < samplePoints.length; i++) {
    const pi = samplePoints[i];
    const neighbors = [
      { x: pi.x + SAMPLE_GRID_SIZE, y: pi.y },
      { x: pi.x - SAMPLE_GRID_SIZE, y: pi.y },
      { x: pi.x, y: pi.y + SAMPLE_GRID_SIZE },
      { x: pi.x, y: pi.y - SAMPLE_GRID_SIZE },
      { x: pi.x + SAMPLE_GRID_SIZE, y: pi.y + SAMPLE_GRID_SIZE },
      { x: pi.x - SAMPLE_GRID_SIZE, y: pi.y + SAMPLE_GRID_SIZE },
      { x: pi.x + SAMPLE_GRID_SIZE, y: pi.y - SAMPLE_GRID_SIZE },
      { x: pi.x - SAMPLE_GRID_SIZE, y: pi.y - SAMPLE_GRID_SIZE },
    ];

    for (const n of neighbors) {
      const key = `${Math.round(n.x)},${Math.round(n.y)}`;
      const j = pointIndices.get(key);
      if (j !== undefined && j > i) {
        let blocked = false;
        for (const seg of wallSegments) {
          if (lineSegmentIntersection(pi, samplePoints[j], seg.p1, seg.p2)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) { adjacency[i].add(j); adjacency[j].add(i); }
      }
    }
  }

  const visited = new Set<number>();
  const components: { samples: Vector2[]; hasBalls: boolean }[] = [];

  for (let i = 0; i < samplePoints.length; i++) {
    if (visited.has(i)) continue;
    const component: Vector2[] = [];
    const queue = [i];
    visited.add(i);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(samplePoints[curr]);
      for (const neighbor of adjacency[curr]) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }

    let hasBalls = false;
    for (const ball of balls) {
      if (ball.state === 'won') continue;
      for (const sample of component) {
        let ballBlocked = false;
        for (const seg of wallSegments) {
          if (lineSegmentIntersection(ball.position, sample, seg.p1, seg.p2)) {
            ballBlocked = true;
            break;
          }
        }
        if (!ballBlocked) { hasBalls = true; break; }
      }
      if (hasBalls) break;
    }
    components.push({ samples: component, hasBalls });
  }

  // Fallback: if no component detected a ball (floating-point edge case), assign
  // each active ball to its nearest component by sample distance.
  if (components.length > 1 && !components.some(c => c.hasBalls)) {
    const activeBalls = balls.filter(b => b.state !== 'won');
    for (const ball of activeBalls) {
      let nearestComp = components[0];
      let nearestDist = Infinity;
      for (const comp of components) {
        for (const sample of comp.samples) {
          const d = Math.hypot(sample.x - ball.position.x, sample.y - ball.position.y);
          if (d < nearestDist) { nearestDist = d; nearestComp = comp; }
        }
      }
      nearestComp.hasBalls = true;
    }
  }

  return components;
}

export function buildPolygonFromSamples(
  samples: Vector2[],
  sampleCount: number,
): { polygon: Polygon; estimatedArea: number; samplePoints: Vector2[] } | null {
  if (samples.length < 3) return null;

  const estimatedArea = sampleCount * SAMPLE_GRID_SIZE * SAMPLE_GRID_SIZE;

  const sortedX = [...samples].sort((a, b) => a.x - b.x);
  const sortedY = [...samples].sort((a, b) => a.y - b.y);
  const padding = SAMPLE_GRID_SIZE / 2;

  return {
    polygon: {
      vertices: [
        { x: sortedX[0].x - padding,               y: sortedY[0].y - padding               },
        { x: sortedX[sortedX.length - 1].x + padding, y: sortedY[0].y - padding             },
        { x: sortedX[sortedX.length - 1].x + padding, y: sortedY[sortedY.length - 1].y + padding },
        { x: sortedX[0].x - padding,               y: sortedY[sortedY.length - 1].y + padding },
      ],
    },
    estimatedArea,
    samplePoints: samples,
  };
}
