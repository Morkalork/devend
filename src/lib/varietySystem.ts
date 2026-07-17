// Variety System - Controls organic variation in obstacle appearance and size
// The variety property (0-100) determines maximum deviation from original map design

import { Polygon, Vector2, vec2Sub, vec2Add, vec2Normalize, vec2Scale, vec2Distance } from './polygon';
import { DecorationType, DecorationConfig } from './obstacleDecorations';

// Seeded random for consistent variety per level/run
function createSeededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Create a unique seed from level id, run seed, and entity id
export function createVarietySeed(levelId: string, runSeed: number, entityId: string): number {
  let hash = runSeed;
  for (let i = 0; i < levelId.length; i++) {
    hash = ((hash << 5) - hash) + levelId.charCodeAt(i);
    hash = hash & hash;
  }
  for (let i = 0; i < entityId.length; i++) {
    hash = ((hash << 5) - hash) + entityId.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Get a run seed - use timestamp-based seed that changes per run
let currentRunSeed: number | null = null;
export function getRunSeed(): number {
  if (currentRunSeed === null) {
    currentRunSeed = Math.floor(Math.random() * 1000000);
  }
  return currentRunSeed;
}

// Reset run seed for new game
export function resetRunSeed(): void {
  currentRunSeed = Math.floor(Math.random() * 1000000);
}

// Seeded (daily) runs pin the seed so obstacle variation is shared (see runRng)
export function setRunSeed(seed: number): void {
  currentRunSeed = seed >>> 0;
}

/**
 * Get decoration config influenced by variety value
 * Low variety (0-10): Simple bumps, low density, small size
 * Medium variety (10-30): Mix of types, moderate density
 * High variety (30-100): All types possible, higher density, larger spread
 */
export function getVarietyDecorationConfig(
  variety: number,
  levelId: string,
  entityId: string,
  obstacleIndex: number
): DecorationConfig {
  const runSeed = getRunSeed();
  const seed = createVarietySeed(levelId, runSeed, entityId) + obstacleIndex;
  const random = createSeededRandom(seed);
  
  // Clamp variety to 0-100
  const v = Math.max(0, Math.min(100, variety));
  const varietyFactor = v / 100; // 0 to 1
  
  // Determine decoration type based on variety
  let type: DecorationType;
  const typeRoll = random();
  
  if (v === 0) {
    // No decoration for zero variety
    type = 'bump';
  } else if (v <= 10) {
    // Low variety: mostly simple bumps
    type = typeRoll < 0.8 ? 'bump' : 'tooth';
  } else if (v <= 30) {
    // Medium variety: mix of types
    if (typeRoll < 0.4) {
      type = 'bump';
    } else if (typeRoll < 0.7) {
      type = 'tooth';
    } else if (typeRoll < 0.9) {
      type = 'spike';
    } else {
      type = 'wave';
    }
  } else {
    // High variety: all types equally possible
    if (typeRoll < 0.25) {
      type = 'bump';
    } else if (typeRoll < 0.5) {
      type = 'tooth';
    } else if (typeRoll < 0.75) {
      type = 'spike';
    } else {
      type = 'wave';
    }
  }
  
  // Density scales with variety (0.5-3 decorations per 100 units)
  const baseDensity = 0.5;
  const maxDensityBonus = 2.5;
  const densityJitter = (random() - 0.5) * varietyFactor * 0.5;
  const density = v === 0 ? 0 : baseDensity + (maxDensityBonus * varietyFactor) + densityJitter;
  
  // Size scales with variety
  const baseMinSize = 3;
  const baseMaxSize = 6;
  const sizeScale = 1 + varietyFactor * 0.8; // 1x to 1.8x
  const sizeJitter = random() * varietyFactor * 0.3;
  
  return {
    type,
    density: Math.max(0, density),
    minSize: (baseMinSize * sizeScale) * (1 + sizeJitter),
    maxSize: (baseMaxSize * sizeScale) * (1 + sizeJitter),
    seed: seed + 12345,
  };
}

/**
 * Apply size variation to a rectangle based on variety
 * Returns modified x, y, width, height
 */
export function applyRectVariation(
  x: number,
  y: number,
  width: number,
  height: number,
  variety: number,
  levelId: string,
  entityId: string
): { x: number; y: number; width: number; height: number } {
  if (variety === 0) {
    return { x, y, width, height };
  }
  
  const runSeed = getRunSeed();
  const seed = createVarietySeed(levelId, runSeed, entityId);
  const random = createSeededRandom(seed);
  
  const varietyFactor = Math.max(0, Math.min(100, variety)) / 100;
  
  // Symmetric variation around center
  const widthVariation = (random() - 0.5) * 2 * varietyFactor * width;
  const heightVariation = (random() - 0.5) * 2 * varietyFactor * height;
  
  // Clamp to reasonable bounds (at least 50% of original, at most 150%)
  const newWidth = Math.max(width * 0.5, Math.min(width * 1.5, width + widthVariation));
  const newHeight = Math.max(height * 0.5, Math.min(height * 1.5, height + heightVariation));
  
  // Adjust position to keep center unchanged
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const newX = centerX - newWidth / 2;
  const newY = centerY - newHeight / 2;
  
  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * Apply size variation to a circle based on variety
 * Returns modified radius (center stays the same)
 */
export function applyCircleVariation(
  radius: number,
  variety: number,
  levelId: string,
  entityId: string
): number {
  if (variety === 0) {
    return radius;
  }
  
  const runSeed = getRunSeed();
  const seed = createVarietySeed(levelId, runSeed, entityId);
  const random = createSeededRandom(seed);
  
  const varietyFactor = Math.max(0, Math.min(100, variety)) / 100;
  
  // Symmetric variation
  const radiusVariation = (random() - 0.5) * 2 * varietyFactor * radius;
  
  // Clamp to reasonable bounds (50% to 150% of original)
  return Math.max(radius * 0.5, Math.min(radius * 1.5, radius + radiusVariation));
}

/**
 * Apply vertex offset variation to polygon vertices based on variety
 * Vertices are offset along their outward normals
 */
export function applyPolygonVariation(
  vertices: Vector2[],
  variety: number,
  levelId: string,
  entityId: string
): Vector2[] {
  if (variety === 0 || vertices.length < 3) {
    return vertices.map(v => ({ ...v }));
  }
  
  const runSeed = getRunSeed();
  const seed = createVarietySeed(levelId, runSeed, entityId);
  const random = createSeededRandom(seed);
  
  const varietyFactor = Math.max(0, Math.min(100, variety)) / 100;
  
  // Calculate centroid for outward normal direction
  let cx = 0, cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  cx /= vertices.length;
  cy /= vertices.length;
  const centroid = { x: cx, y: cy };
  
  // Calculate average edge length for scaling
  let totalEdgeLength = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    totalEdgeLength += vec2Distance(v1, v2);
  }
  const avgEdgeLength = totalEdgeLength / vertices.length;
  
  // Maximum offset is a fraction of average edge length
  const maxOffset = avgEdgeLength * 0.15 * varietyFactor;
  
  return vertices.map((v) => {
    // Direction from centroid to vertex (outward)
    const outward = vec2Normalize(vec2Sub(v, centroid));
    
    // Random offset along outward direction
    const offset = (random() - 0.5) * 2 * maxOffset;
    
    return vec2Add(v, vec2Scale(outward, offset));
  });
}
