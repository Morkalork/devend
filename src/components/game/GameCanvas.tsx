import { useRef, useEffect, useState, useCallback } from "react";
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from "@/types/game";
import { LevelConfig } from "@/types/level";

import { GameModifiers } from "@/hooks/useActiveModifiers";
import { clearBallRenderCache } from "@/lib/ballRenderCache";
import { renderFrame, createRainParticles } from "@/lib/rendering/renderFrame";
import { RenderContext, RainState } from "@/lib/rendering/types";
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
  circleCapsuleCollision,
  polygonBounds,
  pointToSegmentDistance,
  lineSegmentIntersection,
} from "@/lib/polygon";
import {
  LockDustParticle,
  LockFlashState,
  DissolveTile,
  DissolveState,
} from "@/types/game";
import {
  LOCK_TOTAL_DURATION,
  BALL_SPEED_INCREASE,
  MINIMUM_WALL_TIME,
  RECOVERY_WINDOW_MS,
  BALL_WON_REGION_THRESHOLD,
} from "@/lib/gameConstants";
import {
  hexToRgba,
  generateRegionId,
  generateWallId,
  getRandomDirection,
  findRegionContainingPoint,
  computeLevelScore,
  computeOvercutBonus,
  getWallSpeedBase,
} from "@/lib/gameUtils";
import { Wall, WALL_THICKNESS } from "@/lib/wallGeometry";
import { 
  registerWallImpact, 
  clearWallImpacts 
} from "@/lib/wallImpactEffects";
import {
  REGION_SAMPLE_GRID_SIZE,
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
  rasterizeCutToGrid,
  findGridRegions,
  getRemainingPercent,
  getRegionPercentage,
  removeRegion,
  worldToGridIndex,
} from "@/lib/spaceGrid";
import { playFenceBreakSound, playDeathSound, playBallLockSound } from "@/lib/gameAudio";

import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BoardRect,
  computeBoardRect,
  screenToWorld,
  isPointInBoard,
} from "@/lib/boardConstants";
import { CanvasGameState } from "@/types/gameState";
import { createInitialGameData } from "@/lib/initGame";
import { useGameInput } from "@/hooks/useGameInput";
import { createGameLoop, GameLoopCallbacks } from "@/hooks/useGameLoop";

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

  const gameRef = useRef<CanvasGameState>({
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
    bonusCutCells: new Set<string>(),
  });

  // Attach pointer event listeners via dedicated hook
  useGameInput(canvasRef, gameRef, activeModifiers, setCutCount, setIsPlayerDragging);

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

    const drawSamplesToBlur = (_samples: Vector2[]) => {
      // Dead areas are now transparent so the data-rain shows through — no fill needed.
      return;
      const blurCanvas = blurCanvasRef.current;
      const blurCtx = blurCanvas?.getContext("2d");
      if (!blurCtx || !blurCanvas) return;
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
      // Captured cells are now rendered in repaintRegionCanvas; blur canvas is unused.
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
        // repaintRegionCanvas will draw captured cells; no separate blur canvas draw needed.
      }
    };
    // ─────────────────────────────────────────────────────────────────────────

    // ── Region canvas helpers (repaint on cut, blit every frame) ─────────────
    // Two offscreen canvases with separate responsibilities:
    //   boardGridCanvas  — static grid background, painted once per level/resize
    //                      from initialSamplePoints. Never changes during play.
    //   regionCanvas     — captured (scored) area solid fill only, rebuilt on cut.
    //                      Active areas are transparent holes so the grid shows through.
    // Render order: boardGridCanvas → regionCanvas → walls/balls
    const boardGridCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const regionCanvas    = new OffscreenCanvas(canvas.width, canvas.height);

    // Scanline pattern tile: 4 rows — 3px transparent + 1px dark line
    const scanlineTile = new OffscreenCanvas(4, 4);
    (() => {
      const stCtx = scanlineTile.getContext('2d')!;
      stCtx.clearRect(0, 0, 4, 4);
      stCtx.fillStyle = 'rgba(0,0,0,0.18)';
      stCtx.fillRect(0, 3, 4, 1);
    })();

    // Paint the board grid onto boardGridCanvas from ALL initialSamplePoints.
    // This canvas never changes during play — it is the static grid that shows
    // through transparent holes punched by repaintRegionCanvas.
    const paintBoardGrid = () => {
      const gCtx = boardGridCanvas.getContext("2d");
      if (!gCtx) return;
      const { width: sw, height: sh } = game.screenSize;
      if (boardGridCanvas.width !== sw || boardGridCanvas.height !== sh) {
        boardGridCanvas.width  = sw;
        boardGridCanvas.height = sh;
      }
      gCtx.clearRect(0, 0, boardGridCanvas.width, boardGridCanvas.height);
      if (game.initialSamplePoints.length === 0) return;
      const { boardRect, regionColor } = game;
      const gridSize    = 15;
      const halfGrid    = gridSize / 2;
      const cellPadding = 3;
      const size = (gridSize + cellPadding * 2) * boardRect.scale;
      gCtx.save();
      gCtx.globalAlpha = canvasOpacity * 0.55;
      gCtx.fillStyle   = regionColor;
      for (const sample of game.initialSamplePoints) {
        const sx = boardRect.left + (sample.x - halfGrid - cellPadding) * boardRect.scale;
        const sy = boardRect.top  + (sample.y - halfGrid - cellPadding) * boardRect.scale;
        gCtx.fillRect(sx, sy, size, size);
      }
      gCtx.restore();
    };

    const repaintRegionCanvas = () => {
      // Sync boardGridCanvas (full initial grid, static background layer).
      paintBoardGrid();

      const rCtx = regionCanvas.getContext("2d");
      if (!rCtx) return;
      const { width: sw, height: sh } = game.screenSize;
      if (regionCanvas.width !== sw || regionCanvas.height !== sh) {
        regionCanvas.width  = sw;
        regionCanvas.height = sh;
      }
      rCtx.clearRect(0, 0, regionCanvas.width, regionCanvas.height);

      const { boardRect, regionColor } = game;

      // Step 1 — solid board fill = captured (scored) territory.
      rCtx.save();
      rCtx.globalAlpha = canvasOpacity * 0.8;
      rCtx.fillStyle   = regionColor;
      rCtx.fillRect(boardRect.left, boardRect.top, boardRect.width, boardRect.height);
      rCtx.restore();

      // Step 2 — punch transparent holes for active region cells (clearRect avoids
      // the polygon over-extension that broke the old destination-out approach).
      const gridSize    = 15;
      const halfGrid    = gridSize / 2;
      const cellPadding = 3;
      const size = (gridSize + cellPadding * 2) * boardRect.scale;
      for (const region of game.regions) {
        for (const sample of (region.samplePoints ?? [])) {
          const sx = boardRect.left + (sample.x - halfGrid - cellPadding) * boardRect.scale;
          const sy = boardRect.top  + (sample.y - halfGrid - cellPadding) * boardRect.scale;
          rCtx.clearRect(sx, sy, size, size);
        }
      }

      // Step 3 — scanline overlay on captured fill only (source-atop leaves holes untouched).
      const scanPattern = rCtx.createPattern(scanlineTile, 'repeat');
      if (scanPattern) {
        rCtx.save();
        rCtx.globalAlpha = 1;
        rCtx.globalCompositeOperation = 'source-atop';
        rCtx.fillStyle = scanPattern;
        rCtx.fillRect(0, 0, regionCanvas.width, regionCanvas.height);
        rCtx.restore();
      }
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

    // Ambient data-rain state — particles are seeded in initGame, recycled in renderFrame
    const rainState: RainState = { particles: [], lastTime: 0 };

    const initGame = () => {
      game.assimilations.clear();
      game.bonusCutCells.clear();

      // Build level geometry and initial physics state (pure computation)
      const data = createInitialGameData(level, levelNumber, activeModifiers);
      game.walls              = data.walls;
      game.obstaclePolygons   = data.obstaclePolygons;
      game.mirrorPolygons     = data.mirrorPolygons;
      game.boardPolygon       = data.boardPolygon;
      game.originalArea       = data.originalArea;
      game.basePlayableArea   = data.basePlayableArea;
      game.balls              = data.balls;
      game.initialSamplePoints = data.initialSamplePoints;
      game.spaceGrid          = data.spaceGrid;
      game.gridRegions        = data.gridRegions;
      game.regions            = data.regions;
      game.fastestBallId      = data.fastestBallId;

      // Reset blur accumulation state for new level
      removedSamples    = [];
      removedSamplesSet = new Set();
      repaintBlurCanvas();

      // Repaint canvas layers that depend on world geometry
      // (paintBoardGrid is called from within repaintRegionCanvas)
      repaintRegionCanvas();

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
      setRemainingPercent(100);

      // Seed rain particles staggered across the board
      rainState.particles = createRainParticles(40);
      rainState.lastTime = 0;
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
      // Region canvas and board grid share the same coordinate space — repaintRegionCanvas
      // rebuilds both (paintBoardGrid is called from within repaintRegionCanvas).
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

      // Fallback: if multiple components exist but none detected any balls (floating-point
      // edge case where line-of-sight to every sample falsely intersects the new wall),
      // assign each active ball to its nearest component by sample distance.
      if (components.length > 1 && !components.some(c => c.hasBalls)) {
        const activeBalls = balls.filter(b => b.state !== 'won');
        for (const ball of activeBalls) {
          let nearestComp = components[0];
          let nearestDist = Infinity;
          for (const comp of components) {
            for (const sample of comp.samples) {
              const d = Math.hypot(sample.x - ball.position.x, sample.y - ball.position.y);
              if (d < nearestDist) { nearestDist = d; nearestComp = comp; }
            }
          }
          nearestComp.hasBalls = true;
        }
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
            game.activeWall = null;
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
          // If the fence didn't actually split the region (only 1 component), keep it
          // unconditionally — regardless of hasBalls, nothing was captured.
          if (subRegions.length === 1) {
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
      // STEP 5b: Garbage Collector bonus fence cut (probabilistic)
      // ============================================================
      if (!game.gameOver) {
        if (
          activeModifiers.bonusRemovalChance > 0 &&
          activeModifiers.bonusRemovalAmount > 0 &&
          Math.random() < activeModifiers.bonusRemovalChance
        ) {
          // TODO: implement Garbage Collector bonus fence cut
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
        const currT = Math.max(0, Math.min(1, elapsed / expectedDuration));

        // When the easing clock has fully elapsed, force both ends to their targets
        // and mark the wall complete immediately. Without this, a very small final
        // growth step (< 0.01) can leave the fence permanently stuck just short of
        // the target wall — causing it to stay glowing and lethal forever.
        if (currT >= 1) {
          wall.startPoint = { ...wall.targetStart };
          wall.startSegmentIndex = Math.max(0, wall.startWaypoints.length - 2);
          wall.endPoint = { ...wall.targetEnd };
          wall.endSegmentIndex = Math.max(0, wall.endWaypoints.length - 2);
          wall.isComplete = true;
          return;
        }

        const prevT = Math.max(0, Math.min(1, (elapsed - dt) / expectedDuration));
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

    const rctx: RenderContext = {
      accentColor,
      activeModifiers,
      boardGridCanvas,
      regionCanvas,
      rain: rainState,
    };

    const render = () => renderFrame(ctx, game, rctx);

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

    const gameLoopCallbacks: GameLoopCallbacks = {
      updateWall: (dt: number) => updateWall(dt),
      applyCut: (wall) => applyCut(wall),
      render,
    };
    const gameLoop = createGameLoop(game, canvas, ctx, parallaxTickRef, gameLoopCallbacks);
    game.gameLoopFn = gameLoop;

    // Setup
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    game.animationId = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
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
            filter: 'none',
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
