import { useEffect, useRef, useMemo, useState, useCallback } from 'react';

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
 * 
 * GLITCH EFFECTS:
 * - Occasional text corruption, line tears, and flickers
 * - Triggered randomly every few seconds
 * - Lightweight CSS-based animations
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

interface CRTBackgroundProps {
  accentColor?: string; // hex color with #
}

// Glitch effect types
type GlitchType = 'tear' | 'flicker' | 'corrupt' | null;

export function CRTBackground({ accentColor = '#00ff88' }: CRTBackgroundProps) {
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const [activeGlitch, setActiveGlitch] = useState<GlitchType>(null);
  const [glitchOffset, setGlitchOffset] = useState(0);
  
  // Generate a shuffled, repeated code block for seamless looping
  const codeContent = useMemo(() => {
    // Shuffle and repeat snippets for variety
    const shuffled = [...CODE_SNIPPETS].sort(() => Math.random() - 0.5);
    const repeated = [...shuffled, ...shuffled]; // Duplicate for seamless loop
    return repeated.join('\n\n');
  }, []);

  // Trigger a random glitch effect
  const triggerGlitch = useCallback(() => {
    const glitchTypes: GlitchType[] = ['tear', 'flicker', 'corrupt'];
    const type = glitchTypes[Math.floor(Math.random() * glitchTypes.length)];
    const offset = 20 + Math.random() * 60; // Random vertical position (20-80%)
    
    setGlitchOffset(offset);
    setActiveGlitch(type);
    
    // Duration varies by type
    const duration = type === 'flicker' ? 80 : type === 'tear' ? 150 : 200;
    setTimeout(() => setActiveGlitch(null), duration);
  }, []);

  // Random glitch interval
  useEffect(() => {
    const scheduleNextGlitch = () => {
      // Random interval: 3-8 seconds
      const delay = 3000 + Math.random() * 5000;
      return setTimeout(() => {
        triggerGlitch();
        scheduleNextGlitch();
      }, delay);
    };
    
    const timeout = scheduleNextGlitch();
    return () => clearTimeout(timeout);
  }, [triggerGlitch]);

  // Clone content for seamless loop
  useEffect(() => {
    const container = codeContainerRef.current;
    if (!container) return;

    const pre = container.querySelector('pre');
    if (pre && !container.querySelector('.crt-clone')) {
      const clone = pre.cloneNode(true) as HTMLElement;
      clone.classList.add('crt-clone');
      container.appendChild(clone);
    }
  }, [codeContent]);

  // Derive glow color from accent (same color with transparency)
  const glowColor = accentColor + '66';

  return (
    <div 
      className={`crt-background ${activeGlitch ? `crt-glitch-${activeGlitch}` : ''}`}
      aria-hidden="true"
      style={{
        // CSS Custom Properties for easy tweaking
        '--crt-scroll-duration': '40s',
        '--crt-text-color': accentColor,
        '--crt-bg-color': '#001a0f',
        '--crt-glow-color': glowColor,
        '--crt-text-opacity': '0.85',
        '--crt-scanline-opacity': '0.08',
        '--crt-vignette-opacity': '0.6',
        '--crt-glitch-offset': `${glitchOffset}%`,
      } as React.CSSProperties}
    >
      {/* Layer 1: Scrolling Code */}
      <div className="crt-code-layer" ref={codeContainerRef}>
        <pre className="crt-code">{codeContent}</pre>
      </div>

      {/* Layer 2: Glitch tear overlay - horizontal slice displacement */}
      {activeGlitch === 'tear' && (
        <div className="crt-glitch-tear" />
      )}

      {/* Layer 3: Scanline Overlay */}
      <div className="crt-scanlines" />

      {/* Layer 4: Vignette Overlay */}
      <div className="crt-vignette" />
    </div>
  );
}
