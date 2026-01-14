import { useRef, useEffect, useState, useCallback } from 'react';
import { Ball, Bounds, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from '@/types/game';
import { LevelConfig } from '@/types/level';

interface GameCanvasProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  totalScore: number;
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
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

let regionIdCounter = 0;
function generateRegionId(): string {
  return `region-${++regionIdCounter}`;
}

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

function pointInBounds(x: number, y: number, bounds: Bounds): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function getRegionArea(bounds: Bounds): number {
  return (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
}

function findRegionContainingPoint(regions: Region[], x: number, y: number): Region | null {
  for (const region of regions) {
    if (pointInBounds(x, y, region.bounds)) {
      return region;
    }
  }
  return null;
}

function computeLevelScore(basePoints: number, expectedCuts: number, actualCuts: number): number {
  let score: number;
  if (actualCuts <= expectedCuts) {
    score = basePoints + (expectedCuts - actualCuts);
  } else {
    score = basePoints - (actualCuts - expectedCuts);
  }
  return Math.max(0, score);
}

export function GameCanvas({ level, levelNumber, totalLevels, totalScore, onGameEnd, onLevelComplete }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remainingPercent, setRemainingPercent] = useState(100);
  const [cutCount, setCutCount] = useState(0);
  
  const gameRef = useRef({
    regions: [] as Region[],
    originalArea: 0,
    balls: [] as Ball[],
    activeWall: null as GrowingWall | null,
    gameOver: false,
    levelComplete: false,
    swipeStart: null as Vector2 | null,
    swipeRegionId: null as string | null, // track which region the swipe started in
    lastTime: 0,
    animationId: 0,
    canvasSize: { width: 0, height: 0 },
    backgroundColor: `#${level.backgroundColor}`,
    regionColor: `#${level.rectangleColor}`,
    cutCount: 0, // track cuts internally too
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const game = gameRef.current;
    game.backgroundColor = `#${level.backgroundColor}`;
    game.regionColor = `#${level.rectangleColor}`;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const initGame = () => {
      const { width, height } = game.canvasSize;
      const margin = Math.min(width, height) * ARENA_MARGIN;
      const arenaWidth = width - margin * 2;
      const arenaHeight = height - margin * 2;
      
      // Reset region counter for new level
      regionIdCounter = 0;
      
      // Create initial single region
      const initialRegionId = generateRegionId();
      const initialBounds: Bounds = {
        left: margin,
        top: margin,
        right: margin + arenaWidth,
        bottom: margin + arenaHeight,
      };
      
      game.regions = [{
        id: initialRegionId,
        bounds: initialBounds,
      }];
      
      game.originalArea = arenaWidth * arenaHeight;
      
      // Create balls from level config, all in the initial region
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
          regionId: initialRegionId,
        };
      });
      
      game.activeWall = null;
      game.gameOver = false;
      game.levelComplete = false;
      game.swipeStart = null;
      game.swipeRegionId = null;
      game.lastTime = 0;
      game.cutCount = 0;
      setCutCount(0);
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

    // Find the region a ball is in
    const findBallRegion = (ball: Ball): Region | null => {
      return findRegionContainingPoint(game.regions, ball.position.x, ball.position.y);
    };

    // Update ball's regionId based on its position
    const updateBallRegion = (ball: Ball) => {
      const region = findBallRegion(ball);
      if (region) {
        ball.regionId = region.id;
      }
    };

    // Bounce ball within its assigned region
    const updateBall = (ball: Ball, dt: number) => {
      const region = game.regions.find(r => r.id === ball.regionId);
      if (!region) return;

      const bounds = region.bounds;

      ball.position.x += ball.velocity.x * dt;
      ball.position.y += ball.velocity.y * dt;

      if (ball.position.x - ball.radius < bounds.left) {
        ball.position.x = bounds.left + ball.radius;
        ball.velocity.x = Math.abs(ball.velocity.x);
      }
      if (ball.position.x + ball.radius > bounds.right) {
        ball.position.x = bounds.right - ball.radius;
        ball.velocity.x = -Math.abs(ball.velocity.x);
      }
      if (ball.position.y - ball.radius < bounds.top) {
        ball.position.y = bounds.top + ball.radius;
        ball.velocity.y = Math.abs(ball.velocity.y);
      }
      if (ball.position.y + ball.radius > bounds.bottom) {
        ball.position.y = bounds.bottom - ball.radius;
        ball.velocity.y = -Math.abs(ball.velocity.y);
      }
    };

    // Calculate combined area of all regions
    const getCombinedArea = (): number => {
      return game.regions.reduce((sum, region) => sum + getRegionArea(region.bounds), 0);
    };

    // Check if a ball's center is exactly on the cut line
    const isBallOnCutLine = (ball: Ball, wall: GrowingWall): boolean => {
      if (wall.orientation === 'horizontal') {
        return Math.abs(ball.position.y - wall.origin.y) < 0.1;
      } else {
        return Math.abs(ball.position.x - wall.origin.x) < 0.1;
      }
    };

    const applyCut = (wall: GrowingWall) => {
      const { regions, balls } = game;
      
      // Find the active region
      const activeRegionIndex = regions.findIndex(r => r.id === wall.activeRegionId);
      if (activeRegionIndex === -1) return;
      
      const activeRegion = regions[activeRegionIndex];
      const bounds = activeRegion.bounds;

      // Check if any ball is exactly on the cut line - instant game over
      for (const ball of balls) {
        if (ball.regionId === activeRegion.id && isBallOnCutLine(ball, wall)) {
          game.gameOver = true;
          const percent = Math.round((getCombinedArea() / game.originalArea) * 100);
          onGameEnd({
            isWin: false,
            remainingPercent: percent,
            levelId: level.id,
            levelNumber,
            cutCount: game.cutCount,
            expectedCuts: level.expectedCuts,
            basePoints: level.points,
          });
          return;
        }
      }

      // Split the active region into two child regions
      let childBounds1: Bounds;
      let childBounds2: Bounds;

      if (wall.orientation === 'horizontal') {
        const cutY = wall.origin.y;
        childBounds1 = { ...bounds, bottom: cutY - wall.thickness / 2 }; // top region
        childBounds2 = { ...bounds, top: cutY + wall.thickness / 2 }; // bottom region
      } else {
        const cutX = wall.origin.x;
        childBounds1 = { ...bounds, right: cutX - wall.thickness / 2 }; // left region
        childBounds2 = { ...bounds, left: cutX + wall.thickness / 2 }; // right region
      }

      const child1Id = generateRegionId();
      const child2Id = generateRegionId();

      // Assign balls to child regions
      const ballsInChild1: Ball[] = [];
      const ballsInChild2: Ball[] = [];

      for (const ball of balls) {
        if (ball.regionId !== activeRegion.id) continue;
        
        const inChild1 = pointInBounds(ball.position.x, ball.position.y, childBounds1);
        const inChild2 = pointInBounds(ball.position.x, ball.position.y, childBounds2);
        
        if (inChild1) {
          ball.regionId = child1Id;
          ballsInChild1.push(ball);
        } else if (inChild2) {
          ball.regionId = child2Id;
          ballsInChild2.push(ball);
        }
      }

      // Remove the active region and add child regions (only those with balls)
      const newRegions = regions.filter(r => r.id !== activeRegion.id);
      
      if (ballsInChild1.length > 0) {
        newRegions.push({ id: child1Id, bounds: childBounds1 });
      }
      if (ballsInChild2.length > 0) {
        newRegions.push({ id: child2Id, bounds: childBounds2 });
      }

      game.regions = newRegions;
      game.activeWall = null;

      // Calculate combined remaining area
      const combinedArea = getCombinedArea();
      const percent = Math.round((combinedArea / game.originalArea) * 100);
      setRemainingPercent(percent);

      // Check win condition
      if (percent < level.sizeThreshold) {
        game.levelComplete = true;
        const levelScore = computeLevelScore(level.points, level.expectedCuts, game.cutCount);
        
        setTimeout(() => {
          onLevelComplete({
            levelNumber,
            levelId: level.id,
            cutCount: game.cutCount,
            expectedCuts: level.expectedCuts,
            basePoints: level.points,
            levelScore,
            remainingPercent: percent,
          });
        }, 600);
        return;
      }

      // Speed up all balls if area was removed
      if (ballsInChild1.length === 0 || ballsInChild2.length === 0) {
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
      const { activeWall: wall, regions, balls } = game;
      if (!wall || wall.isComplete) return;

      // Find the active region for this wall
      const activeRegion = regions.find(r => r.id === wall.activeRegionId);
      if (!activeRegion) {
        game.activeWall = null;
        return;
      }

      const bounds = activeRegion.bounds;
      const growth = WALL_GROWTH_SPEED * dt;

      if (wall.orientation === 'horizontal') {
        wall.startExtent = Math.max(bounds.left, wall.startExtent - growth);
        wall.endExtent = Math.min(bounds.right, wall.endExtent + growth);
        if (wall.startExtent <= bounds.left && wall.endExtent >= bounds.right) {
          wall.isComplete = true;
        }
      } else {
        wall.startExtent = Math.max(bounds.top, wall.startExtent - growth);
        wall.endExtent = Math.min(bounds.bottom, wall.endExtent + growth);
        if (wall.startExtent <= bounds.top && wall.endExtent >= bounds.bottom) {
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
            const combinedArea = game.regions.reduce((sum, r) => sum + getRegionArea(r.bounds), 0);
            const percent = Math.round((combinedArea / game.originalArea) * 100);
            onGameEnd({
              isWin: false,
              remainingPercent: percent,
              levelId: level.id,
              levelNumber,
              cutCount: game.cutCount,
              expectedCuts: level.expectedCuts,
              basePoints: level.points,
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
      const { regions, balls, activeWall: wall, canvasSize, backgroundColor, regionColor } = game;
      const { width, height } = canvasSize;

      // Fill with darkness (background)
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);

      // Fill all regions with region color
      ctx.fillStyle = regionColor;
      for (const region of regions) {
        const b = region.bounds;
        ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      }

      // Render growing wall
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

    // Handle ball-to-ball collisions
    const handleBallCollisions = () => {
      const balls = game.balls;
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const ball1 = balls[i];
          const ball2 = balls[j];
          
          // Only check collisions if balls are in the same region
          if (ball1.regionId !== ball2.regionId) continue;
          
          const dx = ball2.position.x - ball1.position.x;
          const dy = ball2.position.y - ball1.position.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = ball1.radius + ball2.radius;
          
          if (distance < minDistance && distance > 0) {
            // Normalize collision vector
            const nx = dx / distance;
            const ny = dy / distance;
            
            // Relative velocity
            const dvx = ball1.velocity.x - ball2.velocity.x;
            const dvy = ball1.velocity.y - ball2.velocity.y;
            
            // Relative velocity along collision normal
            const dvn = dvx * nx + dvy * ny;
            
            // Only resolve if balls are moving towards each other
            if (dvn > 0) {
              // Update velocities (equal mass elastic collision)
              ball1.velocity.x -= dvn * nx;
              ball1.velocity.y -= dvn * ny;
              ball2.velocity.x += dvn * nx;
              ball2.velocity.y += dvn * ny;
              
              // Separate balls to prevent overlap
              const overlap = minDistance - distance;
              const separationX = (overlap / 2) * nx;
              const separationY = (overlap / 2) * ny;
              ball1.position.x -= separationX;
              ball1.position.y -= separationY;
              ball2.position.x += separationX;
              ball2.position.y += separationY;
            }
          }
        }
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
      // Check ball-to-ball collisions
      handleBallCollisions();
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

      const pos = getCanvasCoords(e);
      const margin = WALL_THICKNESS;
      
      // Find which region contains this point
      const region = findRegionContainingPoint(game.regions, pos.x, pos.y);
      if (!region) return; // Clicked in darkness - ignore
      
      const bounds = region.bounds;
      
      // Check if inside the region with margin
      if (
        pos.x > bounds.left + margin &&
        pos.x < bounds.right - margin &&
        pos.y > bounds.top + margin &&
        pos.y < bounds.bottom - margin
      ) {
        game.swipeStart = pos;
        game.swipeRegionId = region.id;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete || game.activeWall) return;

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
        activeRegionId: game.swipeRegionId,
      };

      // Increment cut count when a valid wall is created
      game.cutCount += 1;
      setCutCount(game.cutCount);

      game.swipeStart = null;
      game.swipeRegionId = null;
    };

    const handlePointerUp = () => {
      game.swipeStart = null;
      game.swipeRegionId = null;
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
      {/* Level indicator and Score - top left */}
      <div className="absolute top-4 left-4 z-10 flex gap-3">
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Level</span>
          <div className="text-2xl font-display font-bold text-primary">
            {levelNumber} / {totalLevels}
          </div>
        </div>
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Score</span>
          <div className="text-2xl font-display font-bold text-accent">
            {totalScore}
          </div>
        </div>
      </div>

      {/* Cuts counter - top center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Cuts</span>
          <div className="text-2xl font-display font-bold text-foreground">
            {cutCount}
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
