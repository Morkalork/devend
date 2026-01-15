import { useRef, useEffect, useState, useCallback } from 'react';
import { Ball, Bounds, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from '@/types/game';
import { LevelConfig } from '@/types/level';
import { UpgradeConfig } from '@/types/upgrade';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';

interface GameCanvasProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  totalScore: number;
  ownedUpgradeIds: string[];
  upgrades: UpgradeConfig[];
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
}

// Game constants
const BASE_BALL_RADIUS = 10;
const BALL_SPEED_INCREASE = 1.05;
const WALL_THICKNESS = 6;
const BASE_WALL_GROWTH_SPEED = 1200;
const BASE_SWIPE_MIN_DISTANCE = 15;
const ARENA_MARGIN = 0.1;

// Colors
const COLORS = {
  wallActive: '#ff8800',
  wallActiveGlow: 'rgba(255, 136, 0, 0.5)',
  cutPreview: 'rgba(255, 255, 255, 0.3)',
  fastestBallHighlight: '#00ffff',
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

export function GameCanvas({ level, levelNumber, totalLevels, totalScore, ownedUpgradeIds, upgrades, onGameEnd, onLevelComplete }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remainingPercent, setRemainingPercent] = useState(100);
  const [cutCount, setCutCount] = useState(0);
  const [wallShieldCount, setWallShieldCount] = useState(0);
  
  // Calculate active modifiers from owned upgrades
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades);
  
  const gameRef = useRef({
    regions: [] as Region[],
    originalArea: 0,
    balls: [] as Ball[],
    activeWall: null as GrowingWall | null,
    gameOver: false,
    levelComplete: false,
    swipeStart: null as Vector2 | null,
    swipeRegionId: null as string | null,
    currentSwipePos: null as Vector2 | null, // For cut preview
    lastTime: 0,
    animationId: 0,
    canvasSize: { width: 0, height: 0 },
    backgroundColor: `#${level.backgroundColor}`,
    regionColor: `#${level.rectangleColor}`,
    cutCount: 0,
    wallShieldsRemaining: 0,
    fastestBallId: null as string | null,
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const game = gameRef.current;
    game.backgroundColor = `#${level.backgroundColor}`;
    game.regionColor = `#${level.rectangleColor}`;
    game.wallShieldsRemaining = activeModifiers.wallShield;
    setWallShieldCount(activeModifiers.wallShield);
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Calculate effective ball radius with modifier
    const effectiveBallRadius = BASE_BALL_RADIUS * activeModifiers.ballSizeMultiplier;
    
    // Calculate effective swipe distance with modifier
    const effectiveSwipeMinDistance = BASE_SWIPE_MIN_DISTANCE / activeModifiers.swipeSensitivity;

    const initGame = () => {
      const { width, height } = game.canvasSize;
      const margin = Math.min(width, height) * ARENA_MARGIN;
      const arenaWidth = width - margin * 2;
      const arenaHeight = height - margin * 2;
      
      // Reset region counter for new level
      regionIdCounter = 0;
      
      // Calculate starting percentage based on reducedSize modifier
      const targetRemaining = Math.max(20, 100 - activeModifiers.reducedSizePercent);
      
      // Scale factor to shrink the region
      const scaleFactor = Math.sqrt(targetRemaining / 100);
      
      // Calculate shrunk dimensions centered in the arena
      const shrunkWidth = arenaWidth * scaleFactor;
      const shrunkHeight = arenaHeight * scaleFactor;
      const centerX = margin + arenaWidth / 2;
      const centerY = margin + arenaHeight / 2;
      
      // Create initial single region (possibly shrunk)
      const initialRegionId = generateRegionId();
      const initialBounds: Bounds = {
        left: centerX - shrunkWidth / 2,
        top: centerY - shrunkHeight / 2,
        right: centerX + shrunkWidth / 2,
        bottom: centerY + shrunkHeight / 2,
      };
      
      game.regions = [{
        id: initialRegionId,
        bounds: initialBounds,
      }];
      
      // Original area is still based on full arena (for percentage calculation)
      game.originalArea = arenaWidth * arenaHeight;
      
      // Create balls from level config with modifiers applied
      const regionWidth = initialBounds.right - initialBounds.left;
      const regionHeight = initialBounds.bottom - initialBounds.top;
      const regionCenterX = (initialBounds.left + initialBounds.right) / 2;
      const regionCenterY = (initialBounds.top + initialBounds.bottom) / 2;
      
      game.balls = level.balls.map((ballConfig) => {
        const dir = getRandomDirection();
        // Apply ball speed multiplier
        const modifiedSpeed = ballConfig.initialSpeed * activeModifiers.ballSpeedMultiplier;
        const modifiedTopSpeed = ballConfig.topSpeed * activeModifiers.ballSpeedMultiplier;
        
        return {
          id: ballConfig.id,
          position: { 
            x: regionCenterX + (Math.random() - 0.5) * regionWidth * 0.3,
            y: regionCenterY + (Math.random() - 0.5) * regionHeight * 0.3,
          },
          velocity: { 
            x: dir.x * modifiedSpeed, 
            y: dir.y * modifiedSpeed,
          },
          radius: effectiveBallRadius, // Apply ball size multiplier
          speed: modifiedSpeed,
          topSpeed: modifiedTopSpeed,
          color: `#${ballConfig.color}`,
          regionId: initialRegionId,
        };
      });
      
      // Find and track the fastest ball for highlighting
      if (activeModifiers.highlightFastestBall && game.balls.length > 0) {
        let fastestSpeed = 0;
        let fastestId = game.balls[0].id;
        for (const ball of game.balls) {
          const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2);
          if (speed > fastestSpeed) {
            fastestSpeed = speed;
            fastestId = ball.id;
          }
        }
        game.fastestBallId = fastestId;
      }
      
      game.activeWall = null;
      game.gameOver = false;
      game.levelComplete = false;
      game.swipeStart = null;
      game.swipeRegionId = null;
      game.currentSwipePos = null;
      game.lastTime = 0;
      game.cutCount = 0;
      setCutCount(0);
      setRemainingPercent(Math.round(targetRemaining));
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

    const handleGameOver = () => {
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
          handleGameOver();
          return;
        }
      }

      // Split the active region into two child regions
      let childBounds1: Bounds;
      let childBounds2: Bounds;

      if (wall.orientation === 'horizontal') {
        const cutY = wall.origin.y;
        childBounds1 = { ...bounds, bottom: cutY - wall.thickness / 2 };
        childBounds2 = { ...bounds, top: cutY + wall.thickness / 2 };
      } else {
        const cutX = wall.origin.x;
        childBounds1 = { ...bounds, right: cutX - wall.thickness / 2 };
        childBounds2 = { ...bounds, left: cutX + wall.thickness / 2 };
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
        
        // Apply expectedCutsBonus for scoring only
        const effectiveExpectedCuts = level.expectedCuts + activeModifiers.expectedCutsBonus;
        let levelScore = computeLevelScore(level.points, effectiveExpectedCuts, game.cutCount);
        
        // Apply score multiplier
        levelScore = Math.round(levelScore * activeModifiers.scoreMultiplier);
        
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
        
        // Update fastest ball tracking
        if (activeModifiers.highlightFastestBall) {
          let fastestSpeed = 0;
          let fastestId = game.balls[0]?.id || null;
          for (const ball of game.balls) {
            const speed = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2);
            if (speed > fastestSpeed) {
              fastestSpeed = speed;
              fastestId = ball.id;
            }
          }
          game.fastestBallId = fastestId;
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
      // Apply wall speed multiplier
      const effectiveWallSpeed = BASE_WALL_GROWTH_SPEED * activeModifiers.wallSpeedMultiplier;
      const growth = effectiveWallSpeed * dt;

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
          // Apply wallGrace modifier - reduce effective ball radius for collision
          const graceMultiplier = 1 - activeModifiers.wallGrace;
          const effectiveCollisionRadius = ball.radius * graceMultiplier;
          
          if (circleRectCollision(ball.position.x, ball.position.y, effectiveCollisionRadius, rx, ry, rw, rh)) {
            // Check if we have wall shields
            if (game.wallShieldsRemaining > 0) {
              game.wallShieldsRemaining--;
              setWallShieldCount(game.wallShieldsRemaining);
              // Cancel the wall but don't game over
              game.activeWall = null;
              return;
            }
            
            handleGameOver();
            return;
          }
        }
      }

      if (wall.isComplete) {
        applyCut(wall);
      }
    };

    const render = () => {
      const { regions, balls, activeWall: wall, canvasSize, backgroundColor, regionColor, swipeStart, swipeRegionId, currentSwipePos } = game;
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

      // Render cut preview if enabled and swiping
      if (activeModifiers.cutPreview && swipeStart && swipeRegionId && currentSwipePos && !wall) {
        const region = regions.find(r => r.id === swipeRegionId);
        if (region) {
          const deltaX = currentSwipePos.x - swipeStart.x;
          const deltaY = currentSwipePos.y - swipeStart.y;
          
          if (Math.abs(deltaX) >= effectiveSwipeMinDistance || Math.abs(deltaY) >= effectiveSwipeMinDistance) {
            const isHorizontal = Math.abs(deltaX) >= Math.abs(deltaY);
            
            ctx.save();
            ctx.strokeStyle = COLORS.cutPreview;
            ctx.lineWidth = WALL_THICKNESS;
            ctx.setLineDash([10, 10]);
            ctx.beginPath();
            
            if (isHorizontal) {
              ctx.moveTo(region.bounds.left, swipeStart.y);
              ctx.lineTo(region.bounds.right, swipeStart.y);
            } else {
              ctx.moveTo(swipeStart.x, region.bounds.top);
              ctx.lineTo(swipeStart.x, region.bounds.bottom);
            }
            
            ctx.stroke();
            ctx.restore();
          }
        }
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
        const isFastest = activeModifiers.highlightFastestBall && ball.id === game.fastestBallId;
        
        // Fastest ball highlight ring
        if (isFastest) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(ball.position.x, ball.position.y, ball.radius + 15, 0, Math.PI * 2);
          ctx.strokeStyle = COLORS.fastestBallHighlight;
          ctx.lineWidth = 3;
          ctx.shadowColor = COLORS.fastestBallHighlight;
          ctx.shadowBlur = 15;
          ctx.stroke();
          ctx.restore();
        }
        
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
        game.currentSwipePos = pos;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete) return;

      const pos = getCanvasCoords(e);
      game.currentSwipePos = pos; // Update for preview
      
      if (game.activeWall) return; // Wall already created
      
      const deltaX = pos.x - game.swipeStart.x;
      const deltaY = pos.y - game.swipeStart.y;

      // Apply swipe sensitivity modifier
      if (Math.abs(deltaX) < effectiveSwipeMinDistance && Math.abs(deltaY) < effectiveSwipeMinDistance) return;

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
      game.currentSwipePos = null;
    };

    const handlePointerUp = () => {
      game.swipeStart = null;
      game.swipeRegionId = null;
      game.currentSwipePos = null;
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
  }, [level, levelNumber, onGameEnd, onLevelComplete, activeModifiers]);

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: `#${level.backgroundColor}` }}>
      {/* Cuts counter - top left */}
      <div className="absolute top-4 left-4 z-10 flex gap-3">
        <div className="hud-display">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Cuts</span>
          <div className="text-2xl font-display font-bold text-foreground">
            {cutCount}
          </div>
        </div>
        {wallShieldCount > 0 && (
          <div className="hud-display">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Shields</span>
            <div className="text-2xl font-display font-bold text-cyan-400">
              {wallShieldCount}
            </div>
          </div>
        )}
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
