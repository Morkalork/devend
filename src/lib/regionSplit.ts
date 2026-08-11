import {
  Polygon,
  Vector2,
  pointInPolygon,
  pointToSegmentDistance,
  lineSegmentIntersection,
} from "@/lib/polygon";
import { Ball, Region } from "@/types/game";
import { Wall } from "@/lib/wallGeometry";
import { WallGrid, queryWallsNear } from "@/lib/physics/wallGrid";

export const SAMPLE_GRID_SIZE = 15;

/**
 * Split a region into connected sub-regions by sampling it on a grid.
 *
 * PERFORMANCE. This is the single most expensive thing the game does: profiled
 * on a mid-range phone the whole cut pass ran 95-145ms, and ~90% of it was here.
 * The reason is that all three passes below were O(samples x WALLS), and walls
 * accumulate all map long - every fence segment ever drawn stays in the list -
 * so the cost grows quadratically as a map fills up, which is exactly when the
 * player is cutting most.
 *
 * `index` fixes the two passes whose tests are LOCAL (a sample against nearby
 * wall thickness; a sample against its 8 immediate neighbours): a spatial query
 * turns "every wall on the board" into "the two or three that could possibly
 * matter". Pass it whenever one is available; without it the behaviour is
 * identical, just slower.
 *
 * The third pass (ball-to-sample line of sight) spans the whole region and can't
 * be answered by a local query, so it gets a different fix - see below.
 */
export function findSubRegionsGrid(
  region: Region,
  balls: Ball[],
  walls: Wall[],
  index?: WallGrid | null,
): { samples: Vector2[]; hasBalls: boolean }[] {
  const bounds = {
    minX: Math.min(...region.polygon.vertices.map(v => v.x)),
    maxX: Math.max(...region.polygon.vertices.map(v => v.x)),
    minY: Math.min(...region.polygon.vertices.map(v => v.y)),
    maxY: Math.max(...region.polygon.vertices.map(v => v.y)),
  };

  const wallSegments: { p1: Vector2; p2: Vector2; wallId: string }[] = [];
  let maxThickness = 0;
  for (const wall of walls) {
    wallSegments.push({ p1: wall.start, p2: wall.end, wallId: wall.id });
    if (wall.thickness > maxThickness) maxThickness = wall.thickness;
  }
  // Reused across every spatial query below; never held across two queries.
  const scratch: Wall[] = [];

  const samplePoints: Vector2[] = [];
  const pointIndices: Map<string, number> = new Map();

  for (let x = bounds.minX + SAMPLE_GRID_SIZE / 2; x < bounds.maxX; x += SAMPLE_GRID_SIZE) {
    for (let y = bounds.minY + SAMPLE_GRID_SIZE / 2; y < bounds.maxY; y += SAMPLE_GRID_SIZE) {
      const point = { x, y };
      if (!pointInPolygon(point, region.polygon)) continue;

      // Only walls within the thickest wall's reach can possibly fail this.
      let tooCloseToWall = false;
      for (const wall of index ? queryWallsNear(index, x, y, maxThickness, scratch) : walls) {
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

    // Every neighbour is within one diagonal step, so ONE query around `pi`
    // covers all eight edges. Queried per sample rather than per edge: the
    // scratch array is reused, so it must not be re-queried mid-loop.
    const local = index
      ? queryWallsNear(index, pi.x, pi.y, SAMPLE_GRID_SIZE * 1.5, scratch)
      : walls;

    for (const n of neighbors) {
      const key = `${Math.round(n.x)},${Math.round(n.y)}`;
      const j = pointIndices.get(key);
      if (j !== undefined && j > i) {
        let blocked = false;
        for (const seg of local) {
          if (lineSegmentIntersection(pi, samplePoints[j], seg.start, seg.end)) {
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
    let qh = 0; // head pointer: Array.shift() is O(n), so this BFS was O(n^2)
    visited.add(i);
    while (qh < queue.length) {
      const curr = queue[qh++];
      component.push(samplePoints[curr]);
      for (const neighbor of adjacency[curr]) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }

    // Does any live ball have line of sight into this component?
    //
    // These segments span the region, so a local wall query cannot answer them.
    // Instead, try the sample NEAREST the ball first: a ball standing in its own
    // component can nearly always see its closest sample, so the answer usually
    // costs one visibility test instead of scanning every sample against every
    // wall. Only when that nearest sample is blocked does it fall back to the
    // exhaustive scan, so the result is unchanged - just reached sooner.
    const visible = (from: Vector2, to: Vector2): boolean => {
      for (const seg of wallSegments) {
        if (lineSegmentIntersection(from, to, seg.p1, seg.p2)) return false;
      }
      return true;
    };

    let hasBalls = false;
    for (const ball of balls) {
      if (ball.state === 'won') continue;

      let nearest = component[0];
      let bestD = Infinity;
      for (const sample of component) {
        const d = (sample.x - ball.position.x) ** 2 + (sample.y - ball.position.y) ** 2;
        if (d < bestD) { bestD = d; nearest = sample; }
      }
      if (nearest && visible(ball.position, nearest)) { hasBalls = true; break; }

      for (const sample of component) {
        if (sample !== nearest && visible(ball.position, sample)) { hasBalls = true; break; }
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
