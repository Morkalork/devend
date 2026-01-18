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
// IMPORTANT: Both endpoints must be on the polygon boundary for a valid split.
// If an endpoint is inside (e.g., at a wall obstacle), no split occurs.
export function splitPolygon(
  poly: Polygon,
  cutStart: Vector2,
  cutEnd: Vector2
): [Polygon, Polygon] | null {
  const { vertices } = poly;
  if (vertices.length < 3) return null;
  
  // Find where cutStart and cutEnd intersect the polygon boundary
  // Both must be on the boundary for a valid split
  const intersections: { point: Vector2; edgeIndex: number; t: number }[] = [];
  
  // Tolerance for checking if a point is on an edge (world units)
  // Generous tolerance to handle floating point imprecision from ray intersections
  const EDGE_TOLERANCE = 10;
  
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const p1 = vertices[i];
    const p2 = vertices[j];
    const edge = vec2Sub(p2, p1);
    const edgeLen = vec2Length(edge);
    
    // Check if cutStart is on this edge
    const distStart = pointToSegmentDistance(cutStart, p1, p2);
    if (distStart < EDGE_TOLERANCE) {
      const toPoint = vec2Sub(cutStart, p1);
      const t = edgeLen > 0 ? vec2Dot(toPoint, vec2Normalize(edge)) / edgeLen : 0;
      if (t >= -0.05 && t <= 1.05) {
        // Check if we already have this point
        const alreadyHasStart = intersections.some(
          int => vec2Distance(int.point, cutStart) < EDGE_TOLERANCE
        );
        if (!alreadyHasStart) {
          intersections.push({ 
            point: { ...cutStart }, 
            edgeIndex: i, 
            t: Math.max(0, Math.min(1, t)) 
          });
        }
      }
    }
    
    // Check if cutEnd is on this edge
    const distEnd = pointToSegmentDistance(cutEnd, p1, p2);
    if (distEnd < EDGE_TOLERANCE) {
      const toPoint = vec2Sub(cutEnd, p1);
      const t = edgeLen > 0 ? vec2Dot(toPoint, vec2Normalize(edge)) / edgeLen : 0;
      if (t >= -0.05 && t <= 1.05) {
        // Check if we already have this point
        const alreadyHasEnd = intersections.some(
          int => vec2Distance(int.point, cutEnd) < EDGE_TOLERANCE
        );
        if (!alreadyHasEnd) {
          intersections.push({ 
            point: { ...cutEnd }, 
            edgeIndex: i, 
            t: Math.max(0, Math.min(1, t)) 
          });
        }
      }
    }
  }
  
  // If we still don't have 2 intersections, try segment-segment intersection as fallback
  // Extend the segment slightly beyond endpoints to catch floating point edge cases
  // BUT only accept intersections that are close to the original cut endpoints
  if (intersections.length < 2) {
    const cutDir = vec2Sub(cutEnd, cutStart);
    const cutLen = vec2Length(cutDir);
    if (cutLen > 0) {
      const normalizedDir = vec2Scale(cutDir, 1 / cutLen);
      // Extend slightly beyond each endpoint for intersection detection
      const extendedStart = vec2Sub(cutStart, vec2Scale(normalizedDir, 15));
      const extendedEnd = vec2Add(cutEnd, vec2Scale(normalizedDir, 15));
      
      for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        const intersection = lineSegmentIntersection(
          extendedStart, extendedEnd,
          vertices[i], vertices[j]
        );
        
        if (intersection) {
          // Only accept if intersection is near one of the original endpoints
          const distToStart = vec2Distance(intersection, cutStart);
          const distToEnd = vec2Distance(intersection, cutEnd);
          const nearEndpoint = distToStart < EDGE_TOLERANCE * 2 || distToEnd < EDGE_TOLERANCE * 2;
          
          if (nearEndpoint) {
            const edge = vec2Sub(vertices[j], vertices[i]);
            const edgeLen = vec2Length(edge);
            const toInt = vec2Sub(intersection, vertices[i]);
            const t = edgeLen > 0 ? vec2Length(toInt) / edgeLen : 0;
            
            // Check if we already have a nearby point
            const alreadyHas = intersections.some(
              int => vec2Distance(int.point, intersection) < EDGE_TOLERANCE
            );
            if (!alreadyHas) {
              intersections.push({ point: intersection, edgeIndex: i, t });
            }
          }
        }
      }
    }
  }
  
  // We need exactly 2 intersection points to split
  // If we don't have 2, it means one endpoint is inside the polygon (at a wall)
  // In that case, no split should occur
  if (intersections.length !== 2) return null;
  
  // Remove duplicate intersections (same edge, very close t values)
  if (intersections[0].edgeIndex === intersections[1].edgeIndex &&
      Math.abs(intersections[0].t - intersections[1].t) < 0.01) {
    return null;
  }
  
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
      
      // Push ball out of obstacle
      const penetration = ballRadius - dist;
      newPos = vec2Add(newPos, vec2Scale(normal, penetration + 0.5));
    }
  }
  
  return { position: newPos, velocity: newVel, collided };
}
