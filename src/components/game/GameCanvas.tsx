import { useRef, useEffect, useState } from 'react';
import { Ball, Bounds, GrowingWall, Vector2, GameResult } from '@/types/game';
import { LevelConfig } from '@/types/level';

interface GameCanvasProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: () => void;
}

// Game constants
const BALL_RADIUS = 10;
const BALL_SPEED_INCREASE = 1.05;
const WALL_THICKNESS = 6;
const WALL_GROWTH_SPEED = 1200;
const ARENA_MARGIN = 0.1;

// Colors
const COLORS = {
  wallActive: '#ff8800',
  wallActiveGlow: 'rgba(255, 136, 0, 0.5)',
};

function getRandomDirection(): Vector2 {
  const minAngle = 15 * (Math.PI / 180);
  const maxAngle = 75 * (Math.PI / 180);
  const quadrant = Math.floor(Math.random() * 4);
  const baseAngle = minAngle + Math.random() * (maxAngle - minAngle);
  const angle = baseAngle + (quadrant * Math.PI / 2);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function circleRectCollision(
  cx: number, cy: number, r: number,
  rx: number, ry: number, rw: number, rh: number
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < (r * r);
}

function hexToRgba(hex: string, alpha: number = 1): string {
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function GameCanvas({ level, levelNumber, totalLevels, onGameEnd, onLevelComplete }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remainingPercent, setRemainingPercent] = useState(100);
  
  const gameRef = useRef({
    arena: null as Bounds | null,
    originalArea: 0,
    balls: [] as Ball[],
    activeWall: null as GrowingWall | null,
    gameOver: false,
    levelComplete: false,
    swipeStart: null as Vector2 | null,
    lastTime: 0,
    animationId: 0,
    canvasSize: { width: 0, height: 0 },
    backgroundColor: `#${level.backgroundColor}`,
    arenaColor: `#${level.rectangleColor}`,
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const game = gameRef.current;
    game.backgroundColor = `#${level.backgroundColor}`;
    game.arenaColor = `#${level.rectangleColor}`;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const initGame = () => {
      const { width, height } = game.canvasSize;
      const margin = Math.min(width, height) * ARENA_MARGIN;
      const arenaWidth = width - margin * 2;
      const arenaHeight = height - margin * 2;
      
      game.arena = {
        left: margin,
        top: margin,
        right: margin + arenaWidth,
        bottom: margin + arenaHeight,
      };
      
      game.originalArea = arenaWidth * arenaHeight;
      
      // Create balls from level config
      game.balls = level.balls.map((ballConfig) => {
        const dir = getRandomDirection();
        return {
          id: ballConfig.id,
          position: { 
            x: margin + arenaWidth / 2 + (Math.random() - 0.5) * arenaWidth * 0.3,
            y: margin + arenaHeight / 2 + (Math.random() - 0.5) * arenaHeight * 0.3,
          },
          velocity: { 
            x: dir.x * ballConfig.initialSpeed, 
            y: dir.y * ballConfig.initialSpeed 
          },
          radius: BALL_RADIUS,
          speed: ballConfig.initialSpeed,
          topSpeed: ballConfig.topSpeed,
          color: `#${ballConfig.color}`,
        };
      });
      
      game.activeWall = null;
      game.gameOver = false;
      game.levelComplete = false;
      game.swipeStart = null;
      game.lastTime = 0;
      setRemainingPercent(100);
    };

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      game.canvasSize = { width, height };
      initGame();
    };

    const updateBall = (ball: Ball, dt: number) => {
      const { arena } = game;
      if (!arena) return;

      ball.position.x += ball.velocity.x * dt;
      ball.position.y += ball.velocity.y * dt;

      if (ball.position.x - ball.radius < arena.left) {
        ball.position.x = arena.left + ball.radius;
        ball.velocity.x = Math.abs(ball.velocity.x);
      }
      if (ball.position.x + ball.radius > arena.right) {
        ball.position.x = arena.right - ball.radius;
        ball.velocity.x = -Math.abs(ball.velocity.x);
      }
      if (ball.position.y - ball.radius < arena.top) {
        ball.position.y = arena.top + ball.radius;
        ball.velocity.y = Math.abs(ball.velocity.y);
      }
      if (ball.position.y + ball.radius > arena.bottom) {
        ball.position.y = arena.bottom - ball.radius;
        ball.velocity.y = -Math.abs(ball.velocity.y);
      }
    };

    const applyCut = (wall: GrowingWall) => {
      const { arena, balls } = game;
      if (!arena || balls.length === 0) return;

      let region1: Bounds;
      let region2: Bounds;

      if (wall.orientation === 'horizontal') {
        const cutY = wall.origin.y;
        region1 = { ...arena, bottom: cutY - wall.thickness / 2 }; // top region
        region2 = { ...arena, top: cutY + wall.thickness / 2 }; // bottom region
      } else {
        const cutX = wall.origin.x;
        region1 = { ...arena, right: cutX - wall.thickness / 2 }; // left region
        region2 = { ...arena, left: cutX + wall.thickness / 2 }; // right region
      }

      // Check which balls are in which region
      const ballsInRegion1: Ball[] = [];
      const ballsInRegion2: Ball[] = [];

      for (const ball of balls) {
        const inRegion1 = ball.position.x >= region1.left && ball.position.x <= region1.right &&
                          ball.position.y >= region1.top && ball.position.y <= region1.bottom;
        const inRegion2 = ball.position.x >= region2.left && ball.position.x <= region2.right &&
                          ball.position.y >= region2.top && ball.position.y <= region2.bottom;
        
        if (inRegion1) ballsInRegion1.push(ball);
        if (inRegion2) ballsInRegion2.push(ball);
      }

      let newArena: Bounds | null = null;

      // Apply cut only if exactly one region is empty
      if (ballsInRegion1.length === 0 && ballsInRegion2.length > 0) {
        newArena = region2;
      } else if (ballsInRegion2.length === 0 && ballsInRegion1.length > 0) {
        newArena = region1;
      }
      // If both have balls, cut is wasted - do nothing

      game.activeWall = null;

      if (newArena) {
        game.arena = newArena;
        
        const currentArea = (newArena.right - newArena.left) * (newArena.bottom - newArena.top);
        const percent = Math.round((currentArea / game.originalArea) * 100);
        setRemainingPercent(percent);

        if (percent < level.sizeThreshold) {
          game.levelComplete = true;
          setTimeout(() => {
            onLevelComplete();
          }, 600);
          return;
        }

        // Speed up all balls
        for (const ball of balls) {
          const newSpeed = Math.min(ball.speed * BALL_SPEED_INCREASE, ball.topSpeed);
          const ratio = newSpeed / ball.speed;
          ball.speed = newSpeed;
          ball.velocity.x *= ratio;
          ball.velocity.y *= ratio;
        }
      }
    };

    const updateWall = (dt: number) => {
      const { activeWall: wall, arena, balls } = game;
      if (!wall || !arena || balls.length === 0 || wall.isComplete) return;

      const growth = WALL_GROWTH_SPEED * dt;

      if (wall.orientation === 'horizontal') {
        wall.startExtent = Math.max(arena.left, wall.startExtent - growth);
        wall.endExtent = Math.min(arena.right, wall.endExtent + growth);
        if (wall.startExtent <= arena.left && wall.endExtent >= arena.right) {
          wall.isComplete = true;
        }
      } else {
        wall.startExtent = Math.max(arena.top, wall.startExtent - growth);
        wall.endExtent = Math.min(arena.bottom, wall.endExtent + growth);
        if (wall.startExtent <= arena.top && wall.endExtent >= arena.bottom) {
          wall.isComplete = true;
        }
      }

      // Collision check with any ball while growing
      if (!wall.isComplete) {
        let rx: number, ry: number, rw: number, rh: number;
        if (wall.orientation === 'horizontal') {
          rx = wall.startExtent;
          ry = wall.origin.y - wall.thickness / 2;
          rw = wall.endExtent - wall.startExtent;
          rh = wall.thickness;
        } else {
          rx = wall.origin.x - wall.thickness / 2;
          ry = wall.startExtent;
          rw = wall.thickness;
          rh = wall.endExtent - wall.startExtent;
        }

        for (const ball of balls) {
          if (circleRectCollision(ball.position.x, ball.position.y, ball.radius, rx, ry, rw, rh)) {
            game.gameOver = true;
            const currentArea = (arena.right - arena.left) * (arena.bottom - arena.top);
            const percent = Math.round((currentArea / game.originalArea) * 100);
            onGameEnd({
              isWin: false,
              remainingPercent: percent,
              levelId: level.id,
              levelNumber,
            });
            return;
          }
        }
      }

      if (wall.isComplete) {
        applyCut(wall);
      }
    };

    const render = () => {
      const { arena, balls, activeWall: wall, canvasSize, backgroundColor, arenaColor } = game;
      const { width, height } = canvasSize;

      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);

      if (!arena) return;

      ctx.fillStyle = arenaColor;
      ctx.fillRect(arena.left, arena.top, arena.right - arena.left, arena.bottom - arena.top);

      if (wall && !wall.isComplete) {
        ctx.save();
        ctx.fillStyle = COLORS.wallActive;
        ctx.shadowColor = COLORS.wallActiveGlow;
        ctx.shadowBlur = 20;
        
        if (wall.orientation === 'horizontal') {
          ctx.fillRect(
            wall.startExtent,
            wall.origin.y - wall.thickness / 2,
            wall.endExtent - wall.startExtent,
            wall.thickness
          );
        } else {
          ctx.fillRect(
            wall.origin.x - wall.thickness / 2,
            wall.startExtent,
            wall.thickness,
            wall.endExtent - wall.startExtent
          );
        }
        ctx.restore();
      }

      // Render all balls
      for (const ball of balls) {
        // Ball glow
        ctx.beginPath();
        ctx.arc(ball.position.x, ball.position.y, ball.radius + 10, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(ball.color.slice(1), 0.4);
        ctx.fill();

        // Ball
        ctx.save();
        ctx.beginPath();
        ctx.arc(ball.position.x, ball.position.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = ball.color;
        ctx.shadowColor = ball.color;
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.restore();
      }
    };

    const gameLoop = (timestamp: number) => {
      if (game.gameOver || game.levelComplete) return;

      const dt = game.lastTime ? (timestamp - game.lastTime) / 1000 : 0;
      game.lastTime = timestamp;
      const cappedDt = Math.min(dt, 0.05);

      for (const ball of game.balls) {
        updateBall(ball, cappedDt);
      }
      updateWall(cappedDt);
      render();

      game.animationId = requestAnimationFrame(gameLoop);
    };

    const getCanvasCoords = (e: PointerEvent): Vector2 => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (game.gameOver || game.levelComplete || game.activeWall) return;
      const { arena } = game;
      if (!arena) return;

      const pos = getCanvasCoords(e);
      const margin = WALL_THICKNESS;
      
      if (
        pos.x > arena.left + margin &&
        pos.x < arena.right - margin &&
        pos.y > arena.top + margin &&
        pos.y < arena.bottom - margin
      ) {
        game.swipeStart = pos;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!game.swipeStart || game.gameOver || game.levelComplete || game.activeWall) return;

      const pos = getCanvasCoords(e);
      const deltaX = pos.x - game.swipeStart.x;
      const deltaY = pos.y - game.swipeStart.y;

      const minDistance = 15;
      if (Math.abs(deltaX) < minDistance && Math.abs(deltaY) < minDistance) return;

      const orientation = Math.abs(deltaX) >= Math.abs(deltaY) ? 'horizontal' : 'vertical';

      game.activeWall = {
        origin: { ...game.swipeStart },
        orientation,
        startExtent: orientation === 'horizontal' ? game.swipeStart.x : game.swipeStart.y,
        endExtent: orientation === 'horizontal' ? game.swipeStart.x : game.swipeStart.y,
        thickness: WALL_THICKNESS,
        isComplete: false,
      };

      game.swipeStart = null;
    };

    const handlePointerUp = () => {
      game.swipeStart = null;
    };

    // Setup
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);

    game.animationId = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerUp);
      cancelAnimationFrame(game.animationId);
    };
  }, [level, levelNumber, onGameEnd, onLevelComplete]);

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: `#${level.backgroundColor}` }}>
      {/* Level indicator - top left */}
      <div className="absolute top-4 left-4 z-10">
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Level</span>
          <div className="text-2xl font-display font-bold text-primary">
            {levelNumber} / {totalLevels}
          </div>
        </div>
      </div>

      {/* Remaining percentage - top right */}
      <div className="absolute top-4 right-4 z-10">
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Remaining</span>
          <div className="text-2xl font-display font-bold text-primary">
            {remainingPercent}%
          </div>
          <span className="text-muted-foreground text-xs">Target: &lt;{level.sizeThreshold}%</span>
        </div>
      </div>

      <div ref={containerRef} className="w-full h-full">
        <canvas
          ref={canvasRef}
          className="touch-none cursor-crosshair"
        />
      </div>
    </div>
  );
}
