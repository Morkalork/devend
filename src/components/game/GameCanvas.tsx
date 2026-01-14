import { useRef, useEffect, useState } from 'react';
import { Ball, Bounds, GrowingWall, Vector2 } from '@/types/game';

interface GameCanvasProps {
  onGameEnd: (isWin: boolean, remainingPercent: number) => void;
}

// Game constants
const BALL_RADIUS = 10;
const BALL_INITIAL_SPEED = 350;
const BALL_MAX_SPEED = 900;
const BALL_SPEED_INCREASE = 1.05;
const WALL_THICKNESS = 6;
const WALL_GROWTH_SPEED = 1200;
const WIN_THRESHOLD = 25;
const ARENA_MARGIN = 0.1;

// Colors
const COLORS = {
  void: '#050508',
  arena: '#ffffff',
  ball: '#00d4ff',
  ballGlow: 'rgba(0, 212, 255, 0.4)',
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

export function GameCanvas({ onGameEnd }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remainingPercent, setRemainingPercent] = useState(100);
  
  // All game state in a single ref to avoid closure issues
  const gameRef = useRef({
    arena: null as Bounds | null,
    originalArea: 0,
    ball: null as Ball | null,
    activeWall: null as GrowingWall | null,
    gameOver: false,
    swipeStart: null as Vector2 | null,
    lastTime: 0,
    animationId: 0,
    canvasSize: { width: 0, height: 0 },
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const game = gameRef.current;
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
      
      const dir = getRandomDirection();
      game.ball = {
        position: { x: margin + arenaWidth / 2, y: margin + arenaHeight / 2 },
        velocity: { x: dir.x * BALL_INITIAL_SPEED, y: dir.y * BALL_INITIAL_SPEED },
        radius: BALL_RADIUS,
        speed: BALL_INITIAL_SPEED,
      };
      
      game.activeWall = null;
      game.gameOver = false;
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

    const updateBall = (dt: number) => {
      const { ball, arena } = game;
      if (!ball || !arena) return;

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
      const { arena, ball } = game;
      if (!arena || !ball) return;

      let newArena: Bounds;

      if (wall.orientation === 'horizontal') {
        const cutY = wall.origin.y;
        if (ball.position.y < cutY) {
          newArena = { ...arena, bottom: cutY - wall.thickness / 2 };
        } else {
          newArena = { ...arena, top: cutY + wall.thickness / 2 };
        }
      } else {
        const cutX = wall.origin.x;
        if (ball.position.x < cutX) {
          newArena = { ...arena, right: cutX - wall.thickness / 2 };
        } else {
          newArena = { ...arena, left: cutX + wall.thickness / 2 };
        }
      }

      game.arena = newArena;
      game.activeWall = null;

      const currentArea = (newArena.right - newArena.left) * (newArena.bottom - newArena.top);
      const percent = Math.round((currentArea / game.originalArea) * 100);
      setRemainingPercent(percent);

      if (percent < WIN_THRESHOLD) {
        game.gameOver = true;
        onGameEnd(true, percent);
        return;
      }

      // Speed up ball
      const newSpeed = Math.min(ball.speed * BALL_SPEED_INCREASE, BALL_MAX_SPEED);
      const ratio = newSpeed / ball.speed;
      ball.speed = newSpeed;
      ball.velocity.x *= ratio;
      ball.velocity.y *= ratio;
    };

    const updateWall = (dt: number) => {
      const { activeWall: wall, arena, ball } = game;
      if (!wall || !arena || !ball || wall.isComplete) return;

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

      // Collision check while growing
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

        if (circleRectCollision(ball.position.x, ball.position.y, ball.radius, rx, ry, rw, rh)) {
          game.gameOver = true;
          const currentArea = (arena.right - arena.left) * (arena.bottom - arena.top);
          const percent = Math.round((currentArea / game.originalArea) * 100);
          onGameEnd(false, percent);
          return;
        }
      }

      if (wall.isComplete) {
        applyCut(wall);
      }
    };

    const render = () => {
      const { arena, ball, activeWall: wall, canvasSize } = game;
      const { width, height } = canvasSize;

      ctx.fillStyle = COLORS.void;
      ctx.fillRect(0, 0, width, height);

      if (!arena || !ball) return;

      ctx.fillStyle = COLORS.arena;
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

      // Ball glow
      ctx.beginPath();
      ctx.arc(ball.position.x, ball.position.y, ball.radius + 10, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.ballGlow;
      ctx.fill();

      // Ball
      ctx.save();
      ctx.beginPath();
      ctx.arc(ball.position.x, ball.position.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.ball;
      ctx.shadowColor = COLORS.ball;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.restore();
    };

    const gameLoop = (timestamp: number) => {
      if (game.gameOver) return;

      const dt = game.lastTime ? (timestamp - game.lastTime) / 1000 : 0;
      game.lastTime = timestamp;
      const cappedDt = Math.min(dt, 0.05);

      updateBall(cappedDt);
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
      if (game.gameOver || game.activeWall) return;
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
      if (!game.swipeStart || game.gameOver || game.activeWall) return;

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
  }, [onGameEnd]);

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-4 right-4 z-10">
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Remaining</span>
          <div className="text-2xl font-display font-bold text-primary">
            {remainingPercent}%
          </div>
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
