import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from "@/types/game";
import { LevelConfig, LevelEntity } from "@/types/level";
import { UpgradeConfig } from "@/types/upgrade";
import { generateRandomObstacles } from "@/lib/randomObstacles";
import { decoratePolygon } from "@/lib/obstacleDecorations";
import { 
  getVarietyDecorationConfig, 
  applyRectVariation, 
  applyCircleVariation, 
  applyPolygonVariation,
  resetRunSeed 
} from "@/lib/varietySystem";
import { useActiveModifiers } from "@/hooks/useActiveModifiers";
import { calculateScore, ensureScoringConfigLoaded } from "@/hooks/useScoring";
import { PushYourLuckOverlay } from "./PushYourLuckOverlay";
import { InteractiveTutorialOverlay } from "./InteractiveTutorialOverlay";
import { TutorialStep } from "@/hooks/useInteractiveTutorial";
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
  resolveBallPolygonCollisionOutward,
  circleCapsuleCollision,
  polygonCentroid,
  polygonBounds,
  createPolygonFromShape,
  pointToSegmentDistance,
  lineSegmentIntersection,
  clipLineAgainstPolygons,
  closestPointOnSegment,
} from "@/lib/polygon";
import { extractContours } from "@/lib/contour";
import { Wall, WALL_THICKNESS, WALL_COLOR, createWallsFromPolygon, findWallTermination } from "@/lib/wallGeometry";
import { 
  registerWallImpact, 
  updateWallImpacts, 
  renderWallWithEffects, 
  clearWallImpacts 
} from "@/lib/wallImpactEffects";
import {
  REGION_SAMPLE_GRID_SIZE,
  CONTAINMENT_MARGIN,
  validateAllBallOwnership,
  reassignBallsToRegions,
  isBallInRegion,
  findContainingRegion,
  constrainBallToRegion,
  wouldWallOrphanBall
} from "@/lib/regionOwnership";
import {
  SpaceGrid,
  GridRegion,
  createSpaceGrid,
  rasterizeCutToGrid,
  findGridRegions,
  getRemainingPercent,
  getRegionPercentage,
  removeRegion,
  getActiveCellPositions,
  getRegionCellPositions,
  isPositionActive,
  worldToGridIndex,
  gridIndexToWorld,
} from "@/lib/spaceGrid";
import { playWallHitSound, playBallCollideSound, playFenceBreakSound, playDeathSound, initAudio } from "@/lib/gameAudio";
import {
  createBallEffectState,
  updateBallEffects,
  triggerWallHit,
  triggerBallHit,
  renderBallEffects,
} from "@/lib/ballEffects";
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BOARD_ASPECT,
  TOP_UI_PERCENT,
  BOARD_BAND_PERCENT,
  BoardRect,
  computeBoardRect,
  screenToWorld,
  isPointInBoard,
} from "@/lib/boardConstants";

export interface GameStateInfo {
  cutsUsed: number;
  spaceRemaining: number;
  lockedBalls: number;
  pushMode: "none" | "prompt" | "pushing";
  onBankAndContinue?: () => void;
}

interface GameCanvasProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  totalScore: number;
  ownedUpgradeIds: string[];
  upgrades: UpgradeConfig[];
  lives: number;
  onLivesChange: (newLives: number) => void;
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
  onGameStateChange?: (state: GameStateInfo) => void;
  tutorialMode?: boolean;
  tutorialStep?: TutorialStep;
  onTutorialCutSuccess?: () => void;
  canvasOpacity?: number;
  fenceSpeedBase?: number;
  fenceSpeedMin?: number;
  fenceSpeedPerLevel?: number;
  regionColor?: string; // hex color with #
  accentColor?: string; // hex color with #
}

// Game constants - all in WORLD units
const BASE_BALL_RADIUS = 18; // World units (was ~10 in ~450px canvas, now in 900px world)
const BALL_SPEED_INCREASE = 1.03; // Post-wall speed ramp
const BASE_SWIPE_MIN_DISTANCE = 35; // World units
const ARENA_MARGIN = 0.05; // 5% margin from board edges
const MINIMUM_WALL_TIME = 0.35; // seconds
const RECOVERY_WINDOW_MS = 700; // Recovery time after failed wall
const BALL_WON_REGION_THRESHOLD = 5; // Ball is WON if its region is <= this % of total area
const WON_BALL_SPIN_SPEED = 8; // Radians per second for won ball spin

// Difficulty curve: wall speed decreases per level (slower = harder)
function getWallSpeedBase(levelIndex: number, base = 1200, min = 750, perLevel = 50): number {
  // World units per second
  return Math.max(min, Math.min(base, base - (levelIndex - 1) * perLevel));
}

// Difficulty curve: ball speed increases per level (faster = harder)
function getBallSpeedLevelMultiplier(levelIndex: number): number {
  return 1 + (levelIndex - 1) * 0.06;
}

// Colors (static, non-configurable)
const COLORS = {
  cutPreview: "rgba(255, 255, 255, 0.3)",
  fastestBallHighlight: "#00ffff",
  debugOutline: "#ff00ff",
};

let regionIdCounter = 0;
function generateRegionId(): string {
  return `region-${++regionIdCounter}`;
}

let wallIdCounter = 0;
function generateWallId(): string {
  return `wall-${++wallIdCounter}`;
}

function getRandomDirection(): Vector2 {
  const minAngle = 15 * (Math.PI / 180);
  const maxAngle = 75 * (Math.PI / 180);
  const quadrant = Math.floor(Math.random() * 4);
  const baseAngle = minAngle + Math.random() * (maxAngle - minAngle);
  const angle = baseAngle + (quadrant * Math.PI) / 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function hexToRgba(hex: string, alpha: number = 1): string {
  // Remove # prefix if present
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
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

// Legacy scoring - kept for compatibility but primary scoring now uses configurable system
function computeLevelScore(basePoints: number, expectedCuts: number, actualCuts: number): number {
  let score: number;
  if (actualCuts <= expectedCuts) {
    score = basePoints + (expectedCuts - actualCuts);
  } else {
    score = basePoints - (actualCuts - expectedCuts);
  }
  return Math.max(0, score);
}

// Calculate overcut bonus - legacy function, now integrated into space optimization
function computeOvercutBonus(threshold: number, remaining: number, basePoints: number): number {
  const overshoot = Math.max(0, threshold - remaining);
  if (overshoot <= 0) return 0;
  const overcutRatio = overshoot / threshold;
  const bonus = Math.round(basePoints * 0.6 * Math.sqrt(overcutRatio));
  const maxBonus = Math.floor(0.5 * basePoints);
  return Math.min(bonus, maxBonus);
}

export function GameCanvas({
  level,
  levelNumber,
  totalLevels,
  totalScore,
  ownedUpgradeIds,
  upgrades,
  lives,
  onLivesChange,
  onGameEnd,
  onLevelComplete,
  onGameStateChange,
  tutorialMode = false,
  tutorialStep = "completed",
  onTutorialCutSuccess,
  canvasOpacity = 0.9,
  fenceSpeedBase = 1200,
  fenceSpeedMin = 750,
  fenceSpeedPerLevel = 50,
  regionColor: regionColorProp = "#1a3020",
  accentColor = "#00ff88",
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remainingPercent, setRemainingPercent] = useState(100);
  const [cutCount, setCutCount] = useState(0);
  const [wallShieldCount, setWallShieldCount] = useState(0);
  const [displayLives, setDisplayLives] = useState(lives);
  const [screenFlash, setScreenFlash] = useState<"none" | "red">("none");
  const [isRecovering, setIsRecovering] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isPlayerDragging, setIsPlayerDragging] = useState(false);
  const [canvasOffsetTop, setCanvasOffsetTop] = useState(0);
  const [canvasOffsetLeft, setCanvasOffsetLeft] = useState(0);
  const [tutorialCutMade, setTutorialCutMade] = useState(false);
  const [debugInfo, setDebugInfo] = useState({ boardWidth: 0, boardHeight: 0, scale: 0 });
  const [lockedBallsCount, setLockedBallsCount] = useState(0);
  
  // Track if game has been initialized to prevent re-init on resize events (e.g., shake animation)
  const gameInitializedRef = useRef(false);
  // Track which level the game was initialized for - only reset when level actually changes
  const initializedLevelRef = useRef<string | null>(null);

  // Ref to track current lives value for use in closures
  const livesRef = useRef(lives);
  useEffect(() => {
    livesRef.current = lives;
    setDisplayLives(lives);
  }, [lives]);

  // Push Your Luck state
  const [pushMode, setPushMode] = useState<"none" | "prompt" | "pushing">("none");
  const [clearedPercent, setClearedPercent] = useState<number | null>(null);

  // Calculate active modifiers from owned upgrades
  const activeModifiers = useActiveModifiers(ownedUpgradeIds, upgrades);

  // Game state notification moved to after handleBankAndContinue definition

  const gameRef = useRef({
    // ============================================================
    // EXPLICIT SPACE MODEL: SpaceGrid is the authoritative source
    // ============================================================
    spaceGrid: null as SpaceGrid | null, // Authoritative 2D grid model
    gridRegions: [] as GridRegion[], // Current connected regions from grid
    
    regions: [] as Region[], // Legacy - kept for rendering compatibility
    // UNIFIED WALL MODEL: All walls are identical in behavior and appearance
    walls: [] as Wall[], // All walls: board edges, obstacles, user-drawn
    obstaclePolygons: [] as Polygon[], // Obstacles for clipping user-drawn walls
    boardPolygon: null as Polygon | null, // Original board boundary for ball collision
    originalArea: 0,
    basePlayableArea: 0, // Initial playable area after subtracting obstacles
    balls: [] as Ball[],
    activeWall: null as GrowingWall | null,
    gameOver: false,
    levelComplete: false,
    swipeStart: null as Vector2 | null, // World coords
    swipeRegionId: null as string | null,
    currentSwipePos: null as Vector2 | null, // World coords
    lastTime: 0,
    animationId: 0,
    screenSize: { width: 0, height: 0 },
    boardRect: { left: 0, top: 0, width: 0, height: 0, scale: 1 } as BoardRect,
    backgroundColor: "#0a1a10", // Will be overridden by config
    regionColor: "#1a3020", // Will be overridden by config
    wallCount: 0, // Track user-added walls for scoring
    wallShieldsRemaining: 0,
    fastestBallId: null as string | null,
    pushMode: "none" as "none" | "prompt" | "pushing",
    bestRemainingPercent: 100,
    gameLoopFn: null as ((timestamp: number) => void) | null,
    wallCompleteTime: 0,
    isRecovering: false,
    recoveryEndTime: 0,
    initialSamplePoints: [] as Vector2[], // Track initial board area for blur effect
    frozenBallId: null as string | null, // Ball frozen after fence collision
    frozenBallVelocity: null as Vector2 | null, // Stored velocity to restore after freeze
    frozenBallPosition: null as Vector2 | null, // Stored position to restore after freeze
    // Lock bonus tracking: each locked ball gives 50 * lockOrder (50, 100, 150...)
    lockedBallsCount: 0,
    lockBonus: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Only reset game initialized flag when the level ACTUALLY changes
    // This prevents re-init when other useEffect dependencies change (e.g., callbacks recreated on render)
    if (initializedLevelRef.current !== level.id) {
      gameInitializedRef.current = false;
      initializedLevelRef.current = level.id;
    }

    const game = gameRef.current;
    game.regionColor = regionColorProp;
    game.wallShieldsRemaining = 0;
    setWallShieldCount(0);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate effective ball radius with modifier (world units)
    const effectiveBallRadius = BASE_BALL_RADIUS * activeModifiers.ballSizeMultiplier;

    // Calculate effective swipe distance with modifier (world units)
    const effectiveSwipeMinDistance = BASE_SWIPE_MIN_DISTANCE;

    const initGame = () => {
      // ============================================================
      // UNIFIED WALL MODEL INITIALIZATION
      // ============================================================
      // The game board is defined entirely by walls.
      // - Board edges are walls
      // - Obstacles are walls
      // - User-drawn lines become walls
      // All walls have identical appearance and behavior.
      // The playable area is enclosed spaces that contain balls.
      // ============================================================

      const margin = Math.min(BOARD_WIDTH, BOARD_HEIGHT) * ARENA_MARGIN;
      const arenaWidth = BOARD_WIDTH - margin * 2;
      const arenaHeight = BOARD_HEIGHT - margin * 2;

      // Reset counters for new level
      regionIdCounter = 0;
      wallIdCounter = 0;

      // No starting area reduction in new upgrade system
      const targetRemaining = 100;

      // Scale factor to shrink the region
      const scaleFactor = Math.sqrt(targetRemaining / 100);

      // Calculate shrunk dimensions centered in the arena
      const shrunkWidth = arenaWidth * scaleFactor;
      const shrunkHeight = arenaHeight * scaleFactor;
      const centerX = BOARD_WIDTH / 2;
      const centerY = BOARD_HEIGHT / 2;

      const left = centerX - shrunkWidth / 2;
      const top = centerY - shrunkHeight / 2;
      const right = centerX + shrunkWidth / 2;
      const bottom = centerY + shrunkHeight / 2;

      const boardPolygon = createRectPolygon(left, top, right, bottom);

      // Initialize walls array with board edges
      const allWalls: Wall[] = createWallsFromPolygon(boardPolygon, "board");

      // Collect obstacle polygons and create walls from them
      const obstaclePolygons: Polygon[] = [];

      // Reset run seed for new game/level to get consistent variety per run
      resetRunSeed();
      
      // Get variety value from level config (default 0 = no variation)
      const variety = level.variety ?? 0;

      // Generate random obstacles for this level (adds variety)
      const randomObstacles = generateRandomObstacles(
        levelNumber,
        level.entities || [],
        level.balls
      );
      const allEntities = [...(level.entities || []), ...randomObstacles];

      if (allEntities.length > 0) {
        let obstacleIndex = 0;
        for (const entity of allEntities) {
          if (entity.kind === "wall") {
            let basePolygon: Polygon;
            
            if (entity.shape === "rect") {
              // Apply size variation to rect based on variety
              const varied = applyRectVariation(
                entity.x, entity.y, entity.width, entity.height,
                variety, level.id, entity.id
              );
              basePolygon = createPolygonFromShape("rect", {
                x: varied.x,
                y: varied.y,
                width: varied.width,
                height: varied.height,
              });
            } else if (entity.shape === "polygon") {
              // Apply vertex offset variation to polygon based on variety
              const variedVertices = applyPolygonVariation(
                entity.points.map(([x, y]) => ({ x, y })),
                variety, level.id, entity.id
              );
              basePolygon = { vertices: variedVertices };
            } else if (entity.shape === "circle") {
              // Apply radius variation to circle based on variety
              const variedRadius = applyCircleVariation(
                entity.radius, variety, level.id, entity.id
              );
              const numSides = 24;
              const vertices: { x: number; y: number }[] = [];
              for (let i = 0; i < numSides; i++) {
                const angle = (i / numSides) * Math.PI * 2;
                vertices.push({
                  x: entity.cx + Math.cos(angle) * variedRadius,
                  y: entity.cy + Math.sin(angle) * variedRadius,
                });
              }
              basePolygon = { vertices };
            } else {
              continue;
            }

            // Add visual decorations (bumps, spikes, etc.) based on variety
            const decorationConfig = getVarietyDecorationConfig(
              variety, level.id, entity.id, obstacleIndex
            );
            const obstaclePolygon = variety > 0 
              ? decoratePolygon(basePolygon, decorationConfig)
              : basePolygon; // Skip decoration if variety is 0
            obstacleIndex++;

            obstaclePolygons.push(obstaclePolygon);
            // Add obstacle edges as walls
            const obstacleWalls = createWallsFromPolygon(obstaclePolygon, `obstacle-${entity.id}`);
            allWalls.push(...obstacleWalls);
          }
        }
      }

      // Store all walls and obstacles in unified model
      game.walls = allWalls;
      game.obstaclePolygons = obstaclePolygons;

      // NOTE: originalArea will be set later after sample points are generated
      // to ensure consistency with estimatedArea calculations
      game.originalArea = 0;
      game.basePlayableArea = 0;

      // Create balls first (we need their positions to determine which regions to keep)
      const bounds = polygonBounds(boardPolygon);
      const regionWidth = bounds.maxX - bounds.minX;
      const regionHeight = bounds.maxY - bounds.minY;
      const centroid = polygonCentroid(boardPolygon);

      const ballSpeedLevelMult = getBallSpeedLevelMultiplier(levelNumber);
      const baseSpeedMultiplier = 2.0;

      // Helper: check if a ball at given position fully fits inside playable area
      const isBallPositionValid = (pos: Vector2, radius: number): boolean => {
        const safeRadius = radius + 5; // Extra margin for safety
        
        // 1. Check ball center and perimeter are inside board polygon
        if (!pointInPolygon(pos, boardPolygon)) return false;
        
        // Check multiple points around ball perimeter
        const numPerimeterChecks = 16;
        for (let i = 0; i < numPerimeterChecks; i++) {
          const angle = (i / numPerimeterChecks) * Math.PI * 2;
          const perimeterPoint = { 
            x: pos.x + Math.cos(angle) * safeRadius, 
            y: pos.y + Math.sin(angle) * safeRadius 
          };
          if (!pointInPolygon(perimeterPoint, boardPolygon)) return false;
        }
        
        // 2. Check ball doesn't overlap any obstacle
        for (const obstacle of obstaclePolygons) {
          // Check if center is inside obstacle
          if (pointInPolygon(pos, obstacle)) return false;
          
          // Check if any perimeter point is inside obstacle
          for (let i = 0; i < numPerimeterChecks; i++) {
            const angle = (i / numPerimeterChecks) * Math.PI * 2;
            const perimeterPoint = { 
              x: pos.x + Math.cos(angle) * safeRadius, 
              y: pos.y + Math.sin(angle) * safeRadius 
            };
            if (pointInPolygon(perimeterPoint, obstacle)) return false;
          }
          
          // Check distance to obstacle edges (for edge-grazing cases)
          const obsBounds = polygonBounds(obstacle);
          // Quick bounding box check first
          if (pos.x + safeRadius > obsBounds.minX && 
              pos.x - safeRadius < obsBounds.maxX &&
              pos.y + safeRadius > obsBounds.minY && 
              pos.y - safeRadius < obsBounds.maxY) {
            // Detailed edge distance check
            for (let i = 0; i < obstacle.vertices.length; i++) {
              const v1 = obstacle.vertices[i];
              const v2 = obstacle.vertices[(i + 1) % obstacle.vertices.length];
              const dist = pointToSegmentDistance(pos, v1, v2);
              if (dist < safeRadius) return false;
            }
          }
        }
        
        // 3. Check ball edges are fully inside board bounds
        if (pos.x - safeRadius < left || pos.x + safeRadius > right ||
            pos.y - safeRadius < top || pos.y + safeRadius > bottom) {
          return false;
        }
        
        return true;
      };

      // Helper: find valid spawn position for a ball with specific radius
      const findValidSpawnPosition = (ballRadius: number): Vector2 => {
        // Try random positions, preferring center area first
        for (let attempt = 0; attempt < 300; attempt++) {
          // Gradually expand search area as attempts increase
          const spreadFactor = Math.min(0.8, 0.3 + (attempt / 300) * 0.5);
          const pos = {
            x: centroid.x + (Math.random() - 0.5) * regionWidth * spreadFactor,
            y: centroid.y + (Math.random() - 0.5) * regionHeight * spreadFactor,
          };
          
          if (isBallPositionValid(pos, ballRadius)) {
            return pos;
          }
        }
        
        // Grid search fallback: systematically check positions
        const gridStep = ballRadius * 2;
        for (let x = left + ballRadius + 10; x < right - ballRadius - 10; x += gridStep) {
          for (let y = top + ballRadius + 10; y < bottom - ballRadius - 10; y += gridStep) {
            const pos = { x, y };
            if (isBallPositionValid(pos, ballRadius)) {
              return pos;
            }
          }
        }
        
        // Last resort: spawn at centroid (may still cause issues on very constrained maps)
        console.warn("Could not find valid spawn position for ball, using centroid as fallback");
        return { ...centroid };
      };

      // Create all balls with positions
      game.balls = level.balls.map((ballConfig, index) => {
        const dir = getRandomDirection();
        const levelScaledSpeed =
          ballConfig.initialSpeed * baseSpeedMultiplier * ballSpeedLevelMult * activeModifiers.ballSpeedMultiplier;
        const modifiedTopSpeed = ballConfig.topSpeed * baseSpeedMultiplier * activeModifiers.ballSpeedMultiplier;
        const modifiedSpeed = Math.min(levelScaledSpeed, modifiedTopSpeed);

        // Use ball-specific radius if defined, otherwise fall back to default
        const ballRadius = (ballConfig.radius ?? BASE_BALL_RADIUS) * activeModifiers.ballSizeMultiplier;
        
        // Use configured start position if provided, otherwise fallback to safe spawn
        let position: Vector2;
        if (ballConfig.startX !== undefined && ballConfig.startY !== undefined) {
          // Use configured position, but validate it's safe
          const configuredPos = { x: ballConfig.startX, y: ballConfig.startY };
          if (isBallPositionValid(configuredPos, ballRadius)) {
            position = configuredPos;
          } else {
            console.warn(`Ball ${ballConfig.id} configured position is invalid, finding alternative`);
            position = findValidSpawnPosition(ballRadius);
          }
        } else {
          // No configured position, find a safe spawn
          position = findValidSpawnPosition(ballRadius);
        }
        
        return {
          id: ballConfig.id,
          position,
          velocity: { x: dir.x * modifiedSpeed, y: dir.y * modifiedSpeed },
          radius: ballRadius,
          speed: modifiedSpeed,
          topSpeed: modifiedTopSpeed,
          color: `#${ballConfig.color}`,
          regionId: "", // Will be assigned after regions are created
          rotation: Math.random() * Math.PI * 2, // Start with random rotation
          flashIntensity: 0, // Legacy - kept for compatibility
          effects: createBallEffectState(), // Visual effects state
          state: 'active' as const, // Ball starts in active state
          wonSpinSpeed: 0, // Only used when in 'won' state
        };
      });

      // Dead balls feature removed in new upgrade system

      // Store the board polygon for ball collision (never changes after init)
      game.boardPolygon = boardPolygon;

      // Initialize single region with sample points
      // Sample points define the playable area (inside board, outside obstacles)
      const initialRegionId = generateRegionId();
      
      // Generate initial samplePoints so the border renders correctly from the start
      const initBounds = polygonBounds(boardPolygon);
      const initGridSize = 15;
      const initSamplePoints: Vector2[] = [];
      
      for (let x = initBounds.minX + initGridSize / 2; x < initBounds.maxX; x += initGridSize) {
        for (let y = initBounds.minY + initGridSize / 2; y < initBounds.maxY; y += initGridSize) {
          const point = { x, y };
          
          // Must be inside the board polygon
          if (!pointInPolygon(point, boardPolygon)) continue;
          
          // Must not be inside any obstacle
          let insideObstacle = false;
          for (const obstacle of obstaclePolygons) {
            if (pointInPolygon(point, obstacle)) {
              insideObstacle = true;
              break;
            }
          }
          if (insideObstacle) continue;
          
          initSamplePoints.push(point);
        }
      }
      
      // Store initial sample points for blur effect (tracks full board area)
      game.initialSamplePoints = [...initSamplePoints];
      
      // ============================================================
      // EXPLICIT SPACE MODEL: Create authoritative SpaceGrid
      // ============================================================
      // The SpaceGrid is the single source of truth for space state.
      // All area calculations and region detection derive from it.
      // ============================================================
      game.spaceGrid = createSpaceGrid(boardPolygon, obstaclePolygons, initGridSize);
      game.gridRegions = findGridRegions(game.spaceGrid);
      
      // Calculate initial area from the authoritative grid (exact count)
      const initialEstimatedArea = game.spaceGrid.initialActiveCount * initGridSize * initGridSize;
      
      // Set originalArea to match the grid-based calculation for consistent percentages
      game.originalArea = initialEstimatedArea;
      game.basePlayableArea = initialEstimatedArea;
      
      game.regions = [{ 
        id: initialRegionId, 
        polygon: boardPolygon,
        samplePoints: initSamplePoints,
        estimatedArea: initialEstimatedArea
      }];

      // Assign all balls to their grid regions
      for (const ball of game.balls) {
        ball.regionId = initialRegionId;
        // Also validate ball is in active space
        if (!isPositionActive(game.spaceGrid, ball.position)) {
          console.warn(`[INIT] Ball ${ball.id} spawned in removed space, repositioning...`);
        }
      }

      // Track fastest ball (always track for potential future use)
      if (game.balls.length > 0) {
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
      game.wallCount = 0;
      clearWallImpacts(); // Clear any lingering visual effects
      setCutCount(0);
      setRemainingPercent(Math.round(targetRemaining));
    };

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      game.screenSize = { width, height };
      
      // Also resize blur canvas
      const blurCanvas = blurCanvasRef.current;
      if (blurCanvas) {
        blurCanvas.width = width;
        blurCanvas.height = height;
        blurCanvas.style.width = `${width}px`;
        blurCanvas.style.height = `${height}px`;
      }

      // Compute the board rectangle
      game.boardRect = computeBoardRect(width, height);

      // Update debug info
      setDebugInfo({
        boardWidth: Math.round(game.boardRect.width),
        boardHeight: Math.round(game.boardRect.height),
        scale: Math.round(game.boardRect.scale * 1000) / 1000,
      });

      // Only initialize game on first resize, not on subsequent ones (e.g., shake animation)
      if (!gameInitializedRef.current) {
        gameInitializedRef.current = true;
        initGame();
      }
    };

    // Resolve ball collision with a line segment (for completed cuts)
    // ROBUST: Uses larger collision margin and push-out distance to prevent tunneling
    const resolveBallLineCollision = (
      ballPos: Vector2,
      ballVel: Vector2,
      ballRadius: number,
      lineStart: Vector2,
      lineEnd: Vector2,
      lineThickness: number,
    ): { position: Vector2; velocity: Vector2; collided: boolean; impactPoint?: Vector2 } => {
      const dist = pointToSegmentDistance(ballPos, lineStart, lineEnd);
      // Use a slightly larger collision zone for detection (helps with fast-moving balls)
      const collisionDist = ballRadius + lineThickness / 2 + 2;

      if (dist < collisionDist) {
        // Get closest point on line
        const edge = vec2Sub(lineEnd, lineStart);
        const edgeLengthSq = edge.x * edge.x + edge.y * edge.y;
        let closestPoint: Vector2;

        if (edgeLengthSq === 0) {
          closestPoint = { ...lineStart };
        } else {
          const t = Math.max(0, Math.min(1, vec2Dot(vec2Sub(ballPos, lineStart), edge) / edgeLengthSq));
          closestPoint = vec2Add(lineStart, vec2Scale(edge, t));
        }

        // Normal points from line toward ball
        const toBall = vec2Sub(ballPos, closestPoint);
        let normal = vec2Normalize(toBall);
        if (vec2Length(toBall) < 0.001) {
          // Ball exactly on line, use perpendicular
          normal = vec2Normalize({ x: -edge.y, y: edge.x });
        }

        // Reflect velocity if moving toward line
        const velDotNormal = vec2Dot(ballVel, normal);
        let newVel = { ...ballVel };
        if (velDotNormal < 0) {
          newVel = vec2Sub(ballVel, vec2Scale(normal, 2 * velDotNormal));
        }

        // Push ball out with generous margin to prevent re-penetration
        const minSafeDist = ballRadius + lineThickness / 2 + 3;
        const pushDist = Math.max(0, minSafeDist - dist);
        const newPos = vec2Add(ballPos, vec2Scale(normal, pushDist + 2));

        return { position: newPos, velocity: newVel, collided: true, impactPoint: closestPoint };
      }

      return { position: ballPos, velocity: ballVel, collided: false };
    };

    // Update ball position and bounce off all walls (all in world coordinates)
    const updateBall = (ball: Ball, dt: number) => {
      // WON balls don't need physics updates - they just spin
      if (ball.state === 'won') return;
      
      // Move ball (world units)
      ball.position.x += ball.velocity.x * dt;
      ball.position.y += ball.velocity.y * dt;

      // Update rotation based on speed (medium spin rate)
      const speed = vec2Length(ball.velocity);
      const rotationSpeed = speed * 0.015; // Radians per second based on speed
      ball.rotation += rotationSpeed * dt;
      
      // Update ball visual effects (pulse, wall hit, ball hit decays)
      const now = performance.now();
      updateBallEffects(ball.effects, dt, now);
      
      // Legacy flash decay (kept for compatibility)
      if (ball.flashIntensity > 0) {
        ball.flashIntensity = Math.max(0, ball.flashIntensity - dt * 7);
      }

      // CRITICAL: First check if ball has escaped the board entirely
      // This is a safety recovery for high-speed tunneling through boundaries
      if (game.boardPolygon && !pointInPolygon(ball.position, game.boardPolygon)) {
        // Ball escaped! Find the nearest edge and push it back inside
        const boardVerts = game.boardPolygon.vertices;
        let minDist = Infinity;
        let nearestPoint: Vector2 = ball.position;
        let nearestNormal: Vector2 = { x: 0, y: -1 };
        
        for (let i = 0; i < boardVerts.length; i++) {
          const j = (i + 1) % boardVerts.length;
          const p1 = boardVerts[i];
          const p2 = boardVerts[j];
          const closest = closestPointOnSegment(ball.position, p1, p2);
          const dist = vec2Distance(ball.position, closest);
          
          if (dist < minDist) {
            minDist = dist;
            nearestPoint = closest;
            // Normal pointing into the board (toward centroid)
            const edge = vec2Sub(p2, p1);
            const perpendicular = vec2Normalize({ x: -edge.y, y: edge.x });
            const boardCentroid = polygonCentroid(game.boardPolygon);
            const toCenter = vec2Sub(boardCentroid, closest);
            // Choose direction pointing toward board center (inward)
            nearestNormal = vec2Dot(perpendicular, toCenter) > 0 ? perpendicular : vec2Scale(perpendicular, -1);
          }
        }
        
        // Push ball back inside with margin
        ball.position = vec2Add(nearestPoint, vec2Scale(nearestNormal, ball.radius + 5));
        
        // Reflect velocity
        const velDotNormal = vec2Dot(ball.velocity, nearestNormal);
        if (velDotNormal < 0) {
          ball.velocity = vec2Sub(ball.velocity, vec2Scale(nearestNormal, 2 * velDotNormal));
        }
        
        // CRITICAL: Reassign ball to the correct region after board escape recovery
        // The ball may have ended up in a different region than it was originally in
        let foundRegion = false;
        for (const region of game.regions) {
          // Check if ball is near any sample point in this region
          if (region.samplePoints) {
            for (const sample of region.samplePoints) {
              if (vec2Distance(ball.position, sample) < REGION_SAMPLE_GRID_SIZE * 1.5) {
                ball.regionId = region.id;
                foundRegion = true;
                console.warn("[PHYSICS] Ball escaped board, reassigned to region:", region.id);
                break;
              }
            }
          }
          if (foundRegion) break;
          
          // Fallback: check polygon containment
          if (!foundRegion && pointInPolygon(ball.position, region.polygon)) {
            ball.regionId = region.id;
            foundRegion = true;
            console.warn("[PHYSICS] Ball escaped board, reassigned to region (polygon):", region.id);
          }
        }
        
        console.warn("[PHYSICS] Ball escaped board, recovered to:", ball.position);
      }

      // Resolve collisions with board boundary (always use original board, not region bounding box)
      if (game.boardPolygon) {
        const boardResult = resolveBallPolygonCollision(ball.position, ball.velocity, ball.radius, game.boardPolygon);
        ball.position = boardResult.position;
        ball.velocity = boardResult.velocity;
        
        // Register wall impact for visual effect
        if (boardResult.collided && boardResult.impactEdge) {
          const speed = vec2Length(ball.velocity);
          const impactStrength = Math.min(1, speed / 400); // Normalize based on typical ball speed
          registerWallImpact(
            boardResult.impactEdge.start,
            boardResult.impactEdge.end,
            boardResult.impactEdge.point,
            impactStrength
          );
          // Trigger wall hit effect on ball
          triggerWallHit(ball.effects, performance.now());
          // Play wall hit sound
          playWallHitSound(impactStrength);
        }
      }

      // CRITICAL: Check obstacle polygon penetration before edge collisions
      // This catches cases where fast balls tunnel through edges between frames
      // or slip through vertex gaps in polygonal approximations of circles
      for (const obstacle of game.obstaclePolygons) {
        const obstacleResult = resolveBallPolygonCollisionOutward(
          ball.position,
          ball.velocity,
          ball.radius,
          obstacle
        );
        if (obstacleResult.collided) {
          ball.position = obstacleResult.position;
          ball.velocity = obstacleResult.velocity;
          
          // Trigger wall hit effect on ball
          triggerWallHit(ball.effects, performance.now());
          
          // Play wall hit sound for obstacle collision
          const speed = vec2Length(ball.velocity);
          const impactStrength = Math.min(1, speed / 400);
          playWallHitSound(impactStrength);
        }
      }

      // UNIFIED WALL MODEL: Balls bounce off all walls (board edges, obstacles, user walls)
      // User-drawn walls are stored in game.walls with id starting with "user-"
      for (const wall of game.walls) {
        // Skip board edge walls (already handled by boardPolygon collision above)
        if (wall.id.startsWith("board-")) continue;
        
        const wallResult = resolveBallLineCollision(
          ball.position,
          ball.velocity,
          ball.radius,
          wall.start,
          wall.end,
          wall.thickness,
        );
        ball.position = wallResult.position;
        ball.velocity = wallResult.velocity;
        
        // Register wall impact for visual effect
        if (wallResult.collided && wallResult.impactPoint) {
          const speed = vec2Length(ball.velocity);
          const impactStrength = Math.min(1, speed / 400);
          registerWallImpact(wall.start, wall.end, wallResult.impactPoint, impactStrength);
          // Trigger wall hit effect on ball
          triggerWallHit(ball.effects, performance.now());
          // Play wall hit sound
          playWallHitSound(impactStrength);
        }
      }
      
      // CRITICAL: Region containment check using strict ownership system
      // After all collisions, verify ball is still within its assigned region
      // SKIP for frozen balls - they should not be moved during freeze
      if (game.frozenBallId && ball.id === game.frozenBallId) return;
      
      const ballRegion = game.regions.find(r => r.id === ball.regionId);
      if (!ballRegion) return;
      
      // Use strict region ownership validation
      const isInAssigned = isBallInRegion(ball.position, ballRegion, game.walls);
      
      if (isInAssigned) return; // Ball is valid in its assigned region
      
      // Ball escaped - try to find which region it's actually in
      const actualRegion = findContainingRegion(ball.position, game.regions, game.walls);
      
      if (actualRegion) {
        // Ball moved to a different region - reassign it
        console.log("[OWNERSHIP] Ball", ball.id, "moved from", ball.regionId, "to", actualRegion.id);
        ball.regionId = actualRegion.id;
        return;
      }
      
      // Ball is not in ANY region - use constraint system to recover
      const constraint = constrainBallToRegion(ball, ballRegion, game.walls);
      
      if (constraint.corrected) {
        ball.position = constraint.position;
        if (constraint.newVelocity) {
          ball.velocity = constraint.newVelocity;
        }
        console.warn("[OWNERSHIP] Ball", ball.id, "escaped, recovered to region", ball.regionId);
      }
    };

    // ============================================================
    // EXPLICIT SPACE MODEL: Grid-based area calculation (authoritative)
    // ============================================================
    // The SpaceGrid is the single source of truth for area calculations.
    // This eliminates any inference from physics or collision outcomes.
    // ============================================================
    const getCombinedArea = (): number => {
      if (game.spaceGrid) {
        // Use authoritative grid count
        let activeCount = 0;
        for (let i = 0; i < game.spaceGrid.cells.length; i++) {
          if (game.spaceGrid.cells[i] === 0) activeCount++; // CellState.ACTIVE = 0
        }
        return activeCount * game.spaceGrid.cellSize * game.spaceGrid.cellSize;
      }
      // Fallback to legacy calculation
      return game.regions.reduce((sum, region) => {
        return sum + (region.estimatedArea ?? polygonArea(region.polygon));
      }, 0);
    };

    // Get remaining percentage from the authoritative grid
    const getGridRemainingPercent = (): number => {
      if (game.spaceGrid) {
        return getRemainingPercent(game.spaceGrid);
      }
      return (getCombinedArea() / game.originalArea) * 100;
    };

    // ============================================================
    // BALL WON STATE MANAGEMENT
    // ============================================================
    // A ball becomes WON when its region is <= BALL_WON_REGION_THRESHOLD% of total area.
    // WON balls: physics disabled, centered in region, continuous spin animation.
    // ============================================================
    const checkAndUpdateBallWonStates = (): boolean => {
      if (!game.spaceGrid) return false;
      
      let anyBallWon = false;
      const gridRegions = findGridRegions(game.spaceGrid);
      
      for (const ball of game.balls) {
        // Skip already won balls or dead balls
        if (ball.state === 'won' || ball.speed === 0) continue;
        
        // Find which grid region this ball is in
        const ballGridIndex = worldToGridIndex(game.spaceGrid, ball.position.x, ball.position.y);
        if (ballGridIndex < 0) continue;
        
        // Find the region containing this ball
        let ballRegion: GridRegion | null = null;
        for (const region of gridRegions) {
          if (region.cellIndices.includes(ballGridIndex)) {
            ballRegion = region;
            break;
          }
        }
        
        if (!ballRegion) continue;
        
        // Calculate region percentage
        const regionPercent = getRegionPercentage(game.spaceGrid, ballRegion);
        
        // Check if ball should become WON
        if (regionPercent <= BALL_WON_REGION_THRESHOLD) {
          console.log(`[WON] Ball ${ball.id} captured! Region is ${regionPercent.toFixed(1)}% of total area`);
          
          // Transition to WON state
          ball.state = 'won';
          ball.wonSpinSpeed = WON_BALL_SPIN_SPEED;
          ball.velocity = { x: 0, y: 0 }; // Stop physics
          
          // Move to center of region
          ball.position = { ...ballRegion.centroid };
          
           // Award lock bonus: +1h per locked ball, capped at 2h total
           game.lockedBallsCount += 1;
           const thisLockBonus = 1;
           game.lockBonus = Math.min(2, game.lockBonus + thisLockBonus);
           console.log(`[WON] Lock bonus: +${thisLockBonus} (total: ${game.lockBonus})`);
          
          // Update React state for UI display
          setLockedBallsCount(game.lockedBallsCount);
          
          anyBallWon = true;
        }
      }
      
      return anyBallWon;
    };

    // Check if all balls are in WON state (level win condition)
    const areAllBallsWon = (): boolean => {
      // Only check active balls (exclude dead balls)
      const activeBalls = game.balls.filter(b => b.speed > 0 || b.state === 'won');
      if (activeBalls.length === 0) return false;
      
      return activeBalls.every(ball => ball.state === 'won');
    };

    // Check if a ball's center is on the cut line
    const isBallOnCutLine = (ball: Ball, wall: GrowingWall): boolean => {
      const toOrigin = vec2Sub(ball.position, wall.origin);
      const perpDist = Math.abs(toOrigin.x * -wall.direction.y + toOrigin.y * wall.direction.x);
      return perpDist < 0.5;
    };

    const handleGameOver = () => {
      game.gameOver = true;
      playDeathSound();
      const percent = Math.round((getCombinedArea() / game.originalArea) * 100);

      // If in push mode, level is still cleared - just forfeit space bonus (penalty for failing push)
      if (game.pushMode === "pushing") {
        const effectiveExpectedCuts = level.expectedCuts;
        
        // Use new scoring system - but no space bonus since push failed
        const { levelScore, breakdown } = calculateScore(
          game.wallCount,
          effectiveExpectedCuts,
          percent,
          level.sizeThreshold,
          level.points,
          activeModifiers.scoreMultiplier,
          levelNumber
        );
        
        // Remove space bonus since push failed
        const adjustedLevelScore = Math.max(0, levelScore - breakdown.spaceBonus);

        onLevelComplete({
          levelNumber,
          levelId: level.id,
          cutCount: game.wallCount,
          expectedCuts: level.expectedCuts,
          basePoints: level.points,
          levelScore: adjustedLevelScore + game.lockBonus,
          remainingPercent: percent,
          overcutBonus: 0,
          thresholdPercent: level.sizeThreshold,
          underParBonus: breakdown.underParBonus,
          spaceBonus: 0,
          spaceBonusRaw: breakdown.spaceBonusRaw,
          performanceMultiplier: breakdown.performanceMultiplier,
          fencesUnderPar: breakdown.fencesUnderPar,
          fencesOverPar: breakdown.fencesOverPar,
          extraPercent: breakdown.extraPercent,
          lockBonus: game.lockBonus,
          lockedBallsCount: game.lockedBallsCount,
        });
        return;
      }

      // Freeze and shake for 1 second before showing game over
      setScreenFlash("red");
      setIsShaking(true);

      setTimeout(() => {
        setScreenFlash("none");
        setIsShaking(false);

        onGameEnd({
          isWin: false,
          remainingPercent: percent,
          levelId: level.id,
          levelNumber,
          cutCount: game.wallCount,
          expectedCuts: level.expectedCuts,
          basePoints: level.points,
        });
      }, 1000);
    };

    // Handle push-your-luck failure - level still complete, no life lost
    const handlePushFailed = () => {
      game.gameOver = true;
      const percent = Math.round((getCombinedArea() / game.originalArea) * 100);

      const effectiveExpectedCuts = level.expectedCuts;
      
      // Use new scoring system - but no space bonus since push failed
      const { levelScore, breakdown } = calculateScore(
        game.wallCount,
        effectiveExpectedCuts,
        percent,
        level.sizeThreshold,
        level.points,
        activeModifiers.scoreMultiplier,
        levelNumber
      );
      
      // Remove space bonus since push failed
      const adjustedLevelScore = levelScore - breakdown.spaceBonus;

      onLevelComplete({
        levelNumber,
        levelId: level.id,
        cutCount: game.wallCount,
        expectedCuts: level.expectedCuts,
        basePoints: level.points,
        levelScore: adjustedLevelScore + game.lockBonus,
        remainingPercent: percent,
        overcutBonus: 0,
        thresholdPercent: level.sizeThreshold,
        pushFailed: true,
        underParBonus: breakdown.underParBonus,
        spaceBonus: 0,
        spaceBonusRaw: breakdown.spaceBonusRaw,
        performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar,
        fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent,
        lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
      });
    };

    // Get all boundary segments from the unified wall model
    const getAllBoundarySegments = (region: Region): { p1: Vector2; p2: Vector2 }[] => {
      const segments: { p1: Vector2; p2: Vector2 }[] = [];

      // UNIFIED WALL MODEL: All walls define boundaries
      for (const wall of game.walls) {
        segments.push({ p1: wall.start, p2: wall.end });
      }

      return segments;
    };

    // Check if a line segment intersects or passes through any boundary
    const lineIntersectsBoundary = (
      p1: Vector2,
      p2: Vector2,
      segments: { p1: Vector2; p2: Vector2 }[],
      cuts: { start: Vector2; end: Vector2; thickness: number }[],
    ): boolean => {
      // Check regular segments (polygon edges, obstacle edges)
      for (const seg of segments) {
        if (lineSegmentIntersection(p1, p2, seg.p1, seg.p2)) {
          return true;
        }
      }

      // For cuts, check if the line segment crosses the cut or passes too close to it
      // This handles both perpendicular and parallel crossings
      for (const cut of cuts) {
        // Check direct intersection
        if (lineSegmentIntersection(p1, p2, cut.start, cut.end)) {
          return true;
        }

        // Check if either endpoint of our test line is within cut thickness of the cut line
        const dist1 = pointToSegmentDistance(p1, cut.start, cut.end);
        const dist2 = pointToSegmentDistance(p2, cut.start, cut.end);
        const halfThickness = cut.thickness / 2 + 2;

        // If both points are on opposite sides of the cut, they're blocked
        // Check by seeing if the midpoint is close to the cut
        const midPoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const distMid = pointToSegmentDistance(midPoint, cut.start, cut.end);

        // If midpoint is within cut thickness and we span across the cut, we're blocked
        if (distMid < halfThickness) {
          // Check if the cut actually spans between p1 and p2 by projecting onto cut direction
          const cutDir = vec2Normalize(vec2Sub(cut.end, cut.start));
          const perpDir = { x: -cutDir.y, y: cutDir.x };
          const proj1 = vec2Dot(vec2Sub(p1, cut.start), perpDir);
          const proj2 = vec2Dot(vec2Sub(p2, cut.start), perpDir);

          // If p1 and p2 are on opposite sides of the cut line, they're blocked
          if ((proj1 > 0 && proj2 < 0) || (proj1 < 0 && proj2 > 0)) {
            // Also verify we're within the cut segment's length
            const along1 = vec2Dot(vec2Sub(midPoint, cut.start), cutDir);
            const cutLen = vec2Distance(cut.start, cut.end);
            if (along1 >= 0 && along1 <= cutLen) {
              return true;
            }
          }
        }
      }

      return false;
    };

    // Find all distinct sub-regions using flood-fill on a grid
    const findSubRegionsGrid = (region: Region): { samples: Vector2[]; hasBalls: boolean }[] => {
      const { balls } = game;
      const bounds = polygonBounds(region.polygon);
      const gridSize = 15; // Finer grid for better cut detection

      // UNIFIED WALL MODEL: Build wall segments from all walls
      const wallSegments: { p1: Vector2; p2: Vector2; wallId: string }[] = [];
      for (const wall of game.walls) {
        wallSegments.push({ p1: wall.start, p2: wall.end, wallId: wall.id });
      }

      // Generate valid sample points
      const samplePoints: Vector2[] = [];
      const pointIndices: Map<string, number> = new Map();

      for (let x = bounds.minX + gridSize / 2; x < bounds.maxX; x += gridSize) {
        for (let y = bounds.minY + gridSize / 2; y < bounds.maxY; y += gridSize) {
          const point = { x, y };

          // Must be inside the region polygon
          if (!pointInPolygon(point, region.polygon)) continue;

          // UNIFIED WALL MODEL: Check distance to all walls (obstacles and user walls)
          let tooCloseToWall = false;
          for (const wall of game.walls) {
            // Skip board edge walls for "inside" check
            if (wall.id.startsWith("board-")) continue;
            
            const dist = pointToSegmentDistance(point, wall.start, wall.end);
            if (dist < wall.thickness) {
              tooCloseToWall = true;
              break;
            }
          }
          if (tooCloseToWall) continue;

          const key = `${Math.round(x)},${Math.round(y)}`;
          pointIndices.set(key, samplePoints.length);
          samplePoints.push(point);
        }
      }

      if (samplePoints.length === 0) return [];

      // Build adjacency: two points are connected if no wall crosses between them
      const adjacency: Set<number>[] = samplePoints.map(() => new Set());

      for (let i = 0; i < samplePoints.length; i++) {
        const pi = samplePoints[i];

        // Check all 8 neighbors (cardinal + diagonal)
        const neighbors = [
          { x: pi.x + gridSize, y: pi.y }, // right
          { x: pi.x - gridSize, y: pi.y }, // left
          { x: pi.x, y: pi.y + gridSize }, // down
          { x: pi.x, y: pi.y - gridSize }, // up
          { x: pi.x + gridSize, y: pi.y + gridSize }, // down-right
          { x: pi.x - gridSize, y: pi.y + gridSize }, // down-left
          { x: pi.x + gridSize, y: pi.y - gridSize }, // up-right
          { x: pi.x - gridSize, y: pi.y - gridSize }, // up-left
        ];

        for (const n of neighbors) {
          const key = `${Math.round(n.x)},${Math.round(n.y)}`;
          const j = pointIndices.get(key);
          if (j !== undefined && j > i) {
            // Check if any wall blocks this connection
            let blocked = false;
            for (const seg of wallSegments) {
              if (lineSegmentIntersection(pi, samplePoints[j], seg.p1, seg.p2)) {
                blocked = true;
                break;
              }
            }
            if (!blocked) {
              adjacency[i].add(j);
              adjacency[j].add(i);
            }
          }
        }
      }

      // Flood-fill to find connected components
      const visited = new Set<number>();
      const components: { samples: Vector2[]; hasBalls: boolean }[] = [];

      for (let i = 0; i < samplePoints.length; i++) {
        if (visited.has(i)) continue;

        const component: Vector2[] = [];
        const queue = [i];
        visited.add(i);

        while (queue.length > 0) {
          const curr = queue.shift()!;
          component.push(samplePoints[curr]);

          for (const neighbor of adjacency[curr]) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }

        // Check if any ball is in this component
        let hasBalls = false;
        for (const ball of balls) {
          // Check if ball can reach any sample in this component without crossing walls
          for (const sample of component) {
            let ballBlocked = false;
            for (const seg of wallSegments) {
              if (lineSegmentIntersection(ball.position, sample, seg.p1, seg.p2)) {
                ballBlocked = true;
                break;
              }
            }
            if (!ballBlocked) {
              hasBalls = true;
              break;
            }
          }
          if (hasBalls) break;
        }

        components.push({ samples: component, hasBalls });
      }


      return components;
    };

    // Grid size used for sampling - must match findSubRegionsGrid
    const SAMPLE_GRID_SIZE = 15;

    // Build a polygon from sample points - returns samples for grid-based rendering
    const buildPolygonFromSamples = (
      samples: Vector2[],
      region: Region,
      sampleCount: number,
    ): { polygon: Polygon; estimatedArea: number; samplePoints: Vector2[] } | null => {
      if (samples.length < 3) return null;

      // Calculate estimated area from sample count
      // Each sample represents a grid cell of gridSize x gridSize
      const cellArea = SAMPLE_GRID_SIZE * SAMPLE_GRID_SIZE;
      const estimatedArea = sampleCount * cellArea;

      // For the polygon, use bounding box with small padding (for ball containment checks)
      const sortedX = [...samples].sort((a, b) => a.x - b.x);
      const sortedY = [...samples].sort((a, b) => a.y - b.y);

      const padding = SAMPLE_GRID_SIZE / 2;
      const minX = sortedX[0].x - padding;
      const maxX = sortedX[sortedX.length - 1].x + padding;
      const minY = sortedY[0].y - padding;
      const maxY = sortedY[sortedY.length - 1].y + padding;

      return {
        polygon: {
          vertices: [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
          ],
        },
        estimatedArea,
        samplePoints: samples, // Store for grid-based rendering
      };
    };

    // Compute convex hull using gift wrapping algorithm
    const computeConvexHull = (points: Vector2[]): Vector2[] => {
      if (points.length < 3) return points;

      // Find leftmost point
      let start = 0;
      for (let i = 1; i < points.length; i++) {
        if (points[i].x < points[start].x) {
          start = i;
        }
      }

      const hull: Vector2[] = [];
      let current = start;

      do {
        hull.push({ ...points[current] });
        let next = 0;

        for (let i = 1; i < points.length; i++) {
          if (next === current) {
            next = i;
            continue;
          }

          // Cross product to determine turn direction
          const cross =
            (points[i].x - points[current].x) * (points[next].y - points[current].y) -
            (points[i].y - points[current].y) * (points[next].x - points[current].x);

          if (cross > 0) {
            next = i;
          }
        }

        current = next;

        // Safety check to prevent infinite loop
        if (hull.length > points.length) break;
      } while (current !== start);

      return hull;
    };

    // Try to remove enclosed areas and update regions using flood-fill
    const tryRemoveEnclosedAreas = (region: Region): boolean => {
      const { balls } = game;

      const subRegions = findSubRegionsGrid(region);

      console.log(
        "[FLOOD] Found",
        subRegions.length,
        "sub-regions:",
        subRegions.map((r) => ({ samples: r.samples.length, hasBalls: r.hasBalls })),
      );

      if (subRegions.length <= 1) {
        console.log("[FLOOD] Only 1 or fewer sub-regions, no split needed");
        return false;
      }

      const regionsWithBalls = subRegions.filter((r) => r.hasBalls);
      const regionsWithoutBalls = subRegions.filter((r) => !r.hasBalls);

      if (regionsWithoutBalls.length === 0) return false;

      // Build new regions for areas with balls
      const newRegions: Region[] = game.regions.filter((r) => r.id !== region.id);
      console.log("[FLOOD] Building polygons for", regionsWithBalls.length, "regions with balls");

      for (const subRegion of regionsWithBalls) {
        console.log("[FLOOD] Building polygon from", subRegion.samples.length, "samples");
        const result = buildPolygonFromSamples(subRegion.samples, region, subRegion.samples.length);
        console.log(
          "[FLOOD] Built polygon:",
          result ? `${result.polygon.vertices.length} vertices, estimatedArea ${result.estimatedArea}` : "null",
        );

        if (result && result.estimatedArea > 100) {
          const newId = generateRegionId();
          // CRITICAL: Store samplePoints in the new region for accurate area tracking
          newRegions.push({ 
            id: newId, 
            polygon: result.polygon, 
            estimatedArea: result.estimatedArea,
            samplePoints: result.samplePoints 
          });
          console.log("[FLOOD] Added new region:", newId, "with estimatedArea:", result.estimatedArea, "samplePoints:", result.samplePoints.length);

          // Ball region assignment handled by mandatory validation below
        } else {
          console.log("[FLOOD] Polygon rejected - too small or null");
        }
      }

      console.log("[FLOOD] New regions count:", newRegions.length);

      if (newRegions.length === 0) {
        // Failed to build valid polygons, keep original
        console.log("[FLOOD] No valid regions built, keeping original");
        return false;
      }

      game.regions = newRegions;

      // MANDATORY VALIDATION: Reassign all balls to their correct regions
      reassignBallsToRegions(game.balls, game.regions, game.walls);
      validateAllBallOwnership(game.balls, game.regions, game.walls);

      // Speed up balls
      for (const ball of balls) {
        const newSpeed = Math.min(ball.speed * BALL_SPEED_INCREASE, ball.topSpeed);
        const ratio = newSpeed / ball.speed;
        ball.speed = newSpeed;
        ball.velocity.x *= ratio;
        ball.velocity.y *= ratio;
      }

      // Track fastest ball
      {
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

      return true;
    };

    // Pre-validate that a wall won't trap any ball in a region without valid sample points
    // Uses the region ownership module for consistent validation
    const wouldWallTrapBallCheck = (wallStart: Vector2, wallEnd: Vector2): boolean => {
      return wouldWallOrphanBall(wallStart, wallEnd, game.balls, game.regions, game.walls);
    };

    const applyCut = (wall: GrowingWall) => {
      // ============================================================
      // EXPLICIT SPACE MODEL: Grid-based cut processing
      // ============================================================
      // 1. Rasterize cut path to grid cells (mark as REMOVED)
      // 2. Find all connected regions using flood-fill
      // 3. Check which regions contain balls
      // 4. Remove regions without balls
      // 5. Check for ball WON states (region <= 5% of total)
      // 6. If all balls WON, level is won
      // ============================================================

      const { balls } = game;

      // Check if any ACTIVE ball is exactly on the wall line - instant game over
      for (const ball of balls) {
        if (ball.state === 'won') continue; // WON balls are immune
        if (isBallOnCutLine(ball, wall)) {
          handleGameOver();
          return;
        }
      }

      // CRITICAL: Check if this wall would trap any ball in an area too small to play
      // If so, abort the cut (the wall simply doesn't complete)
      if (wouldWallTrapBallCheck(wall.startPoint, wall.endPoint)) {
        console.log("[CUT] Aborted - wall would trap a ball");
        return;
      }

      // Add the new wall to the walls array
      const newWall: Wall = {
        id: generateWallId(),
        start: { ...wall.startPoint },
        end: { ...wall.endPoint },
        thickness: wall.thickness,
      };
      game.walls.push(newWall);

      console.log("[WALL] Added new wall:", {
        id: newWall.id,
        start: newWall.start,
        end: newWall.end,
        totalWalls: game.walls.length,
      });

      // ============================================================
      // STEP 1: Rasterize cut to grid (mark cells as REMOVED)
      // ============================================================
      if (game.spaceGrid) {
        const removedCells = rasterizeCutToGrid(
          game.spaceGrid,
          wall.startPoint,
          wall.endPoint,
          wall.thickness
        );
        console.log("[GRID] Cut rasterized, removed", removedCells.length, "cells");

        // ============================================================
        // STEP 2: Find connected regions via flood-fill
        // ============================================================
        const gridRegions = findGridRegions(game.spaceGrid);
        console.log("[GRID] Found", gridRegions.length, "connected regions");

        // ============================================================
        // STEP 3: Check which regions contain ACTIVE balls
        // ============================================================
        const regionsWithBalls: GridRegion[] = [];
        const regionsWithoutBalls: GridRegion[] = [];

        for (const region of gridRegions) {
          let hasBall = false;
          for (const ball of balls) {
            if (ball.state === 'won') continue; // WON balls don't count
            const ballIndex = worldToGridIndex(game.spaceGrid, ball.position.x, ball.position.y);
            if (ballIndex >= 0 && region.cellIndices.includes(ballIndex)) {
              hasBall = true;
              break;
            }
          }
          if (hasBall) {
            regionsWithBalls.push(region);
          } else {
            regionsWithoutBalls.push(region);
          }
        }

        console.log("[GRID] Regions with balls:", regionsWithBalls.length, 
                    "Regions without:", regionsWithoutBalls.length);

        // ============================================================
        // STEP 4: Remove regions without balls
        // ============================================================
        for (const emptyRegion of regionsWithoutBalls) {
          removeRegion(game.spaceGrid, emptyRegion);
          console.log("[GRID] Removed region:", emptyRegion.id, 
                      "with", emptyRegion.cellCount, "cells");
        }

        // Update gridRegions reference
        game.gridRegions = regionsWithBalls;
      }

      // ============================================================
      // LEGACY: Also update sample-based regions for rendering
      // ============================================================
      const updatedRegions: Region[] = [];
      
      for (const region of [...game.regions]) {
        const subRegions = findSubRegionsGrid(region);
        
        if (subRegions.length <= 1) {
          const hasBallsInRegion = subRegions.length === 1 && subRegions[0].hasBalls;
          if (hasBallsInRegion) {
            const totalSamples = subRegions[0].samples.length;
            const cellArea = 15 * 15;
            updatedRegions.push({
              ...region,
              samplePoints: subRegions[0].samples,
              estimatedArea: totalSamples * cellArea,
            });
          }
          continue;
        }

        const regionsWithBalls = subRegions.filter((r) => r.hasBalls);
        for (const subRegion of regionsWithBalls) {
          const result = buildPolygonFromSamples(subRegion.samples, region, subRegion.samples.length);
          if (result && result.estimatedArea > 100) {
            const newId = generateRegionId();
            updatedRegions.push({
              id: newId,
              polygon: result.polygon,
              estimatedArea: result.estimatedArea,
              samplePoints: result.samplePoints,
            });
          }
        }
      }

      game.regions = updatedRegions;

      // Reassign balls to regions
      reassignBallsToRegions(game.balls, game.regions, game.walls);
      validateAllBallOwnership(game.balls, game.regions, game.walls);

      game.activeWall = null;

      // ============================================================
      // STEP 5: Check for ball WON states
      // ============================================================
      checkAndUpdateBallWonStates();

      // ============================================================
      // STEP 6: Check if ALL balls are WON (level win condition)
      // ============================================================
      if (areAllBallsWon()) {
        console.log("[WIN] All balls captured! Level complete.");
        game.levelComplete = true;
        
        const percent = Math.round(getGridRemainingPercent());
        setRemainingPercent(percent);
        
        const effectiveExpectedCuts = level.expectedCuts;
        const { levelScore, breakdown } = calculateScore(
          game.wallCount,
          effectiveExpectedCuts,
          percent,
          level.sizeThreshold,
          level.points,
          activeModifiers.scoreMultiplier,
          levelNumber
        );
        
        onLevelComplete({
          levelNumber,
          levelId: level.id,
          cutCount: game.wallCount,
          expectedCuts: level.expectedCuts,
          basePoints: level.points,
          levelScore: levelScore + game.lockBonus,
          remainingPercent: percent,
          thresholdPercent: level.sizeThreshold,
          underParBonus: breakdown.underParBonus,
          spaceBonus: breakdown.spaceBonus,
          spaceBonusRaw: breakdown.spaceBonusRaw,
          performanceMultiplier: breakdown.performanceMultiplier,
          fencesUnderPar: breakdown.fencesUnderPar,
          fencesOverPar: breakdown.fencesOverPar,
          extraPercent: breakdown.extraPercent,
          lockBonus: game.lockBonus,
          lockedBallsCount: game.lockedBallsCount,
        });
        return;
      }

      // Calculate remaining percentage from authoritative grid
      const percent = Math.round(getGridRemainingPercent());
      setRemainingPercent(percent);

      // Tutorial cut success
      if (tutorialMode && !tutorialCutMade && percent < 100) {
        setTutorialCutMade(true);
        onTutorialCutSuccess?.();
      }

      // Track best remaining percent during push mode
      if (game.pushMode === "pushing" && percent < game.bestRemainingPercent) {
        game.bestRemainingPercent = percent;
      }

      // Check if level just got cleared (legacy threshold check)
      if (percent < level.sizeThreshold && game.pushMode === "none") {
        render();
        game.pushMode = "prompt";
        setPushMode("prompt");
        setClearedPercent(percent);
        game.bestRemainingPercent = percent;
        return;
      }
    };

    const updateWall = (dt: number) => {
      const { activeWall: wall, regions, balls } = game;
      if (!wall || wall.isComplete) return;

      const activeRegion = regions.find((r) => r.id === wall.activeRegionId);
      if (!activeRegion) {
        game.activeWall = null;
        return;
      }

      // Calculate wall speed (world units per second)
      const wallSpeedBase = getWallSpeedBase(levelNumber, fenceSpeedBase, fenceSpeedMin, fenceSpeedPerLevel);
      const wallSpeedEffective = wallSpeedBase * activeModifiers.fenceGenerationSpeedMultiplier;

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
      if (vec2Distance(wall.startPoint, wall.targetStart) < 1 && vec2Distance(wall.endPoint, wall.targetEnd) < 1) {
        wall.startPoint = { ...wall.targetStart };
        wall.endPoint = { ...wall.targetEnd };
        if (!wall.isComplete) {
          wall.isComplete = true;
          game.wallCompleteTime = performance.now();
        }
      }

      // Collision check with any ball while growing
      if (!wall.isComplete && !game.isRecovering) {
        for (const ball of balls) {
          const effectiveCollisionRadius = ball.radius;

          if (
            circleCapsuleCollision(
              ball.position,
              effectiveCollisionRadius,
              wall.startPoint,
              wall.endPoint,
              wall.thickness / 2,
            )
          ) {
            // Freeze the ball that hit the fence - store position and velocity, then stop it
            game.frozenBallId = ball.id;
            game.frozenBallPosition = { ...ball.position };
            game.frozenBallVelocity = { ...ball.velocity };
            ball.velocity = { x: 0, y: 0 };
            console.log("[FREEZE] Ball frozen at position:", ball.position, "stored:", game.frozenBallPosition);
            console.log("[FREEZE] Current walls count:", game.walls.length, "regions count:", game.regions.length);
            
            // Check if we have wall shields first
            if (game.wallShieldsRemaining > 0) {
              game.wallShieldsRemaining--;
              setWallShieldCount(game.wallShieldsRemaining);
              game.activeWall = null;
              console.log("[FREEZE] Active wall nullified (shield). Walls:", game.walls.length, "Regions:", game.regions.length);
              game.isRecovering = true;
              game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
              setIsRecovering(true);
              setScreenFlash("red");
              setIsShaking(true);
              setTimeout(() => setScreenFlash("none"), 150);
              setTimeout(() => {
                setIsShaking(false);
                // Unfreeze the ball after shake completes - restore position and velocity
                const frozenBall = game.balls.find(b => b.id === game.frozenBallId);
                if (frozenBall) {
                  if (game.frozenBallPosition) frozenBall.position = game.frozenBallPosition;
                  if (game.frozenBallVelocity) frozenBall.velocity = game.frozenBallVelocity;
                }
                game.frozenBallId = null;
                game.frozenBallPosition = null;
                game.frozenBallVelocity = null;
              }, 400);
              setTimeout(() => {
                game.isRecovering = false;
                setIsRecovering(false);
              }, RECOVERY_WINDOW_MS);
              return;
            }

            // If in push mode, don't lose a life - just fail the push
            if (game.pushMode === "pushing") {
              game.activeWall = null;
              setScreenFlash("red");
              setIsShaking(true);
              setTimeout(() => setScreenFlash("none"), 200);
              setTimeout(() => {
                setIsShaking(false);
                // Unfreeze the ball after shake completes - restore position and velocity
                const frozenBall = game.balls.find(b => b.id === game.frozenBallId);
                if (frozenBall) {
                  if (game.frozenBallPosition) frozenBall.position = game.frozenBallPosition;
                  if (game.frozenBallVelocity) frozenBall.velocity = game.frozenBallVelocity;
                }
                game.frozenBallId = null;
                game.frozenBallPosition = null;
                game.frozenBallVelocity = null;
              }, 400);
              handlePushFailed();
              return;
            }

            // Failed cut - lose a life
            playFenceBreakSound();
            const newLives = livesRef.current - 1;
            livesRef.current = newLives;
            setDisplayLives(newLives);
            onLivesChange(newLives);

            game.activeWall = null;
            console.log("[FREEZE] Active wall nullified (life lost). Walls:", game.walls.length, "Regions:", game.regions.length);

            if (newLives <= 0) {
              // Unfreeze before game over (game will end anyway)
              game.frozenBallId = null;
              game.frozenBallPosition = null;
              game.frozenBallVelocity = null;
              handleGameOver();
              return;
            }

            // Still have lives - enter recovery window
            game.isRecovering = true;
            game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
            setIsRecovering(true);
            setScreenFlash("red");
            setIsShaking(true);
            setTimeout(() => setScreenFlash("none"), 200);
            setTimeout(() => {
              setIsShaking(false);
              // Unfreeze the ball after shake completes - restore position and velocity
              const frozenBall = game.balls.find(b => b.id === game.frozenBallId);
              if (frozenBall) {
                if (game.frozenBallPosition) frozenBall.position = game.frozenBallPosition;
                if (game.frozenBallVelocity) frozenBall.velocity = game.frozenBallVelocity;
              }
              game.frozenBallId = null;
              game.frozenBallPosition = null;
              game.frozenBallVelocity = null;
            }, 400);
            setTimeout(() => {
              game.isRecovering = false;
              setIsRecovering(false);
            }, RECOVERY_WINDOW_MS);

            return;
          }
        }
      }
    };

    // Helper: world coord to screen coord
    const worldToScreen = (worldX: number, worldY: number) => {
      const { boardRect } = game;
      return {
        x: boardRect.left + worldX * boardRect.scale,
        y: boardRect.top + worldY * boardRect.scale,
      };
    };

    const render = () => {
      const {
        regions,
        walls,
        balls,
        activeWall: wall,
        screenSize,
        boardRect,
        backgroundColor,
        regionColor,
        swipeStart,
        swipeRegionId,
        currentSwipePos,
        initialSamplePoints,
      } = game;
      const { width: screenWidth, height: screenHeight } = screenSize;
      const { scale } = boardRect;

      // Clear the canvas (transparent to show CRT background through)
      ctx.clearRect(0, 0, screenWidth, screenHeight);

      // ===== Render blur layer for removed areas =====
      const blurCanvas = blurCanvasRef.current;
      const blurCtx = blurCanvas?.getContext("2d");
      if (blurCtx && blurCanvas) {
        blurCtx.clearRect(0, 0, screenWidth, screenHeight);
        
        // Collect all current sample points from active regions
        const activeSampleSet = new Set<string>();
        for (const region of regions) {
          if (region.samplePoints) {
            for (const sample of region.samplePoints) {
              activeSampleSet.add(`${sample.x},${sample.y}`);
            }
          }
        }
        
        // Draw removed areas (initial points that are no longer active)
        const gridSize = 15;
        const halfGrid = gridSize / 2;
        const cellPadding = 3;
        
        blurCtx.save();
        blurCtx.fillStyle = regionColor;
        blurCtx.globalAlpha = 0.7;
        
        for (const sample of initialSamplePoints) {
          const key = `${sample.x},${sample.y}`;
          if (!activeSampleSet.has(key)) {
            // This sample was removed - draw it on blur canvas
            const topLeft = worldToScreen(sample.x - halfGrid - cellPadding, sample.y - halfGrid - cellPadding);
            const size = (gridSize + cellPadding * 2) * scale;
            blurCtx.fillRect(topLeft.x, topLeft.y, size, size);
          }
        }
        blurCtx.restore();
      }

      // NOTE: Don't fill the entire screen - let CRT show through
      // The regions themselves define the playable area and will be drawn below

      // Fill all regions - use sample points for accurate rendering if available
      ctx.save();
      ctx.globalAlpha = canvasOpacity;
      ctx.fillStyle = regionColor;

      const gridSize = 15; // SAMPLE_GRID_SIZE - must match
      const halfGrid = gridSize / 2;
      // Larger overlap for smoother edges
      const cellPadding = 3;

      for (const region of regions) {
        if (region.samplePoints && region.samplePoints.length > 0) {
          // First pass: Draw filled cells with overlap
          for (const sample of region.samplePoints) {
            const topLeft = worldToScreen(sample.x - halfGrid - cellPadding, sample.y - halfGrid - cellPadding);
            const size = (gridSize + cellPadding * 2) * scale;
            ctx.fillRect(topLeft.x, topLeft.y, size, size);
          }

          // Second pass: Draw a smooth border around the edge cells to anti-alias
          // Find edge cells (cells that don't have all 4 neighbors)
          const sampleSet = new Set(region.samplePoints.map((s) => `${s.x},${s.y}`));
          const edgeCells: Vector2[] = [];

          for (const sample of region.samplePoints) {
            const neighbors = [
              `${sample.x - gridSize},${sample.y}`,
              `${sample.x + gridSize},${sample.y}`,
              `${sample.x},${sample.y - gridSize}`,
              `${sample.x},${sample.y + gridSize}`,
            ];
            const isEdge = neighbors.some((n) => !sampleSet.has(n));
            if (isEdge) {
              edgeCells.push(sample);
            }
          }

          // Draw smooth rounded rectangles on edge cells for anti-aliasing
          ctx.save();
          ctx.globalAlpha = canvasOpacity * 0.6;
          const edgePadding = 5;
          for (const sample of edgeCells) {
            const topLeft = worldToScreen(sample.x - halfGrid - edgePadding, sample.y - halfGrid - edgePadding);
            const size = (gridSize + edgePadding * 2) * scale;
            const radius = 4 * scale;

            ctx.beginPath();
            ctx.roundRect(topLeft.x, topLeft.y, size, size, radius);
            ctx.fill();
          }
          ctx.restore();
        } else {
          // Fallback to polygon rendering (for initial region before any cuts)
          const { vertices } = region.polygon;
          if (vertices.length < 3) continue;

          ctx.beginPath();
          const start = worldToScreen(vertices[0].x, vertices[0].y);
          ctx.moveTo(start.x, start.y);
          for (let i = 1; i < vertices.length; i++) {
            const pt = worldToScreen(vertices[i].x, vertices[i].y);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();

      // Note: Green border is now drawn via the unified wall model below
      // All walls (board edges, obstacles, user-drawn) are rendered identically

      // UNIFIED WALL MODEL: Draw ALL walls as visible borders using accent color
      // Walls are "fences" - they are drawn ON TOP, not used to erase space
      // User-drawn walls are clipped against obstacles (no fences inside obstacles)
      ctx.save();
      ctx.strokeStyle = accentColor; // Dynamic accent color
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = 6 * scale;

      const obstacles = game.obstaclePolygons;

      for (const w of walls) {
        const wallLineWidth = w.thickness * scale;
        ctx.lineWidth = wallLineWidth;

        // Clip user-drawn walls AND board edges against obstacles
        // Only obstacle edges themselves should render as-is (they define the obstacle boundary)
        const shouldClip = obstacles.length > 0 &&
          (w.id.startsWith("wall-") || w.id.startsWith("board-"));

        if (shouldClip) {
          // Clip wall segment against all obstacles
          const segments = clipLineAgainstPolygons(w.start, w.end, obstacles);
          for (const seg of segments) {
            const startScreen = worldToScreen(seg.start.x, seg.start.y);
            const endScreen = worldToScreen(seg.end.x, seg.end.y);
            renderWallWithEffects(
              ctx,
              startScreen,
              endScreen,
              seg.start,
              seg.end,
              scale,
              accentColor,
              wallLineWidth
            );
          }
        } else {
          // Obstacle edges render as-is with impact effects
          const startScreen = worldToScreen(w.start.x, w.start.y);
          const endScreen = worldToScreen(w.end.x, w.end.y);
          renderWallWithEffects(
            ctx,
            startScreen,
            endScreen,
            w.start,
            w.end,
            scale,
            accentColor,
            wallLineWidth
          );
        }
      }
      ctx.restore();

      // Render cut preview line during drag (always shown, not just with cutPreview modifier)
      // This shows the user where their cut will go before they commit to it
      if (swipeStart && swipeRegionId && currentSwipePos && !wall) {
        const delta = vec2Sub(currentSwipePos, swipeStart);
        const dist = vec2Length(delta);

        // Show preview once there's any significant drag distance
        if (dist >= 5) {
          const direction = vec2Normalize(delta);

          // UNIFIED WALL MODEL: Find wall intersections in both directions for preview
          let previewEnd: Vector2 | null = null;
          let previewStart: Vector2 | null = null;
          let previewEndDist = Infinity;
          let previewStartDist = Infinity;

          for (const w of walls) {
            const wallIntPos = lineSegmentIntersection(
              swipeStart,
              vec2Add(swipeStart, vec2Scale(direction, 10000)),
              w.start,
              w.end,
            );
            if (wallIntPos) {
              const wallDist = vec2Distance(swipeStart, wallIntPos);
              if (wallDist > 0.1 && wallDist < previewEndDist) {
                previewEnd = wallIntPos;
                previewEndDist = wallDist;
              }
            }
            const wallIntNeg = lineSegmentIntersection(
              swipeStart,
              vec2Add(swipeStart, vec2Scale(direction, -10000)),
              w.start,
              w.end,
            );
            if (wallIntNeg) {
              const wallDist = vec2Distance(swipeStart, wallIntNeg);
              if (wallDist > 0.1 && wallDist < previewStartDist) {
                previewStart = wallIntNeg;
                previewStartDist = wallDist;
              }
            }
          }

          // Draw preview line if we found valid intersections
          if (previewEnd && previewStart) {
            ctx.save();
            ctx.globalAlpha = 0.15;

            const previewThickness = WALL_THICKNESS * activeModifiers.fenceWidthMultiplier;
            // Draw white outline for visibility
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = (previewThickness + 8) * scale;
            ctx.lineCap = "round";
            const negScreen = worldToScreen(previewStart.x, previewStart.y);
            const posScreen = worldToScreen(previewEnd.x, previewEnd.y);
            ctx.beginPath();
            ctx.moveTo(negScreen.x, negScreen.y);
            ctx.lineTo(posScreen.x, posScreen.y);
            ctx.stroke();

            // Draw accent-colored center (same style as active wall)
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = (previewThickness + 4) * scale;
            ctx.beginPath();
            ctx.moveTo(negScreen.x, negScreen.y);
            ctx.lineTo(posScreen.x, posScreen.y);
            ctx.stroke();

            ctx.restore();
          }
        }
      }

      // Render all balls with multi-axis spin illusion
      for (const ball of balls) {
        const screenPos = worldToScreen(ball.position.x, ball.position.y);
        const screenRadius = ball.radius * scale;
        const isFastest = false; // Highlight fastest ball removed in new upgrade system

        // Calculate spin phases based on ball rotation and unique offsets per ball
        const ballIdHash = ball.id.charCodeAt(ball.id.length - 1) || 0;
        const primaryPhase = ball.rotation;
        const secondaryPhase = ball.rotation * 0.7 + ballIdHash * 0.5;
        const tertiaryPhase = ball.rotation * 1.3 + ballIdHash * 0.3;

        // Fastest ball highlight ring
        if (isFastest) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(screenPos.x, screenPos.y, screenRadius + 15 * scale, 0, Math.PI * 2);
          ctx.strokeStyle = COLORS.fastestBallHighlight;
          ctx.lineWidth = 3 * scale;
          ctx.shadowColor = COLORS.fastestBallHighlight;
          ctx.shadowBlur = 15 * scale;
          ctx.stroke();
          ctx.restore();
        }

        // ===== NEW BALL EFFECTS SYSTEM =====
        // Renders: baseline pulse (always), wall collision ring (medium), ball-to-ball glow (strongest)
        renderBallEffects(
          ctx,
          ball.effects,
          screenPos.x,
          screenPos.y,
          screenRadius,
          accentColor,
          ball.color,
          performance.now(),
          scale
        );

        // Outer glow (ambient light effect)
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, screenRadius + 10 * scale, 0, Math.PI * 2);
        const outerGlow = ctx.createRadialGradient(
          screenPos.x, screenPos.y, screenRadius * 0.7,
          screenPos.x, screenPos.y, screenRadius + 10 * scale
        );
        outerGlow.addColorStop(0, hexToRgba(ball.color.slice(1), 0.4));
        outerGlow.addColorStop(0.6, hexToRgba(ball.color.slice(1), 0.15));
        outerGlow.addColorStop(1, "transparent");
        ctx.fillStyle = outerGlow;
        ctx.fill();

        // Ball base with gradient for 3D depth
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
        
        const r = parseInt(ball.color.slice(1, 3), 16);
        const g = parseInt(ball.color.slice(3, 5), 16);
        const b = parseInt(ball.color.slice(5, 7), 16);
        const lighterColor = `rgb(${Math.min(255, r + 50)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 50)})`;
        const darkerColor = `rgb(${Math.max(0, r - 60)}, ${Math.max(0, g - 60)}, ${Math.max(0, b - 60)})`;
        const darkestColor = `rgb(${Math.max(0, r - 100)}, ${Math.max(0, g - 100)}, ${Math.max(0, b - 100)})`;
        
        const baseGradient = ctx.createRadialGradient(
          screenPos.x - screenRadius * 0.3,
          screenPos.y - screenRadius * 0.3,
          0,
          screenPos.x + screenRadius * 0.15,
          screenPos.y + screenRadius * 0.15,
          screenRadius * 1.3
        );
        baseGradient.addColorStop(0, lighterColor);
        baseGradient.addColorStop(0.35, ball.color);
        baseGradient.addColorStop(0.75, darkerColor);
        baseGradient.addColorStop(1, darkestColor);
        
        ctx.fillStyle = baseGradient;
        ctx.shadowColor = ball.color;
        ctx.shadowBlur = 15 * scale;
        ctx.fill();
        ctx.clip();

        // ===== LAYER 1: Latitude bands (suggest Y-axis tilt) =====
        // Oscillating latitude lines that compress/expand to suggest tilted rotation
        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        
        const tiltAngle = Math.sin(secondaryPhase) * 0.4; // Tilt oscillation
        ctx.rotate(tiltAngle);
        
        ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
        ctx.lineWidth = 1.8 * scale;
        ctx.lineCap = "round";
        
        // Draw 5 latitude bands that appear to wrap around sphere
        for (let i = -2; i <= 2; i++) {
          const baseY = i * screenRadius * 0.35;
          // Apply perspective compression based on phase
          const compression = 0.6 + 0.4 * Math.cos(primaryPhase + i * 0.3);
          const yOffset = baseY * compression;
          
          // Only draw if visible (within ball bounds)
          if (Math.abs(yOffset) < screenRadius * 0.95) {
            const xExtent = Math.sqrt(Math.max(0, screenRadius * screenRadius - yOffset * yOffset));
            ctx.beginPath();
            // Draw as arc for subtle curvature
            ctx.ellipse(0, yOffset, xExtent, screenRadius * 0.08, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();

        // ===== LAYER 2: Longitude meridians (suggest X-axis spin) =====
        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        ctx.rotate(primaryPhase); // Primary rotation
        
        ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
        ctx.lineWidth = 2 * scale;
        
        // Draw 4 meridian lines that curve around the sphere
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2;
          const xOffset = Math.sin(angle) * screenRadius * 0.9;
          
          // Calculate apparent width based on foreshortening
          const foreShorten = Math.abs(Math.cos(angle));
          if (foreShorten > 0.15) {
            ctx.beginPath();
            // Draw curved meridian
            ctx.ellipse(xOffset * 0.5, 0, Math.max(1, screenRadius * 0.15 * foreShorten), screenRadius * 0.85, 0, -Math.PI / 2, Math.PI / 2);
            ctx.stroke();
          }
        }
        ctx.restore();

        // ===== LAYER 3: Equatorial band with stripes (main spin indicator) =====
        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        ctx.rotate(tertiaryPhase);
        
        // Draw thick equatorial band
        ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
        ctx.lineWidth = 3 * scale;
        ctx.beginPath();
        ctx.moveTo(-screenRadius, 0);
        ctx.lineTo(screenRadius, 0);
        ctx.stroke();
        
        // Draw segment markers on equator for clear spin visibility
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        const segmentCount = 8;
        for (let i = 0; i < segmentCount; i++) {
          const segAngle = (i / segmentCount) * Math.PI * 2;
          const xPos = Math.cos(segAngle) * screenRadius * 0.65;
          const yPos = Math.sin(segAngle) * screenRadius * 0.15; // Flattened for equator
          
          // Only draw segments on visible side
          const visibility = Math.cos(segAngle);
          if (visibility > -0.3) {
            const segSize = (2.5 + visibility * 1.5) * scale;
            ctx.beginPath();
            ctx.arc(xPos, yPos, segSize, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();

        // ===== LAYER 4: Polar caps (enhance 3D depth) =====
        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        
        // Top polar region - slightly offset based on tilt
        const tiltX = Math.sin(secondaryPhase) * screenRadius * 0.1;
        const tiltY = Math.cos(secondaryPhase) * screenRadius * 0.1;
        
        ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
        ctx.beginPath();
        ctx.ellipse(tiltX, -screenRadius * 0.7 + tiltY, screenRadius * 0.35, screenRadius * 0.15, secondaryPhase * 0.3, 0, Math.PI * 2);
        ctx.fill();
        
        // Bottom polar region
        ctx.beginPath();
        ctx.ellipse(-tiltX, screenRadius * 0.7 - tiltY, screenRadius * 0.35, screenRadius * 0.15, -secondaryPhase * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.restore(); // End clipping

        // ===== Highlight/glare overlay (fixed, not rotating) =====
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
        ctx.clip();
        
        // Primary highlight at top-left
        const glareGradient = ctx.createRadialGradient(
          screenPos.x - screenRadius * 0.4, 
          screenPos.y - screenRadius * 0.4, 
          0,
          screenPos.x - screenRadius * 0.4, 
          screenPos.y - screenRadius * 0.4, 
          screenRadius * 0.6
        );
        glareGradient.addColorStop(0, "rgba(255, 255, 255, 0.65)");
        glareGradient.addColorStop(0.25, "rgba(255, 255, 255, 0.3)");
        glareGradient.addColorStop(0.6, "rgba(255, 255, 255, 0.05)");
        glareGradient.addColorStop(1, "transparent");
        ctx.fillStyle = glareGradient;
        ctx.fillRect(screenPos.x - screenRadius, screenPos.y - screenRadius, screenRadius * 2, screenRadius * 2);
        
        // Small sharp specular highlight
        ctx.beginPath();
        ctx.arc(screenPos.x - screenRadius * 0.35, screenPos.y - screenRadius * 0.35, screenRadius * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.fill();
        
        // Rim light at bottom-right
        const rimGradient = ctx.createRadialGradient(
          screenPos.x + screenRadius * 0.35,
          screenPos.y + screenRadius * 0.45,
          0,
          screenPos.x + screenRadius * 0.35,
          screenPos.y + screenRadius * 0.45,
          screenRadius * 0.35
        );
        rimGradient.addColorStop(0, "rgba(255, 255, 255, 0.2)");
        rimGradient.addColorStop(1, "transparent");
        ctx.fillStyle = rimGradient;
        ctx.fillRect(screenPos.x - screenRadius, screenPos.y - screenRadius, screenRadius * 2, screenRadius * 2);
        
        ctx.restore();
      }

      // Render wall - on top of everything, clipped to region
      if (wall) {
        const startScreen = worldToScreen(wall.startPoint.x, wall.startPoint.y);
        const endScreen = worldToScreen(wall.endPoint.x, wall.endPoint.y);

        const activeRegion = regions.find((r) => r.id === wall.activeRegionId);

        ctx.save();

        // Clip to the active region polygon
        if (activeRegion && activeRegion.polygon.vertices.length > 0) {
          ctx.beginPath();
          const first = worldToScreen(activeRegion.polygon.vertices[0].x, activeRegion.polygon.vertices[0].y);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < activeRegion.polygon.vertices.length; i++) {
            const pt = worldToScreen(activeRegion.polygon.vertices[i].x, activeRegion.polygon.vertices[i].y);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();
          ctx.clip();
        }

        // Draw white outline
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = (wall.thickness + 8) * scale;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(startScreen.x, startScreen.y);
        ctx.lineTo(endScreen.x, endScreen.y);
        ctx.stroke();

        // Draw accent-colored center (uses config accent color)
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = (wall.thickness + 4) * scale;
        ctx.shadowColor = accentColor + "80"; // 50% alpha glow
        ctx.shadowBlur = 25 * scale;
        ctx.beginPath();
        ctx.moveTo(startScreen.x, startScreen.y);
        ctx.lineTo(endScreen.x, endScreen.y);
        ctx.stroke();

        ctx.restore();
      }

      // Debug board outline removed - was showing purple dashed border
    };

    // Handle ball-to-ball collisions
    const handleBallCollisions = () => {
      const balls = game.balls;
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const ball1 = balls[i];
          const ball2 = balls[j];

          // Skip collisions involving frozen ball - it should stay perfectly still
          if (game.frozenBallId && (ball1.id === game.frozenBallId || ball2.id === game.frozenBallId)) continue;
          
          // Skip collisions involving WON balls - they are stationary trophies
          if (ball1.state === 'won' || ball2.state === 'won') continue;

          if (ball1.regionId !== ball2.regionId) continue;

          const delta = vec2Sub(ball2.position, ball1.position);
          const distance = vec2Length(delta);
          const minDistance = ball1.radius + ball2.radius;

          if (distance < minDistance && distance > 0) {
            const normal = vec2Normalize(delta);
            const relVel = vec2Sub(ball1.velocity, ball2.velocity);
            const relVelNormal = vec2Dot(relVel, normal);

            if (relVelNormal > 0) {
              ball1.velocity = vec2Sub(ball1.velocity, vec2Scale(normal, relVelNormal));
              ball2.velocity = vec2Add(ball2.velocity, vec2Scale(normal, relVelNormal));

              const overlap = minDistance - distance;
              const separation = vec2Scale(normal, overlap / 2);
              ball1.position = vec2Sub(ball1.position, separation);
              ball2.position = vec2Add(ball2.position, separation);
              
              // Trigger ball-to-ball collision effect (strongest visual)
              const now = performance.now();
              triggerBallHit(ball1.effects, now);
              triggerBallHit(ball2.effects, now);
              
              // Play ball collision sound
              const collisionIntensity = Math.min(1, Math.abs(relVelNormal) / 300);
              playBallCollideSound(collisionIntensity);
              
              // Legacy Bouncer and Yin Yang effects removed in new upgrade system
            }
          }
        }
      }
    };

    const gameLoop = (timestamp: number) => {
      if (game.gameOver || game.levelComplete || game.pushMode === "prompt") return;

      const dt = game.lastTime ? (timestamp - game.lastTime) / 1000 : 0;
      game.lastTime = timestamp;
      const cappedDt = Math.min(dt, 0.05);

      for (const ball of game.balls) {
        // Handle WON balls - just spin, no physics
        if (ball.state === 'won') {
          ball.rotation += ball.wonSpinSpeed * cappedDt;
          continue;
        }
        
        // Skip updating frozen ball - it stays in place during shake animation
        if (game.frozenBallId && ball.id === game.frozenBallId) {
          // Debug: log if position changed unexpectedly
          if (game.frozenBallPosition && (ball.position.x !== game.frozenBallPosition.x || ball.position.y !== game.frozenBallPosition.y)) {
            console.error("[FREEZE] Ball position changed during freeze! Current:", ball.position, "Should be:", game.frozenBallPosition);
            ball.position = { ...game.frozenBallPosition }; // Force restore
          }
          continue;
        }
        updateBall(ball, cappedDt);
      }
      handleBallCollisions();
      updateWall(cappedDt);
      
      // Update wall impact visual effects (time-based)
      updateWallImpacts();
      
      render();

      // Apply completed wall cut immediately
      if (game.activeWall && game.activeWall.isComplete) {
        applyCut(game.activeWall);
      }

      game.animationId = requestAnimationFrame(gameLoop);
    };

    game.gameLoopFn = gameLoop;

    // Convert screen coords to canvas-relative coords
    const getCanvasCoords = (e: PointerEvent): { screenX: number; screenY: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
      };
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Initialize audio on first interaction (browser requirement)
      initAudio();
      
      if (game.gameOver || game.levelComplete || game.activeWall || game.pushMode === "prompt" || game.isRecovering)
        return;

      const { screenX, screenY } = getCanvasCoords(e);

      // Only allow interactions inside the board rect
      if (!isPointInBoard(screenX, screenY, game.boardRect)) return;

      // Convert to world coordinates
      const worldPos = screenToWorld(screenX, screenY, game.boardRect);

      // Find which region contains this point (world coords)
      const region = findRegionContainingPoint(game.regions, worldPos.x, worldPos.y);
      if (!region) return; // Clicked in darkness - ignore

      // Prevent starting swipes from too close to existing walls
      for (const w of game.walls) {
        const dist = pointToSegmentDistance(worldPos, w.start, w.end);
        if (dist < w.thickness * 2) {
          return; // Too close to a wall - ignore
        }
      }

      game.swipeStart = worldPos;
      game.swipeRegionId = region.id;
      game.currentSwipePos = worldPos;
      setIsPlayerDragging(true);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete) return;

      const { screenX, screenY } = getCanvasCoords(e);

      // Convert to world coordinates, clamping to board bounds
      // (don't cancel the swipe if the pointer drifts slightly outside)
      const worldPos = screenToWorld(screenX, screenY, game.boardRect);
      worldPos.x = Math.max(0, Math.min(BOARD_WIDTH, worldPos.x));
      worldPos.y = Math.max(0, Math.min(BOARD_HEIGHT, worldPos.y));

      // Just update the current position - wall creation happens on pointer up
      game.currentSwipePos = worldPos;
    };

    const handlePointerUp = () => {
      // Only create wall if we have a valid swipe
      if (
        game.swipeStart &&
        game.swipeRegionId &&
        game.currentSwipePos &&
        !game.activeWall &&
        !game.gameOver &&
        !game.levelComplete &&
        !game.isRecovering &&
        game.pushMode !== "prompt"
      ) {
        const delta = vec2Sub(game.currentSwipePos, game.swipeStart);
        const dist = vec2Length(delta);

        if (dist >= effectiveSwipeMinDistance) {
          const direction = vec2Normalize(delta);

          // UNIFIED WALL MODEL: Find wall intersections in both directions
          // This ensures fences ALWAYS grow to the nearest wall/fence, regardless of drag distance
          let targetEnd: Vector2 | null = null;
          let targetStart: Vector2 | null = null;
          let targetEndDist = Infinity;
          let targetStartDist = Infinity;

          // Cast rays in both directions and find closest wall intersection
          for (const w of game.walls) {
            // Check positive direction
            const wallIntPos = lineSegmentIntersection(
              game.swipeStart,
              vec2Add(game.swipeStart, vec2Scale(direction, 10000)),
              w.start,
              w.end,
            );
            if (wallIntPos) {
              const wallDist = vec2Distance(game.swipeStart, wallIntPos);
              if (wallDist > 0.1 && wallDist < targetEndDist) {
                targetEnd = wallIntPos;
                targetEndDist = wallDist;
              }
            }

            // Check negative direction
            const wallIntNeg = lineSegmentIntersection(
              game.swipeStart,
              vec2Add(game.swipeStart, vec2Scale(direction, -10000)),
              w.start,
              w.end,
            );
            if (wallIntNeg) {
              const wallDist = vec2Distance(game.swipeStart, wallIntNeg);
              if (wallDist > 0.1 && wallDist < targetStartDist) {
                targetStart = wallIntNeg;
                targetStartDist = wallDist;
              }
            }
          }

          // Only create wall if we found valid intersections in both directions
          if (targetEnd && targetStart) {
            game.wallCount += 1;
            setCutCount(game.wallCount);

            // Check if this fence should be instant (Hot Start upgrade)
            const isInstant = game.wallCount <= activeModifiers.instantFencesPerMap;

            game.activeWall = {
              origin: { ...game.swipeStart },
              direction,
              startPoint: isInstant ? { ...targetStart } : { ...game.swipeStart },
              endPoint: isInstant ? { ...targetEnd } : { ...game.swipeStart },
              targetStart,
              targetEnd,
              thickness: WALL_THICKNESS * activeModifiers.fenceWidthMultiplier,
              isComplete: isInstant,
              activeRegionId: game.swipeRegionId!,
            };

            if (isInstant) {
              game.wallCompleteTime = performance.now();
            }
          }
        }
      }

      game.swipeStart = null;
      game.swipeRegionId = null;
      game.currentSwipePos = null;
      setIsPlayerDragging(false);
    };

    // Setup
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);

    game.animationId = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
      cancelAnimationFrame(game.animationId);
    };
  }, [level, levelNumber, onGameEnd, onLevelComplete, activeModifiers]);

  // Handlers for Push Your Luck overlay
  const handleBankAndContinue = useCallback(() => {
    const game = gameRef.current;
    game.levelComplete = true;

    const effectiveExpectedCuts = level.expectedCuts;
    
    // Use new configurable scoring system
    const { levelScore, breakdown } = calculateScore(
      game.wallCount,
      effectiveExpectedCuts,
      game.bestRemainingPercent,
      level.sizeThreshold,
      level.points,
      activeModifiers.scoreMultiplier,
      levelNumber
    );

    setTimeout(() => {
      onLevelComplete({
        levelNumber,
        levelId: level.id,
        cutCount: game.wallCount,
        expectedCuts: level.expectedCuts,
        basePoints: level.points,
        levelScore: levelScore + game.lockBonus,
        remainingPercent: game.bestRemainingPercent,
        overcutBonus: 0, // Legacy field - now handled by spaceBonus
        thresholdPercent: level.sizeThreshold,
        underParBonus: breakdown.underParBonus,
        spaceBonus: breakdown.spaceBonus,
        spaceBonusRaw: breakdown.spaceBonusRaw,
        performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar,
        fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent,
        lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
      });
    }, 300);
  }, [level, levelNumber, activeModifiers, onLevelComplete]);

  // Notify parent of game state changes for top bar display
  useEffect(() => {
    if (onGameStateChange) {
      onGameStateChange({
        cutsUsed: cutCount,
        spaceRemaining: remainingPercent,
        lockedBalls: lockedBallsCount,
        pushMode: pushMode,
        onBankAndContinue: handleBankAndContinue,
      });
    }
  }, [cutCount, remainingPercent, pushMode, handleBankAndContinue, onGameStateChange, lockedBallsCount]);

  const handlePushYourLuck = useCallback(() => {
    const game = gameRef.current;
    game.pushMode = "pushing";
    setPushMode("pushing");
  }, []);

  // Resume game loop when push mode becomes 'pushing'
  useEffect(() => {
    if (pushMode !== "pushing") return;

    const game = gameRef.current;
    game.lastTime = 0;

    if (game.gameLoopFn) {
      cancelAnimationFrame(game.animationId);
      requestAnimationFrame(() => {
        game.lastTime = 0;
        game.animationId = requestAnimationFrame(game.gameLoopFn!);
      });
    }
  }, [pushMode]);

  // Track canvas position for tutorial overlay positioning
  useEffect(() => {
    const updateCanvasPosition = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setCanvasOffsetTop(rect.top);
      setCanvasOffsetLeft(rect.left);
    };

    updateCanvasPosition();
    window.addEventListener("resize", updateCanvasPosition);

    const timeoutId = setTimeout(updateCanvasPosition, 100);

    return () => {
      window.removeEventListener("resize", updateCanvasPosition);
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className={`flex flex-col w-full h-full ${isShaking ? "animate-shake" : ""}`}>
      {/* Screen flash overlay for damage feedback */}
      {screenFlash === "red" && <div className="absolute inset-0 z-50 pointer-events-none bg-red-500/40" />}

      {/* Debug info in dev mode - minimal display */}
      {process.env.NODE_ENV === "development" && (
        <div className="absolute top-2 right-2 text-xs text-muted-foreground/50 font-mono z-10">
          {debugInfo.boardWidth}×{debugInfo.boardHeight} @ {debugInfo.scale}x
        </div>
      )}

      {/* Canvas container - Board band (~70% height) */}
      <div ref={containerRef} className="flex-1 min-h-0 relative" style={{ height: "70%" }}>
        {/* Blur canvas - renders removed areas with blur effect */}
        <canvas 
          ref={blurCanvasRef} 
          className="absolute inset-0 pointer-events-none"
          style={{ 
            filter: 'blur(8px)',
            opacity: 0.6,
          }}
        />
        {/* Main game canvas */}
        <canvas ref={canvasRef} className="absolute inset-0 touch-none cursor-crosshair" />
      </div>

      {/* Bottom section - Bottom UI band (~15% height) - empty now, button moved to GameScreen */}
      <div 
        className="flex-shrink-0 px-4 py-3 flex justify-center items-center" 
        style={{ minHeight: "15%" }}
      >
      </div>

      {/* Push Your Luck Overlay */}
      {pushMode === "prompt" && clearedPercent !== null && (
        <PushYourLuckOverlay
          remainingPercent={clearedPercent}
          thresholdPercent={level.sizeThreshold}
          basePoints={level.points}
          onBank={handleBankAndContinue}
          onPush={handlePushYourLuck}
        />
      )}

      {/* Interactive Tutorial Overlay */}
      {tutorialMode && tutorialStep !== "completed" && !tutorialCutMade && (
        <InteractiveTutorialOverlay
          tutorialStep={tutorialStep}
          isPlayerDragging={isPlayerDragging}
          canvasWidth={gameRef.current.screenSize.width}
          canvasHeight={gameRef.current.screenSize.height}
          canvasOffsetTop={canvasOffsetTop}
          canvasOffsetLeft={canvasOffsetLeft}
        />
      )}
    </div>
  );
}
