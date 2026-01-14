import { useRef, useEffect, useCallback, useState } from 'react';
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
const ARENA_MARGIN = 0.1; // 10% margin from edges

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
  // Random angle avoiding near-horizontal/vertical (within 15 degrees of axes)
  const minAngle = 15 * (Math.PI / 180);
  const maxAngle = 75 * (Math.PI / 180);
  
  const quadrant = Math.floor(Math.random() * 4);
  const baseAngle = minAngle + Math.random() * (maxAngle - minAngle);
  const angle = baseAngle + (quadrant * Math.PI / 2);
  
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function circleRectCollision(
  circleX: number,
  circleY: number,
  radius: number,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number
): boolean {
  const closestX = Math.max(rectX, Math.min(circleX, rectX + rectW));
  const closestY = Math.max(rectY, Math.min(circleY, rectY + rectH));
  const distX = circleX - closestX;
  const distY = circleY - closestY;
  return (distX * distX + distY * distY) < (radius * radius);
}

export function GameCanvas({ onGameEnd }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  
  const [remainingPercent, setRemainingPercent] = useState(100);
  
  // Game state refs (to avoid re-renders during game loop)
  const arenaRef = useRef<Bounds | null>(null);
  const originalAreaRef = useRef<number>(0);
  const ballRef = useRef<Ball | null>(null);
  const activeWallRef = useRef<GrowingWall | null>(null);
  const gameOverRef = useRef<boolean>(false);
  const swipeStartRef = useRef<Vector2 | null>(null);

  const initGame = useCallback((width: number, height: number) => {
    const margin = Math.min(width, height) * ARENA_MARGIN;
    const arenaWidth = width - margin * 2;
    const arenaHeight = height - margin * 2;
    
    arenaRef.current = {
      left: margin,
      top: margin,
      right: margin + arenaWidth,
      bottom: margin + arenaHeight,
    };
    
    originalAreaRef.current = arenaWidth * arenaHeight;
    
    const direction = getRandomDirection();
    ballRef.current = {
      position: {
        x: margin + arenaWidth / 2,
        y: margin + arenaHeight / 2,
      },
      velocity: {
        x: direction.x * BALL_INITIAL_SPEED,
        y: direction.y * BALL_INITIAL_SPEED,
      },
      radius: BALL_RADIUS,
      speed: BALL_INITIAL_SPEED,
    };
    
    activeWallRef.current = null;
    gameOverRef.current = false;
    setRemainingPercent(100);
  }, []);

  const updateBall = useCallback((deltaTime: number) => {
    const ball = ballRef.current;
    const arena = arenaRef.current;
    if (!ball || !arena) return;

    // Update position
    ball.position.x += ball.velocity.x * deltaTime;
    ball.position.y += ball.velocity.y * deltaTime;

    // Bounce off arena walls
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
  }, []);

  const updateWall = useCallback((deltaTime: number) => {
    const wall = activeWallRef.current;
    const arena = arenaRef.current;
    const ball = ballRef.current;
    if (!wall || !arena || !ball || wall.isComplete) return;

    const growthAmount = WALL_GROWTH_SPEED * deltaTime;

    if (wall.orientation === 'horizontal') {
      wall.startExtent = Math.max(arena.left, wall.startExtent - growthAmount);
      wall.endExtent = Math.min(arena.right, wall.endExtent + growthAmount);
      
      if (wall.startExtent <= arena.left && wall.endExtent >= arena.right) {
        wall.isComplete = true;
      }
    } else {
      wall.startExtent = Math.max(arena.top, wall.startExtent - growthAmount);
      wall.endExtent = Math.min(arena.bottom, wall.endExtent + growthAmount);
      
      if (wall.startExtent <= arena.top && wall.endExtent >= arena.bottom) {
        wall.isComplete = true;
      }
    }

    // Check collision with ball while growing
    if (!wall.isComplete) {
      let wallRect: { x: number; y: number; w: number; h: number };
      
      if (wall.orientation === 'horizontal') {
        wallRect = {
          x: wall.startExtent,
          y: wall.origin.y - wall.thickness / 2,
          w: wall.endExtent - wall.startExtent,
          h: wall.thickness,
        };
      } else {
        wallRect = {
          x: wall.origin.x - wall.thickness / 2,
          y: wall.startExtent,
          w: wall.thickness,
          h: wall.endExtent - wall.startExtent,
        };
      }

      if (circleRectCollision(
        ball.position.x,
        ball.position.y,
        ball.radius,
        wallRect.x,
        wallRect.y,
        wallRect.w,
        wallRect.h
      )) {
        gameOverRef.current = true;
        const currentArea = (arena.right - arena.left) * (arena.bottom - arena.top);
        const percent = Math.round((currentArea / originalAreaRef.current) * 100);
        onGameEnd(false, percent);
        return;
      }
    }

    // Apply cut when wall completes
    if (wall.isComplete) {
      applyCut(wall);
    }
  }, [onGameEnd]);

  const applyCut = useCallback((wall: GrowingWall) => {
    const arena = arenaRef.current;
    const ball = ballRef.current;
    if (!arena || !ball) return;

    let newArena: Bounds;

    if (wall.orientation === 'horizontal') {
      // Split horizontally
      const cutY = wall.origin.y;
      const ballAbove = ball.position.y < cutY;
      
      if (ballAbove) {
        newArena = { ...arena, bottom: cutY - wall.thickness / 2 };
      } else {
        newArena = { ...arena, top: cutY + wall.thickness / 2 };
      }
    } else {
      // Split vertically
      const cutX = wall.origin.x;
      const ballLeft = ball.position.x < cutX;
      
      if (ballLeft) {
        newArena = { ...arena, right: cutX - wall.thickness / 2 };
      } else {
        newArena = { ...arena, left: cutX + wall.thickness / 2 };
      }
    }

    arenaRef.current = newArena;
    activeWallRef.current = null;

    // Calculate remaining percentage
    const currentArea = (newArena.right - newArena.left) * (newArena.bottom - newArena.top);
    const percent = Math.round((currentArea / originalAreaRef.current) * 100);
    setRemainingPercent(percent);

    // Check win condition
    if (percent < WIN_THRESHOLD) {
      gameOverRef.current = true;
      onGameEnd(true, percent);
      return;
    }

    // Increase ball speed
    const newSpeed = Math.min(ball.speed * BALL_SPEED_INCREASE, BALL_MAX_SPEED);
    const speedRatio = newSpeed / ball.speed;
    ball.speed = newSpeed;
    ball.velocity.x *= speedRatio;
    ball.velocity.y *= speedRatio;
  }, [onGameEnd]);

  const render = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const arena = arenaRef.current;
    const ball = ballRef.current;
    const wall = activeWallRef.current;

    // Clear with void color
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, width, height);

    if (!arena || !ball) return;

    // Draw arena
    ctx.fillStyle = COLORS.arena;
    ctx.fillRect(
      arena.left,
      arena.top,
      arena.right - arena.left,
      arena.bottom - arena.top
    );

    // Draw active wall
    if (wall && !wall.isComplete) {
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
      ctx.shadowBlur = 0;
    }

    // Draw ball with glow
    ctx.beginPath();
    ctx.arc(ball.position.x, ball.position.y, ball.radius + 10, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ballGlow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ball.position.x, ball.position.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ball;
    ctx.shadowColor = COLORS.ball;
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.shadowBlur = 0;
  }, []);

  const gameLoop = useCallback((timestamp: number) => {
    if (gameOverRef.current) return;

    const deltaTime = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0;
    lastTimeRef.current = timestamp;

    // Cap delta time to prevent huge jumps
    const cappedDelta = Math.min(deltaTime, 0.05);

    updateBall(cappedDelta);
    updateWall(cappedDelta);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      render(ctx, canvas.width, canvas.height);
    }

    animationRef.current = requestAnimationFrame(gameLoop);
  }, [updateBall, updateWall, render]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (gameOverRef.current || activeWallRef.current) return;

    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Check if inside arena with margin
    const margin = WALL_THICKNESS;
    if (
      x > arena.left + margin &&
      x < arena.right - margin &&
      y > arena.top + margin &&
      y < arena.bottom - margin
    ) {
      swipeStartRef.current = { x, y };
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!swipeStartRef.current || gameOverRef.current || activeWallRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const deltaX = x - swipeStartRef.current.x;
    const deltaY = y - swipeStartRef.current.y;

    // Need minimum swipe distance to trigger
    const minDistance = 20;
    if (Math.abs(deltaX) < minDistance && Math.abs(deltaY) < minDistance) return;

    const orientation = Math.abs(deltaX) >= Math.abs(deltaY) ? 'horizontal' : 'vertical';

    activeWallRef.current = {
      origin: { ...swipeStartRef.current },
      orientation,
      startExtent: orientation === 'horizontal' ? swipeStartRef.current.x : swipeStartRef.current.y,
      endExtent: orientation === 'horizontal' ? swipeStartRef.current.x : swipeStartRef.current.y,
      thickness: WALL_THICKNESS,
      isComplete: false,
    };

    swipeStartRef.current = null;
  }, []);

  const handlePointerUp = useCallback(() => {
    swipeStartRef.current = null;
  }, []);

  // Setup and resize
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
      
      initGame(width, height);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start game loop
    lastTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationRef.current);
    };
  }, [initGame, gameLoop]);

  return (
    <div className="relative w-full h-full">
      {/* HUD */}
      <div className="absolute top-4 right-4 z-10">
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Remaining</span>
          <div className="text-2xl font-display font-bold text-primary">
            {remainingPercent}%
          </div>
        </div>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} className="w-full h-full">
        <canvas
          ref={canvasRef}
          className="touch-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
    </div>
  );
}
