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

// Get config based on level number
function getObstacleConfig(levelNumber: number): RandomObstacleConfig | null {
  // No random obstacles for first 3 levels
  if (levelNumber <= 3) return null;
  
  // Level 4-6: light obstacles
  if (levelNumber <= 6) {
    return {
      minCount: 1,
      maxCount: 2,
      types: ['bump', 'pebble'],
      minSize: 15,
      maxSize: 25,
    };
  }
  
  // Level 7-10: moderate obstacles
  if (levelNumber <= 10) {
    return {
      minCount: 2,
      maxCount: 4,
      types: ['bump', 'pebble', 'spike'],
      minSize: 18,
      maxSize: 30,
    };
  }
  
  // Level 11-14: more variety
  if (levelNumber <= 14) {
    return {
      minCount: 3,
      maxCount: 5,
      types: ['bump', 'pebble', 'spike', 'triangle'],
      minSize: 20,
      maxSize: 35,
    };
  }
  
  // Level 15+: maximum variety
  return {
    minCount: 3,
    maxCount: 6,
    types: ['bump', 'pebble', 'spike', 'triangle'],
    minSize: 22,
    maxSize: 40,
  };
}

// Generate a random number in range
function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Pick random item from array
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate a circular bump obstacle
function generateBump(x: number, y: number, size: number): LevelEntity {
  return {
    id: `random-bump-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    id: `random-pebble-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'wall',
    shape: 'circle',
    cx: x,
    cy: y,
    radius: size * 0.6, // Smaller than bumps
  } as LevelEntity & CircleShape;
}

// Generate a spike (3-4 pointed star shape)
function generateSpike(x: number, y: number, size: number): LevelEntity {
  const numPoints = Math.random() > 0.5 ? 3 : 4;
  const outerRadius = size;
  const innerRadius = size * 0.4;
  const points: [number, number][] = [];
  const startAngle = Math.random() * Math.PI * 2;
  
  for (let i = 0; i < numPoints * 2; i++) {
    const angle = startAngle + (i / (numPoints * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    points.push([
      x + Math.cos(angle) * radius,
      y + Math.sin(angle) * radius,
    ]);
  }
  
  return {
    id: `random-spike-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'wall',
    shape: 'polygon',
    points,
  } as LevelEntity & PolygonShape;
}

// Generate a triangle obstacle
function generateTriangle(x: number, y: number, size: number): LevelEntity {
  const startAngle = Math.random() * Math.PI * 2;
  const points: [number, number][] = [];
  
  for (let i = 0; i < 3; i++) {
    const angle = startAngle + (i / 3) * Math.PI * 2;
    points.push([
      x + Math.cos(angle) * size,
      y + Math.sin(angle) * size,
    ]);
  }
  
  return {
    id: `random-triangle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
 * Returns an array of new entities to add to the level.
 */
export function generateRandomObstacles(
  levelNumber: number,
  existingEntities: LevelEntity[] = [],
  balls: { startX?: number; startY?: number }[] = []
): LevelEntity[] {
  const config = getObstacleConfig(levelNumber);
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
