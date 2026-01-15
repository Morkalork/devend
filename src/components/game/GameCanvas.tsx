import { useRef, useEffect, useState, useCallback } from 'react';
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from '@/types/game';
import { LevelConfig } from '@/types/level';
import { UpgradeConfig } from '@/types/upgrade';
import { useActiveModifiers } from '@/hooks/useActiveModifiers';
import { PushYourLuckOverlay } from './PushYourLuckOverlay';
import {
  Polygon,
  vec2Add,
  vec2Sub,
  vec2Scale,
  vec2Normalize,
  vec2Length,
  vec2Distance,
  vec2Dot,
  polygonArea,
  pointInPolygon,
  rayPolygonIntersection,
  splitPolygon,
  createRectPolygon,
  resolveBallPolygonCollision,
  circleCapsuleCollision,
  polygonCentroid,
  polygonBounds,
} from '@/lib/polygon';

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
const BALL_SPEED_INCREASE = 1.03; // Post-cut speed ramp
const WALL_THICKNESS = 6;
const BASE_SWIPE_MIN_DISTANCE = 20;
const ARENA_MARGIN = 0.1;
const MINIMUM_WALL_TIME = 0.35; // seconds

// Difficulty curve: wall speed decreases per level (slower = harder)
function getWallSpeedBase(levelIndex: number): number {
  return Math.max(420, Math.min(700, 700 - (levelIndex - 1) * 30));
}

// Difficulty curve: ball speed increases per level (faster = harder)
function getBallSpeedLevelMultiplier(levelIndex: number): number {
  return 1 + (levelIndex - 1) * 0.06;
}

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

function hexToRgba(hex: string, alpha: number = 1): string {
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function findRegionContainingPoint(regions: Region[], x: number, y: number): Region | null {
  for (const region of regions) {
    if (pointInPolygon({ x, y }, region.polygon)) {
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

// Calculate overcut bonus
function computeOvercutBonus(threshold: number, remaining: number, basePoints: number): number {
  const overshoot = Math.max(0, threshold - remaining);
  if (overshoot <= 0) return 0;
  const overcutRatio = overshoot / threshold;
  const bonus = Math.round(basePoints * 0.6 * Math.sqrt(overcutRatio));
  const maxBonus = Math.floor(0.5 * basePoints);
  return Math.min(bonus, maxBonus);
}

export function GameCanvas({ level, levelNumber, totalLevels, totalScore, ownedUpgradeIds, upgrades, onGameEnd, onLevelComplete }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remainingPercent, setRemainingPercent] = useState(100);
  const [cutCount, setCutCount] = useState(0);
  const [wallShieldCount, setWallShieldCount] = useState(0);
  
  // Push Your Luck state
  const [pushMode, setPushMode] = useState<'none' | 'prompt' | 'pushing'>('none');
  const [clearedPercent, setClearedPercent] = useState<number | null>(null);
  
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
    currentSwipePos: null as Vector2 | null,
    lastTime: 0,
    animationId: 0,
    canvasSize: { width: 0, height: 0 },
    backgroundColor: `#${level.backgroundColor}`,
    regionColor: `#${level.rectangleColor}`,
    cutCount: 0,
    wallShieldsRemaining: 0,
    fastestBallId: null as string | null,
    pushMode: 'none' as 'none' | 'prompt' | 'pushing',
    bestRemainingPercent: 100,
    gameLoopFn: null as ((timestamp: number) => void) | null,
    wallCompleteTime: 0, // Time when wall completed, for visual delay
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
      
      // Create initial polygon region (rectangle)
      const initialRegionId = generateRegionId();
      const left = centerX - shrunkWidth / 2;
      const top = centerY - shrunkHeight / 2;
      const right = centerX + shrunkWidth / 2;
      const bottom = centerY + shrunkHeight / 2;
      
      const initialPolygon = createRectPolygon(left, top, right, bottom);
      
      game.regions = [{
        id: initialRegionId,
        polygon: initialPolygon,
      }];
      
      // Original area is still based on full arena (for percentage calculation)
      game.originalArea = arenaWidth * arenaHeight;
      
      // Create balls from level config with modifiers applied
      const centroid = polygonCentroid(initialPolygon);
      const bounds = polygonBounds(initialPolygon);
      const regionWidth = bounds.maxX - bounds.minX;
      const regionHeight = bounds.maxY - bounds.minY;
      
      // Calculate ball speed with level curve and modifiers
      const ballSpeedLevelMult = getBallSpeedLevelMultiplier(levelNumber);
      
      game.balls = level.balls.map((ballConfig) => {
        const dir = getRandomDirection();
        // Apply level curve and ball speed multiplier
        const levelScaledSpeed = ballConfig.initialSpeed * ballSpeedLevelMult * activeModifiers.ballSpeedMultiplier;
        const modifiedSpeed = Math.min(levelScaledSpeed, ballConfig.topSpeed);
        const modifiedTopSpeed = ballConfig.topSpeed * activeModifiers.ballSpeedMultiplier;
        
        return {
          id: ballConfig.id,
          position: { 
            x: centroid.x + (Math.random() - 0.5) * regionWidth * 0.3,
            y: centroid.y + (Math.random() - 0.5) * regionHeight * 0.3,
          },
          velocity: { 
            x: dir.x * modifiedSpeed, 
            y: dir.y * modifiedSpeed,
          },
          radius: effectiveBallRadius,
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
          const speed = vec2Length(ball.velocity);
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

    // Update ball position and bounce off polygon edges
    const updateBall = (ball: Ball, dt: number) => {
      const region = game.regions.find(r => r.id === ball.regionId);
      if (!region) return;

      // Move ball
      ball.position.x += ball.velocity.x * dt;
      ball.position.y += ball.velocity.y * dt;

      // Resolve collisions with polygon edges
      const result = resolveBallPolygonCollision(
        ball.position,
        ball.velocity,
        ball.radius,
        region.polygon
      );
      
      ball.position = result.position;
      ball.velocity = result.velocity;
    };

    // Calculate combined area of all regions
    const getCombinedArea = (): number => {
      return game.regions.reduce((sum, region) => sum + polygonArea(region.polygon), 0);
    };

    // Check if a ball's center is on the cut line
    const isBallOnCutLine = (ball: Ball, wall: GrowingWall): boolean => {
      // Distance from ball center to the cut line
      const toOrigin = vec2Sub(ball.position, wall.origin);
      const perpDist = Math.abs(toOrigin.x * (-wall.direction.y) + toOrigin.y * wall.direction.x);
      return perpDist < 0.5;
    };

    const handleGameOver = () => {
      game.gameOver = true;
      const percent = Math.round((getCombinedArea() / game.originalArea) * 100);
      
      // If in push mode, level is still cleared - just forfeit overcut bonus
      if (game.pushMode === 'pushing') {
        const effectiveExpectedCuts = level.expectedCuts + activeModifiers.expectedCutsBonus;
        let levelScore = computeLevelScore(level.points, effectiveExpectedCuts, game.cutCount);
        levelScore = Math.round(levelScore * activeModifiers.scoreMultiplier);
        
        // No overcut bonus on death during push mode
        onLevelComplete({
          levelNumber,
          levelId: level.id,
          cutCount: game.cutCount,
          expectedCuts: level.expectedCuts,
          basePoints: level.points,
          levelScore,
          remainingPercent: percent,
          overcutBonus: 0,
          thresholdPercent: level.sizeThreshold,
        });
        return;
      }
      
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

      // Check if any ball is exactly on the cut line - instant game over
      for (const ball of balls) {
        if (ball.regionId === activeRegion.id && isBallOnCutLine(ball, wall)) {
          handleGameOver();
          return;
        }
      }

      // Split the polygon along the cut
      const splitResult = splitPolygon(
        activeRegion.polygon,
        wall.startPoint,
        wall.endPoint
      );

      if (!splitResult) {
        game.activeWall = null;
        return;
      }

      const [poly1, poly2] = splitResult;
      const child1Id = generateRegionId();
      const child2Id = generateRegionId();

      // Assign balls to child regions
      const ballsInChild1: Ball[] = [];
      const ballsInChild2: Ball[] = [];

      for (const ball of balls) {
        if (ball.regionId !== activeRegion.id) continue;
        
        const inChild1 = pointInPolygon(ball.position, poly1);
        const inChild2 = pointInPolygon(ball.position, poly2);
        
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
        newRegions.push({ id: child1Id, polygon: poly1 });
      }
      if (ballsInChild2.length > 0) {
        newRegions.push({ id: child2Id, polygon: poly2 });
      }

      game.regions = newRegions;
      game.activeWall = null;

      // Calculate combined remaining area
      const combinedArea = getCombinedArea();
      const percent = Math.round((combinedArea / game.originalArea) * 100);
      setRemainingPercent(percent);

      // Track best remaining percent during push mode
      if (game.pushMode === 'pushing' && percent < game.bestRemainingPercent) {
        game.bestRemainingPercent = percent;
      }

      // Check if level just got cleared (first time crossing threshold)
      if (percent < level.sizeThreshold && game.pushMode === 'none') {
        // Show push your luck prompt
        game.pushMode = 'prompt';
        setPushMode('prompt');
        setClearedPercent(percent);
        game.bestRemainingPercent = percent;
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
            const speed = vec2Length(ball.velocity);
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

      // Calculate wall speed with level curve and modifiers
      const wallSpeedBase = getWallSpeedBase(levelNumber);
      const wallSpeedEffective = wallSpeedBase * activeModifiers.wallSpeedMultiplier;
      
      // Cap speed so walls never complete too fast in tiny regions
      // Wall grows in BOTH directions from origin, so use longest half-length for timing
      const maxSegmentLength = vec2Distance(wall.targetStart, wall.targetEnd);
      let distToStart = vec2Distance(wall.startPoint, wall.targetStart);
      let distToEnd = vec2Distance(wall.endPoint, wall.targetEnd);
      const longestHalf = Math.max(distToStart, distToEnd, maxSegmentLength / 2);
      const maxSpeedForMinTime = longestHalf / MINIMUM_WALL_TIME;
      const wallSpeedFinal = Math.min(wallSpeedEffective, maxSpeedForMinTime);
      
      const growth = wallSpeedFinal * dt;

      // Grow toward targetStart
      if (distToStart > 0.5) {
        const moveStart = Math.min(growth, distToStart);
        const dirToStart = vec2Normalize(vec2Sub(wall.targetStart, wall.startPoint));
        wall.startPoint = vec2Add(wall.startPoint, vec2Scale(dirToStart, moveStart));
      } else {
        wall.startPoint = { ...wall.targetStart };
      }

      // Grow toward targetEnd
      if (distToEnd > 0.5) {
        const moveEnd = Math.min(growth, distToEnd);
        const dirToEnd = vec2Normalize(vec2Sub(wall.targetEnd, wall.endPoint));
        wall.endPoint = vec2Add(wall.endPoint, vec2Scale(dirToEnd, moveEnd));
      } else {
        wall.endPoint = { ...wall.targetEnd };
      }

      // Check if complete
      if (vec2Distance(wall.startPoint, wall.targetStart) < 1 &&
          vec2Distance(wall.endPoint, wall.targetEnd) < 1) {
        wall.startPoint = { ...wall.targetStart };
        wall.endPoint = { ...wall.targetEnd };
        if (!wall.isComplete) {
          wall.isComplete = true;
          game.wallCompleteTime = performance.now();
        }
      }

      // Collision check with any ball while growing (capsule collision)
      if (!wall.isComplete) {
        for (const ball of balls) {
          // Apply wallGrace modifier - reduce effective ball radius for collision
          const graceMultiplier = 1 - activeModifiers.wallGrace;
          const effectiveCollisionRadius = ball.radius * graceMultiplier;
          
          if (circleCapsuleCollision(
            ball.position,
            effectiveCollisionRadius,
            wall.startPoint,
            wall.endPoint,
            wall.thickness / 2
          )) {
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

      // Don't call applyCut here - let it render complete wall first
      // applyCut will be called from gameLoop after render
    };

    const render = () => {
      const { regions, balls, activeWall: wall, canvasSize, backgroundColor, regionColor, swipeStart, swipeRegionId, currentSwipePos } = game;
      const { width, height } = canvasSize;

      // Fill with darkness (background)
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);

      // Fill all regions with region color (polygons)
      ctx.fillStyle = regionColor;
      for (const region of regions) {
        const { vertices } = region.polygon;
        if (vertices.length < 3) continue;
        
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Render cut preview if enabled and swiping
      if (activeModifiers.cutPreview && swipeStart && swipeRegionId && currentSwipePos && !wall) {
        const region = regions.find(r => r.id === swipeRegionId);
        if (region) {
          const delta = vec2Sub(currentSwipePos, swipeStart);
          const dist = vec2Length(delta);
          
          if (dist >= effectiveSwipeMinDistance) {
            const direction = vec2Normalize(delta);
            
            // Find intersection points with polygon
            const intPos = rayPolygonIntersection(swipeStart, direction, region.polygon);
            const intNeg = rayPolygonIntersection(swipeStart, vec2Scale(direction, -1), region.polygon);
            
            if (intPos && intNeg) {
              ctx.save();
              ctx.strokeStyle = COLORS.cutPreview;
              ctx.lineWidth = WALL_THICKNESS;
              ctx.setLineDash([10, 10]);
              ctx.beginPath();
              ctx.moveTo(intNeg.point.x, intNeg.point.y);
              ctx.lineTo(intPos.point.x, intPos.point.y);
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      // Render wall - ALWAYS draw if wall exists
      if (wall) {
        ctx.save();
        
        // Draw glow
        ctx.shadowColor = COLORS.wallActiveGlow;
        ctx.shadowBlur = 25;
        
        // Draw the main wall line
        ctx.strokeStyle = COLORS.wallActive;
        ctx.lineWidth = wall.thickness + 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(wall.startPoint.x, wall.startPoint.y);
        ctx.lineTo(wall.endPoint.x, wall.endPoint.y);
        ctx.stroke();
        
        // Draw white outline for contrast
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = wall.thickness + 6;
        ctx.beginPath();
        ctx.moveTo(wall.startPoint.x, wall.startPoint.y);
        ctx.lineTo(wall.endPoint.x, wall.endPoint.y);
        ctx.stroke();
        
        // Draw orange center
        ctx.strokeStyle = COLORS.wallActive;
        ctx.lineWidth = wall.thickness + 2;
        ctx.beginPath();
        ctx.moveTo(wall.startPoint.x, wall.startPoint.y);
        ctx.lineTo(wall.endPoint.x, wall.endPoint.y);
        ctx.stroke();
        
        ctx.restore();
        
        // Debug: log when wall is complete but still rendering
        if (wall.isComplete) {
          console.log('Rendering complete wall, length:', vec2Distance(wall.startPoint, wall.endPoint));
        }
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
          
          const delta = vec2Sub(ball2.position, ball1.position);
          const distance = vec2Length(delta);
          const minDistance = ball1.radius + ball2.radius;
          
          if (distance < minDistance && distance > 0) {
            // Normalize collision vector
            const normal = vec2Normalize(delta);
            
            // Relative velocity
            const relVel = vec2Sub(ball1.velocity, ball2.velocity);
            
            // Relative velocity along collision normal
            const relVelNormal = vec2Dot(relVel, normal);
            
            // Only resolve if balls are moving towards each other
            if (relVelNormal > 0) {
              // Update velocities (equal mass elastic collision)
              ball1.velocity = vec2Sub(ball1.velocity, vec2Scale(normal, relVelNormal));
              ball2.velocity = vec2Add(ball2.velocity, vec2Scale(normal, relVelNormal));
              
              // Separate balls to prevent overlap
              const overlap = minDistance - distance;
              const separation = vec2Scale(normal, overlap / 2);
              ball1.position = vec2Sub(ball1.position, separation);
              ball2.position = vec2Add(ball2.position, separation);
            }
          }
        }
      }
    };

    const gameLoop = (timestamp: number) => {
      if (game.gameOver || game.levelComplete || game.pushMode === 'prompt') return;

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
      
      // Apply completed wall cut AFTER rendering (so wall is visible when complete)
      // Add a small delay (100ms) to ensure wall is visible before cut is applied
      const WALL_VISIBLE_DELAY = 100; // ms
      if (game.activeWall && game.activeWall.isComplete) {
        const timeSinceComplete = performance.now() - game.wallCompleteTime;
        if (timeSinceComplete >= WALL_VISIBLE_DELAY) {
          applyCut(game.activeWall);
        }
      }

      game.animationId = requestAnimationFrame(gameLoop);
    };
    
    // Store gameLoop in ref so it can be restarted
    game.gameLoopFn = gameLoop;

    const getCanvasCoords = (e: PointerEvent): Vector2 => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (game.gameOver || game.levelComplete || game.activeWall || game.pushMode === 'prompt') return;

      const pos = getCanvasCoords(e);
      
      // Find which region contains this point
      const region = findRegionContainingPoint(game.regions, pos.x, pos.y);
      if (!region) return; // Clicked in darkness - ignore
      
      game.swipeStart = pos;
      game.swipeRegionId = region.id;
      game.currentSwipePos = pos;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete) return;

      const pos = getCanvasCoords(e);
      game.currentSwipePos = pos; // Update for preview
      
      if (game.activeWall) return; // Wall already created
      
      const delta = vec2Sub(pos, game.swipeStart);
      const dist = vec2Length(delta);

      // Apply swipe sensitivity modifier
      if (dist < effectiveSwipeMinDistance) return;

      const direction = vec2Normalize(delta);
      
      // Find the active region
      const region = game.regions.find(r => r.id === game.swipeRegionId);
      if (!region) {
        game.swipeStart = null;
        game.swipeRegionId = null;
        game.currentSwipePos = null;
        return;
      }

      // Find intersection points with polygon boundary
      const intPos = rayPolygonIntersection(game.swipeStart, direction, region.polygon);
      const intNeg = rayPolygonIntersection(game.swipeStart, vec2Scale(direction, -1), region.polygon);
      
      if (!intPos || !intNeg) {
        // Cannot create valid cut
        game.swipeStart = null;
        game.swipeRegionId = null;
        game.currentSwipePos = null;
        return;
      }

      game.activeWall = {
        origin: { ...game.swipeStart },
        direction,
        startPoint: { ...game.swipeStart },
        endPoint: { ...game.swipeStart },
        targetStart: intNeg.point,
        targetEnd: intPos.point,
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

  // Handlers for Push Your Luck overlay
  const handleBankAndContinue = useCallback(() => {
    const game = gameRef.current;
    game.levelComplete = true;
    
    // Calculate score with overcut bonus
    const effectiveExpectedCuts = level.expectedCuts + activeModifiers.expectedCutsBonus;
    let baseScore = computeLevelScore(level.points, effectiveExpectedCuts, game.cutCount);
    baseScore = Math.round(baseScore * activeModifiers.scoreMultiplier);
    
    const overcutBonus = computeOvercutBonus(level.sizeThreshold, game.bestRemainingPercent, level.points);
    const levelScore = baseScore + overcutBonus;
    
    setTimeout(() => {
      onLevelComplete({
        levelNumber,
        levelId: level.id,
        cutCount: game.cutCount,
        expectedCuts: level.expectedCuts,
        basePoints: level.points,
        levelScore,
        remainingPercent: game.bestRemainingPercent,
        overcutBonus,
        thresholdPercent: level.sizeThreshold,
      });
    }, 300);
  }, [level, levelNumber, activeModifiers, onLevelComplete]);

  const handlePushYourLuck = useCallback(() => {
    const game = gameRef.current;
    game.pushMode = 'pushing';
    setPushMode('pushing');
  }, []);
  
  // Resume game loop when push mode becomes 'pushing'
  useEffect(() => {
    if (pushMode !== 'pushing') return;
    
    const game = gameRef.current;
    game.lastTime = 0;
    
    // Restart the game loop - cancel any existing and start fresh
    if (game.gameLoopFn) {
      cancelAnimationFrame(game.animationId);
      // Small delay to ensure state is settled, then restart
      requestAnimationFrame(() => {
        game.lastTime = 0;
        game.animationId = requestAnimationFrame(game.gameLoopFn!);
      });
    }
  }, [pushMode]);

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
          <div className={`text-2xl font-display font-bold ${pushMode === 'pushing' ? 'text-amber-400' : 'text-primary'}`}>
            {remainingPercent}%
          </div>
          <span className="text-muted-foreground text-xs">
            {pushMode === 'pushing' ? 'Push Mode!' : `Target: <${level.sizeThreshold}%`}
          </span>
        </div>
      </div>

      <div ref={containerRef} className="w-full h-full">
        <canvas
          ref={canvasRef}
          className="touch-none cursor-crosshair"
        />
      </div>

      {/* Bank button during push mode */}
      {pushMode === 'pushing' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={handleBankAndContinue}
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-lg hover:from-amber-400 hover:to-orange-400 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Bank & Continue
          </button>
        </div>
      )}

      {/* Push Your Luck Overlay */}
      {pushMode === 'prompt' && clearedPercent !== null && (
        <PushYourLuckOverlay
          remainingPercent={clearedPercent}
          thresholdPercent={level.sizeThreshold}
          basePoints={level.points}
          onBank={handleBankAndContinue}
          onPush={handlePushYourLuck}
        />
      )}
    </div>
  );
}
