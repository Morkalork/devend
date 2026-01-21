// Contour extraction from grid-based sample points
// Extracts continuous border paths for uniform thickness rendering

import { Vector2 } from "./polygon";

interface EdgeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  key: string;
}

/**
 * Extracts continuous contour paths from sample points grid.
 * Returns arrays of connected vertices forming closed or open paths.
 */
export function extractContours(
  samplePoints: Vector2[],
  gridSize: number
): Vector2[][] {
  if (samplePoints.length === 0) return [];

  const halfGrid = gridSize / 2;
  const sampleSet = new Set(samplePoints.map((s) => `${s.x},${s.y}`));

  // Collect all edge segments (edges between filled and empty cells)
  const edgeMap = new Map<string, EdgeSegment>();

  for (const sample of samplePoints) {
    const neighbors = {
      left: { key: `${sample.x - gridSize},${sample.y}`, dx: -1, dy: 0 },
      right: { key: `${sample.x + gridSize},${sample.y}`, dx: 1, dy: 0 },
      top: { key: `${sample.x},${sample.y - gridSize}`, dx: 0, dy: -1 },
      bottom: { key: `${sample.x},${sample.y + gridSize}`, dx: 0, dy: 1 },
    };

    const cellLeft = sample.x - halfGrid;
    const cellRight = sample.x + halfGrid;
    const cellTop = sample.y - halfGrid;
    const cellBottom = sample.y + halfGrid;

    // For each missing neighbor, add an edge segment
    if (!sampleSet.has(neighbors.left.key)) {
      const key = `${cellLeft},${cellTop}-${cellLeft},${cellBottom}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { x1: cellLeft, y1: cellTop, x2: cellLeft, y2: cellBottom, key });
      }
    }
    if (!sampleSet.has(neighbors.right.key)) {
      const key = `${cellRight},${cellTop}-${cellRight},${cellBottom}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { x1: cellRight, y1: cellTop, x2: cellRight, y2: cellBottom, key });
      }
    }
    if (!sampleSet.has(neighbors.top.key)) {
      const key = `${cellLeft},${cellTop}-${cellRight},${cellTop}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { x1: cellLeft, y1: cellTop, x2: cellRight, y2: cellTop, key });
      }
    }
    if (!sampleSet.has(neighbors.bottom.key)) {
      const key = `${cellLeft},${cellBottom}-${cellRight},${cellBottom}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { x1: cellLeft, y1: cellBottom, x2: cellRight, y2: cellBottom, key });
      }
    }
  }

  if (edgeMap.size === 0) return [];

  // Build adjacency: point -> list of segments that include this point
  const pointToSegments = new Map<string, EdgeSegment[]>();

  for (const segment of edgeMap.values()) {
    const p1Key = `${segment.x1},${segment.y1}`;
    const p2Key = `${segment.x2},${segment.y2}`;

    if (!pointToSegments.has(p1Key)) pointToSegments.set(p1Key, []);
    if (!pointToSegments.has(p2Key)) pointToSegments.set(p2Key, []);

    pointToSegments.get(p1Key)!.push(segment);
    pointToSegments.get(p2Key)!.push(segment);
  }

  // Trace contours by following connected segments
  const usedSegments = new Set<string>();
  const contours: Vector2[][] = [];

  for (const startSegment of edgeMap.values()) {
    if (usedSegments.has(startSegment.key)) continue;

    const contour: Vector2[] = [];
    let currentSegment = startSegment;
    let currentPoint = { x: startSegment.x1, y: startSegment.y1 };

    contour.push({ ...currentPoint });
    usedSegments.add(currentSegment.key);

    // Move to the other end of the segment
    if (currentPoint.x === currentSegment.x1 && currentPoint.y === currentSegment.y1) {
      currentPoint = { x: currentSegment.x2, y: currentSegment.y2 };
    } else {
      currentPoint = { x: currentSegment.x1, y: currentSegment.y1 };
    }
    contour.push({ ...currentPoint });

    // Continue tracing
    let safety = edgeMap.size + 10;
    while (safety-- > 0) {
      const pointKey = `${currentPoint.x},${currentPoint.y}`;
      const connectedSegments = pointToSegments.get(pointKey) || [];

      // Find an unused segment connected to this point
      let nextSegment: EdgeSegment | null = null;
      for (const seg of connectedSegments) {
        if (!usedSegments.has(seg.key)) {
          nextSegment = seg;
          break;
        }
      }

      if (!nextSegment) break; // End of path

      usedSegments.add(nextSegment.key);

      // Move to the other end of the next segment
      if (currentPoint.x === nextSegment.x1 && currentPoint.y === nextSegment.y1) {
        currentPoint = { x: nextSegment.x2, y: nextSegment.y2 };
      } else {
        currentPoint = { x: nextSegment.x1, y: nextSegment.y1 };
      }

      // Check if we've returned to start (closed contour)
      const firstPoint = contour[0];
      if (Math.abs(currentPoint.x - firstPoint.x) < 0.1 && Math.abs(currentPoint.y - firstPoint.y) < 0.1) {
        break; // Closed loop
      }

      contour.push({ ...currentPoint });
    }

    if (contour.length >= 3) {
      // Simplify contour by merging collinear segments
      const simplified = simplifyContour(contour);
      contours.push(simplified);
    }
  }

  return contours;
}

/**
 * Simplifies a contour by removing collinear points
 */
function simplifyContour(contour: Vector2[]): Vector2[] {
  if (contour.length <= 2) return contour;

  const simplified: Vector2[] = [contour[0]];

  for (let i = 1; i < contour.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = contour[i];
    const next = contour[i + 1];

    // Check if prev, curr, next are collinear
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // If direction changes, keep the point
    const sameDirection = 
      (Math.abs(dx1) < 0.1 && Math.abs(dx2) < 0.1) || // Both vertical
      (Math.abs(dy1) < 0.1 && Math.abs(dy2) < 0.1);   // Both horizontal

    if (!sameDirection) {
      simplified.push(curr);
    }
  }

  // Add last point
  simplified.push(contour[contour.length - 1]);

  return simplified;
}
