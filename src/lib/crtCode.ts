/**
 * The code the background scrolls (CRTBackground) and the board's floor shows
 * lit from below by the balls (codeUnderlay.ts): one text, so the code under
 * the board is the same code as the code around it.
 */

// TypeScript-like code snippets that feel like real game/engine code
export const CODE_SNIPPETS: readonly string[] = [
  `interface Entity {
  id: string;
  position: Vector2;
  velocity: Vector2;
  bounds: Rect;
}`,
  `type GameState = 'idle' | 'playing' | 'paused' | 'gameover';`,
  `export function update(dt: number): void {
  for (const entity of entities) {
    integrate(entity, dt);
    checkBounds(entity);
  }
}`,
  `interface PhysicsBody {
  mass: number;
  restitution: number;
  friction: number;
}`,
  `function detectCollision(a: Circle, b: Polygon): boolean {
  const closest = findClosestPoint(b, a.center);
  return distance(closest, a.center) < a.radius;
}`,
  `const BOARD_WIDTH = 900;
const BOARD_HEIGHT = 1600;
const GRAVITY = 0.0;`,
  `export class GameLoop {
  private lastTime = 0;
  private accumulator = 0;
  private readonly fixedDt = 1/60;
}`,
  `function resolveCollision(
  body: PhysicsBody,
  normal: Vector2
): Vector2 {
  const vn = dot(body.velocity, normal);
  return subtract(body.velocity, scale(normal, vn * 2));
}`,
  `interface Region {
  polygon: Polygon;
  area: number;
  containsBall: boolean;
}`,
  `type UpdateFn = (state: GameState, dt: number) => GameState;`,
  `function calculateArea(polygon: Polygon): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return Math.abs(area) / 2;
}`,
  `interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}`,
  `export function integrate(
  ball: Ball,
  dt: number
): void {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
}`,
  `const COLORS = {
  primary: '#00ffff',
  accent: '#ff8c00',
  background: '#0a0a0f',
};`,
  `function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}`,
  `interface Wall {
  start: Vector2;
  end: Vector2;
  progress: number;
  complete: boolean;
}`,
  `type Direction = 'up' | 'down' | 'left' | 'right';`,
  `function growWall(wall: Wall, speed: number, dt: number): void {
  wall.progress = Math.min(1, wall.progress + speed * dt);
  if (wall.progress >= 1) wall.complete = true;
}`,
  `export interface LevelConfig {
  id: string;
  sizeThreshold: number;
  balls: BallConfig[];
  entities?: Entity[];
}`,
  `function pointInPolygon(point: Vector2, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    // Ray casting algorithm
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}`,
  `// Initialize game state
const game: GameState = {
  balls: [],
  regions: [],
  walls: [],
  score: 0,
};`,
  `interface Modifier {
  id: string;
  type: 'speed' | 'size' | 'time';
  value: number;
  duration?: number;
}`,
  `export function applyModifiers(
  base: number,
  modifiers: Modifier[]
): number {
  return modifiers.reduce((acc, mod) => acc * mod.value, base);
}`,
  `// Physics constants
const EPSILON = 0.0001;
const MAX_VELOCITY = 1000;
const DAMPING = 0.999;`,
  `function normalize(v: Vector2): Vector2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}`,
];
