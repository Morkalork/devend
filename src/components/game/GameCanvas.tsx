import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from "@/types/game";
import { LevelConfig, LevelEntity } from "@/types/level";
import { generateRandomObstacles } from "@/lib/randomObstacles";
import { decoratePolygon } from "@/lib/obstacleDecorations";
import { 
  getVarietyDecorationConfig, 
  applyRectVariation, 
  applyCircleVariation, 
  applyPolygonVariation,
  resetRunSeed 
} from "@/lib/varietySystem";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { getBallBase, getBallSpecular, clearBallRenderCache } from "@/lib/ballRenderCache";
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
  vec2Reflect,
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
interface LockDustParticle {
  angle: number;   // radians
  speed: number;   // world units / sec
  lifetime: number; // ms
  size: number;    // world units at birth (unused for streaks but kept for compat)
  lengthPx: number; // screen-space streak length in pixels
}
interface LockFlashState {
  ballId: string;
  cellIndices: number[]; // space-grid cell indices (kept for centroid / dust origin)
  polygon: Vector2[];    // exact boundary polygon built from wall intersections
  centroid: Vector2;
  startTime: number;
  ballPos: Vector2;   // ball position at moment of lock
  ballColor: string;  // ball colour for dust tint
  particles: LockDustParticle[];
}
const LOCK_PULSE_DURATION  = 600;      // ms — 3 quick pulses
const LOCK_FLOOD_DURATION  = 380;      // ms — fill explodes across region
const LOCK_DUST_DURATION   = 900;      // ms — longest particle lifetime
const LOCK_TOTAL_DURATION  = LOCK_PULSE_DURATION + LOCK_FLOOD_DURATION;
const BALL_DISINTEGRATE_MS = 420;      // ms — ball shrinks to nothing
const DISSOLVE_DURATION    = 1000;     // ms — board dissolve after level complete

interface DissolveTile {
  sx: number; sy: number; sw: number; sh: number; // source rect in captured canvas
  cx: number; cy: number; // center position at start
  vx: number; vy: number; // initial velocity (px/s)
  rotSpeed: number;       // rad/s
  delay: number;          // seconds before tile starts moving
}
interface DissolveState {
  captured: HTMLCanvasElement;
  tiles: DissolveTile[];
  startTime: number;
  onComplete: () => void;
}
import { Wall, WALL_THICKNESS, WALL_COLOR, createWallsFromPolygon, findWallTermination, castRayWithReflections } from "@/lib/wallGeometry";
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
  CellState,
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
  indexToRowCol,
} from "@/lib/spaceGrid";
import { playWallHitSound, playBallCollideSound, playFenceBreakSound, playDeathSound, playBallLockSound, initAudio } from "@/lib/gameAudio";
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
  regionColor?: string;
  accentColor?: string;
  activeModifiers: GameModifiers;
  cumulativeLockedBalls?: number;
  parallaxTickRef?: React.MutableRefObject<((timestamp: number) => void) | null>;
}

// Game constants - all in WORLD units
const BASE_BALL_RADIUS = 18; // World units (was ~10 in ~450px canvas, now in 900px world)
const BALL_SPEED_INCREASE = 1.03; // Post-wall speed ramp
const BASE_SWIPE_MIN_DISTANCE = 5; // World units
const ARENA_MARGIN = 0.05; // 5% margin from board edges
const MINIMUM_WALL_TIME = 0.35; // seconds
const RECOVERY_WINDOW_MS = 700; // Recovery time after failed wall
const BALL_WON_REGION_THRESHOLD = 5; // Ball is WON if its region is <= this % of total area
const WON_BALL_SPIN_SPEED = 8; // Radians per second for won ball spin

// Difficulty curve: wall speed decreases per level (slower = harder)
const PHYSICS_STEP = 1 / 120; // Fixed physics timestep: 120 ticks per second
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

/**
 * Compute future ball path waypoints by ray-casting off solid walls.
 * Returns an array of points starting at ball.position, with up to numBounces
 * additional reflection points. Ignores in-progress fences (completed walls only).
 *
 * Uses its own ray-segment intersector with t > 0 (not a dist threshold) so it
 * works correctly even when the origin is very close to a wall after a shallow bounce.
 */
function computeBallTrajectory(
  ballPosition: { x: number; y: number },
  ballVelocity: { x: number; y: number },
  walls: Wall[],
  numBounces: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [{ ...ballPosition }];
  let origin = { ...ballPosition };
  let dir = vec2Normalize(ballVelocity);
  let excludeId: string | undefined;

  for (let bounce = 0; bounce < numBounces; bounce++) {
    // Find the nearest wall hit along the ray, skipping the wall we just bounced off.
    let bestT = Infinity;
    let bestNormal: { x: number; y: number } | null = null;
    let bestId: string | undefined;

    for (const wall of walls) {
      if (wall.id === excludeId) continue;

      const ex = wall.end.x - wall.start.x;
      const ey = wall.end.y - wall.start.y;
      const denom = dir.x * ey - dir.y * ex; // ray × wall direction
      if (Math.abs(denom) < 1e-9) continue;  // parallel

      const wx = wall.start.x - origin.x;
      const wy = wall.start.y - origin.y;
      const t = (wx * ey - wy * ex) / denom; // distance along the ray
      const u = (wx * dir.y - wy * dir.x) / denom; // fraction along the wall [0,1]

      if (t > 1e-4 && u >= 0 && u <= 1 && t < bestT) {
        bestT = t;
        bestId = wall.id;
        // Compute wall normal facing toward the incoming ray
        const len = Math.sqrt(ex * ex + ey * ey);
        let nx = -ey / len;
        let ny =  ex / len;
        if (dir.x * nx + dir.y * ny > 0) { nx = -nx; ny = -ny; }
        bestNormal = { x: nx, y: ny };
      }
    }

    if (bestNormal === null) break;

    const hitPoint = { x: origin.x + bestT * dir.x, y: origin.y + bestT * dir.y };
    points.push(hitPoint);

    // Reflect direction off the wall normal
    const dot = dir.x * bestNormal.x + dir.y * bestNormal.y;
    dir = { x: dir.x - 2 * dot * bestNormal.x, y: dir.y - 2 * dot * bestNormal.y };
    // Nudge past the wall surface to avoid re-intersecting it
    origin = { x: hitPoint.x + dir.x * 0.5, y: hitPoint.y + dir.y * 0.5 };
    excludeId = bestId;
  }

  return points;
}

export function GameCanvas({
  level,
  levelNumber,
  totalLevels,
  totalScore,
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
  activeModifiers,
  cumulativeLockedBalls = 0,
  parallaxTickRef,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startDissolveRef = useRef<((onComplete: () => void, tint?: string) => void) | null>(null);
  const onLevelCompleteRef = useRef(onLevelComplete);
  useEffect(() => { onLevelCompleteRef.current = onLevelComplete; }, [onLevelComplete]);
  const onGameEndRef = useRef(onGameEnd);
  useEffect(() => { onGameEndRef.current = onGameEnd; }, [onGameEnd]);
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
  const [bonusPulseKey, setBonusPulseKey] = useState(0);
  // Debounce refs — prevent overlapping flash/shake timeouts from rapid ball hits
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
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
    mirrorPolygons: [] as Polygon[], // Mirror obstacles for distinct cyan rendering
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
    swipePointerId: null as number | null, // Pointer ID that started the current swipe
    lastTime: 0,
    accumulator: 0,
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
    pushStartPercent: 100,
    levelClearedTime: 0, // timestamp when level threshold was first met
    gameLoopFn: null as ((timestamp: number) => void) | null,
    isRecovering: false,
    recoveryEndTime: 0,
    initialSamplePoints: [] as Vector2[], // Track initial board area for blur effect
    frozenBallId: null as string | null, // Ball frozen after fence collision
    frozenBallVelocity: null as Vector2 | null, // Stored velocity to restore after freeze
    frozenBallPosition: null as Vector2 | null, // Stored position to restore after freeze
    // Lock bonus tracking: each locked ball gives 50 * lockOrder (50, 100, 150...)
    lockedBallsCount: 0,
    lockBonus: 0,
    assimilations: new Map<string, LockFlashState>(),
    dissolve: null as DissolveState | null,
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

    // ── Blur canvas helpers (write-once accumulation) ─────────────────────────
    // Removed cells are drawn to the blur canvas once at removal time.
    // resizeCanvas repaints the whole set from scratch after scale changes.
    let removedSamples: Vector2[] = [];
    let removedSamplesSet: Set<string> = new Set();

    const drawSamplesToBlur = (samples: Vector2[]) => {
      const blurCanvas = blurCanvasRef.current;
      const blurCtx = blurCanvas?.getContext("2d");
      if (!blurCtx || !blurCanvas || samples.length === 0) return;
      const { boardRect, regionColor } = game;
      const gridSize = 15;
      const halfGrid = gridSize / 2;
      const cellPadding = 3;
      const cellSize = (gridSize + cellPadding * 2) * boardRect.scale;
      blurCtx.save();
      blurCtx.fillStyle = regionColor;
      blurCtx.globalAlpha = 0.7;
      for (const sample of samples) {
        const sx = boardRect.left + (sample.x - halfGrid - cellPadding) * boardRect.scale;
        const sy = boardRect.top  + (sample.y - halfGrid - cellPadding) * boardRect.scale;
        blurCtx.fillRect(sx, sy, cellSize, cellSize);
      }
      blurCtx.restore();
    };

    const repaintBlurCanvas = () => {
      const blurCanvas = blurCanvasRef.current;
      const blurCtx = blurCanvas?.getContext("2d");
      if (!blurCtx || !blurCanvas) return;
      blurCtx.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
      drawSamplesToBlur(removedSamples);
    };

    /** After each cut, append newly-inactive sample points and draw them once. */
    const collectAndDrawRemovedSamples = () => {
      const activeSet = new Set<string>();
      for (const r of game.regions) {
        for (const s of (r.samplePoints ?? [])) activeSet.add(`${s.x},${s.y}`);
      }
      const newSamples: Vector2[] = [];
      for (const s of game.initialSamplePoints) {
        const key = `${s.x},${s.y}`;
        if (!activeSet.has(key) && !removedSamplesSet.has(key)) {
          newSamples.push(s);
          removedSamplesSet.add(key);
        }
      }
      if (newSamples.length > 0) {
        removedSamples.push(...newSamples);
        drawSamplesToBlur(newSamples);
      }
    };
    // ─────────────────────────────────────────────────────────────────────────

    // ── Region canvas helpers (repaint on cut, blit every frame) ─────────────
    // Region fill shape only changes when a fence completes. Pre-rendering it to
    // an OffscreenCanvas reduces the per-frame draw call count from O(samplePoints)
    // to a single drawImage blit.
    const regionCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    // Scanline pattern tile: 4 rows — 3px transparent + 1px dark line
    const scanlineTile = new OffscreenCanvas(4, 4);
    (() => {
      const stCtx = scanlineTile.getContext('2d')!;
      stCtx.clearRect(0, 0, 4, 4);
      stCtx.fillStyle = 'rgba(0,0,0,0.18)';
      stCtx.fillRect(0, 3, 4, 1);
    })();

    const repaintRegionCanvas = () => {
      const rCtx = regionCanvas.getContext("2d");
      if (!rCtx) return;
      const { width: sw, height: sh } = game.screenSize;
      if (regionCanvas.width !== sw || regionCanvas.height !== sh) {
        regionCanvas.width  = sw;
        regionCanvas.height = sh;
      }
      rCtx.clearRect(0, 0, regionCanvas.width, regionCanvas.height);
      if (game.regions.length === 0) return;

      const { boardRect, regionColor } = game;
      const gridSize    = 15;
      const halfGrid    = gridSize / 2;
      const cellPadding = 3;

      rCtx.save();
      rCtx.globalAlpha = canvasOpacity * 0.55; // reduced so scanline layer doesn't look heavy
      rCtx.fillStyle   = regionColor;

      for (const region of game.regions) {
        if (region.samplePoints && region.samplePoints.length > 0) {
          // First pass: all filled cells (base, reduced alpha)
          for (const sample of region.samplePoints) {
            const sx   = boardRect.left + (sample.x - halfGrid - cellPadding) * boardRect.scale;
            const sy   = boardRect.top  + (sample.y - halfGrid - cellPadding) * boardRect.scale;
            const size = (gridSize + cellPadding * 2) * boardRect.scale;
            rCtx.fillRect(sx, sy, size, size);
          }
          // Second pass: edge cells at full alpha (boundary stays readable)
          const sampleSet = new Set(region.samplePoints.map(s => `${s.x},${s.y}`));
          const edgePadding = 5;
          rCtx.save();
          rCtx.globalAlpha = canvasOpacity;
          for (const sample of region.samplePoints) {
            const isEdge = [
              `${sample.x - gridSize},${sample.y}`,
              `${sample.x + gridSize},${sample.y}`,
              `${sample.x},${sample.y - gridSize}`,
              `${sample.x},${sample.y + gridSize}`,
            ].some(n => !sampleSet.has(n));
            if (isEdge) {
              const sx     = boardRect.left + (sample.x - halfGrid - edgePadding) * boardRect.scale;
              const sy     = boardRect.top  + (sample.y - halfGrid - edgePadding) * boardRect.scale;
              const size   = (gridSize + edgePadding * 2) * boardRect.scale;
              const radius = 4 * boardRect.scale;
              rCtx.beginPath();
              rCtx.roundRect(sx, sy, size, size, radius);
              rCtx.fill();
            }
          }
          rCtx.restore();
        } else {
          // Fallback: polygon outline (initial region before any cut)
          const { vertices } = region.polygon;
          if (vertices.length < 3) continue;
          rCtx.beginPath();
          rCtx.moveTo(boardRect.left + vertices[0].x * boardRect.scale, boardRect.top + vertices[0].y * boardRect.scale);
          for (let i = 1; i < vertices.length; i++) {
            rCtx.lineTo(boardRect.left + vertices[i].x * boardRect.scale, boardRect.top + vertices[i].y * boardRect.scale);
          }
          rCtx.closePath();
          rCtx.fill();
        }
      }

      // Scanline overlay: repeating horizontal dark lines across all region cells
      const scanPattern = rCtx.createPattern(scanlineTile, 'repeat');
      if (scanPattern) {
        rCtx.save();
        rCtx.globalAlpha = 1;
        rCtx.globalCompositeOperation = 'source-over';
        rCtx.fillStyle = scanPattern;
        rCtx.fillRect(0, 0, regionCanvas.width, regionCanvas.height);
        rCtx.restore();
      }
      rCtx.restore();
    };
    // ─────────────────────────────────────────────────────────────────────────

    // CRT phosphor dot overlay — painted once on mount/resize, zero per-frame cost
    const paintOverlayCanvas = () => {
      const oc = overlayCanvasRef.current;
      if (!oc) return;
      const { width: w, height: h } = canvas;
      oc.width  = w; oc.height = h;
      oc.style.width  = `${w}px`;
      oc.style.height = `${h}px`;
      const oCtx = oc.getContext('2d');
      if (!oCtx) return;
      oCtx.clearRect(0, 0, w, h);
      // Build 3×3 phosphor dot tile: 1px circle at centre on dark gap
      const tile = new OffscreenCanvas(3, 3);
      const tCtx = tile.getContext('2d')!;
      tCtx.clearRect(0, 0, 3, 3);
      tCtx.fillStyle = 'rgba(0,0,0,0.08)';
      tCtx.beginPath();
      tCtx.arc(1.5, 1.5, 0.6, 0, Math.PI * 2);
      tCtx.fill();
      const pattern = oCtx.createPattern(tile, 'repeat')!;
      oCtx.fillStyle = pattern;
      oCtx.fillRect(0, 0, w, h);
      // Vignette: transparent centre → dark corners
      const cx = w / 2, cy = h / 2;
      const vign = oCtx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.72);
      vign.addColorStop(0,   'rgba(0,0,0,0)');
      vign.addColorStop(1,   'rgba(0,0,0,0.22)');
      oCtx.fillStyle = vign;
      oCtx.fillRect(0, 0, w, h);
    };

    // Ambient data-rain particles — purely cosmetic background effect
    interface RainParticle { x: number; y: number; symbol: string; alpha: number; speed: number; size: number; }
    const RAIN_SYMBOLS = '01{}()=>;./#@*';
    let rainParticles: RainParticle[] = [];
    let rainLastTime = 0;
    const spawnRainParticle = (startY?: number): RainParticle => ({
      x: 15 + Math.random() * (BOARD_WIDTH - 30),
      y: startY ?? -(10 + Math.random() * 80),
      symbol: RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)],
      alpha: 0.03 + Math.random() * 0.04,
      speed: 30 + Math.random() * 50,
      size: 15 + Math.random() * 10,
    });

    // Circuit-board hex overlay cached per accent colour
    const hexOverlayCache = new Map<string, OffscreenCanvas>();
    const getHexOverlay = (color: string): OffscreenCanvas => {
      if (hexOverlayCache.has(color)) return hexOverlayCache.get(color)!;
      const SIZE = 128;
      const oc = new OffscreenCanvas(SIZE, SIZE);
      const hCtx = oc.getContext('2d')!;
      const R = 10;                        // hex circumradius in 128px space
      const s3 = Math.sqrt(3);
      hCtx.strokeStyle = color;
      hCtx.lineWidth = 0.7;
      hCtx.globalAlpha = 1;                // full alpha; caller controls composite alpha
      hCtx.lineCap = 'round';
      for (let col = -1; col <= Math.ceil(SIZE / (R * 1.5)) + 1; col++) {
        for (let row = -1; row <= Math.ceil(SIZE / (R * s3)) + 1; row++) {
          const cx = col * 1.5 * R;
          const cy = row * R * s3 + (col % 2 === 0 ? 0 : R * s3 / 2);
          hCtx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i;
            const px = cx + R * Math.cos(a);
            const py = cy + R * Math.sin(a);
            if (i === 0) hCtx.moveTo(px, py); else hCtx.lineTo(px, py);
          }
          hCtx.closePath();
          hCtx.stroke();
        }
      }
      hexOverlayCache.set(color, oc);
      return oc;
    };

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
      game.assimilations.clear();

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
        level.randomShapes ?? 20,
        level.entities || [],
        level.balls
      );
      const allEntities = [...(level.entities || []), ...randomObstacles];

      const mirrorPolygons: Polygon[] = [];
      if (allEntities.length > 0) {
        let obstacleIndex = 0;
        for (const entity of allEntities) {
          if (entity.kind === "wall") {
            const isMirror = !!entity.mirror;
            let basePolygon: Polygon;

            if (entity.shape === "rect") {
              if (isMirror) {
                // Mirror entities: clean rect, no variety/decorations
                basePolygon = createPolygonFromShape("rect", {
                  x: entity.x, y: entity.y,
                  width: entity.width, height: entity.height,
                });
              } else {
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
              }
            } else if (entity.shape === "polygon") {
              if (isMirror) {
                basePolygon = { vertices: entity.points.map(([x, y]) => ({ x, y })) };
              } else {
                // Apply vertex offset variation to polygon based on variety
                const variedVertices = applyPolygonVariation(
                  entity.points.map(([x, y]) => ({ x, y })),
                  variety, level.id, entity.id
                );
                basePolygon = { vertices: variedVertices };
              }
            } else if (entity.shape === "circle") {
              const radius = isMirror
                ? entity.radius
                : applyCircleVariation(entity.radius, variety, level.id, entity.id);
              const numSides = 64;
              const vertices: { x: number; y: number }[] = [];
              for (let i = 0; i < numSides; i++) {
                const angle = (i / numSides) * Math.PI * 2;
                vertices.push({
                  x: entity.cx + Math.cos(angle) * radius,
                  y: entity.cy + Math.sin(angle) * radius,
                });
              }
              basePolygon = { vertices };
            } else {
              continue;
            }

            let obstaclePolygon: Polygon;
            if (isMirror) {
              // Mirrors skip decorations
              obstaclePolygon = basePolygon;
            } else {
              // Add visual decorations (bumps, spikes, etc.) based on variety
              const decorationConfig = getVarietyDecorationConfig(
                variety, level.id, entity.id, obstacleIndex
              );
              obstaclePolygon = variety > 0
                ? decoratePolygon(basePolygon, decorationConfig)
                : basePolygon;
            }
            obstacleIndex++;

            if (isMirror) {
              mirrorPolygons.push(obstaclePolygon);
            }
            obstaclePolygons.push(obstaclePolygon);
            // Add obstacle edges as walls
            const obstacleWalls = createWallsFromPolygon(obstaclePolygon, `obstacle-${entity.id}`, isMirror);
            allWalls.push(...obstacleWalls);
          }
        }
      }

      // Store all walls and obstacles in unified model
      game.walls = allWalls;
      game.obstaclePolygons = obstaclePolygons;
      game.mirrorPolygons = mirrorPolygons;

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
          baseSpeed: modifiedSpeed,
          topSpeed: modifiedTopSpeed,
          color: `#${ballConfig.color}`,
          regionId: "", // Will be assigned after regions are created
          rotation: Math.random() * Math.PI * 2, // Start with random rotation
          flashIntensity: 0, // Legacy - kept for compatibility
          effects: createBallEffectState(), // Visual effects state
          state: 'active' as const, // Ball starts in active state
          wonSpinSpeed: 0, // Only used when in 'won' state
          wonTime: 0,
          assimScale: 1,
          assimColorFade: 0,
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

      // Reset blur accumulation state for new level
      removedSamples = [];
      removedSamplesSet = new Set();
      repaintBlurCanvas();
      
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

      // Region canvas must be built after initial regions are established
      repaintRegionCanvas();

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
      game.swipePointerId = null;
      game.lastTime = 0;
      game.accumulator = 0;
      game.wallCount = 0;
      clearWallImpacts(); // Clear any lingering visual effects
      setCutCount(0);
      setRemainingPercent(Math.round(targetRemaining));

      // Seed rain particles staggered across the board
      rainParticles = Array.from({ length: 40 }, (_, i) =>
        spawnRainParticle(-10 - (i / 40) * BOARD_HEIGHT),
      );
      rainLastTime = 0;
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

      // Ball render cache is keyed by screenRadius which changes with scale → invalidate
      clearBallRenderCache();
      // Blur canvas pixels are in screen-space → repaint from stored world-space samples
      repaintBlurCanvas();
      // Region canvas likewise needs scale-corrected coordinates
      repaintRegionCanvas();
      // CRT phosphor overlay is screen-size locked → repaint
      paintOverlayCanvas();

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
      if (ball.state === 'won') return; // stopped and disintegrating

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
      const prevLockedCount = game.lockedBallsCount;
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
          // Transition to WON state — stop the ball, then it disintegrates
          ball.state = 'won';
          ball.wonTime = performance.now();
          ball.velocity = { x: 0, y: 0 };
          ball.speed = 0;

          // Kick off the pulse-then-flood + dust disintegration animation.
          if (ballRegion.cellIndices.length > 0) {
            // Build exact boundary polygon by casting rays from centroid to all walls.
            // Each ray finds the closest wall intersection — gives the true fence geometry.
            const centroid = ballRegion.centroid;
            const RAY_COUNT = 360;
            const RAY_LEN = 4000;
            const hitPoints: Array<{ angle: number; pt: Vector2 }> = [];
            for (let ri = 0; ri < RAY_COUNT; ri++) {
              const angle = (ri / RAY_COUNT) * Math.PI * 2;
              const rayEnd = {
                x: centroid.x + Math.cos(angle) * RAY_LEN,
                y: centroid.y + Math.sin(angle) * RAY_LEN,
              };
              let closestDist = Infinity;
              let closestPt: Vector2 | null = null;
              for (const wall of game.walls) {
                const hit = lineSegmentIntersection(centroid, rayEnd, wall.start, wall.end);
                if (hit) {
                  const d = (hit.x - centroid.x) ** 2 + (hit.y - centroid.y) ** 2;
                  if (d < closestDist) { closestDist = d; closestPt = hit; }
                }
              }
              if (closestPt) hitPoints.push({ angle, pt: closestPt });
            }
            // Sort by angle and deduplicate adjacent near-identical points
            hitPoints.sort((a, b) => a.angle - b.angle);
            const polygon: Vector2[] = [];
            for (const { pt } of hitPoints) {
              const last = polygon[polygon.length - 1];
              if (!last || Math.abs(pt.x - last.x) > 0.5 || Math.abs(pt.y - last.y) > 0.5) {
                polygon.push(pt);
              }
            }

            const PARTICLE_COUNT = 110;
            const particles: LockDustParticle[] = [
              // Main burst — short streaks (4–14 px)
              ...Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
                angle: (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.25,
                speed: 12 + Math.random() * 60,
                lifetime: 350 + Math.random() * 550,
                size: 0.6 + Math.random() * 2.0,
                lengthPx: 4 + Math.random() * 10,
              })),
              // Needle streaks — longer, energetic spines
              ...Array.from({ length: 20 }, (_, i) => ({
                angle: (i / 20) * Math.PI * 2 + (Math.random() - 0.5) * 0.15,
                speed: 40 + Math.random() * 80,
                lifetime: 250 + Math.random() * 300,
                size: 1.0,
                lengthPx: 18 + Math.random() * 22,
              })),
            ];
            game.assimilations.set(ball.id, {
              ballId: ball.id,
              cellIndices: [...ballRegion.cellIndices],
              polygon,
              centroid: { ...ballRegion.centroid },
              startTime: performance.now(),
              ballPos: { ...ball.position },
              ballColor: ball.color,
              particles,
            });
            playBallLockSound();
          }
          
           game.lockedBallsCount += 1;

           // MicroManager: immediately cap speed of remaining active balls
           if (activeModifiers.microManagerPerLock > 0) {
             // Compounding: each locked ball multiplies speed by (1 - perLock), min 30%
             const totalLocked = cumulativeLockedBalls + game.lockedBallsCount;
             const speedFactor = Math.max(0.30, Math.pow(1 - activeModifiers.microManagerPerLock, totalLocked));
             for (const otherBall of game.balls) {
               if (otherBall.state === 'won' || otherBall.speed === 0) continue;
               const actualSpeed = vec2Length(otherBall.velocity);
               const cappedSpeed = otherBall.baseSpeed * speedFactor;
               if (actualSpeed > cappedSpeed && cappedSpeed > 0) {
                 const ratio = cappedSpeed / actualSpeed;
                 otherBall.velocity.x *= ratio;
                 otherBall.velocity.y *= ratio;
                 otherBall.speed = cappedSpeed;
               }
             }
           }

          // Update React state for UI display
          setLockedBallsCount(game.lockedBallsCount);
          
          anyBallWon = true;
        }
      }

      // Multi-lock multiplier: N balls locked simultaneously = N × N bonus points
      const newlyLocked = game.lockedBallsCount - prevLockedCount;
      if (newlyLocked > 0) {
        game.lockBonus += newlyLocked * newlyLocked;
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
      // Check all segments in both waypoint paths
      const checkWaypoints = (waypoints: Vector2[]): boolean => {
        for (let i = 0; i < waypoints.length - 1; i++) {
          const dist = pointToSegmentDistance(ball.position, waypoints[i], waypoints[i + 1]);
          if (dist < 0.5) return true;
        }
        return false;
      };
      return checkWaypoints(wall.startWaypoints) || checkWaypoints(wall.endWaypoints);
    };

    const handleGameOver = () => {
      game.gameOver = true;
      playDeathSound();
      const percent = Math.round((getCombinedArea() / game.originalArea) * 100);

      // If in push mode, level is still cleared - keep full score + push bonus earned so far
      if (game.pushMode === "pushing") {
        const effectiveExpectedCuts = level.expectedCuts;

        // Use scoring at the moment push started (clearedPercent), not current percent
        const pushStartPercent = game.bestRemainingPercent;
        const { levelScore, breakdown } = calculateScore(
          game.wallCount,
          effectiveExpectedCuts,
          pushStartPercent,
          level.sizeThreshold,
          level.points,
          activeModifiers.scoreMultiplier,
          levelNumber
        );

        // Calculate push bonus: +1 OT per 25% of original remaining area cleared
        const areaAtPushStart = game.pushStartPercent ?? pushStartPercent;
        const areaCleared = Math.max(0, areaAtPushStart - percent);
        const chunkSize = areaAtPushStart * 0.25;
        const pushBonus = chunkSize > 0 ? Math.floor(areaCleared / chunkSize) : 0;

        const scoreData = {
          levelNumber,
          levelId: level.id,
          cutCount: game.wallCount,
          expectedCuts: level.expectedCuts,
          basePoints: level.points,
          levelScore: levelScore + game.lockBonus + pushBonus,
          remainingPercent: percent,
          overcutBonus: 0,
          thresholdPercent: level.sizeThreshold,
          pushFailed: true,
          pushBonus,
          underParBonus: breakdown.underParBonus,
          spaceBonus: breakdown.spaceBonus,
          spaceBonusRaw: breakdown.spaceBonusRaw,
          performanceMultiplier: breakdown.performanceMultiplier,
          fencesUnderPar: breakdown.fencesUnderPar,
          fencesOverPar: breakdown.fencesOverPar,
          extraPercent: breakdown.extraPercent,
          lockBonus: game.lockBonus,
          lockedBallsCount: game.lockedBallsCount,
        };
        onLevelCompleteRef.current(scoreData);
        startDissolve(() => {}, 'rgba(160, 0, 0, 0.55)');
        return;
      }

      // Freeze and shake for 1 second before showing game over
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
      setScreenFlash("red");
      setIsShaking(true);

      shakeTimeoutRef.current = setTimeout(() => {
        shakeTimeoutRef.current = null;
        setScreenFlash("none");
        setIsShaking(false);

        onGameEndRef.current({
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

    // Handle push-your-luck failure - level still complete, keep full score + push bonus
    const handlePushFailed = () => {
      game.gameOver = true;
      const percent = Math.round((getCombinedArea() / game.originalArea) * 100);

      const effectiveExpectedCuts = level.expectedCuts;

      // Score based on push start state - player keeps everything
      const { levelScore, breakdown } = calculateScore(
        game.wallCount,
        effectiveExpectedCuts,
        game.pushStartPercent ?? percent,
        level.sizeThreshold,
        level.points,
        activeModifiers.scoreMultiplier,
        levelNumber
      );

      // Calculate push bonus: +1 OT per 25% of original remaining area cleared
      const areaAtPushStart = game.pushStartPercent ?? percent;
      const areaCleared = Math.max(0, areaAtPushStart - percent);
      const chunkSize = areaAtPushStart * 0.25;
      const pushBonus = chunkSize > 0 ? Math.floor(areaCleared / chunkSize) : 0;

      const scoreData = {
        levelNumber,
        levelId: level.id,
        cutCount: game.wallCount,
        expectedCuts: level.expectedCuts,
        basePoints: level.points,
        levelScore: levelScore + game.lockBonus + pushBonus,
        remainingPercent: percent,
        overcutBonus: 0,
        thresholdPercent: level.sizeThreshold,
        pushFailed: true,
        pushBonus,
        underParBonus: breakdown.underParBonus,
        spaceBonus: breakdown.spaceBonus,
        spaceBonusRaw: breakdown.spaceBonusRaw,
        performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar,
        fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent,
        lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
      };
      onLevelCompleteRef.current(scoreData);
      startDissolve(() => {}, 'rgba(160, 0, 0, 0.55)');
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

      if (subRegions.length <= 1) {
        return false;
      }

      const regionsWithBalls = subRegions.filter((r) => r.hasBalls);
      const regionsWithoutBalls = subRegions.filter((r) => !r.hasBalls);

      if (regionsWithoutBalls.length === 0) return false;

      // Build new regions for areas with balls
      const newRegions: Region[] = game.regions.filter((r) => r.id !== region.id);

      for (const subRegion of regionsWithBalls) {
        const result = buildPolygonFromSamples(subRegion.samples, region, subRegion.samples.length);

        if (result && result.estimatedArea > 100) {
          const newId = generateRegionId();
          // CRITICAL: Store samplePoints in the new region for accurate area tracking
          newRegions.push({ 
            id: newId, 
            polygon: result.polygon, 
            estimatedArea: result.estimatedArea,
            samplePoints: result.samplePoints
          });

          // Ball region assignment handled by mandatory validation below
        }
      }

      if (newRegions.length === 0) {
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
        ball.baseSpeed = Math.min(ball.baseSpeed * BALL_SPEED_INCREASE, ball.topSpeed);
        ball.velocity.x *= ratio;
        ball.velocity.y *= ratio;
      }

      // MicroManager: cap speed of all active balls based on locked ball count
      const totalLockedMM = cumulativeLockedBalls + game.lockedBallsCount;
      if (activeModifiers.microManagerPerLock > 0 && totalLockedMM > 0) {
        const totalReduction = Math.min(0.70, totalLockedMM * activeModifiers.microManagerPerLock);
        for (const ball of balls) {
          if (ball.state === 'won' || ball.speed === 0) continue;
          const cappedSpeed = ball.baseSpeed * (1 - totalReduction);
          if (ball.speed > cappedSpeed) {
            const ratio = cappedSpeed / ball.speed;
            ball.velocity.x *= ratio;
            ball.velocity.y *= ratio;
            ball.speed = cappedSpeed;
          }
        }
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

    // ============================================================
    // BONUS FENCE CUT (Garbage Collector modifier)
    // Fires after a fence completes when bonusRemovalChance triggers.
    // Draws an automatic fence from an edge of the playable area,
    // cutting off ~bonusRemovalAmount of the total initial area.
    // Only cuts ball-free strips so it never kills a ball.
    // ============================================================
    const applyBonusFenceCut = (amount: number) => {
      if (!game.spaceGrid) return;
      const grid = game.spaceGrid;
      const { balls } = game;

      // Count remaining active cells
      let totalActiveCells = 0;
      for (let i = 0; i < grid.cells.length; i++) {
        if (grid.cells[i] === CellState.ACTIVE) totalActiveCells++;
      }
      if (totalActiveCells === 0) return;

      // N squares to place, each covering 1% of remaining area
      const N = Math.max(1, Math.floor(amount * 100));
      const squareCellCount = Math.max(1, Math.floor(totalActiveCells / 100));
      const squareSide = Math.max(1, Math.ceil(Math.sqrt(squareCellCount)));

      const liveBalls = balls.filter(b => b.state !== 'won' && b.speed > 0);

      for (let sq = 0; sq < N; sq++) {
        let bestScore = -Infinity;
        let bestIndices: number[] = [];

        for (let cr = 0; cr <= grid.height - squareSide; cr++) {
          for (let cc = 0; cc <= grid.width - squareSide; cc++) {
            // Collect active cells in this candidate block
            const candidateIndices: number[] = [];
            for (let dr = 0; dr < squareSide; dr++) {
              for (let dc = 0; dc < squareSide; dc++) {
                const idx = (cr + dr) * grid.width + (cc + dc);
                if (idx < grid.cells.length && grid.cells[idx] === CellState.ACTIVE) {
                  candidateIndices.push(idx);
                }
              }
            }
            if (candidateIndices.length === 0) continue;

            // World-space centre of the candidate block
            const cx = grid.originX + (cc + squareSide / 2) * grid.cellSize;
            const cy = grid.originY + (cr + squareSide / 2) * grid.cellSize;

            // Primary score: distance to the nearest live ball
            let minDist = liveBalls.length === 0 ? 1 : Infinity;
            for (const ball of liveBalls) {
              const dx = cx - ball.position.x;
              const dy = cy - ball.position.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < minDist) minDist = d;
            }

            // "Behind the ball" bonus: for nearby balls prefer placing in their wake
            let behindBonus = 0;
            for (const ball of liveBalls) {
              const dx = cx - ball.position.x;
              const dy = cy - ball.position.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const spd = Math.sqrt(ball.velocity.x ** 2 + ball.velocity.y ** 2);
              if (spd > 0 && dist < squareSide * grid.cellSize * 6) {
                // Positive when square is behind the ball (opposite to velocity)
                const behind = (dx * (-ball.velocity.x) + dy * (-ball.velocity.y)) / spd;
                behindBonus = Math.max(behindBonus, behind * 0.15);
              }
            }

            const score = minDist + behindBonus;
            if (score > bestScore) {
              bestScore = score;
              bestIndices = candidateIndices;
            }
          }
        }

        if (bestIndices.length === 0) break;

        // Mark the chosen block's cells as removed
        for (const idx of bestIndices) {
          grid.cells[idx] = CellState.REMOVED;
        }
      }

      // Batch cleanup: remove grid regions that no longer contain any live ball
      const postGridRegions = findGridRegions(grid);
      const postWithBalls: GridRegion[] = [];
      for (const region of postGridRegions) {
        let hasBallInRegion = false;
        for (const ball of balls) {
          if (ball.state === 'won') continue;
          const bidx = worldToGridIndex(grid, ball.position.x, ball.position.y);
          if (bidx >= 0 && region.cellIndices.includes(bidx)) { hasBallInRegion = true; break; }
        }
        if (hasBallInRegion) {
          postWithBalls.push(region);
        } else {
          removeRegion(grid, region);
        }
      }
      game.gridRegions = postWithBalls;

      // Update sample-based regions for rendering
      const bonusUpdatedRegions: Region[] = [];
      for (const region of [...game.regions]) {
        const subRegions = findSubRegionsGrid(region);
        if (subRegions.length <= 1) {
          if (subRegions.length === 1 && subRegions[0].hasBalls) {
            bonusUpdatedRegions.push({
              ...region,
              samplePoints: subRegions[0].samples,
              estimatedArea: subRegions[0].samples.length * 15 * 15,
            });
          }
          continue;
        }
        for (const subRegion of subRegions.filter(r => r.hasBalls)) {
          const result = buildPolygonFromSamples(subRegion.samples, region, subRegion.samples.length);
          if (result && result.estimatedArea > 100) {
            bonusUpdatedRegions.push({
              id: generateRegionId(),
              polygon: result.polygon,
              estimatedArea: result.estimatedArea,
              samplePoints: result.samplePoints,
            });
          }
        }
      }
      game.regions = bonusUpdatedRegions;
      collectAndDrawRemovedSamples();
      repaintRegionCanvas();
      reassignBallsToRegions(game.balls, game.regions, game.walls);
      validateAllBallOwnership(game.balls, game.regions, game.walls);
      checkAndUpdateBallWonStates();
      setBonusPulseKey(k => k + 1);
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
      // Check all segments of both waypoint paths
      {
        const allSegs: { start: Vector2; end: Vector2 }[] = [];
        for (let i = 0; i < wall.startWaypoints.length - 1; i++) {
          allSegs.push({ start: wall.startWaypoints[i], end: wall.startWaypoints[i + 1] });
        }
        for (let i = 0; i < wall.endWaypoints.length - 1; i++) {
          allSegs.push({ start: wall.endWaypoints[i], end: wall.endWaypoints[i + 1] });
        }
        for (const seg of allSegs) {
          if (wouldWallTrapBallCheck(seg.start, seg.end)) {
            return;
          }
        }
      }

      // Add walls for all segments of both waypoint paths
      const addSegmentWalls = (waypoints: Vector2[]) => {
        for (let i = 0; i < waypoints.length - 1; i++) {
          const newWall: Wall = {
            id: generateWallId(),
            start: { ...waypoints[i] },
            end: { ...waypoints[i + 1] },
            thickness: wall.thickness,
          };
          game.walls.push(newWall);
        }
      };
      addSegmentWalls(wall.startWaypoints);
      addSegmentWalls(wall.endWaypoints);

      // ============================================================
      // STEP 1: Rasterize cut to grid (mark cells as REMOVED)
      // ============================================================
      if (game.spaceGrid) {
        // Rasterize all segments of both waypoint paths
        let totalRemoved = 0;
        const rasterizeWaypoints = (waypoints: Vector2[]) => {
          for (let i = 0; i < waypoints.length - 1; i++) {
            const removedCells = rasterizeCutToGrid(
              game.spaceGrid!,
              waypoints[i],
              waypoints[i + 1],
              wall.thickness
            );
            totalRemoved += removedCells.length;
          }
        };
        rasterizeWaypoints(wall.startWaypoints);
        rasterizeWaypoints(wall.endWaypoints);

        // ============================================================
        // STEP 2: Find connected regions via flood-fill
        // ============================================================
        const gridRegions = findGridRegions(game.spaceGrid);

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

        // ============================================================
        // STEP 4: Remove regions without balls
        // ============================================================
        for (const emptyRegion of regionsWithoutBalls) {
          removeRegion(game.spaceGrid, emptyRegion);
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

      // Write cells removed by this cut to the blur canvas (event-driven, not per-frame)
      collectAndDrawRemovedSamples();
      // Repaint region canvas with updated shape
      repaintRegionCanvas();

      // Reassign balls to regions
      reassignBallsToRegions(game.balls, game.regions, game.walls);
      validateAllBallOwnership(game.balls, game.regions, game.walls);

      game.activeWall = null;

      // ============================================================
      // STEP 5: Check for ball WON states
      // ============================================================
      checkAndUpdateBallWonStates();
      // Render immediately so the lock animation is visible even if the game ends this frame
      render();

      // ============================================================
      // STEP 5c: Speed up balls + MicroManager cap
      // ============================================================
      for (const ball of balls) {
        if (ball.speed === 0) continue; // skip won/dead balls
        const newSpeed = Math.min(ball.speed * BALL_SPEED_INCREASE, ball.topSpeed);
        const ratio = newSpeed / ball.speed;
        ball.speed = newSpeed;
        ball.baseSpeed = Math.min(ball.baseSpeed * BALL_SPEED_INCREASE, ball.topSpeed);
        ball.velocity.x *= ratio;
        ball.velocity.y *= ratio;
      }
      const totalLockedMM2 = cumulativeLockedBalls + game.lockedBallsCount;
      if (activeModifiers.microManagerPerLock > 0 && totalLockedMM2 > 0) {
        // Compounding: each locked ball multiplies speed by (1 - perLock), min 30%
        const speedFactor = Math.max(0.30, Math.pow(1 - activeModifiers.microManagerPerLock, totalLockedMM2));
        for (const ball of balls) {
          if (ball.state === 'won' || ball.speed === 0) continue;
          const actualSpeed = vec2Length(ball.velocity);
          const cappedSpeed = ball.baseSpeed * speedFactor;
          if (actualSpeed > cappedSpeed && cappedSpeed > 0) {
            const ratio = cappedSpeed / actualSpeed;
            ball.velocity.x *= ratio;
            ball.velocity.y *= ratio;
            ball.speed = cappedSpeed;
          }
        }
      }

      // ============================================================
      // STEP 5b: Bonus fence cuts
      // ============================================================
      if (!game.gameOver) {
        // Aggressive Refactor: guaranteed extra cut every fence
        if (activeModifiers.mapReductionPerFenceBonus > 0) {
          applyBonusFenceCut(activeModifiers.mapReductionPerFenceBonus);
        }
        // Garbage Collector: probabilistic extra cut
        if (
          activeModifiers.bonusRemovalChance > 0 &&
          activeModifiers.bonusRemovalAmount > 0 &&
          Math.random() < activeModifiers.bonusRemovalChance
        ) {
          applyBonusFenceCut(activeModifiers.bonusRemovalAmount);
        }
      }

      // ============================================================
      // STEP 6: Check if ALL balls are WON (level win condition)
      // ============================================================
      if (areAllBallsWon()) {
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

        const scoreData = {
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
        };

        // Wait for lock animation then dissolve the board, then hand off
        const lockDelay = game.assimilations.size > 0 ? LOCK_TOTAL_DURATION + 200 : 0;
        setTimeout(() => {
          onLevelCompleteRef.current(scoreData);
          startDissolve(() => {});
        }, lockDelay);
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

      // Check if level just got cleared (space threshold + optional thread-lock requirement)
      const lockReq = level.threadLockRequired ?? 0;
      if (percent < level.sizeThreshold && game.lockedBallsCount >= lockReq && game.pushMode === "none") {
        render();
        render();
        game.pushMode = "prompt";
        game.levelClearedTime = performance.now();
        setPushMode("prompt");
        setClearedPercent(percent);
        game.bestRemainingPercent = percent;
        game.pushStartPercent = percent;
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

      // Calculate total path length for speed calibration
      let totalStartPath = 0;
      for (let i = 0; i < wall.startWaypoints.length - 1; i++) {
        totalStartPath += vec2Distance(wall.startWaypoints[i], wall.startWaypoints[i + 1]);
      }
      let totalEndPath = 0;
      for (let i = 0; i < wall.endWaypoints.length - 1; i++) {
        totalEndPath += vec2Distance(wall.endWaypoints[i], wall.endWaypoints[i + 1]);
      }
      const longestHalf = Math.max(totalStartPath, totalEndPath);
      const maxSpeedForMinTime = longestHalf / MINIMUM_WALL_TIME;
      const wallSpeedFinal = Math.min(wallSpeedEffective, maxSpeedForMinTime);

      // Ease-in-out: fast start, smooth arrival — makes each cut feel deliberate
      const easeInOut = (t: number) =>
        t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      let growth: number;
      if (wall.startTime) {
        const elapsed = (performance.now() - wall.startTime) / 1000;
        const expectedDuration = longestHalf / wallSpeedFinal;
        const prevT = Math.max(0, Math.min(1, (elapsed - dt) / expectedDuration));
        const currT = Math.max(0, Math.min(1, elapsed / expectedDuration));
        growth = (easeInOut(currT) - easeInOut(prevT)) * longestHalf;
      } else {
        growth = wallSpeedFinal * dt; // instant fences — no easing needed
      }

      // Grow start side along waypoints
      {
        let remaining = growth;
        while (remaining > 0.01 && wall.startSegmentIndex < wall.startWaypoints.length - 1) {
          const segTarget = wall.startWaypoints[wall.startSegmentIndex + 1];
          const dist = vec2Distance(wall.startPoint, segTarget);
          if (dist <= remaining + 0.5) {
            // Reached this waypoint, advance to next segment
            wall.startPoint = { ...segTarget };
            remaining -= dist;
            wall.startSegmentIndex++;
          } else {
            const dir = vec2Normalize(vec2Sub(segTarget, wall.startPoint));
            wall.startPoint = vec2Add(wall.startPoint, vec2Scale(dir, remaining));
            remaining = 0;
          }
        }
      }

      // Grow end side along waypoints
      {
        let remaining = growth;
        while (remaining > 0.01 && wall.endSegmentIndex < wall.endWaypoints.length - 1) {
          const segTarget = wall.endWaypoints[wall.endSegmentIndex + 1];
          const dist = vec2Distance(wall.endPoint, segTarget);
          if (dist <= remaining + 0.5) {
            wall.endPoint = { ...segTarget };
            remaining -= dist;
            wall.endSegmentIndex++;
          } else {
            const dir = vec2Normalize(vec2Sub(segTarget, wall.endPoint));
            wall.endPoint = vec2Add(wall.endPoint, vec2Scale(dir, remaining));
            remaining = 0;
          }
        }
      }

      // Check if complete (both sides reached final waypoints)
      const startDone = vec2Distance(wall.startPoint, wall.targetStart) < 1;
      const endDone = vec2Distance(wall.endPoint, wall.targetEnd) < 1;
      if (startDone && endDone) {
        wall.startPoint = { ...wall.targetStart };
        wall.endPoint = { ...wall.targetEnd };
        if (!wall.isComplete) {
          wall.isComplete = true;
        }
      }

      // Collision check with any ball while growing — check ALL segments
      if (!wall.isComplete && !game.isRecovering) {
        // Build all renderable segments for collision
        const allSegments: { start: Vector2; end: Vector2 }[] = [];
        // Start side: completed segments + partial current
        for (let i = 0; i < wall.startSegmentIndex; i++) {
          allSegments.push({ start: wall.startWaypoints[i], end: wall.startWaypoints[i + 1] });
        }
        allSegments.push({ start: wall.startWaypoints[wall.startSegmentIndex], end: wall.startPoint });
        // End side: completed segments + partial current
        for (let i = 0; i < wall.endSegmentIndex; i++) {
          allSegments.push({ start: wall.endWaypoints[i], end: wall.endWaypoints[i + 1] });
        }
        allSegments.push({ start: wall.endWaypoints[wall.endSegmentIndex], end: wall.endPoint });

        for (const ball of balls) {
          const effectiveCollisionRadius = ball.radius;
          let hit = false;
          for (const seg of allSegments) {
            if (circleCapsuleCollision(ball.position, effectiveCollisionRadius, seg.start, seg.end, wall.thickness / 2)) {
              hit = true;
              break;
            }
          }

          if (hit) {
            // Freeze the ball that hit the fence - store position and velocity, then stop it
            game.frozenBallId = ball.id;
            game.frozenBallPosition = { ...ball.position };
            game.frozenBallVelocity = { ...ball.velocity };
            ball.velocity = { x: 0, y: 0 };

            // Check if we have wall shields first
            if (game.wallShieldsRemaining > 0) {
              game.wallShieldsRemaining--;
              setWallShieldCount(game.wallShieldsRemaining);
              game.activeWall = null;
              game.isRecovering = true;
              game.recoveryEndTime = performance.now() + RECOVERY_WINDOW_MS;
              setIsRecovering(true);
              if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
              if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
              setScreenFlash("red");
              setIsShaking(true);
              flashTimeoutRef.current = setTimeout(() => { setScreenFlash("none"); flashTimeoutRef.current = null; }, 150);
              shakeTimeoutRef.current = setTimeout(() => {
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
              if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
              if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
              setScreenFlash("red");
              setIsShaking(true);
              flashTimeoutRef.current = setTimeout(() => { setScreenFlash("none"); flashTimeoutRef.current = null; }, 200);
              shakeTimeoutRef.current = setTimeout(() => {
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
            if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
            if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
            setScreenFlash("red");
            setIsShaking(true);
            flashTimeoutRef.current = setTimeout(() => { setScreenFlash("none"); flashTimeoutRef.current = null; }, 200);
            shakeTimeoutRef.current = setTimeout(() => {
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

      // NOTE: Don't fill the entire screen - let CRT show through
      // The regions themselves define the playable area and will be drawn below

      // ---- Ambient data rain (cosmetic layer drawn before region fill) ----
      {
        const now = performance.now();
        const dtRain = rainLastTime ? Math.min((now - rainLastTime) / 1000, 0.05) : 0;
        rainLastTime = now;
        const { scale, left: bx, top: by } = game.boardRect;
        ctx.save();
        ctx.font = `${Math.round(14 * scale)}px 'JetBrains Mono', monospace`;
        ctx.textBaseline = 'top';
        for (const p of rainParticles) {
          p.y += p.speed * dtRain;
          if (p.y > BOARD_HEIGHT + 20) {
            p.y = -(10 + Math.random() * 60);
            p.x = 15 + Math.random() * (BOARD_WIDTH - 30);
            p.symbol = RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)];
            p.alpha = 0.03 + Math.random() * 0.04;
            p.speed = 30 + Math.random() * 50;
          }
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = accentColor;
          ctx.fillText(p.symbol, bx + p.x * scale, by + p.y * scale);
        }
        ctx.restore();
      }
      // ---- End ambient data rain ----

      // Single blit of pre-rendered region canvas (rebuilt only on each cut)
      ctx.drawImage(regionCanvas, 0, 0);

      // Note: Green border is now drawn via the unified wall model below
      // All walls (board edges, obstacles, user-drawn) are rendered identically

      // ---- Wall inner shadow quads for user-drawn fences (depth cue) ----
      {
        const shadowW = 7 * scale;
        ctx.save();
        // Clip to board rect so shadow quads don't bleed past board edges
        ctx.beginPath();
        ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
        ctx.clip();
        for (const w of walls) {
          if (!w.id.startsWith('wall-')) continue;
          const s = worldToScreen(w.start.x, w.start.y);
          const e = worldToScreen(w.end.x, w.end.y);
          const dxW = e.x - s.x;
          const dyW = e.y - s.y;
          const lenW = Math.sqrt(dxW * dxW + dyW * dyW);
          if (lenW < 1) continue;
          const nx = -dyW / lenW;
          const ny =  dxW / lenW;
          const midX = (s.x + e.x) / 2;
          const midY = (s.y + e.y) / 2;
          const grad = ctx.createLinearGradient(
            midX + nx * shadowW, midY + ny * shadowW,
            midX - nx * shadowW, midY - ny * shadowW,
          );
          grad.addColorStop(0,   'rgba(0,0,0,0)');
          grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
          grad.addColorStop(1,   'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(s.x + nx * shadowW, s.y + ny * shadowW);
          ctx.lineTo(e.x + nx * shadowW, e.y + ny * shadowW);
          ctx.lineTo(e.x - nx * shadowW, e.y - ny * shadowW);
          ctx.lineTo(s.x - nx * shadowW, s.y - ny * shadowW);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      // ---- End wall shadow quads ----

      // Catmull-Rom spline helper — builds a smooth closed path through world-space vertices
      const buildSmoothPath = (verts: { x: number; y: number }[]) => {
        const n = verts.length;
        if (n < 3) return;
        const sv = verts.map(v => worldToScreen(v.x, v.y));
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p0 = sv[(i - 1 + n) % n];
          const p1 = sv[i];
          const p2 = sv[(i + 1) % n];
          const p3 = sv[(i + 2) % n];
          if (i === 0) ctx.moveTo(p1.x, p1.y);
          ctx.bezierCurveTo(
            p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
            p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
            p2.x, p2.y,
          );
        }
        ctx.closePath();
      };

      // ---- Smooth obstacle outlines (non-mirror) ----
      {
        const mirrorSet = new Set(game.mirrorPolygons);
        ctx.save();
        ctx.strokeStyle = accentColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = WALL_THICKNESS * scale;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 6 * scale;
        for (const poly of game.obstaclePolygons) {
          if (mirrorSet.has(poly)) continue;
          buildSmoothPath(poly.vertices);
          ctx.stroke();
        }
        ctx.restore();
      }
      // ---- End smooth obstacle outlines ----

      // UNIFIED WALL MODEL: Draw ALL walls as visible borders using accent color
      // Walls are "fences" - they are drawn ON TOP, not used to erase space
      // User-drawn walls are clipped against obstacles (no fences inside obstacles)
      ctx.save();
      ctx.strokeStyle = accentColor; // Dynamic accent color
      ctx.lineCap = "square";
      ctx.lineJoin = "round";
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = 6 * scale;
      // Clip to board rect so thick fences merge cleanly at walls/edges
      ctx.beginPath();
      ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
      ctx.clip();

      const obstacles = game.obstaclePolygons;

      for (const w of walls) {
        if (w.isMirror) continue; // Mirror walls rendered separately below
        if (w.id.startsWith('obstacle-')) continue; // drawn as smooth splines above
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

      // ---- Hard-clear any paint that leaked outside boardRect ----
      // ctx.clearRect bypasses compositing, alpha, clip — most reliable erase
      {
        const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
        const sw = game.screenSize.width;
        const sh = game.screenSize.height;
        ctx.clearRect(0,       0,        sw,             bt);               // top strip
        ctx.clearRect(0,       bt + bh,  sw,             sh - (bt + bh));   // bottom strip
        ctx.clearRect(0,       bt,       bl,             bh);               // left strip
        ctx.clearRect(bl + bw, bt,       sw - (bl + bw), bh);               // right strip
      }

      // ---- Neon rim light: 3-layer glow border around playfield ----
      {
        const { left: rl, top: rt, width: rw, height: rh } = boardRect;
        const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.0014);
        const cornerSz = 6 * scale;
        const layers = [
          { lw: 10 * scale, blur: 20 * scale, alpha: 0.10 * pulse },
          { lw: 4  * scale, blur: 10 * scale, alpha: 0.30 * pulse },
          { lw: 1.5 * scale, blur: 4 * scale, alpha: 0.85 * pulse },
        ];
        ctx.save();
        ctx.strokeStyle = accentColor;
        for (const { lw, blur, alpha } of layers) {
          ctx.globalAlpha = alpha;
          ctx.lineWidth = lw;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = blur;
          ctx.strokeRect(rl, rt, rw, rh);
        }
        // Corner accent squares
        ctx.globalAlpha = 0.9 * pulse;
        ctx.shadowBlur = 8 * scale;
        ctx.fillStyle = accentColor;
        for (const [cx, cy] of [[rl, rt], [rl + rw, rt], [rl, rt + rh], [rl + rw, rt + rh]] as [number, number][]) {
          ctx.fillRect(cx - cornerSz / 2, cy - cornerSz / 2, cornerSz, cornerSz);
        }
        ctx.restore();
      }
      // ---- End neon rim ----

      // Render mirror polygon fills (semi-transparent cyan)
      if (game.mirrorPolygons.length > 0) {
        ctx.save();
        ctx.fillStyle = "rgba(136, 221, 255, 0.15)";
        for (const poly of game.mirrorPolygons) {
          if (poly.vertices.length < 3) continue;
          buildSmoothPath(poly.vertices);
          ctx.fill();
        }
        ctx.restore();
      }

      // Render mirror polygon smooth outlines with cyan color and glow
      if (game.mirrorPolygons.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = WALL_THICKNESS * scale;
        ctx.strokeStyle = "#88ddff";
        ctx.shadowColor = "#88ddff";
        ctx.shadowBlur = 8 * scale;
        for (const poly of game.mirrorPolygons) {
          buildSmoothPath(poly.vertices);
          ctx.stroke();
        }
        // White highlight
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1 * scale;
        ctx.shadowBlur = 0;
        for (const poly of game.mirrorPolygons) {
          buildSmoothPath(poly.vertices);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Render cut preview line during drag (always shown, not just with cutPreview modifier)
      // This shows the user where their cut will go before they commit to it
      if (swipeStart && swipeRegionId && currentSwipePos && !wall) {
        const delta = vec2Sub(currentSwipePos, swipeStart);
        const dist = vec2Length(delta);

        // Show preview once there's any significant drag distance
        if (dist >= 5) {
          const direction = vec2Normalize(delta);

          // Cast rays with reflection support for preview
          const negDir = { x: -direction.x, y: -direction.y };
          const fwdPreview = castRayWithReflections(swipeStart, direction, walls);
          const bwdPreview = castRayWithReflections(swipeStart, negDir, walls);

          if (fwdPreview && bwdPreview) {
            ctx.save();
            ctx.globalAlpha = 0.15;
            // Clip to board rect so preview doesn't bleed past edges
            ctx.beginPath();
            ctx.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height);
            ctx.clip();

            const previewThickness = WALL_THICKNESS * activeModifiers.fenceWidthMultiplier;
            ctx.lineCap = "square";

            // Draw all segments from both waypoint paths
            const allWaypoints = [fwdPreview.waypoints, bwdPreview.waypoints];
            for (const waypoints of allWaypoints) {
              for (let i = 0; i < waypoints.length - 1; i++) {
                const s = worldToScreen(waypoints[i].x, waypoints[i].y);
                const e = worldToScreen(waypoints[i + 1].x, waypoints[i + 1].y);

                // White outline
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = (previewThickness + 8) * scale;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();

                // Accent center
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = (previewThickness + 4) * scale;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();
              }
            }

            // Draw small dots at bounce/reflection points
            ctx.globalAlpha = 0.4;
            for (const waypoints of allWaypoints) {
              for (let i = 1; i < waypoints.length - 1; i++) {
                const pt = worldToScreen(waypoints[i].x, waypoints[i].y);
                ctx.fillStyle = "#88ddff";
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 4 * scale, 0, Math.PI * 2);
                ctx.fill();
              }
            }

            ctx.restore();
          }
        }
      }

      // SCRUM Master: ball trajectory preview
      if (activeModifiers.ballPathPredictionBounces > 0 && activeModifiers.ballPathPredictionBalls > 0) {
        const numBounces = activeModifiers.ballPathPredictionBounces;
        const maxBalls = activeModifiers.ballPathPredictionBalls;

        // Sort active balls by current speed descending; ≥100 means track all
        const activeBalls = balls
          .filter(b => b.state === 'active')
          .sort((a, b) => b.speed - a.speed);
        const trackedBalls = maxBalls >= 100 ? activeBalls : activeBalls.slice(0, maxBalls);

        ctx.save();
        for (const ball of trackedBalls) {
          const waypoints = computeBallTrajectory(ball.position, ball.velocity, walls, numBounces);
          if (waypoints.length < 2) continue;

          const totalSegs = waypoints.length - 1;

          // Draw path segments with linear opacity fade (bright near ball, dim at end)
          ctx.lineCap = 'round';
          ctx.setLineDash([6 * scale, 8 * scale]);
          ctx.shadowColor = '#00ff88';
          ctx.shadowBlur = 6 * scale;

          // Compute cumulative world-space distances for each waypoint
          const segLengths: number[] = [];
          let totalLength = 0;
          for (let i = 0; i < totalSegs; i++) {
            const dx = waypoints[i + 1].x - waypoints[i].x;
            const dy = waypoints[i + 1].y - waypoints[i].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            segLengths.push(len);
            totalLength += len;
          }
          // cumDist[i] = distance from start to waypoints[i]
          const cumDist: number[] = [0];
          for (let i = 0; i < totalSegs; i++) cumDist.push(cumDist[i] + segLengths[i]);

          // Opacity at any distance along the total path (last third fades to 0)
          const pathAlpha = (d: number) => {
            const t = totalLength > 0 ? d / totalLength : 0;
            const fadeStart = 2 / 3;
            if (t <= fadeStart) return 0.55;
            return 0.55 * (1 - (t - fadeStart) / (1 - fadeStart));
          };

          ctx.globalAlpha = 1;
          for (let i = 0; i < totalSegs; i++) {
            const a0 = pathAlpha(cumDist[i]);
            const a1 = pathAlpha(cumDist[i + 1]);
            if (a0 <= 0 && a1 <= 0) continue;

            const s = worldToScreen(waypoints[i].x, waypoints[i].y);
            const e = worldToScreen(waypoints[i + 1].x, waypoints[i + 1].y);

            // Per-segment gradient so the fade is pixel-smooth across world distance
            const grad = ctx.createLinearGradient(s.x, s.y, e.x, e.y);
            grad.addColorStop(0, `rgba(0,255,136,${a0.toFixed(3)})`);
            grad.addColorStop(1, `rgba(0,255,136,${a1.toFixed(3)})`);
            ctx.strokeStyle = grad;
            ctx.shadowColor = `rgba(0,255,136,${Math.max(a0, a1).toFixed(3)})`;
            ctx.shadowBlur = 6 * scale;
            ctx.lineWidth = 2 * scale;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(e.x, e.y);
            ctx.stroke();
          }

          // Draw bounce point diamonds
          ctx.setLineDash([]);
          for (let i = 1; i < waypoints.length - 1; i++) {
            const alpha = pathAlpha(cumDist[i]) * (0.75 / 0.55);
            const pt = worldToScreen(waypoints[i].x, waypoints[i].y);
            const r = 4 * scale;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#00ff88';
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y - r);
            ctx.lineTo(pt.x + r, pt.y);
            ctx.lineTo(pt.x, pt.y + r);
            ctx.lineTo(pt.x - r, pt.y);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Render all balls with multi-axis spin illusion
      for (const ball of balls) {
        const screenPos = worldToScreen(
          (ball.renderPosition ?? ball.position).x,
          (ball.renderPosition ?? ball.position).y,
        );
        const assimScale = ball.assimScale ?? 1;
        const screenRadius = ball.radius * scale; // size unchanged — alpha fades instead
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

        // Blend ball color toward accent color during assimilation fade
        const fade = ball.assimColorFade ?? 0;
        const r0 = parseInt(ball.color.slice(1, 3), 16);
        const g0 = parseInt(ball.color.slice(3, 5), 16);
        const b0 = parseInt(ball.color.slice(5, 7), 16);
        const ar = parseInt(accentColor.slice(1, 3), 16);
        const ag = parseInt(accentColor.slice(3, 5), 16);
        const ab = parseInt(accentColor.slice(5, 7), 16);
        const r = Math.round(r0 + (ar - r0) * fade);
        const g = Math.round(g0 + (ag - g0) * fade);
        const b = Math.round(b0 + (ab - b0) * fade);
        const blendedHex = `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

        // Fade out won balls — alpha disintegrates ball into the dust particles
        ctx.save();
        ctx.globalAlpha = assimScale;

        // Motion trail — comet-like smear behind fast-moving balls
        {
          const trailPos = ball.renderPosition ?? ball.position;
          if (!ball.trailPositions) ball.trailPositions = [];
          ball.trailPositions.push({ x: trailPos.x, y: trailPos.y });
          if (ball.trailPositions.length > 8) ball.trailPositions.shift();
          const N = ball.trailPositions.length;
          if (N > 1 && assimScale > 0.05) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let ti = 0; ti < N - 1; ti++) {
              const fraction = (ti + 1) / N;
              const tp = worldToScreen(ball.trailPositions[ti].x, ball.trailPositions[ti].y);
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, screenRadius * fraction * 0.5, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${r0},${g0},${b0},${fraction * 0.35})`;
              ctx.fill();
            }
            ctx.restore();
          }
        }

        // Blit cached ball base (outer glow + 3D sphere gradient).
        // Cache key: blendedHex + screenRadius — stable for the entire level on normal balls.
        const { canvas: baseCanvas, halfSize: baseHalf } = getBallBase(blendedHex, screenRadius, scale);
        ctx.drawImage(baseCanvas, screenPos.x - baseHalf, screenPos.y - baseHalf);

        // Set up clip for rotation layers (latitude bands, meridians, polar caps)
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
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

        // ===== LAYER 5: Circuit-board hex pattern (overlay blend) =====
        if (screenRadius > 0) {
          const hexOC = getHexOverlay(accentColor);
          ctx.save();
          ctx.globalCompositeOperation = 'overlay';
          ctx.globalAlpha = 0.18;
          ctx.translate(screenPos.x, screenPos.y);
          ctx.rotate(ball.rotation * 0.3); // slow co-rotation with ball spin
          ctx.drawImage(hexOC, -screenRadius, -screenRadius, screenRadius * 2, screenRadius * 2);
          ctx.restore();
        }

        ctx.restore(); // End clipping

        // Blit cached specular overlay (colour-independent pure-white glare + rim).
        // Eliminates 2 more gradient creations per ball per frame.
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
        ctx.clip();
        const specCanvas = getBallSpecular(screenRadius, scale);
        ctx.drawImage(specCanvas, screenPos.x - screenRadius - 2, screenPos.y - screenRadius - 2);
        ctx.restore(); // clip restore
        ctx.restore(); // globalAlpha restore
      }

      // Render lock flash — pulse then flood region with accent color
      if (game.assimilations.size > 0) {
        const acR = parseInt(accentColor.slice(1, 3), 16);
        const acG = parseInt(accentColor.slice(3, 5), 16);
        const acB = parseInt(accentColor.slice(5, 7), 16);
        const now = performance.now();

        for (const [, flash] of game.assimilations) {
          if (flash.polygon.length === 0) continue;
          const elapsed = now - flash.startTime;

          let fillAlpha = 0;
          let glowAlpha = 0;

          if (elapsed < LOCK_PULSE_DURATION) {
            const t = elapsed / LOCK_PULSE_DURATION;
            fillAlpha = Math.abs(Math.sin(t * Math.PI * 3)) * 0.5;
            glowAlpha = fillAlpha * 0.7;
          } else if (elapsed < LOCK_PULSE_DURATION + LOCK_FLOOD_DURATION) {
            const ft = Math.min(1, (elapsed - LOCK_PULSE_DURATION) / LOCK_FLOOD_DURATION);
            const ease = ft < 0.5 ? 2 * ft * ft : 1 - Math.pow(-2 * ft + 2, 2) / 2;
            fillAlpha = 0.2 + ease * 0.65;
            glowAlpha = (1 - ft) * 0.9;
          } else {
            // Settled — hold at full fill alpha permanently
            fillAlpha = 0.85;
            glowAlpha = 0;
          }

          // Fill the exact wall-intersection polygon — no grid approximation
          ctx.save();
          if (flash.polygon.length >= 3) {
            ctx.beginPath();
            const fp = worldToScreen(flash.polygon[0].x, flash.polygon[0].y);
            ctx.moveTo(fp.x, fp.y);
            for (let i = 1; i < flash.polygon.length; i++) {
              const p = worldToScreen(flash.polygon[i].x, flash.polygon[i].y);
              ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
            ctx.fillStyle = `rgba(${acR}, ${acG}, ${acB}, ${fillAlpha})`;
            ctx.fill();
          }

          // Radial burst glow from centroid during flood phase
          if (elapsed >= LOCK_PULSE_DURATION && glowAlpha > 0) {
            const ft = Math.min(1, (elapsed - LOCK_PULSE_DURATION) / LOCK_FLOOD_DURATION);
            const c = worldToScreen(flash.centroid.x, flash.centroid.y);
            const burstR = 120 * scale * (0.3 + ft * 1.8);
            const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, burstR);
            grad.addColorStop(0, `rgba(${acR}, ${acG}, ${acB}, ${glowAlpha})`);
            grad.addColorStop(0.5, `rgba(${acR}, ${acG}, ${acB}, ${glowAlpha * 0.4})`);
            grad.addColorStop(1, `rgba(${acR}, ${acG}, ${acB}, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(c.x, c.y, burstR, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          // Dust particles — burst from ball's lock position, fade as fine dust
          if (elapsed < LOCK_DUST_DURATION && flash.particles.length > 0) {
            const pR = parseInt(flash.ballColor.slice(1, 3), 16);
            const pG = parseInt(flash.ballColor.slice(3, 5), 16);
            const pB = parseInt(flash.ballColor.slice(5, 7), 16);

            ctx.save();
            ctx.lineCap = 'round';
            for (const p of flash.particles) {
              if (elapsed > p.lifetime) continue;
              const progress = elapsed / p.lifetime;
              // Decelerate quickly — most movement in first third
              const drag = Math.pow(1 - progress, 1.8);
              const tSec = elapsed / 1000;
              const wx = flash.ballPos.x + Math.cos(p.angle) * p.speed * tSec * drag;
              const wy = flash.ballPos.y + Math.sin(p.angle) * p.speed * tSec * drag
                       + 18 * tSec * tSec; // subtle gravity
              const sp = worldToScreen(wx, wy);
              const alpha = Math.pow(1 - progress, 1.4);
              // Streak: tip at current position, tail shrinks as particle ages
              const tailLen = p.lengthPx * (1 - progress);
              const tx = sp.x - Math.cos(p.angle) * tailLen;
              const ty = sp.y - Math.sin(p.angle) * tailLen;
              ctx.beginPath();
              ctx.moveTo(tx, ty);
              ctx.lineTo(sp.x, sp.y);
              ctx.strokeStyle = `rgba(${pR}, ${pG}, ${pB}, ${alpha})`;
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }

      // Render wall - on top of everything, clipped to region (multi-segment waypoint support)
      if (wall) {
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

        // Build all renderable segments from waypoints
        const renderableSegments: { start: Vector2; end: Vector2 }[] = [];
        // Start side: completed segments + partial current
        for (let i = 0; i < wall.startSegmentIndex; i++) {
          renderableSegments.push({ start: wall.startWaypoints[i], end: wall.startWaypoints[i + 1] });
        }
        renderableSegments.push({ start: wall.startWaypoints[wall.startSegmentIndex], end: wall.startPoint });
        // End side: completed segments + partial current
        for (let i = 0; i < wall.endSegmentIndex; i++) {
          renderableSegments.push({ start: wall.endWaypoints[i], end: wall.endWaypoints[i + 1] });
        }
        renderableSegments.push({ start: wall.endWaypoints[wall.endSegmentIndex], end: wall.endPoint });

        // Draw each segment with white outline + accent center
        for (const seg of renderableSegments) {
          const s = worldToScreen(seg.start.x, seg.start.y);
          const e = worldToScreen(seg.end.x, seg.end.y);

          // White outline
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = (wall.thickness + 8) * scale;
          ctx.lineCap = "butt";
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);
          ctx.stroke();

          // Accent center
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = (wall.thickness + 4) * scale;
          ctx.shadowColor = accentColor + "80";
          ctx.shadowBlur = 25 * scale;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);
          ctx.stroke();
        }

        ctx.restore();
      }

      // Final hard-clear: erase anything outside boardRect drawn by later passes
      {
        const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
        const sw = game.screenSize.width;
        const sh = game.screenSize.height;
        ctx.clearRect(0,       0,        sw,             bt);
        ctx.clearRect(0,       bt + bh,  sw,             sh - (bt + bh));
        ctx.clearRect(0,       bt,       bl,             bh);
        ctx.clearRect(bl + bw, bt,       sw - (bl + bw), bh);
      }

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

    // Capture the current frame and shatter it into falling tiles.
    // tint: optional CSS color to overlay on the snapshot (e.g. dark red for push failure).
    const startDissolve = (onComplete: () => void, tint?: string) => {
      const TILE = 28; // tile size in screen pixels
      const W = canvas.width;
      const H = canvas.height;

      // Snapshot: composite blur layer + main canvas into a single offscreen image
      const captured = document.createElement('canvas');
      captured.width = W;
      captured.height = H;
      const cctx = captured.getContext('2d')!;
      const blurCanvas = blurCanvasRef.current;
      if (blurCanvas) cctx.drawImage(blurCanvas, 0, 0);
      cctx.drawImage(canvas, 0, 0);
      // Optional tint overlay (e.g. dark red for push-your-luck failure)
      if (tint) {
        cctx.fillStyle = tint;
        cctx.fillRect(0, 0, W, H);
      }

      const cols = Math.ceil(W / TILE);
      const rows = Math.ceil(H / TILE);
      const tiles: DissolveTile[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = c * TILE + TILE / 2;
          const cy = r * TILE + TILE / 2;
          const dx = cx - W / 2;
          const dy = cy - H / 2;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = 120 + Math.random() * 360;
          tiles.push({
            sx: c * TILE, sy: r * TILE,
            sw: Math.min(TILE, W - c * TILE),
            sh: Math.min(TILE, H - r * TILE),
            cx, cy,
            vx: (dx / dist) * speed * 0.4 + (Math.random() - 0.5) * 120,
            vy: (dy / dist) * speed * 0.15 + Math.random() * 80 - 20,
            rotSpeed: (Math.random() - 0.5) * 8,
            delay: Math.random() * 0.6,
          });
        }
      }

      game.dissolve = { captured, tiles, startTime: performance.now(), onComplete };
      game.animationId = requestAnimationFrame(gameLoop);
    };
    startDissolveRef.current = startDissolve;

    const gameLoop = (timestamp: number) => {
      // Forward tick to MemoryParallaxLayer so it shares this rAF instead of owning one
      parallaxTickRef?.current?.(timestamp);

      // Dissolve animation always runs regardless of gameOver/levelComplete state
      if (game.dissolve) {
        const d = game.dissolve;
        const elapsed = (performance.now() - d.startTime) / 1000; // seconds
        const dur = DISSOLVE_DURATION / 1000;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const tile of d.tiles) {
          const t = Math.max(0, elapsed - tile.delay);
          const tMax = dur - tile.delay;
          const progress = tMax > 0 ? Math.min(1, t / tMax) : 1;
          const alpha = Math.max(0, 1 - progress * 1.15);
          const x = tile.cx + tile.vx * t;
          const y = tile.cy + tile.vy * t + 400 * t * t; // gravity
          const angle = tile.rotSpeed * t;

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.drawImage(d.captured, tile.sx, tile.sy, tile.sw, tile.sh,
            -tile.sw / 2, -tile.sh / 2, tile.sw, tile.sh);
          ctx.restore();
        }

        if (elapsed >= dur) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          game.dissolve = null;
          d.onComplete();
          return;
        }

        game.animationId = requestAnimationFrame(gameLoop);
        return;
      }

      if (game.gameOver || game.pushMode === "prompt") return;

      // After level complete, keep rendering until all lock animations finish
      if (game.levelComplete) {
        if (game.assimilations.size > 0) {
          for (const ball of game.balls) {
            if (ball.state === 'won') {
              const elapsed = performance.now() - ball.wonTime;
              ball.assimScale = Math.max(0, 1 - Math.max(0, elapsed - 50) / 180);
            }
          }
          render();
          game.animationId = requestAnimationFrame(gameLoop);
        }
        return;
      }

      const dt = game.lastTime ? (timestamp - game.lastTime) / 1000 : 0;
      game.lastTime = timestamp;
      game.accumulator += Math.min(dt, 0.05);

      while (game.accumulator >= PHYSICS_STEP) {
        // Snapshot positions before this step (used for render interpolation)
        for (const ball of game.balls) {
          ball.prevPosition = { ...ball.position };
        }

        for (const ball of game.balls) {
          // WON balls keep full physics but visually disintegrate
          if (ball.state === 'won') {
            const elapsed = performance.now() - ball.wonTime;
            // Hold full opacity for 50ms, then fade out over 180ms — looks like ball pops into dust
            ball.assimScale = Math.max(0, 1 - Math.max(0, elapsed - 50) / 180);
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
          updateBall(ball, PHYSICS_STEP);
        }
        handleBallCollisions();
        updateWall(PHYSICS_STEP);
        game.accumulator -= PHYSICS_STEP;
      }

      // Interpolate render positions between last two physics states
      const alpha = game.accumulator / PHYSICS_STEP;
      for (const ball of game.balls) {
        const prev = ball.prevPosition ?? ball.position;
        ball.renderPosition = {
          x: prev.x + (ball.position.x - prev.x) * alpha,
          y: prev.y + (ball.position.y - prev.y) * alpha,
        };
      }
      
      // Update wall impact visual effects (time-based)
      updateWallImpacts();
      
      render();

      // Apply completed wall cut immediately (skip if level already finishing)
      if (!game.levelComplete && game.activeWall && game.activeWall.isComplete) {
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

      // Second-finger cancel: if a swipe is in progress and a different pointer comes down, cancel it
      if (game.swipeStart && game.swipePointerId !== null && e.pointerId !== game.swipePointerId) {
        game.swipeStart = null;
        game.swipeRegionId = null;
        game.currentSwipePos = null;
        game.swipePointerId = null;
        setIsPlayerDragging(false);
        // Brief haptic feedback on supported devices
        if (navigator.vibrate) navigator.vibrate(30);
        return;
      }

      if (game.gameOver || game.levelComplete || game.activeWall || game.pushMode === "prompt" || game.isRecovering)
        return;

      const { screenX, screenY } = getCanvasCoords(e);

      // Only allow interactions inside the board rect
      if (!isPointInBoard(screenX, screenY, game.boardRect)) return;

      // Convert to world coordinates
      const worldPos = screenToWorld(screenX, screenY, game.boardRect);

      // Reject clicks in captured or out-of-bounds cells (SpaceGrid is authoritative)
      if (!game.spaceGrid || !isPositionActive(game.spaceGrid, worldPos)) return;

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
      game.swipePointerId = e.pointerId;
      setIsPlayerDragging(true);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!game.swipeStart || !game.swipeRegionId || game.gameOver || game.levelComplete) return;
      if (e.pointerId !== game.swipePointerId) return; // ignore other fingers

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

          // UNIFIED WALL MODEL: Find wall intersections with mirror reflections
          const negDir = { x: -direction.x, y: -direction.y };
          const forwardResult = castRayWithReflections(game.swipeStart, direction, game.walls);
          const backwardResult = castRayWithReflections(game.swipeStart, negDir, game.walls);

          // Only create wall if we found valid intersections in both directions
          if (forwardResult && backwardResult) {
            const endWaypoints = forwardResult.waypoints;
            const startWaypoints = backwardResult.waypoints;
            const targetEnd = endWaypoints[endWaypoints.length - 1];
            const targetStart = startWaypoints[startWaypoints.length - 1];

            game.wallCount += 1;
            setCutCount(game.wallCount);

            // Check if this fence should be instant (Hot Start upgrade)
            const isInstant = game.wallCount <= activeModifiers.instantFencesPerMap;

            game.activeWall = {
              origin: { ...game.swipeStart },
              direction,
              startWaypoints,
              endWaypoints,
              startSegmentIndex: isInstant ? startWaypoints.length - 2 : 0,
              endSegmentIndex: isInstant ? endWaypoints.length - 2 : 0,
              startPoint: isInstant ? { ...targetStart } : { ...game.swipeStart },
              endPoint: isInstant ? { ...targetEnd } : { ...game.swipeStart },
              targetStart,
              targetEnd,
              thickness: WALL_THICKNESS * activeModifiers.fenceWidthMultiplier,
              isComplete: isInstant,
              activeRegionId: game.swipeRegionId!,
              startTime: isInstant ? undefined : performance.now(),
            };

          }
        }
      }

      game.swipeStart = null;
      game.swipeRegionId = null;
      game.currentSwipePos = null;
      game.swipePointerId = null;
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
  }, [level, levelNumber, activeModifiers]);

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

    // Calculate push bonus: +1 OT per 25% of original remaining area cleared during push
    const areaAtPushStart = game.pushStartPercent;
    const areaCleared = Math.max(0, areaAtPushStart - game.bestRemainingPercent);
    const chunkSize = areaAtPushStart * 0.25;
    const pushBonus = chunkSize > 0 ? Math.floor(areaCleared / chunkSize) : 0;

    const scoreData = {
      levelNumber,
      levelId: level.id,
      cutCount: game.wallCount,
      expectedCuts: level.expectedCuts,
      basePoints: level.points,
      levelScore: levelScore + game.lockBonus + pushBonus,
      remainingPercent: game.bestRemainingPercent,
      overcutBonus: 0,
      thresholdPercent: level.sizeThreshold,
      pushBonus,
      underParBonus: breakdown.underParBonus,
      spaceBonus: breakdown.spaceBonus,
      spaceBonusRaw: breakdown.spaceBonusRaw,
      performanceMultiplier: breakdown.performanceMultiplier,
      fencesUnderPar: breakdown.fencesUnderPar,
      fencesOverPar: breakdown.fencesOverPar,
      extraPercent: breakdown.extraPercent,
      lockBonus: game.lockBonus,
      lockedBallsCount: game.lockedBallsCount,
    };
    // Brief pause to let the push-prompt UI close, then dissolve normally
    setTimeout(() => {
      onLevelCompleteRef.current(scoreData);
      startDissolveRef.current?.(() => {});
    }, 150);
  }, [level, levelNumber, activeModifiers]);

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
    game.accumulator = 0;

    if (game.gameLoopFn) {
      cancelAnimationFrame(game.animationId);
      requestAnimationFrame(() => {
        game.lastTime = 0;
        game.accumulator = 0;
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
      <div ref={containerRef} className="flex-1 min-h-0 relative overflow-visible" style={{ height: "70%" }}>
        {/* Bonus fence pulse — green shockwave behind the board */}
        {bonusPulseKey > 0 && (
          <div
            key={bonusPulseKey}
            className="absolute inset-0 pointer-events-none animate-bonus-fence-pulse"
            style={{
              zIndex: 0,
              background: `radial-gradient(circle, rgba(0,255,136,0.75) 0%, rgba(0,255,136,0.45) 35%, rgba(0,255,136,0.15) 65%, transparent 80%)`,
              margin: '-25%',
              borderRadius: '50%',
            }}
          />
        )}
        {/* Blur canvas - renders removed areas with blur effect */}
        <canvas
          ref={blurCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{
            filter: 'blur(8px)',
            opacity: 0.6,
            zIndex: 1,
          }}
        />
        {/* Main game canvas */}
        <canvas ref={canvasRef} className="absolute inset-0 touch-none cursor-crosshair" style={{ zIndex: 2 }} />
        {/* CRT phosphor dot overlay — drawn once on mount/resize, never cleared */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 3, opacity: 1 }}
        />
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
