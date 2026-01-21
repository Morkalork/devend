// Polygon geometry utilities for diagonal cutting game

export interface Vector2 {
  x: number;
  y: number;
}

export interface Polygon {
  vertices: Vector2[];
}

export interface LineSegment {
  p1: Vector2;
  p2: Vector2;
}

// Vector math utilities
export function vec2Add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Scale(v: Vector2, s: number): Vector2 {
  return { x: v.x * s, y: v.y * s };
}

export function vec2Dot(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}

export function vec2Cross(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x;
}

export function vec2Length(v: Vector2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vec2Normalize(v: Vector2): Vector2 {
  const len = vec2Length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vec2Distance(a: Vector2, b: Vector2): number {
  return vec2Length(vec2Sub(b, a));
}

export function vec2Reflect(v: Vector2, normal: Vector2): Vector2 {
  const d = 2 * vec2Dot(v, normal);
  return { x: v.x - d * normal.x, y: v.y - d * normal.y };
}

// Polygon area using shoelace formula
export function polygonArea(poly: Polygon): number {
  const { vertices } = poly;
  if (vertices.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

// Point in polygon using ray casting
export function pointInPolygon(point: Vector2, poly: Polygon): boolean {
  const { vertices } = poly;
  if (vertices.length < 3) return false;
  
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Line segment intersection - returns intersection point or null
export function lineSegmentIntersection(
  p1: Vector2, p2: Vector2, 
  p3: Vector2, p4: Vector2
): Vector2 | null {
  const d1 = vec2Sub(p2, p1);
  const d2 = vec2Sub(p4, p3);
  const d3 = vec2Sub(p1, p3);
  
  const cross = vec2Cross(d1, d2);
  if (Math.abs(cross) < 1e-10) return null; // Parallel
  
  const t = vec2Cross(d2, d3) / cross;
  const u = vec2Cross(d1, d3) / cross;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1.x + t * d1.x,
      y: p1.y + t * d1.y
    };
  }
  return null;
}

// Ray-polygon intersection - returns the intersection point and distance along ray
export function rayPolygonIntersection(
  origin: Vector2,
  direction: Vector2,
  poly: Polygon
): { point: Vector2; distance: number; edgeIndex: number } | null {
  const { vertices } = poly;
  let closestDist = Infinity;
  let closestPoint: Vector2 | null = null;
  let closestEdge = -1;
  
  // Extend ray far enough
  const rayEnd = vec2Add(origin, vec2Scale(direction, 100000));
  
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const intersection = lineSegmentIntersection(
      origin, rayEnd,
      vertices[i], vertices[j]
    );
    
    if (intersection) {
      const dist = vec2Distance(origin, intersection);
      // Only consider intersections in the ray direction (positive distance)
      const toIntersection = vec2Sub(intersection, origin);
      if (vec2Dot(toIntersection, direction) > 0 && dist < closestDist && dist > 0.1) {
        closestDist = dist;
        closestPoint = intersection;
        closestEdge = i;
      }
    }
  }
  
  if (closestPoint) {
    return { point: closestPoint, distance: closestDist, edgeIndex: closestEdge };
  }
  return null;
}

// Get edge normal (pointing inward for CCW polygon)
export function getEdgeNormal(p1: Vector2, p2: Vector2): Vector2 {
  const edge = vec2Sub(p2, p1);
  // Rotate 90 degrees CCW for inward normal
  return vec2Normalize({ x: -edge.y, y: edge.x });
}

// Distance from point to line segment
export function pointToSegmentDistance(point: Vector2, p1: Vector2, p2: Vector2): number {
  const edge = vec2Sub(p2, p1);
  const edgeLengthSq = edge.x * edge.x + edge.y * edge.y;
  
  if (edgeLengthSq === 0) return vec2Distance(point, p1);
  
  const t = Math.max(0, Math.min(1, vec2Dot(vec2Sub(point, p1), edge) / edgeLengthSq));
  const projection = vec2Add(p1, vec2Scale(edge, t));
  return vec2Distance(point, projection);
}

// Closest point on segment to point
export function closestPointOnSegment(point: Vector2, p1: Vector2, p2: Vector2): Vector2 {
  const edge = vec2Sub(p2, p1);
  const edgeLengthSq = edge.x * edge.x + edge.y * edge.y;
  
  if (edgeLengthSq === 0) return { ...p1 };
  
  const t = Math.max(0, Math.min(1, vec2Dot(vec2Sub(point, p1), edge) / edgeLengthSq));
  return vec2Add(p1, vec2Scale(edge, t));
}

// Check if a circle (ball) overlaps a line segment (capsule collision)
export function circleCapsuleCollision(
  circleCenter: Vector2,
  circleRadius: number,
  segmentP1: Vector2,
  segmentP2: Vector2,
  capsuleRadius: number
): boolean {
  const dist = pointToSegmentDistance(circleCenter, segmentP1, segmentP2);
  return dist < (circleRadius + capsuleRadius);
}

// Split a polygon along a line defined by two points
// IMPORTANT: Uses the ACTUAL cut endpoints, not extended lines.
// This allows cuts that end on obstacles to work correctly.
export function splitPolygon(
  poly: Polygon,
  cutStart: Vector2,
  cutEnd: Vector2
): [Polygon, Polygon] | null {
  const { vertices } = poly;
  if (vertices.length < 3) return null;
  
  // Find intersection points between cut segment and polygon edges
  const intersections: { point: Vector2; edgeIndex: number; t: number }[] = [];
  
  // Check if cutStart is on a polygon edge
  const startOnEdge = findPointOnPolygonEdge(cutStart, poly);
  // Check if cutEnd is on a polygon edge
  const endOnEdge = findPointOnPolygonEdge(cutEnd, poly);
  
  // If both endpoints are on polygon edges, use them directly
  if (startOnEdge !== null && endOnEdge !== null) {
    intersections.push({ point: { ...cutStart }, edgeIndex: startOnEdge.edgeIndex, t: startOnEdge.t });
    intersections.push({ point: { ...cutEnd }, edgeIndex: endOnEdge.edgeIndex, t: endOnEdge.t });
  } else {
    // Fall back to line intersection for cuts that go through the polygon
    const cutDir = vec2Sub(cutEnd, cutStart);
    const lineP1 = vec2Sub(cutStart, vec2Scale(cutDir, 1000));
    const lineP2 = vec2Add(cutEnd, vec2Scale(cutDir, 1000));
    
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const intersection = lineSegmentIntersection(
        lineP1, lineP2,
        vertices[i], vertices[j]
      );
      
      if (intersection) {
        const edge = vec2Sub(vertices[j], vertices[i]);
        const edgeLen = vec2Length(edge);
        const toInt = vec2Sub(intersection, vertices[i]);
        const t = edgeLen > 0 ? vec2Length(toInt) / edgeLen : 0;
        
        intersections.push({ point: intersection, edgeIndex: i, t });
      }
    }
  }
  
  // We need exactly 2 intersection points to split
  if (intersections.length !== 2) return null;
  
  // Sort by edge index, then by t
  intersections.sort((a, b) => {
    if (a.edgeIndex !== b.edgeIndex) return a.edgeIndex - b.edgeIndex;
    return a.t - b.t;
  });
  
  const [int1, int2] = intersections;
  
  // Build two polygons by walking around the original
  const poly1Vertices: Vector2[] = [];
  const poly2Vertices: Vector2[] = [];
  
  // Polygon 1: from int1 along edges to int2, then back via cut
  poly1Vertices.push({ ...int1.point });
  
  let i = (int1.edgeIndex + 1) % vertices.length;
  while (i !== (int2.edgeIndex + 1) % vertices.length) {
    poly1Vertices.push({ ...vertices[i] });
    i = (i + 1) % vertices.length;
  }
  poly1Vertices.push({ ...int2.point });
  
  // Polygon 2: from int2 along edges to int1, then back via cut
  poly2Vertices.push({ ...int2.point });
  
  i = (int2.edgeIndex + 1) % vertices.length;
  while (i !== (int1.edgeIndex + 1) % vertices.length) {
    poly2Vertices.push({ ...vertices[i] });
    i = (i + 1) % vertices.length;
  }
  poly2Vertices.push({ ...int1.point });
  
  // Validate both polygons have at least 3 vertices
  if (poly1Vertices.length < 3 || poly2Vertices.length < 3) return null;
  
  return [
    { vertices: poly1Vertices },
    { vertices: poly2Vertices }
  ];
}

// Helper: Find if a point lies on a polygon edge, returns edge index and t value
function findPointOnPolygonEdge(
  point: Vector2,
  poly: Polygon,
  tolerance: number = 5
): { edgeIndex: number; t: number } | null {
  const { vertices } = poly;
  
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const dist = pointToSegmentDistance(point, vertices[i], vertices[j]);
    
    if (dist <= tolerance) {
      const edge = vec2Sub(vertices[j], vertices[i]);
      const edgeLen = vec2Length(edge);
      if (edgeLen < 0.001) continue;
      
      const toPoint = vec2Sub(point, vertices[i]);
      const t = vec2Dot(toPoint, edge) / (edgeLen * edgeLen);
      
      // Only valid if t is within [0, 1] (point is on the segment)
      if (t >= -0.01 && t <= 1.01) {
        return { edgeIndex: i, t: Math.max(0, Math.min(1, t)) };
      }
    }
  }
  
  return null;
}

// Get bounding box of polygon
export function polygonBounds(poly: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  const { vertices } = poly;
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  
  return { minX, minY, maxX, maxY };
}

// Get polygon centroid
export function polygonCentroid(poly: Polygon): Vector2 {
  const { vertices } = poly;
  let cx = 0, cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / vertices.length, y: cy / vertices.length };
}

// Create a rectangle polygon (CCW winding)
export function createRectPolygon(left: number, top: number, right: number, bottom: number): Polygon {
  return {
    vertices: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ]
  };
}

// Polygon boolean subtraction using Sutherland-Hodgman clipping
// Returns array of resulting polygons (may be multiple if obstacle splits region)
export function subtractPolygon(
  subject: Polygon,
  clip: Polygon
): Polygon[] {
  // For game purposes, we use a simpler approach:
  // Create a polygon with the obstacle as a "hole" by connecting edges
  // This works because our obstacles are simple convex shapes
  
  const subjectVerts = subject.vertices;
  const clipVerts = clip.vertices;
  
  if (subjectVerts.length < 3 || clipVerts.length < 3) return [subject];
  
  // Check if clip polygon is entirely inside subject
  let allInside = true;
  for (const v of clipVerts) {
    if (!pointInPolygon(v, subject)) {
      allInside = false;
      break;
    }
  }
  
  if (!allInside) {
    // Clip polygon is not fully inside subject, return original
    return [subject];
  }
  
  // Find the closest pair of vertices between subject and clip
  let minDist = Infinity;
  let subjectIdx = 0;
  let clipIdx = 0;
  
  for (let i = 0; i < subjectVerts.length; i++) {
    for (let j = 0; j < clipVerts.length; j++) {
      const dist = vec2Distance(subjectVerts[i], clipVerts[j]);
      if (dist < minDist) {
        minDist = dist;
        subjectIdx = i;
        clipIdx = j;
      }
    }
  }
  
  // Create new polygon by walking: subject to bridge point, around clip (reversed), back to subject
  const result: Vector2[] = [];
  
  // Walk subject from 0 to bridge point
  for (let i = 0; i <= subjectIdx; i++) {
    result.push({ ...subjectVerts[i] });
  }
  
  // Walk clip in reverse (to create hole winding)
  for (let i = 0; i < clipVerts.length; i++) {
    const idx = (clipIdx - i + clipVerts.length) % clipVerts.length;
    result.push({ ...clipVerts[idx] });
  }
  
  // Close the bridge back
  result.push({ ...clipVerts[clipIdx] });
  result.push({ ...subjectVerts[subjectIdx] });
  
  // Continue subject from bridge point to end
  for (let i = subjectIdx + 1; i < subjectVerts.length; i++) {
    result.push({ ...subjectVerts[i] });
  }
  
  return [{ vertices: result }];
}

// Create polygon from entity shape definition
export function createPolygonFromShape(
  shape: "rect" | "polygon",
  params: { x?: number; y?: number; width?: number; height?: number; points?: [number, number][] }
): Polygon {
  if (shape === "rect" && params.x !== undefined && params.y !== undefined && 
      params.width !== undefined && params.height !== undefined) {
    return createRectPolygon(
      params.x,
      params.y,
      params.x + params.width,
      params.y + params.height
    );
  } else if (shape === "polygon" && params.points) {
    return {
      vertices: params.points.map(([x, y]) => ({ x, y }))
    };
  }
  return { vertices: [] };
}

// Ball collision with polygon edges (ball INSIDE polygon, bounces off edges)
export function resolveBallPolygonCollision(
  ballPos: Vector2,
  ballVel: Vector2,
  ballRadius: number,
  poly: Polygon
): { position: Vector2; velocity: Vector2; collided: boolean } {
  const { vertices } = poly;
  let newPos = { ...ballPos };
  let newVel = { ...ballVel };
  let collided = false;
  
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const p1 = vertices[i];
    const p2 = vertices[j];
    
    const dist = pointToSegmentDistance(newPos, p1, p2);
    
    if (dist < ballRadius) {
      collided = true;
      
      // Get edge normal
      const edge = vec2Sub(p2, p1);
      // Normal pointing into polygon (left of edge direction)
      let normal = vec2Normalize({ x: -edge.y, y: edge.x });
      
      // Check if normal points towards ball
      const closestPoint = closestPointOnSegment(newPos, p1, p2);
      const toBall = vec2Sub(newPos, closestPoint);
      if (vec2Dot(toBall, normal) < 0) {
        normal = vec2Scale(normal, -1);
      }
      
      // Reflect velocity
      const velDotNormal = vec2Dot(newVel, normal);
      if (velDotNormal < 0) {
        newVel = vec2Sub(newVel, vec2Scale(normal, 2 * velDotNormal));
      }
      
      // Push ball out
      const penetration = ballRadius - dist;
      newPos = vec2Add(newPos, vec2Scale(normal, penetration + 0.5));
    }
  }
  
  return { position: newPos, velocity: newVel, collided };
}

// Ball collision with polygon edges (ball OUTSIDE polygon, bounces off obstacle)
// Used for obstacles where balls are on the outside and bounce off
export function resolveBallPolygonCollisionOutward(
  ballPos: Vector2,
  ballVel: Vector2,
  ballRadius: number,
  poly: Polygon
): { position: Vector2; velocity: Vector2; collided: boolean } {
  const { vertices } = poly;
  let newPos = { ...ballPos };
  let newVel = { ...ballVel };
  let collided = false;
  
  // First check if ball center is inside the obstacle (shouldn't happen, but handle it)
  if (pointInPolygon(newPos, poly)) {
    // Ball is inside obstacle - push it out toward the nearest edge
    let minDist = Infinity;
    let nearestEdgeNormal: Vector2 = { x: 0, y: -1 };
    let nearestClosestPoint: Vector2 = newPos;
    
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const p1 = vertices[i];
      const p2 = vertices[j];
      const closest = closestPointOnSegment(newPos, p1, p2);
      const dist = vec2Distance(newPos, closest);
      
      if (dist < minDist) {
        minDist = dist;
        nearestClosestPoint = closest;
        const edge = vec2Sub(p2, p1);
        // Normal pointing outward from polygon
        nearestEdgeNormal = vec2Normalize({ x: -edge.y, y: edge.x });
      }
    }
    
    // Push ball completely outside
    newPos = vec2Add(nearestClosestPoint, vec2Scale(nearestEdgeNormal, ballRadius + 2));
    
    // Reflect velocity
    const velDotNormal = vec2Dot(newVel, nearestEdgeNormal);
    if (velDotNormal < 0) {
      newVel = vec2Sub(newVel, vec2Scale(nearestEdgeNormal, 2 * velDotNormal));
    }
    
    return { position: newPos, velocity: newVel, collided: true };
  }
  
  // Normal edge collision detection
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const p1 = vertices[i];
    const p2 = vertices[j];
    
    const dist = pointToSegmentDistance(newPos, p1, p2);
    
    if (dist < ballRadius) {
      collided = true;
      
      // Get closest point on edge
      const closestPoint = closestPointOnSegment(newPos, p1, p2);
      const toBall = vec2Sub(newPos, closestPoint);
      
      // Normal points from obstacle edge toward ball (outward)
      let normal = vec2Normalize(toBall);
      if (vec2Length(toBall) < 0.001) {
        // Ball exactly on edge, use edge perpendicular
        const edge = vec2Sub(p2, p1);
        normal = vec2Normalize({ x: -edge.y, y: edge.x });
      }
      
      // Reflect velocity if moving toward obstacle
      const velDotNormal = vec2Dot(newVel, normal);
      if (velDotNormal < 0) {
        newVel = vec2Sub(newVel, vec2Scale(normal, 2 * velDotNormal));
      }
      
      // Push ball out of obstacle with extra margin
      const penetration = ballRadius - dist;
      newPos = vec2Add(newPos, vec2Scale(normal, penetration + 2));
    }
  }
  
  return { position: newPos, velocity: newVel, collided };
}

/**
 * Clips a line segment against multiple polygons, returning only the portions
 * that are OUTSIDE all polygons. Used to avoid rendering fences inside obstacles.
 */
export function clipLineAgainstPolygons(
  start: Vector2,
  end: Vector2,
  polygons: Polygon[]
): { start: Vector2; end: Vector2 }[] {
  // Collect all intersection t-values along the line
  type Event = { t: number; entering: boolean; polyIndex: number };
  const events: Event[] = [];
  
  const dir = vec2Sub(end, start);
  const lineLen = vec2Length(dir);
  if (lineLen < 0.01) return []; // Degenerate line
  
  // Check start and end points
  for (let pi = 0; pi < polygons.length; pi++) {
    const poly = polygons[pi];
    const startInside = pointInPolygon(start, poly);
    const endInside = pointInPolygon(end, poly);
    
    // Find all intersections with this polygon
    const { vertices } = poly;
    const intersections: { t: number; entering: boolean }[] = [];
    
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const intersection = lineSegmentIntersection(start, end, vertices[i], vertices[j]);
      if (intersection) {
        // Calculate t parameter (0 to 1 along the line)
        const t = vec2Distance(start, intersection) / lineLen;
        if (t > 0.001 && t < 0.999) {
          // Determine if entering or exiting based on edge normal
          const edgeDir = vec2Sub(vertices[j], vertices[i]);
          const edgeNormal = { x: -edgeDir.y, y: edgeDir.x };
          const entering = vec2Dot(dir, edgeNormal) > 0;
          intersections.push({ t, entering });
        }
      }
    }
    
    // Sort intersections by t
    intersections.sort((a, b) => a.t - b.t);
    
    // Add events for this polygon
    if (startInside) {
      events.push({ t: 0, entering: true, polyIndex: pi });
    }
    for (const int of intersections) {
      events.push({ t: int.t, entering: int.entering, polyIndex: pi });
    }
  }
  
  // Sort all events by t
  events.sort((a, b) => a.t - b.t);
  
  // Track which polygons we're inside
  const insideCount = new Map<number, number>();
  for (let pi = 0; pi < polygons.length; pi++) {
    if (pointInPolygon(start, polygons[pi])) {
      insideCount.set(pi, 1);
    } else {
      insideCount.set(pi, 0);
    }
  }
  
  const isInsideAny = () => {
    for (const count of insideCount.values()) {
      if (count > 0) return true;
    }
    return false;
  };
  
  // Build result segments
  const segments: { start: Vector2; end: Vector2 }[] = [];
  let segmentStart: number | null = isInsideAny() ? null : 0;
  
  for (const event of events) {
    const wasInside = isInsideAny();
    
    // Update state
    const current = insideCount.get(event.polyIndex) || 0;
    if (event.entering) {
      insideCount.set(event.polyIndex, current + 1);
    } else {
      insideCount.set(event.polyIndex, Math.max(0, current - 1));
    }
    
    const nowInside = isInsideAny();
    
    if (!wasInside && nowInside && segmentStart !== null) {
      // Entered an obstacle - end current segment
      const segEnd = {
        x: start.x + dir.x * event.t,
        y: start.y + dir.y * event.t,
      };
      const segStart = {
        x: start.x + dir.x * segmentStart,
        y: start.y + dir.y * segmentStart,
      };
      if (vec2Distance(segStart, segEnd) > 1) {
        segments.push({ start: segStart, end: segEnd });
      }
      segmentStart = null;
    } else if (wasInside && !nowInside) {
      // Exited all obstacles - start new segment
      segmentStart = event.t;
    }
  }
  
  // Close final segment if we ended outside
  if (segmentStart !== null) {
    const segStart = {
      x: start.x + dir.x * segmentStart,
      y: start.y + dir.y * segmentStart,
    };
    if (vec2Distance(segStart, end) > 1) {
      segments.push({ start: segStart, end });
    }
  }
  
  return segments;
}
