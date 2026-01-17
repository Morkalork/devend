import { useEffect, useRef, useMemo } from 'react';

/**
 * CRT Terminal Background
 * 
 * A decorative background layer that simulates TypeScript code being written
 * and scrolling upwards, styled like a CRT-green terminal.
 * 
 * CUSTOMIZATION:
 * - Adjust CSS variables in the component for scroll speed, colors, opacity
 * - Modify CODE_SNIPPETS array for different code content
 * - Tweak scanline and vignette opacity for different intensity
 */

// TypeScript-like code snippets that feel like real game/engine code
const CODE_SNIPPETS = [
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

export function CRTBackground() {
  const codeContainerRef = useRef<HTMLDivElement>(null);
  
  // Generate a shuffled, repeated code block for seamless looping
  const codeContent = useMemo(() => {
    // Shuffle and repeat snippets for variety
    const shuffled = [...CODE_SNIPPETS].sort(() => Math.random() - 0.5);
    const repeated = [...shuffled, ...shuffled]; // Duplicate for seamless loop
    return repeated.join('\n\n');
  }, []);

  // Rotate content periodically to prevent staleness (optional enhancement)
  useEffect(() => {
    const container = codeContainerRef.current;
    if (!container) return;

    // Clone content for seamless loop
    const pre = container.querySelector('pre');
    if (pre && !container.querySelector('.crt-clone')) {
      const clone = pre.cloneNode(true) as HTMLElement;
      clone.classList.add('crt-clone');
      container.appendChild(clone);
    }
  }, [codeContent]);

  return (
    <div 
      className="crt-background"
      aria-hidden="true"
      style={{
        // CSS Custom Properties for easy tweaking
        '--crt-scroll-duration': '60s',
        '--crt-text-color': '#00ff88',
        '--crt-bg-color': '#001a0f',
        '--crt-glow-color': '#00ff8866',
        '--crt-text-opacity': '0.85',
        '--crt-scanline-opacity': '0.08',
        '--crt-vignette-opacity': '0.6',
      } as React.CSSProperties}
    >
      {/* Layer 1: Scrolling Code */}
      <div className="crt-code-layer" ref={codeContainerRef}>
        <pre className="crt-code">{codeContent}</pre>
      </div>

      {/* Layer 2: Scanline Overlay */}
      <div className="crt-scanlines" />

      {/* Layer 3: Vignette Overlay */}
      <div className="crt-vignette" />
    </div>
  );
}
