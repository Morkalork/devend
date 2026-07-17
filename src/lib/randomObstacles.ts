import { LevelEntity, CircleShape, PolygonShape } from '@/types/level';

// Board dimensions (from boardConstants)
const BOARD_WIDTH = 900;
const BOARD_HEIGHT = 900;
const MARGIN = 80; // Keep away from edges

// Random obstacle types
type ObstacleType = 'bump' | 'spike' | 'pebble' | 'triangle';

interface RandomObstacleConfig {
  minCount: number;
  maxCount: number;
  types: ObstacleType[];
  minSize: number;
  maxSize: number;
}

// Get config based on randomShapes percentage (0-100)
function getObstacleConfig(randomShapes: number): RandomObstacleConfig | null {
  if (randomShapes <= 0) return null;

  // Scale count and size with the percentage
  // At 20% (default): 1-3 obstacles, size 15-30
  // At 100%: 5-10 obstacles, size 22-45
  const t = randomShapes / 100;
  return {
    minCount: Math.max(1, Math.round(t * 5)),
    maxCount: Math.max(1, Math.round(t * 10)),
    types: t < 0.3
      ? ['bump', 'pebble']
      : t < 0.6
        ? ['bump', 'pebble', 'spike']
        : ['bump', 'pebble', 'spike', 'triangle'],
    minSize: 12 + t * 10,
    maxSize: 22 + t * 23,
  };
}

// The module's randomness source. generateRandomObstacles() swaps it for a
// seeded generator on seeded (daily) runs, so all helpers roll through it.
let rng: () => number = Math.random;
// Per-generation counter for unique, deterministic obstacle ids.
let idCounter = 0;
function nextId(kind: string): string {
  return `random-${kind}-${++idCounter}-${Math.floor(rng() * 1e9).toString(36)}`;
}

// Generate a random number in range
function randomInRange(min: number, max: number): number {
  return min + rng() * (max - min);
}

// Pick random item from array
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Generate a circular bump obstacle
function generateBump(x: number, y: number, size: number): LevelEntity {
  return {
    id: nextId('bump'),
    kind: 'wall',
    shape: 'circle',
    cx: x,
    cy: y,
    radius: size,
  } as LevelEntity & CircleShape;
}

// Generate a small pebble (small circle)
function generatePebble(x: number, y: number, size: number): LevelEntity {
  return {
    id: nextId('pebble'),
    kind: 'wall',
    shape: 'circle',
    cx: x,
    cy: y,
    radius: size * 0.6, // Smaller than bumps
  } as LevelEntity & CircleShape;
}

// Generate a spike (3-4 pointed star shape)
function generateSpike(x: number, y: number, size: number): LevelEntity {
  const numPoints = rng() > 0.5 ? 3 : 4;
  const outerRadius = size;
  const innerRadius = size * 0.4;
  const points: [number, number][] = [];
  const startAngle = rng() * Math.PI * 2;
  
  for (let i = 0; i < numPoints * 2; i++) {
    const angle = startAngle + (i / (numPoints * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    points.push([
      x + Math.cos(angle) * radius,
      y + Math.sin(angle) * radius,
    ]);
  }
  
  return {
    id: nextId('spike'),
    kind: 'wall',
    shape: 'polygon',
    points,
  } as LevelEntity & PolygonShape;
}

// Generate a triangle obstacle
function generateTriangle(x: number, y: number, size: number): LevelEntity {
  const startAngle = rng() * Math.PI * 2;
  const points: [number, number][] = [];
  
  for (let i = 0; i < 3; i++) {
    const angle = startAngle + (i / 3) * Math.PI * 2;
    points.push([
      x + Math.cos(angle) * size,
      y + Math.sin(angle) * size,
    ]);
  }
  
  return {
    id: nextId('triangle'),
    kind: 'wall',
    shape: 'polygon',
    points,
  } as LevelEntity & PolygonShape;
}

// Check if position overlaps with existing entities
function overlapsExisting(
  x: number,
  y: number,
  size: number,
  existingEntities: LevelEntity[],
  safeMargin: number = 50
): boolean {
  for (const entity of existingEntities) {
    if (entity.shape === 'circle') {
      const e = entity as LevelEntity & CircleShape;
      const dist = Math.sqrt((x - e.cx) ** 2 + (y - e.cy) ** 2);
      if (dist < e.radius + size + safeMargin) return true;
    } else if (entity.shape === 'rect') {
      const e = entity as LevelEntity & { x: number; y: number; width: number; height: number };
      const centerX = e.x + e.width / 2;
      const centerY = e.y + e.height / 2;
      const halfWidth = e.width / 2 + size + safeMargin;
      const halfHeight = e.height / 2 + size + safeMargin;
      if (Math.abs(x - centerX) < halfWidth && Math.abs(y - centerY) < halfHeight) return true;
    } else if (entity.shape === 'polygon') {
      const e = entity as LevelEntity & PolygonShape;
      // Simple centroid-based check
      const centroidX = e.points.reduce((sum, p) => sum + p[0], 0) / e.points.length;
      const centroidY = e.points.reduce((sum, p) => sum + p[1], 0) / e.points.length;
      const dist = Math.sqrt((x - centroidX) ** 2 + (y - centroidY) ** 2);
      if (dist < size + safeMargin + 50) return true; // Extra margin for polygons
    }
  }
  return false;
}

// Check if position is too close to ball spawn points
function tooCloseToSpawns(
  x: number,
  y: number,
  size: number,
  balls: { startX?: number; startY?: number }[],
  safeMargin: number = 80
): boolean {
  for (const ball of balls) {
    if (ball.startX !== undefined && ball.startY !== undefined) {
      const dist = Math.sqrt((x - ball.startX) ** 2 + (y - ball.startY) ** 2);
      if (dist < size + safeMargin) return true;
    }
  }
  return false;
}

/**
 * Generate random small obstacles for a level at runtime.
 * @param randomShapes 0-100 percentage controlling density (default 20)
 * @param randomSource optional seeded generator (Daily Stand-up) so every
 *   player on the seed gets the same obstacle field; defaults to Math.random.
 */
export function generateRandomObstacles(
  randomShapes: number,
  existingEntities: LevelEntity[] = [],
  balls: { startX?: number; startY?: number }[] = [],
  randomSource: () => number = Math.random,
): LevelEntity[] {
  rng = randomSource;
  idCounter = 0;
  const config = getObstacleConfig(randomShapes);
  if (!config) return [];
  
  const count = Math.floor(randomInRange(config.minCount, config.maxCount + 1));
  const newObstacles: LevelEntity[] = [];
  
  for (let i = 0; i < count; i++) {
    // Try to find a valid position
    let attempts = 0;
    const maxAttempts = 50;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      const x = randomInRange(MARGIN, BOARD_WIDTH - MARGIN);
      const y = randomInRange(MARGIN, BOARD_HEIGHT - MARGIN);
      const size = randomInRange(config.minSize, config.maxSize);
      
      // Check for overlaps
      const allEntities = [...existingEntities, ...newObstacles];
      if (overlapsExisting(x, y, size, allEntities)) continue;
      if (tooCloseToSpawns(x, y, size, balls)) continue;
      
      // Valid position found - generate obstacle
      const type = randomChoice(config.types);
      let obstacle: LevelEntity;
      
      switch (type) {
        case 'bump':
          obstacle = generateBump(x, y, size);
          break;
        case 'pebble':
          obstacle = generatePebble(x, y, size);
          break;
        case 'spike':
          obstacle = generateSpike(x, y, size);
          break;
        case 'triangle':
          obstacle = generateTriangle(x, y, size);
          break;
        default:
          obstacle = generateBump(x, y, size);
      }
      
      newObstacles.push(obstacle);
      break;
    }
  }
  
  return newObstacles;
}
