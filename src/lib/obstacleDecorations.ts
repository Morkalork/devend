// Obstacle decoration utilities - adds bumps, spikes, and growths to obstacle edges
// These decorations make obstacles look more organic and varied

import { Polygon, Vector2, vec2Add, vec2Sub, vec2Scale, vec2Normalize, vec2Length, vec2Distance } from './polygon';

export type DecorationType = 'bump' | 'spike' | 'tooth' | 'wave';

export interface DecorationConfig {
  type: DecorationType;
  density: number; // Average number of decorations per 100 world units of edge
  minSize: number; // Minimum decoration size in world units
  maxSize: number; // Maximum decoration size in world units
  seed: number; // Random seed for reproducibility
}

// Seeded random for consistent decoration placement
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Get perpendicular (outward) normal for an edge
function getOutwardNormal(p1: Vector2, p2: Vector2, centroid: Vector2): Vector2 {
  const edge = vec2Sub(p2, p1);
  const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  
  // Two possible perpendiculars
  const perp1 = vec2Normalize({ x: -edge.y, y: edge.x });
  const perp2 = vec2Normalize({ x: edge.y, y: -edge.x });
  
  // Choose the one pointing away from centroid
  const toCentroid = vec2Sub(centroid, midpoint);
  if (vec2Length(toCentroid) < 0.001) return perp1;
  
  const dot1 = perp1.x * toCentroid.x + perp1.y * toCentroid.y;
  return dot1 < 0 ? perp1 : perp2;
}

// Add a single bump to an edge - returns vertices to insert
function createBump(
  p1: Vector2,
  p2: Vector2,
  t: number, // Position along edge (0-1)
  size: number,
  outwardNormal: Vector2
): Vector2[] {
  const edge = vec2Sub(p2, p1);
  const basePoint = vec2Add(p1, vec2Scale(edge, t));
  
  // Create a smooth bump with 3 points
  const halfWidth = size * 0.6;
  const edgeDir = vec2Normalize(edge);
  
  const leftBase = vec2Add(basePoint, vec2Scale(edgeDir, -halfWidth));
  const rightBase = vec2Add(basePoint, vec2Scale(edgeDir, halfWidth));
  const peak = vec2Add(basePoint, vec2Scale(outwardNormal, size));
  
  return [leftBase, peak, rightBase];
}

// Add a spike to an edge - returns vertices to insert
function createSpike(
  p1: Vector2,
  p2: Vector2,
  t: number,
  size: number,
  outwardNormal: Vector2
): Vector2[] {
  const edge = vec2Sub(p2, p1);
  const basePoint = vec2Add(p1, vec2Scale(edge, t));
  
  // Create a sharp spike with 3 points
  const halfWidth = size * 0.25; // Narrow base
  const edgeDir = vec2Normalize(edge);
  
  const leftBase = vec2Add(basePoint, vec2Scale(edgeDir, -halfWidth));
  const rightBase = vec2Add(basePoint, vec2Scale(edgeDir, halfWidth));
  const peak = vec2Add(basePoint, vec2Scale(outwardNormal, size * 1.2));
  
  return [leftBase, peak, rightBase];
}

// Add a tooth (asymmetric bump) - returns vertices to insert
function createTooth(
  p1: Vector2,
  p2: Vector2,
  t: number,
  size: number,
  outwardNormal: Vector2,
  random: () => number
): Vector2[] {
  const edge = vec2Sub(p2, p1);
  const basePoint = vec2Add(p1, vec2Scale(edge, t));
  
  const baseWidth = size * 0.5;
  const edgeDir = vec2Normalize(edge);
  
  // Asymmetric offsets
  const leftOffset = baseWidth * (0.5 + random() * 0.5);
  const rightOffset = baseWidth * (0.5 + random() * 0.5);
  
  const leftBase = vec2Add(basePoint, vec2Scale(edgeDir, -leftOffset));
  const rightBase = vec2Add(basePoint, vec2Scale(edgeDir, rightOffset));
  
  // Peaked slightly off-center
  const peakOffset = (random() - 0.5) * baseWidth * 0.4;
  const peakBase = vec2Add(basePoint, vec2Scale(edgeDir, peakOffset));
  const peak = vec2Add(peakBase, vec2Scale(outwardNormal, size * (0.7 + random() * 0.3)));
  
  return [leftBase, peak, rightBase];
}

// Add wave undulation along an edge - modifies the edge with multiple points
function createWave(
  p1: Vector2,
  p2: Vector2,
  amplitude: number,
  outwardNormal: Vector2,
  segments: number,
  phase: number
): Vector2[] {
  const points: Vector2[] = [];
  
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const edge = vec2Sub(p2, p1);
    const point = vec2Add(p1, vec2Scale(edge, t));
    
    // Sine wave offset
    const waveOffset = Math.sin((t * Math.PI * 2 * 1.5) + phase) * amplitude;
    const decoratedPoint = vec2Add(point, vec2Scale(outwardNormal, waveOffset));
    points.push(decoratedPoint);
  }
  
  return points;
}

// Calculate polygon centroid
function calculateCentroid(vertices: Vector2[]): Vector2 {
  let cx = 0, cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / vertices.length, y: cy / vertices.length };
}

/**
 * Add decorations (bumps, spikes, etc.) to a polygon's edges
 * Returns a new polygon with modified vertices
 */
export function decoratePolygon(
  polygon: Polygon,
  config: DecorationConfig
): Polygon {
  const { type, density, minSize, maxSize, seed } = config;
  const random = seededRandom(seed);
  const centroid = calculateCentroid(polygon.vertices);
  
  const newVertices: Vector2[] = [];
  const vertices = polygon.vertices;
  
  for (let i = 0; i < vertices.length; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % vertices.length];
    
    // Always add the starting vertex
    newVertices.push({ ...p1 });
    
    const edgeLength = vec2Distance(p1, p2);
    const outwardNormal = getOutwardNormal(p1, p2, centroid);
    
    // Calculate how many decorations on this edge
    const expectedDecorations = (edgeLength / 100) * density;
    const numDecorations = Math.floor(expectedDecorations + random());
    
    if (numDecorations === 0) continue;
    
    // Skip very short edges
    if (edgeLength < 20) continue;
    
    if (type === 'wave') {
      // Wave is special - it subdivides the whole edge
      const amplitude = minSize + random() * (maxSize - minSize);
      const segments = Math.max(4, Math.floor(edgeLength / 15));
      const wavePoints = createWave(p1, p2, amplitude * 0.5, outwardNormal, segments, random() * Math.PI * 2);
      newVertices.push(...wavePoints);
    } else {
      // Collect decoration points along the edge
      const decorations: { t: number; points: Vector2[] }[] = [];
      
      // Generate decoration positions
      const positions: number[] = [];
      for (let d = 0; d < numDecorations; d++) {
        // Space them out somewhat evenly with randomness
        const baseT = (d + 0.5) / numDecorations;
        const jitter = (random() - 0.5) * (0.7 / numDecorations);
        const t = Math.max(0.1, Math.min(0.9, baseT + jitter));
        positions.push(t);
      }
      
      // Sort positions along edge
      positions.sort((a, b) => a - b);
      
      // Create decorations
      for (const t of positions) {
        const size = minSize + random() * (maxSize - minSize);
        
        let points: Vector2[];
        switch (type) {
          case 'bump':
            points = createBump(p1, p2, t, size, outwardNormal);
            break;
          case 'spike':
            points = createSpike(p1, p2, t, size, outwardNormal);
            break;
          case 'tooth':
            points = createTooth(p1, p2, t, size, outwardNormal, random);
            break;
          default:
            points = createBump(p1, p2, t, size, outwardNormal);
        }
        
        decorations.push({ t, points });
      }
      
      // Insert decoration points in order
      for (const dec of decorations) {
        newVertices.push(...dec.points);
      }
    }
  }
  
  return { vertices: newVertices };
}

/**
 * Get a random decoration type based on level/seed
 */
export function getRandomDecorationType(seed: number): DecorationType {
  const random = seededRandom(seed);
  const types: DecorationType[] = ['bump', 'spike', 'tooth', 'wave'];
  return types[Math.floor(random() * types.length)];
}

/**
 * Get decoration config based on level number and obstacle index
 * Higher levels get more pronounced decorations
 */
export function getDecorationConfig(
  levelNumber: number,
  obstacleIndex: number,
  entityId: string
): DecorationConfig {
  // Create a unique seed from level and obstacle
  const seed = levelNumber * 1000 + obstacleIndex + entityId.charCodeAt(0);
  const random = seededRandom(seed);
  
  // Determine decoration type with some variety
  const typeRoll = random();
  let type: DecorationType;
  if (typeRoll < 0.35) {
    type = 'bump';
  } else if (typeRoll < 0.6) {
    type = 'tooth';
  } else if (typeRoll < 0.8) {
    type = 'spike';
  } else {
    type = 'wave';
  }
  
  // Scale decoration intensity with level
  const levelFactor = Math.min(1.5, 0.7 + levelNumber * 0.05);
  
  return {
    type,
    density: 1.5 + random() * 1.5, // 1.5-3 decorations per 100 units
    minSize: 4 * levelFactor,
    maxSize: 10 * levelFactor,
    seed: seed + 12345,
  };
}
