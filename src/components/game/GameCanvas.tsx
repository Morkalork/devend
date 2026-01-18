import { useRef, useEffect, useState, useCallback } from "react";
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from "@/types/game";
import { LevelConfig, LevelEntity } from "@/types/level";
import { UpgradeConfig } from "@/types/upgrade";
import { useActiveModifiers } from "@/hooks/useActiveModifiers";
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
} from "@/lib/polygon";
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
  isPointInWorldBounds,
} from "@/lib/boardConstants";

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
  tutorialMode?: boolean;
  tutorialStep?: TutorialStep;
  onTutorialCutSuccess?: () => void;
  canvasOpacity?: number;
  regionColor?: string; // hex color with #
  accentColor?: string; // hex color with #
}

// Game constants - all in WORLD units
const BASE_BALL_RADIUS = 18; // World units (was ~10 in ~450px canvas, now in 900px world)
const BALL_SPEED_INCREASE = 1.03; // Post-cut speed ramp
const WALL_THICKNESS = 10; // World units
const BASE_SWIPE_MIN_DISTANCE = 35; // World units
const ARENA_MARGIN = 0.05; // 5% margin from board edges
const MINIMUM_WALL_TIME = 0.35; // seconds
const RECOVERY_WINDOW_MS = 700; // Recovery time after failed cut

// Difficulty curve: wall speed decreases per level (slower = harder)
function getWallSpeedBase(levelIndex: number): number {
  // World units per second
  return Math.max(750, Math.min(1200, 1200 - (levelIndex - 1) * 50));
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

function getRandomDirection(): Vector2 {
  const minAngle = 15 * (Math.PI / 180);
  const maxAngle = 75 * (Math.PI / 180);
  const quadrant = Math.floor(Math.random() * 4);
  const baseAngle = minAngle + Math.random() * (maxAngle - minAngle);
  const angle = baseAngle + (quadrant * Math.PI) / 2;
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
  tutorialMode = false,
  tutorialStep = "completed",
  onTutorialCutSuccess,
  canvasOpacity = 0.9,
  regionColor: regionColorProp = "#1a3020",
  accentColor = "#00ff88",
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  const gameRef = useRef({
    regions: [] as Region[],
    obstacles: [] as Polygon[], // Obstacle polygons for rendering
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
    cutCount: 0,
    wallShieldsRemaining: 0,
    fastestBallId: null as string | null,
    pushMode: "none" as "none" | "prompt" | "pushing",
    bestRemainingPercent: 100,
    gameLoopFn: null as ((timestamp: number) => void) | null,
    wallCompleteTime: 0,
    completedCuts: [] as { start: Vector2; end: Vector2; thickness: number }[],
    isRecovering: false,
    recoveryEndTime: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const game = gameRef.current;
    game.regionColor = regionColorProp;
    game.wallShieldsRemaining = activeModifiers.wallShield;
    setWallShieldCount(activeModifiers.wallShield);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate effective ball radius with modifier (world units)
    const effectiveBallRadius = BASE_BALL_RADIUS * activeModifiers.ballSizeMultiplier;

    // Calculate effective swipe distance with modifier (world units)
    const effectiveSwipeMinDistance = BASE_SWIPE_MIN_DISTANCE / activeModifiers.swipeSensitivity;

    const initGame = () => {
      // ============================================================
      // CUTTING MODEL INITIALIZATION
      // ============================================================
      // The game board is a "piece of material" that can be cut.
      // Obstacles are PRE-EXISTING cuts that partition the board.
      // Only regions containing balls are active. Empty regions are discarded.
      // ============================================================

      const margin = Math.min(BOARD_WIDTH, BOARD_HEIGHT) * ARENA_MARGIN;
      const arenaWidth = BOARD_WIDTH - margin * 2;
      const arenaHeight = BOARD_HEIGHT - margin * 2;

      // Reset region counter for new level
      regionIdCounter = 0;

      // Calculate starting percentage based on reducedSize modifier
      const targetRemaining = Math.max(20, 100 - activeModifiers.reducedSizePercent);

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

      // Collect obstacle polygons from level entities
      const obstaclePolygons: Polygon[] = [];

      if (level.entities && level.entities.length > 0) {
        for (const entity of level.entities) {
          if (entity.kind === "wall") {
            let obstaclePolygon: Polygon;
            if (entity.shape === "rect") {
              obstaclePolygon = createPolygonFromShape("rect", {
                x: entity.x,
                y: entity.y,
                width: entity.width,
                height: entity.height,
              });
            } else if (entity.shape === "polygon") {
              obstaclePolygon = createPolygonFromShape("polygon", {
                points: entity.points,
              });
            } else if (entity.shape === "circle") {
              const numSides = 24;
              const vertices: { x: number; y: number }[] = [];
              for (let i = 0; i < numSides; i++) {
                const angle = (i / numSides) * Math.PI * 2;
                vertices.push({
                  x: entity.cx + Math.cos(angle) * entity.radius,
                  y: entity.cy + Math.sin(angle) * entity.radius,
                });
              }
              obstaclePolygon = { vertices };
            } else {
              continue;
            }

            obstaclePolygons.push(obstaclePolygon);
          }
        }
      }

      // Store obstacle polygons for:
      // 1. Ball collision (balls bounce off obstacles)
      // 2. Cut termination (cuts stop at obstacle edges)
      // 3. Rendering (obstacles are drawn as "cut out" areas)
      game.obstacles = obstaclePolygons;

      // Calculate the original playable area (board minus obstacles)
      const boardArea = polygonArea(boardPolygon);
      const totalObstacleArea = obstaclePolygons.reduce((sum, obs) => sum + Math.abs(polygonArea(obs)), 0);
      game.originalArea = boardArea - totalObstacleArea;
      game.basePlayableArea = game.originalArea;

      // Create balls first (we need their positions to determine which regions to keep)
      const bounds = polygonBounds(boardPolygon);
      const regionWidth = bounds.maxX - bounds.minX;
      const regionHeight = bounds.maxY - bounds.minY;
      const centroid = polygonCentroid(boardPolygon);
      
      const ballSpeedLevelMult = getBallSpeedLevelMultiplier(levelNumber);
      const baseSpeedMultiplier = 2.0;

      // Helper: check if position overlaps any obstacle
      const isInsideObstacle = (pos: Vector2, radius: number): boolean => {
        for (const obstacle of obstaclePolygons) {
          if (pointInPolygon(pos, obstacle)) return true;
          // Check perimeter
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const checkPos = { x: pos.x + Math.cos(angle) * radius, y: pos.y + Math.sin(angle) * radius };
            if (pointInPolygon(checkPos, obstacle)) return true;
          }
        }
        return false;
      };

      // Helper: find valid spawn position
      const findValidSpawnPosition = (): Vector2 => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const pos = {
            x: centroid.x + (Math.random() - 0.5) * regionWidth * 0.6,
            y: centroid.y + (Math.random() - 0.5) * regionHeight * 0.6,
          };
          if (pointInPolygon(pos, boardPolygon) && !isInsideObstacle(pos, effectiveBallRadius)) {
            return pos;
          }
        }
        return { ...centroid };
      };

      // Create all balls with positions
      game.balls = level.balls.map((ballConfig) => {
        const dir = getRandomDirection();
        const levelScaledSpeed =
          ballConfig.initialSpeed * baseSpeedMultiplier * ballSpeedLevelMult * activeModifiers.ballSpeedMultiplier;
        const modifiedTopSpeed = ballConfig.topSpeed * baseSpeedMultiplier * activeModifiers.ballSpeedMultiplier;
        const modifiedSpeed = Math.min(levelScaledSpeed, modifiedTopSpeed);

        return {
          id: ballConfig.id,
          position: findValidSpawnPosition(),
          velocity: { x: dir.x * modifiedSpeed, y: dir.y * modifiedSpeed },
          radius: effectiveBallRadius,
          speed: modifiedSpeed,
          topSpeed: modifiedTopSpeed,
          color: `#${ballConfig.color}`,
          regionId: "", // Will be assigned after regions are created
        };
      });

      // Initialize completed cuts (used for cut-to-cut and cut-to-obstacle termination)
      game.completedCuts = [];

      // Now partition the board into regions based on obstacles
      // Use flood-fill to find connected areas, keeping only those with balls
      const initialRegions = partitionBoardWithObstacles(boardPolygon, obstaclePolygons, game.balls);
      game.regions = initialRegions;

      // Assign each ball to its containing region
      for (const ball of game.balls) {
        for (const region of game.regions) {
          if (pointInPolygon(ball.position, region.polygon)) {
            ball.regionId = region.id;
            break;
          }
        }
      }

      // Track fastest ball
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

    // Partition the board into regions using flood-fill, keeping only regions with balls
    const partitionBoardWithObstacles = (
      board: Polygon,
      obstacles: Polygon[],
      balls: Ball[]
    ): Region[] => {
      const bounds = polygonBounds(board);
      const gridSize = 20; // Sample grid resolution
      
      // Generate sample points inside the board but outside obstacles
      const samplePoints: Vector2[] = [];
      const pointKeys: Map<string, number> = new Map();
      
      for (let x = bounds.minX + gridSize / 2; x < bounds.maxX; x += gridSize) {
        for (let y = bounds.minY + gridSize / 2; y < bounds.maxY; y += gridSize) {
          const point = { x, y };
          
          // Must be inside board
          if (!pointInPolygon(point, board)) continue;
          
          // Must not be inside any obstacle
          let insideObstacle = false;
          for (const obstacle of obstacles) {
            if (pointInPolygon(point, obstacle)) {
              insideObstacle = true;
              break;
            }
          }
          if (insideObstacle) continue;
          
          const key = `${Math.round(x)},${Math.round(y)}`;
          pointKeys.set(key, samplePoints.length);
          samplePoints.push(point);
        }
      }
      
      if (samplePoints.length === 0) {
        // Fallback: single region with the whole board
        const regionId = generateRegionId();
        return [{ id: regionId, polygon: board }];
      }
      
      // Build adjacency: two points connected if no obstacle edge crosses between them
      const adjacency: Set<number>[] = samplePoints.map(() => new Set());
      
      // Collect all obstacle edges
      const obstacleEdges: { p1: Vector2; p2: Vector2 }[] = [];
      for (const obstacle of obstacles) {
        for (let i = 0; i < obstacle.vertices.length; i++) {
          const j = (i + 1) % obstacle.vertices.length;
          obstacleEdges.push({ p1: obstacle.vertices[i], p2: obstacle.vertices[j] });
        }
      }
      
      const lineBlockedByObstacle = (p1: Vector2, p2: Vector2): boolean => {
        const dir = vec2Normalize(vec2Sub(p2, p1));
        const shrink = 2;
        const shrunkP1 = vec2Add(p1, vec2Scale(dir, shrink));
        const shrunkP2 = vec2Sub(p2, vec2Scale(dir, shrink));
        
        for (const edge of obstacleEdges) {
          if (lineSegmentIntersection(shrunkP1, shrunkP2, edge.p1, edge.p2)) {
            return true;
          }
        }
        return false;
      };
      
      for (let i = 0; i < samplePoints.length; i++) {
        const pi = samplePoints[i];
        const neighbors = [
          { x: pi.x + gridSize, y: pi.y },
          { x: pi.x, y: pi.y + gridSize },
          { x: pi.x + gridSize, y: pi.y + gridSize },
          { x: pi.x - gridSize, y: pi.y + gridSize },
        ];
        
        for (const n of neighbors) {
          const key = `${Math.round(n.x)},${Math.round(n.y)}`;
          const j = pointKeys.get(key);
          if (j !== undefined && !lineBlockedByObstacle(pi, samplePoints[j])) {
            adjacency[i].add(j);
            adjacency[j].add(i);
          }
        }
      }
      
      // Flood-fill to find connected components
      const visited = new Set<number>();
      const components: Vector2[][] = [];
      
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
        
        components.push(component);
      }
      
      // For each component, check if it contains any ball
      const regionsWithBalls: Region[] = [];
      
      for (const component of components) {
        // Check if any ball is in this component
        let hasBall = false;
        for (const ball of balls) {
          // Ball is in component if it can reach any sample without crossing obstacles
          for (const sample of component) {
            if (!lineBlockedByObstacle(ball.position, sample)) {
              hasBall = true;
              break;
            }
          }
          if (hasBall) break;
        }
        
        if (hasBall) {
          // Build a polygon for this region using convex hull of reachable boundary points
          const regionPoly = buildRegionPolygon(component, board, obstacles);
          if (regionPoly && polygonArea(regionPoly) > 100) {
            const regionId = generateRegionId();
            regionsWithBalls.push({ id: regionId, polygon: regionPoly });
          }
        }
      }
      
      // If no regions have balls (shouldn't happen), keep the whole board
      if (regionsWithBalls.length === 0) {
        const regionId = generateRegionId();
        return [{ id: regionId, polygon: board }];
      }
      
      return regionsWithBalls;
    };

    // Build a polygon for a region from sample points
    const buildRegionPolygon = (
      samples: Vector2[],
      board: Polygon,
      obstacles: Polygon[]
    ): Polygon | null => {
      if (samples.length < 3) return null;
      
      // Calculate centroid of samples
      let cx = 0, cy = 0;
      for (const s of samples) {
        cx += s.x;
        cy += s.y;
      }
      cx /= samples.length;
      cy /= samples.length;
      
      // Collect boundary points (board edges + obstacle edges) that are reachable from samples
      const boundaryPoints: Vector2[] = [];
      
      // Board vertices
      for (const v of board.vertices) {
        let reachable = false;
        for (const sample of samples) {
          // Check if no obstacle blocks the path
          let blocked = false;
          for (const obstacle of obstacles) {
            for (let i = 0; i < obstacle.vertices.length; i++) {
              const j = (i + 1) % obstacle.vertices.length;
              const dir = vec2Normalize(vec2Sub(sample, v));
              const shrunkV = vec2Add(v, vec2Scale(dir, 2));
              const shrunkS = vec2Sub(sample, vec2Scale(dir, 2));
              if (lineSegmentIntersection(shrunkV, shrunkS, obstacle.vertices[i], obstacle.vertices[j])) {
                blocked = true;
                break;
              }
            }
            if (blocked) break;
          }
          if (!blocked) {
            reachable = true;
            break;
          }
        }
        if (reachable) {
          boundaryPoints.push({ ...v });
        }
      }
      
      // Obstacle vertices that are reachable
      for (const obstacle of obstacles) {
        for (const v of obstacle.vertices) {
          // Only if the vertex is inside the board
          if (!pointInPolygon(v, board)) continue;
          
          let reachable = false;
          for (const sample of samples) {
            let blocked = false;
            for (const obs of obstacles) {
              for (let i = 0; i < obs.vertices.length; i++) {
                const j = (i + 1) % obs.vertices.length;
                const dir = vec2Normalize(vec2Sub(sample, v));
                const shrunkV = vec2Add(v, vec2Scale(dir, 2));
                const shrunkS = vec2Sub(sample, vec2Scale(dir, 2));
                if (lineSegmentIntersection(shrunkV, shrunkS, obs.vertices[i], obs.vertices[j])) {
                  blocked = true;
                  break;
                }
              }
              if (blocked) break;
            }
            if (!blocked) {
              reachable = true;
              break;
            }
          }
          if (reachable) {
            boundaryPoints.push({ ...v });
          }
        }
      }
      
      if (boundaryPoints.length < 3) {
        // Fall back to convex hull of samples
        const sorted = [...samples].sort((a, b) => {
          const angleA = Math.atan2(a.y - cy, a.x - cx);
          const angleB = Math.atan2(b.y - cy, b.x - cx);
          return angleA - angleB;
        });
        return { vertices: sorted };
      }
      
      // Sort boundary points by angle from centroid
      boundaryPoints.sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
      });
      
      // Remove near-duplicate points
      const filtered: Vector2[] = [boundaryPoints[0]];
      for (let i = 1; i < boundaryPoints.length; i++) {
        if (vec2Distance(boundaryPoints[i], filtered[filtered.length - 1]) > 3) {
          filtered.push(boundaryPoints[i]);
        }
      }
      
      if (filtered.length < 3) return null;
      
      return { vertices: filtered };
    };

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      game.screenSize = { width, height };

      // Compute the board rectangle
      game.boardRect = computeBoardRect(width, height);

      // Update debug info
      setDebugInfo({
        boardWidth: Math.round(game.boardRect.width),
        boardHeight: Math.round(game.boardRect.height),
        scale: Math.round(game.boardRect.scale * 1000) / 1000,
      });

      initGame();
    };

    // Resolve ball collision with a line segment (for completed cuts)
    const resolveBallLineCollision = (
      ballPos: Vector2,
      ballVel: Vector2,
      ballRadius: number,
      lineStart: Vector2,
      lineEnd: Vector2,
      lineThickness: number
    ): { position: Vector2; velocity: Vector2 } => {
      const dist = pointToSegmentDistance(ballPos, lineStart, lineEnd);
      const collisionDist = ballRadius + lineThickness / 2;
      
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
        
        // Push ball out
        const penetration = collisionDist - dist;
        const newPos = vec2Add(ballPos, vec2Scale(normal, penetration + 0.5));
        
        return { position: newPos, velocity: newVel };
      }
      
      return { position: ballPos, velocity: ballVel };
    };

    // Update ball position and bounce off polygon edges and obstacles (all in world coordinates)
    const updateBall = (ball: Ball, dt: number) => {
      const region = game.regions.find((r) => r.id === ball.regionId);
      if (!region) return;

      // Move ball (world units)
      ball.position.x += ball.velocity.x * dt;
      ball.position.y += ball.velocity.y * dt;

      // Resolve collisions with region polygon edges
      const regionResult = resolveBallPolygonCollision(ball.position, ball.velocity, ball.radius, region.polygon);
      ball.position = regionResult.position;
      ball.velocity = regionResult.velocity;

      // Resolve collisions with obstacle edges (balls bounce OFF obstacles, so we flip the normal)
      for (const obstacle of game.obstacles) {
        const obstacleResult = resolveBallPolygonCollisionOutward(ball.position, ball.velocity, ball.radius, obstacle);
        ball.position = obstacleResult.position;
        ball.velocity = obstacleResult.velocity;
      }

      // Resolve collisions with completed cuts (visual lines that didn't split a region)
      for (const cut of game.completedCuts) {
        const cutResult = resolveBallLineCollision(
          ball.position,
          ball.velocity,
          ball.radius,
          cut.start,
          cut.end,
          WALL_THICKNESS
        );
        ball.position = cutResult.position;
        ball.velocity = cutResult.velocity;
      }
    };

    // Calculate combined area of all regions (subtracting obstacle areas that overlap)
    const getCombinedArea = (): number => {
      const regionsArea = game.regions.reduce((sum, region) => sum + polygonArea(region.polygon), 0);
      // Subtract obstacle areas (obstacles are fixed dead zones)
      const obstaclesArea = game.obstacles.reduce((sum, obs) => sum + Math.abs(polygonArea(obs)), 0);
      return regionsArea - obstaclesArea;
    };

    // Check if a ball's center is on the cut line
    const isBallOnCutLine = (ball: Ball, wall: GrowingWall): boolean => {
      const toOrigin = vec2Sub(ball.position, wall.origin);
      const perpDist = Math.abs(toOrigin.x * -wall.direction.y + toOrigin.y * wall.direction.x);
      return perpDist < 0.5;
    };

    const handleGameOver = () => {
      game.gameOver = true;
      const percent = Math.round((getCombinedArea() / game.originalArea) * 100);

      // If in push mode, level is still cleared - just forfeit overcut bonus
      if (game.pushMode === "pushing") {
        const effectiveExpectedCuts = level.expectedCuts + activeModifiers.expectedCutsBonus;
        let levelScore = computeLevelScore(level.points, effectiveExpectedCuts, game.cutCount);
        levelScore = Math.round(levelScore * activeModifiers.scoreMultiplier);

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
          cutCount: game.cutCount,
          expectedCuts: level.expectedCuts,
          basePoints: level.points,
        });
      }, 1000);
    };

    // Handle push-your-luck failure - level still complete, no life lost
    const handlePushFailed = () => {
      game.gameOver = true;
      const percent = Math.round((getCombinedArea() / game.originalArea) * 100);

      const effectiveExpectedCuts = level.expectedCuts + activeModifiers.expectedCutsBonus;
      let levelScore = computeLevelScore(level.points, effectiveExpectedCuts, game.cutCount);
      levelScore = Math.round(levelScore * activeModifiers.scoreMultiplier);

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
        pushFailed: true,
      });
    };

    // Get all boundary segments in the game (outer walls + obstacle edges + completed cuts)
    const getAllBoundarySegments = (region: Region): { p1: Vector2; p2: Vector2 }[] => {
      const segments: { p1: Vector2; p2: Vector2 }[] = [];
      
      // Add region polygon edges
      const { vertices } = region.polygon;
      for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        segments.push({ p1: vertices[i], p2: vertices[j] });
      }
      
      // Add obstacle edges
      for (const obstacle of game.obstacles) {
        for (let i = 0; i < obstacle.vertices.length; i++) {
          const j = (i + 1) % obstacle.vertices.length;
          segments.push({ p1: obstacle.vertices[i], p2: obstacle.vertices[j] });
        }
      }
      
      // Add completed cuts
      for (const cut of game.completedCuts) {
        segments.push({ p1: cut.start, p2: cut.end });
      }
      
      return segments;
    };

    // Check if a line segment intersects any boundary
    const lineIntersectsBoundary = (p1: Vector2, p2: Vector2, segments: { p1: Vector2; p2: Vector2 }[]): boolean => {
      // Shrink the line slightly to avoid false positives at endpoints
      const dir = vec2Normalize(vec2Sub(p2, p1));
      const shrink = 2;
      const shrunkP1 = vec2Add(p1, vec2Scale(dir, shrink));
      const shrunkP2 = vec2Sub(p2, vec2Scale(dir, shrink));
      
      for (const seg of segments) {
        if (lineSegmentIntersection(shrunkP1, shrunkP2, seg.p1, seg.p2)) {
          return true;
        }
      }
      return false;
    };

    // Find all distinct sub-regions using flood-fill on a grid
    const findSubRegionsGrid = (region: Region): { samples: Vector2[]; hasBalls: boolean }[] => {
      const { balls } = game;
      const bounds = polygonBounds(region.polygon);
      const gridSize = 25; // Sample every 25 pixels
      const segments = getAllBoundarySegments(region);
      
      // Generate valid sample points
      const samplePoints: Vector2[] = [];
      const pointIndices: Map<string, number> = new Map();
      
      for (let x = bounds.minX + gridSize/2; x < bounds.maxX; x += gridSize) {
        for (let y = bounds.minY + gridSize/2; y < bounds.maxY; y += gridSize) {
          const point = { x, y };
          
          // Must be inside the region polygon
          if (!pointInPolygon(point, region.polygon)) continue;
          
          // Must not be inside any obstacle
          let insideObstacle = false;
          for (const obstacle of game.obstacles) {
            if (pointInPolygon(point, obstacle)) {
              insideObstacle = true;
              break;
            }
          }
          if (insideObstacle) continue;
          
          const key = `${Math.round(x)},${Math.round(y)}`;
          pointIndices.set(key, samplePoints.length);
          samplePoints.push(point);
        }
      }
      
      if (samplePoints.length === 0) return [];
      
      // Build adjacency: two points are connected if no boundary crosses between them
      const adjacency: Set<number>[] = samplePoints.map(() => new Set());
      
      for (let i = 0; i < samplePoints.length; i++) {
        const pi = samplePoints[i];
        
        // Check neighbors (adjacent grid cells)
        const neighbors = [
          { x: pi.x + gridSize, y: pi.y },
          { x: pi.x, y: pi.y + gridSize },
          { x: pi.x + gridSize, y: pi.y + gridSize },
          { x: pi.x - gridSize, y: pi.y + gridSize },
        ];
        
        for (const n of neighbors) {
          const key = `${Math.round(n.x)},${Math.round(n.y)}`;
          const j = pointIndices.get(key);
          if (j !== undefined && !lineIntersectsBoundary(pi, samplePoints[j], segments)) {
            adjacency[i].add(j);
            adjacency[j].add(i);
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
          // Check if ball can reach any sample in this component without crossing boundaries
          for (const sample of component) {
            if (!lineIntersectsBoundary(ball.position, sample, segments)) {
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

    // Build a polygon from sample points by finding the convex hull of reachable boundary points
    const buildPolygonFromSamples = (samples: Vector2[], region: Region): Polygon | null => {
      if (samples.length < 1) return null;
      
      // Find centroid of samples
      let cx = 0, cy = 0;
      for (const s of samples) {
        cx += s.x;
        cy += s.y;
      }
      cx /= samples.length;
      cy /= samples.length;
      
      const segments = getAllBoundarySegments(region);
      const boundaryPoints: Vector2[] = [];
      
      // Collect all boundary segment endpoints that are reachable from centroid
      const allEndpoints: Vector2[] = [];
      for (const seg of segments) {
        allEndpoints.push(seg.p1, seg.p2);
      }
      
      // Add unique endpoints
      const seen = new Set<string>();
      for (const pt of allEndpoints) {
        const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        
        // Check if this point is reachable from any sample
        let reachable = false;
        for (const sample of samples) {
          if (!lineIntersectsBoundary({ x: cx, y: cy }, pt, segments) ||
              !lineIntersectsBoundary(sample, pt, segments)) {
            reachable = true;
            break;
          }
        }
        if (reachable) {
          boundaryPoints.push({ ...pt });
        }
      }
      
      if (boundaryPoints.length < 3) return null;
      
      // Sort by angle from centroid
      boundaryPoints.sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
      });
      
      // Remove duplicates
      const filtered: Vector2[] = [boundaryPoints[0]];
      for (let i = 1; i < boundaryPoints.length; i++) {
        if (vec2Distance(boundaryPoints[i], filtered[filtered.length - 1]) > 3) {
          filtered.push(boundaryPoints[i]);
        }
      }
      
      if (filtered.length < 3) return null;
      
      return { vertices: filtered };
    };

    // Try to remove enclosed areas and update regions using flood-fill
    const tryRemoveEnclosedAreas = (region: Region): boolean => {
      const { balls } = game;
      
      const subRegions = findSubRegionsGrid(region);
      
      if (subRegions.length <= 1) return false;
      
      const regionsWithBalls = subRegions.filter(r => r.hasBalls);
      const regionsWithoutBalls = subRegions.filter(r => !r.hasBalls);
      
      if (regionsWithoutBalls.length === 0) return false;
      
      // Build new regions for areas with balls
      const newRegions: Region[] = game.regions.filter(r => r.id !== region.id);
      
      for (const subRegion of regionsWithBalls) {
        const subPoly = buildPolygonFromSamples(subRegion.samples, region);
        if (subPoly && polygonArea(subPoly) > 100) {
          const newId = generateRegionId();
          newRegions.push({ id: newId, polygon: subPoly });
          
          // Update ball region IDs
          const segments = getAllBoundarySegments(region);
          for (const ball of balls) {
            for (const sample of subRegion.samples) {
              if (!lineIntersectsBoundary(ball.position, sample, segments)) {
                ball.regionId = newId;
                break;
              }
            }
          }
        }
      }
      
      if (newRegions.length === 0) {
        // Failed to build valid polygons, keep original
        return false;
      }
      
      game.regions = newRegions;
      
      // Speed up balls
      for (const ball of balls) {
        const newSpeed = Math.min(ball.speed * BALL_SPEED_INCREASE, ball.topSpeed);
        const ratio = newSpeed / ball.speed;
        ball.speed = newSpeed;
        ball.velocity.x *= ratio;
        ball.velocity.y *= ratio;
      }
      
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
      
      return true;
    };

    const applyCut = (wall: GrowingWall) => {
      // ============================================================
      // UNIFIED CUTTING MODEL
      // ============================================================
      // Every cut is treated the same way:
      // 1. Add the cut as a boundary segment
      // 2. Use flood-fill to find all connected areas
      // 3. Discard areas without balls
      // 4. Keep only areas with balls as active regions
      // ============================================================

      const { balls } = game;

      // Check if any ball is exactly on the cut line - instant game over
      for (const ball of balls) {
        if (isBallOnCutLine(ball, wall)) {
          handleGameOver();
          return;
        }
      }

      // Add the cut to completed cuts (it's now a boundary that balls bounce off)
      game.completedCuts.push({
        start: { ...wall.startPoint },
        end: { ...wall.endPoint },
        thickness: wall.thickness + 14,
      });

      // Re-partition all regions using flood-fill
      // This handles ALL cases uniformly:
      // - Wall-to-wall cuts
      // - Wall-to-obstacle cuts  
      // - Wall-to-previousCut cuts
      // - Obstacle-to-obstacle cuts
      // - Any combination that creates enclosed areas
      for (const region of [...game.regions]) {
        tryRemoveEnclosedAreas(region);
      }

      game.activeWall = null;

      // Calculate combined remaining area
      const combinedArea = getCombinedArea();
      const percent = Math.round((combinedArea / game.originalArea) * 100);
      setRemainingPercent(percent);

      // Check if a successful cut was made during tutorial
      if (tutorialMode && !tutorialCutMade && percent < 100) {
        setTutorialCutMade(true);
        onTutorialCutSuccess?.();
      }

      // Track best remaining percent during push mode
      if (game.pushMode === "pushing" && percent < game.bestRemainingPercent) {
        game.bestRemainingPercent = percent;
      }

      // Check if level just got cleared
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
      const wallSpeedBase = getWallSpeedBase(levelNumber);
      const wallSpeedEffective = wallSpeedBase * activeModifiers.wallSpeedMultiplier;

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
          const graceMultiplier = 1 - activeModifiers.wallGrace;
          const effectiveCollisionRadius = ball.radius * graceMultiplier;

          if (
            circleCapsuleCollision(
              ball.position,
              effectiveCollisionRadius,
              wall.startPoint,
              wall.endPoint,
              wall.thickness / 2,
            )
          ) {
            // Check if we have wall shields first
            if (game.wallShieldsRemaining > 0) {
              game.wallShieldsRemaining--;
              setWallShieldCount(game.wallShieldsRemaining);
              game.activeWall = null;
              game.isRecovering = true;
              game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
              setIsRecovering(true);
              setScreenFlash("red");
              setTimeout(() => setScreenFlash("none"), 150);
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
              setTimeout(() => setIsShaking(false), 400);
              handlePushFailed();
              return;
            }

            // Failed cut - lose a life
            const newLives = livesRef.current - 1;
            livesRef.current = newLives;
            setDisplayLives(newLives);
            onLivesChange(newLives);

            game.activeWall = null;

            if (newLives <= 0) {
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
            setTimeout(() => setIsShaking(false), 400);
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
        obstacles,
        balls,
        activeWall: wall,
        screenSize,
        boardRect,
        backgroundColor,
        regionColor,
        swipeStart,
        swipeRegionId,
        currentSwipePos,
      } = game;
      const { width: screenWidth, height: screenHeight } = screenSize;
      const { scale } = boardRect;

      // Clear the canvas (transparent to show CRT background through)
      ctx.clearRect(0, 0, screenWidth, screenHeight);

      // NOTE: Don't fill the entire screen - let CRT show through
      // The regions themselves define the playable area and will be drawn below

      // Fill all regions with region color (polygons) - use config opacity for CRT to show through
      ctx.save();
      ctx.globalAlpha = canvasOpacity;
      ctx.fillStyle = regionColor;
      for (const region of regions) {
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
      ctx.restore();

      // Render walls as "cut out" regions - they look like the background (same as cuts)
      for (const wall of obstacles) {
        const { vertices } = wall;
        if (vertices.length < 3) continue;

        ctx.save();
        ctx.beginPath();
        const start = worldToScreen(vertices[0].x, vertices[0].y);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < vertices.length; i++) {
          const pt = worldToScreen(vertices[i].x, vertices[i].y);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();

        // Clear the wall area (transparent) so CRT background shows through - same as cut areas
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0, 0, 0, 1)';
        ctx.fill();
        ctx.restore();
      }

      // Draw completed cuts as thick background-colored lines
      ctx.strokeStyle = backgroundColor;
      ctx.lineCap = "round";
      for (const cut of game.completedCuts) {
        ctx.lineWidth = cut.thickness * scale;
        const startScreen = worldToScreen(cut.start.x, cut.start.y);
        const endScreen = worldToScreen(cut.end.x, cut.end.y);
        ctx.beginPath();
        ctx.moveTo(startScreen.x, startScreen.y);
        ctx.lineTo(endScreen.x, endScreen.y);
        ctx.stroke();
      }

      // Render cut preview if enabled and swiping
      if (activeModifiers.cutPreview && swipeStart && swipeRegionId && currentSwipePos && !wall) {
        const region = regions.find((r) => r.id === swipeRegionId);
        if (region) {
          const delta = vec2Sub(currentSwipePos, swipeStart);
          const dist = vec2Length(delta);

          if (dist >= effectiveSwipeMinDistance) {
            const direction = vec2Normalize(delta);

            const intPos = rayPolygonIntersection(swipeStart, direction, region.polygon);
            const intNeg = rayPolygonIntersection(swipeStart, vec2Scale(direction, -1), region.polygon);

            if (intPos && intNeg) {
              // Check wall intersections for preview (walls act as cut boundaries)
              let previewEnd = intPos.point;
              let previewStart = intNeg.point;
              let previewEndDist = intPos.distance;
              let previewStartDist = intNeg.distance;

              // Check obstacle intersections for preview
              for (const obstacle of obstacles) {
                const obstacleIntPos = rayPolygonIntersection(swipeStart, direction, obstacle);
                if (obstacleIntPos && obstacleIntPos.distance > 0.1 && obstacleIntPos.distance < previewEndDist) {
                  previewEnd = obstacleIntPos.point;
                  previewEndDist = obstacleIntPos.distance;
                }
                const obstacleIntNeg = rayPolygonIntersection(swipeStart, vec2Scale(direction, -1), obstacle);
                if (obstacleIntNeg && obstacleIntNeg.distance > 0.1 && obstacleIntNeg.distance < previewStartDist) {
                  previewStart = obstacleIntNeg.point;
                  previewStartDist = obstacleIntNeg.distance;
                }
              }

              // Also check completed cuts for preview
              for (const cut of game.completedCuts) {
                const cutIntPos = lineSegmentIntersection(
                  swipeStart,
                  vec2Add(swipeStart, vec2Scale(direction, 10000)),
                  cut.start,
                  cut.end
                );
                if (cutIntPos) {
                  const dist = vec2Distance(swipeStart, cutIntPos);
                  if (dist > 0.1 && dist < previewEndDist) {
                    previewEnd = cutIntPos;
                    previewEndDist = dist;
                  }
                }
                const cutIntNeg = lineSegmentIntersection(
                  swipeStart,
                  vec2Add(swipeStart, vec2Scale(direction, -10000)),
                  cut.start,
                  cut.end
                );
                if (cutIntNeg) {
                  const dist = vec2Distance(swipeStart, cutIntNeg);
                  if (dist > 0.1 && dist < previewStartDist) {
                    previewStart = cutIntNeg;
                    previewStartDist = dist;
                  }
                }
              }

              ctx.save();
              ctx.strokeStyle = COLORS.cutPreview;
              ctx.lineWidth = WALL_THICKNESS * scale;
              ctx.setLineDash([10 * scale, 10 * scale]);
              const negScreen = worldToScreen(previewStart.x, previewStart.y);
              const posScreen = worldToScreen(previewEnd.x, previewEnd.y);
              ctx.beginPath();
              ctx.moveTo(negScreen.x, negScreen.y);
              ctx.lineTo(posScreen.x, posScreen.y);
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      // Render all balls
      for (const ball of balls) {
        const screenPos = worldToScreen(ball.position.x, ball.position.y);
        const screenRadius = ball.radius * scale;
        const isFastest = activeModifiers.highlightFastestBall && ball.id === game.fastestBallId;

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

        // Ball glow
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, screenRadius + 10 * scale, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(ball.color.slice(1), 0.4);
        ctx.fill();

        // Ball
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
        ctx.fillStyle = ball.color;
        ctx.shadowColor = ball.color;
        ctx.shadowBlur = 15 * scale;
        ctx.fill();
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
        ctx.shadowColor = accentColor + '80'; // 50% alpha glow
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
        updateBall(ball, cappedDt);
      }
      handleBallCollisions();
      updateWall(cappedDt);
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

      // Prevent starting swipes from inside wall areas
      for (const wall of game.obstacles) {
        if (pointInPolygon(worldPos, wall)) {
          return; // Clicked inside a wall - ignore
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
      
      // Cancel swipe if pointer moves outside the board
      if (!isPointInBoard(screenX, screenY, game.boardRect)) {
        game.swipeStart = null;
        game.swipeRegionId = null;
        game.currentSwipePos = null;
        setIsPlayerDragging(false);
        return;
      }
      
      const worldPos = screenToWorld(screenX, screenY, game.boardRect);
      
      // Also ensure world position is within bounds
      if (!isPointInWorldBounds(worldPos.x, worldPos.y)) {
        game.swipeStart = null;
        game.swipeRegionId = null;
        game.currentSwipePos = null;
        setIsPlayerDragging(false);
        return;
      }
      
      game.currentSwipePos = worldPos;

      if (game.activeWall) return;

      const delta = vec2Sub(worldPos, game.swipeStart);
      const dist = vec2Length(delta);

      if (dist < effectiveSwipeMinDistance) return;

      const direction = vec2Normalize(delta);

      const region = game.regions.find((r) => r.id === game.swipeRegionId);
      if (!region) {
        game.swipeStart = null;
        game.swipeRegionId = null;
        game.currentSwipePos = null;
        return;
      }

      // Find intersection points with polygon boundary (world coords)
      const intPos = rayPolygonIntersection(game.swipeStart, direction, region.polygon);
      const intNeg = rayPolygonIntersection(game.swipeStart, vec2Scale(direction, -1), region.polygon);

      if (!intPos || !intNeg) {
        game.swipeStart = null;
        game.swipeRegionId = null;
        game.currentSwipePos = null;
        return;
      }

      // Also check for wall intersections - cuts terminate at walls
      let targetEnd = intPos.point;
      let targetStart = intNeg.point;
      let targetEndDist = intPos.distance;
      let targetStartDist = intNeg.distance;

      // Check intersections with obstacles (static walls in the level)
      for (let i = 0; i < game.obstacles.length; i++) {
        const obstacle = game.obstacles[i];
        
        // Check positive direction - find where the ray enters the obstacle
        const obstacleIntPos = rayPolygonIntersection(game.swipeStart, direction, obstacle);
        if (obstacleIntPos && obstacleIntPos.distance > 0.1 && obstacleIntPos.distance < targetEndDist) {
          targetEnd = obstacleIntPos.point;
          targetEndDist = obstacleIntPos.distance;
        }

        // Check negative direction
        const obstacleIntNeg = rayPolygonIntersection(game.swipeStart, vec2Scale(direction, -1), obstacle);
        if (obstacleIntNeg && obstacleIntNeg.distance > 0.1 && obstacleIntNeg.distance < targetStartDist) {
          targetStart = obstacleIntNeg.point;
          targetStartDist = obstacleIntNeg.distance;
        }
      }

      // Also check for completed cuts (previously drawn lines) - terminate at them too
      for (const cut of game.completedCuts) {
        // Check positive direction intersection with cut line
        const cutIntPos = lineSegmentIntersection(
          game.swipeStart,
          vec2Add(game.swipeStart, vec2Scale(direction, 10000)),
          cut.start,
          cut.end
        );
        if (cutIntPos) {
          const dist = vec2Distance(game.swipeStart, cutIntPos);
          if (dist > 0.1 && dist < targetEndDist) {
            targetEnd = cutIntPos;
            targetEndDist = dist;
          }
        }

        // Check negative direction intersection
        const cutIntNeg = lineSegmentIntersection(
          game.swipeStart,
          vec2Add(game.swipeStart, vec2Scale(direction, -10000)),
          cut.start,
          cut.end
        );
        if (cutIntNeg) {
          const dist = vec2Distance(game.swipeStart, cutIntNeg);
          if (dist > 0.1 && dist < targetStartDist) {
            targetStart = cutIntNeg;
            targetStartDist = dist;
          }
        }
      }

      game.activeWall = {
        origin: { ...game.swipeStart },
        direction,
        startPoint: { ...game.swipeStart },
        endPoint: { ...game.swipeStart },
        targetStart,
        targetEnd,
        thickness: WALL_THICKNESS,
        isComplete: false,
        activeRegionId: game.swipeRegionId,
      };

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

      {/* HUD Section - Top UI band (~15% height) */}
      <div className="flex-shrink-0 px-4 py-3 flex justify-between items-start gap-3" style={{ minHeight: "15%" }}>
        {/* Left side: Cuts, Lives, Shields */}
        <div className="flex gap-3">
          <div className="hud-display">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Cuts</span>
            <div className="text-2xl font-display font-bold text-foreground">{cutCount}</div>
          </div>
          {/* Lives display */}
          <div className={`hud-display ${isRecovering ? "animate-pulse" : ""}`}>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Lives</span>
            <div className="text-2xl font-display font-bold text-red-400 flex items-center gap-1">
              {Array.from({ length: displayLives }).map((_, i) => (
                <span key={i}>❤️</span>
              ))}
              {displayLives === 0 && <span>0</span>}
            </div>
          </div>
          {wallShieldCount > 0 && (
            <div className="hud-display">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Shields</span>
              <div className="text-2xl font-display font-bold text-cyan-400">{wallShieldCount}</div>
            </div>
          )}
        </div>

        {/* Right side: Remaining percentage + debug info */}
        <div className="flex flex-col items-end gap-1">
          <div className="hud-display">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Remaining</span>
            <div
              className={`text-2xl font-display font-bold ${pushMode === "pushing" ? "text-amber-400" : "text-primary"}`}
            >
              {remainingPercent}%
            </div>
            <span className="text-muted-foreground text-xs">
              {pushMode === "pushing" ? "Push Mode!" : `Target: <${level.sizeThreshold}%`}
            </span>
          </div>
          {/* Debug info in dev mode */}
          {process.env.NODE_ENV === "development" && (
            <div className="text-xs text-muted-foreground font-mono">
              {debugInfo.boardWidth}×{debugInfo.boardHeight} @ {debugInfo.scale}x
            </div>
          )}
        </div>
      </div>

      {/* Canvas container - Board band (~70% height) */}
      <div ref={containerRef} className="flex-1 min-h-0 relative" style={{ height: "70%" }}>
        <canvas ref={canvasRef} className="touch-none cursor-crosshair" />
      </div>

      {/* Bottom section - Bottom UI band (~15% height) */}
      <div className="flex-shrink-0 px-4 py-3 flex justify-center items-center" style={{ minHeight: "15%" }}>
        {/* Bank button during push mode */}
        {pushMode === "pushing" && (
          <button
            onClick={handleBankAndContinue}
            className="px-6 py-3 rounded-lg bg-success/20 text-success font-bold shadow-lg border border-success/50 hover:bg-success/30 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Bank & Continue
          </button>
        )}
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
