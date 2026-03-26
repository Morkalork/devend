import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useGameConfig } from '../../hooks/useGameConfig';

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

// Nonsensical callout texts — flowing strings, word-wrapped by the box
const CALLOUT_TEXTS = [
  "Lorem ipsum dolor sit amet consectetur adipiscing void et nullam",
  "null ptr ref at 0xDEADBEEF access violation process terminated",
  "undefined is not a function call stack empty returning null ptr",
  "heap corruption detected in sector 7-G memory dump follows pls",
  "NaN propagated through entire call chain returning Infinity now",
  "stack overflow at depth 9001 all frames corrupt goodbye world",
  "use after free object at 0x00FF already deleted still haunting",
  "type mismatch expected void got raw emotion implicit cast failed",
  "ref count reached zero object deleted ghost pointer still lives",
  "divide by zero in hot path result is pure chaos and IT IS FINE",
  "infinite loop detected at line undefined still running send help",
  "segmentation fault core dumped no survivors rip beloved process",
  "race condition in scheduler execution order undefined coin flip",
  "checksum mismatch byte 0x4F corrupt packet dropped sent anyway",
  "out of memory allocation failed system halting please buy RAM",
  "deadlock found thread alpha waits for thread alpha forever gg",
  "missing semicolon somewhere on line infinity good luck finding",
  "404 logic not found in this function please advise or reboot",
  "assertion failed true does not equal true reality is broken now",
  "buffer overflow wrote one byte past the end classic off by one",
];

interface CRTBackgroundProps {
  accentColor?: string; // hex color with #
}

// Glitch effect types
type GlitchType = 'tear' | 'flicker' | 'corrupt' | null;

interface WordHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  calloutX: number;
  calloutY: number;
  calloutW: number;
  calloutH: number;
  calloutText: string;
  calloutToRight: boolean;
}

export function CRTBackground({ accentColor = '#00ff88' }: CRTBackgroundProps) {
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const [activeGlitch, setActiveGlitch] = useState<GlitchType>(null);
  const [glitchOffset, setGlitchOffset] = useState(0);

  // Word highlight state — array so multiple can show simultaneously
  const { config } = useGameConfig();
  const hlCfg = config.crt_word_highlight;
  type Phase = 'box' | 'horiz' | 'vert' | 'callout';
  const [highlights, setHighlights] = useState<Array<WordHighlight & { id: number; phase: Phase }>>([]);
  const highlightIdRef = useRef(0);
  const nextHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<() => void>(() => {});
  
  // Generate a shuffled, repeated code block for seamless looping
  const codeContent = useMemo(() => {
    // Shuffle and repeat snippets for variety
    const shuffled = [...CODE_SNIPPETS].sort(() => Math.random() - 0.5);
    const repeated = [...shuffled, ...shuffled]; // Duplicate for seamless loop
    return repeated.join('\n\n');
  }, []);

  // Parse declaration names as character offsets into codeContent
  // (function/interface/let/const/type followed by an identifier)
  const wordPositions = useMemo(() => {
    const words: Array<{ charOffset: number; length: number }> = [];
    const declRegex = /(?:function|interface|let|const|type)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;
    while ((match = declRegex.exec(codeContent)) !== null) {
      const name = match[1];
      const charOffset = match.index + match[0].length - name.length;
      words.push({ charOffset, length: name.length });
    }
    return words;
  }, [codeContent]);

  // Convert accent hex color to "r, g, b" for use in rgba()
  const hlColorRgb = useMemo(() => {
    const hex = accentColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }, [accentColor]);

  // Very dark tint of the accent for the callout box background
  const hlBgRgb = useMemo(() => {
    const hex = accentColor.replace('#', '');
    const r = Math.round(parseInt(hex.substring(0, 2), 16) / 8);
    const g = Math.round(parseInt(hex.substring(2, 4), 16) / 8);
    const b = Math.round(parseInt(hex.substring(4, 6), 16) / 8);
    return `${r}, ${g}, ${b}`;
  }, [accentColor]);

  // Pick a random visible word using the Range API for pixel-accurate positioning
  const triggerWordHighlight = useCallback(() => {
    if (wordPositions.length === 0) return;
    const container = codeContainerRef.current;
    if (!container) return;

    // All <pre> elements in the layer (original + clone)
    const pres = Array.from(container.querySelectorAll('pre'));
    const containerRect = container.getBoundingClientRect();
    const vh = window.innerHeight;

    interface Candidate { absX: number; absY: number; width: number; height: number; }
    const candidates: Candidate[] = [];

    for (const pre of pres) {
      const textNode = pre.firstChild;
      if (!textNode) continue;
      for (const { charOffset, length } of wordPositions) {
        try {
          const range = document.createRange();
          range.setStart(textNode, charOffset);
          range.setEnd(textNode, charOffset + length);
          const rect = range.getBoundingClientRect();
          // Only pick words fully visible in the viewport with a small margin
          if (rect.top >= vh * 0.25 && rect.bottom <= vh - 20 && rect.width > 0) {
            candidates.push({
              absX: rect.left - containerRect.left,
              absY: rect.top  - containerRect.top,
              width: rect.width,
              height: rect.height,
            });
          }
        } catch {
          // charOffset out of range for this node — skip
        }
      }
    }

    if (candidates.length === 0) return;

    const picked = candidates[Math.floor(Math.random() * candidates.length)];

    // Decide callout placement: prefer right, fall back to left
    const CALLOUT_W = 118;
    const CALLOUT_H = 52;
    const H_GAP = 88; // horizontal gap between word box edge and callout
    const toRight = (picked.absX + picked.width + H_GAP + CALLOUT_W) < window.innerWidth - 16;
    const calloutX = toRight
      ? picked.absX + picked.width + H_GAP - 40
      : picked.absX - H_GAP - CALLOUT_W - 40;
    // Callout top is below the word's vertical midpoint (rounded to whole pixel)
    const calloutY = Math.round(picked.absY + picked.height / 2 + 14);
    const calloutText = CALLOUT_TEXTS[Math.floor(Math.random() * CALLOUT_TEXTS.length)];

    const id = ++highlightIdRef.current;
    setHighlights(prev => [...prev, {
      id,
      phase: 'box' as const,
      x: picked.absX, y: picked.absY, width: picked.width, height: picked.height,
      calloutX, calloutY, calloutW: CALLOUT_W, calloutH: CALLOUT_H,
      calloutText, calloutToRight: toRight,
    }]);

    // Schedule the next highlight 8–14 s from now (via ref to avoid stale closure)
    const minMs = hlCfg.interval_min_seconds * 1000;
    const maxMs = hlCfg.interval_max_seconds * 1000;
    const delay = minMs + Math.random() * (maxMs - minMs);
    nextHighlightTimerRef.current = setTimeout(() => triggerRef.current(), delay);
  }, [wordPositions, hlCfg.interval_min_seconds, hlCfg.interval_max_seconds]);

  // Keep ref pointing at latest version of the trigger
  useEffect(() => { triggerRef.current = triggerWordHighlight; }, [triggerWordHighlight]);

  // Remove one highlight by id when its animation ends
  const removeHighlight = useCallback((id: number) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
  }, []);

  // Advance a highlight to the next phase in the reveal sequence
  const advancePhase = useCallback((id: number) => {
    setHighlights(prev => prev.map(h => {
      if (h.id !== id) return h;
      const vertHeight = Math.max(0, h.calloutY - (h.y + h.height / 2));
      const next: Record<string, Phase> = {
        box:   'horiz',
        horiz: vertHeight > 0 ? 'vert' : 'callout',
        vert:  'callout',
      };
      return { ...h, phase: (next[h.phase] ?? h.phase) as Phase };
    }));
  }, []);

  // Fire the first highlight shortly after mount; cleanup on unmount
  useEffect(() => {
    const id = setTimeout(() => triggerRef.current(), 600);
    return () => {
      clearTimeout(id);
      if (nextHighlightTimerRef.current) clearTimeout(nextHighlightTimerRef.current);
    };
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
      // Random interval: 3.75-10 seconds (25% longer = 20% fewer glitches)
      const delay = 3750 + Math.random() * 6250;
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
      {/* Layer 1: Scrolling Code — highlight lives here so it moves with the text */}
      <div className="crt-code-layer" ref={codeContainerRef}>
        <pre className="crt-code">{codeContent}</pre>

        {/* Word highlight groups — multiple can be visible simultaneously */}
        {highlights.map(hl => {
          const bw = hlCfg.border_width;
          const borderColor = `rgba(${hlColorRgb}, ${hlCfg.border_opacity})`;
          const bgColor     = `rgba(${hlColorRgb}, ${hlCfg.background_opacity})`;
          const wordMidY    = Math.round(hl.y + hl.height / 2);
          const elbowX      = hl.calloutToRight ? hl.calloutX : hl.calloutX + hl.calloutW;
          const wordConnX   = hl.calloutToRight ? hl.x + hl.width + 4 : hl.x - 4;
          const horizLeft   = Math.min(wordConnX, elbowX);
          const horizWidth  = Math.abs(elbowX - wordConnX);
          // +1 ensures the line overlaps the callout border by 1px, closing any sub-pixel gap
          const vertHeight  = Math.max(0, Math.round(hl.calloutY) - wordMidY + 1);

          return (
            <div
              key={hl.id}
              className="crt-highlight-group"
              aria-hidden="true"
              onAnimationEnd={(e) => { if (e.target === e.currentTarget) removeHighlight(hl.id); }}
              style={{ '--highlight-duration': `${hlCfg.display_seconds}s` } as React.CSSProperties}
            >
              {/* 1. Word box — grows bottom→top */}
              <div
                className="crt-word-box"
                onAnimationEnd={() => advancePhase(hl.id)}
                style={{
                  position: 'absolute',
                  left: `${hl.x - 4}px`, top: `${hl.y - 2}px`,
                  width: `${hl.width + 8}px`, height: `${hl.height + 4}px`,
                  border: `${bw}px solid ${borderColor}`,
                  backgroundColor: bgColor,
                  boxSizing: 'border-box',
                  '--grow-duration': `${hlCfg.grow_seconds * 0.5}s`,
                } as React.CSSProperties}
              />

              {/* 2. Horizontal connector — grows outward from the word box */}
              {(hl.phase === 'horiz' || hl.phase === 'vert' || hl.phase === 'callout') && (
                <div
                  className="crt-line-horiz"
                  onAnimationEnd={() => advancePhase(hl.id)}
                  style={{
                    position: 'absolute',
                    left: `${horizLeft}px`, top: `${wordMidY - 1}px`,
                    width: `${horizWidth + 1}px`, height: '2px',
                    backgroundColor: borderColor,
                    transformOrigin: hl.calloutToRight ? 'left center' : 'right center',
                    '--line-duration': `${hlCfg.line_grow_seconds}s`,
                  } as React.CSSProperties}
                />
              )}

              {/* 3. Vertical connector — grows downward from the elbow */}
              {(hl.phase === 'vert' || hl.phase === 'callout') && vertHeight > 0 && (
                <div
                  className="crt-line-vert"
                  onAnimationEnd={() => advancePhase(hl.id)}
                  style={{
                    position: 'absolute',
                    left: `${elbowX}px`, top: `${wordMidY}px`,
                    width: '2px', height: `${vertHeight}px`,
                    backgroundColor: borderColor,
                    transformOrigin: 'top center',
                    '--line-duration': `${hlCfg.line_grow_seconds}s`,
                  } as React.CSSProperties}
                />
              )}

              {/* 4. Callout box — appears after all lines have grown */}
              {hl.phase === 'callout' && (
                <div style={{
                  position: 'absolute',
                  left: `${hl.calloutX}px`, top: `${hl.calloutY}px`,
                  width: `${hl.calloutW}px`, height: `${hl.calloutH}px`,
                  border: `${bw}px solid ${borderColor}`,
                  backgroundColor: `rgba(${hlBgRgb}, 0.85)`,
                  boxSizing: 'border-box',
                  padding: '3px 7px',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: '6.75px',
                  lineHeight: '1.5',
                  color: `rgba(${hlColorRgb}, 0.9)`,
                  whiteSpace: 'normal',
                  wordWrap: 'break-word',
                  overflow: 'hidden',
                }}>
                  {hl.calloutText}
                </div>
              )}
            </div>
          );
        })}
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
