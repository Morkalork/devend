/**
 * GameCanvas — the playable game board.
 *
 * Bridges React and the imperative game world: all per-frame state lives in
 * a mutable CanvasGameState ref (src/types/gameState.ts), driven by a
 * fixed-timestep loop (src/hooks/useGameLoop.ts) and drawn by
 * src/lib/rendering/renderFrame.ts. React state here is only for UI-visible
 * values (lives, cut count, flashes).
 *
 * Subsystem entry points:
 *   - input:     src/hooks/useGameInput.ts (pointer → fence cuts)
 *   - physics:   src/lib/physics/* (ball movement, fence growth, cuts)
 *   - level init src/lib/initGame.ts (board, obstacles, balls, regions)
 *   - rendering: src/lib/rendering/renderFrame.ts
 */
import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from "@/types/game";
import { LevelConfig } from "@/types/level";

import { GameModifiers } from "@/hooks/useActiveModifiers";
import { clearBallRenderCache } from "@/lib/ballRenderCache";
import { clearBallSphereCache } from "@/lib/ballSphereCache";
import { clearRainGlyphCache } from "@/lib/rendering/rainGlyphCache";
import { clearBallEffectsCache } from "@/lib/ballEffects";
import { renderFrame, createRainParticles, clearRenderFrameCache } from "@/lib/rendering/renderFrame";
import { drawPerfOverlay } from "@/lib/rendering/perfStats";
import { RenderContext, RainState } from "@/lib/rendering/types";
import { calculateScore, ensureScoringConfigLoaded, getShipEarlyBonus } from "@/lib/scoring";
import { PushYourLuckOverlay } from "./PushYourLuckOverlay";
import { InteractiveTutorialOverlay } from "./InteractiveTutorialOverlay";
import { TutorialStep } from "@/types/game";
import {
  Polygon,
  polygonArea,
} from "@/lib/polygon";
import {
  LockFlashState,
  DissolveTile,
  DissolveState,
} from "@/types/game";
import {
  LOCK_TOTAL_DURATION,
  BALL_WON_REGION_THRESHOLD,
  LEVEL_CLEAR_SHIMMER_MS,
} from "@/lib/gameConstants";
import {
  generateRegionId,
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
  paintCellRegionIds,
} from "@/lib/regionOwnership";
import {
  SpaceGrid,
  GridRegion,
  findGridRegions,
  getRemainingPercent,
  getRegionPercentage,
  removeRegion,
} from "@/lib/spaceGrid";
import { traceActiveContours, traceContours } from "@/lib/rendering/regionContour";
import { maybeRampDpr } from "@/lib/rendering/adaptiveDpr";
import { playFenceBreakSound, playDeathSound, playBallLockSound } from "@/lib/gameAudio";
import { vibrateFenceComplete, vibrateFenceBreak } from "@/lib/gameHaptics";

import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BoardRect,
  computeBoardRect,
  screenToWorld,
  isPointInBoard,
  getDevicePixelRatio,
} from "@/lib/boardConstants";
import { CanvasGameState } from "@/types/gameState";
import { ScopeCreepConfig, DEFAULT_SCOPE_CREEP } from "@/lib/scopeCreep";
import { createInitialGameData } from "@/lib/initGame";
import { useGameInput } from "@/hooks/useGameInput";
import { createGameLoop, GameLoopCallbacks } from "@/hooks/useGameLoop";
import { GameCallbacks } from "@/lib/physics/gameCallbacks";
import { applyCutFn } from "@/lib/physics/applyCut";
import { updateFenceWallFn } from "@/lib/physics/updateFenceWall";
import { processWallBreaksFn } from "@/lib/physics/breakFenceWall";
import { processDestroysFn } from "@/lib/physics/destructibles";

export interface GameStateInfo {
  cutsUsed: number;
  spaceRemaining: number;
  lockedBalls: number;
  pushMode: "none" | "prompt" | "pushing";
  /** Current Scope Creep speed boost in percent (0 = not yet active). */
  creepPercent: number;
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
  /** Fired the instant the map is won, so the shell can freeze the code background. */
  onMapComplete?: () => void;
  onGameStateChange?: (state: GameStateInfo) => void;
  tutorialMode?: boolean;
  tutorialStep?: TutorialStep;
  onTutorialCutSuccess?: () => void;
  /** Fired once per ball the instant it locks, with its ball-type id (drives the
   *  tutorial's "encountered ball types" tracking). Returns true iff this was
   *  the first-ever lock of that type (triggers the "Info Unlocked" flash). */
  onBallTypeLocked?: (typeId: string) => boolean;
  canvasOpacity?: number;
  fenceSpeedBase?: number;
  fenceSpeedMin?: number;
  fenceSpeedPerLevel?: number;
  /** Lock rule (from game-config.yml `lock:`). */
  lockWinThresholdPercent?: number;
  lockMinRegionCells?: number;
  /** Scope Creep tuning (from game-config.yml `scope_creep:`). */
  scopeCreep?: ScopeCreepConfig;
  regionColor?: string;
  accentColor?: string;
  activeModifiers: GameModifiers;
  cumulativeLockedBalls?: number;
  /** Ball hits a fence survives (Ascension mode); null/undefined = indestructible. */
  fenceDurability?: number | null;
  parallaxTickRef?: React.MutableRefObject<((timestamp: number) => void) | null>;
  /** When true, freeze the game loop without ending the level. */
  paused?: boolean;
  /** Admin/Playground: draw a live speed label above each ball. */
  showBallSpeeds?: boolean;
  /** Admin/Playground: draw the frame-timing perf HUD (physics/render ms, FPS). */
  showPerfOverlay?: boolean;
  /** Admin/Playground: on clear, play the drain shimmer then freeze on the drained
   *  frame instead of completing the level (no overlay, no dissolve). */
  freezeOnComplete?: boolean;
}

/**
 * Start the rAF game loop. Always cancels the previously-stored handle first so
 * the four start sites (setup, resume, dissolve, push-mode) can never leave two
 * self-rescheduling loops running against the single shared game.animationId.
 */
function startGameLoop(game: CanvasGameState): void {
  if (!game.gameLoopFn) return;
  cancelAnimationFrame(game.animationId);
  game.animationId = requestAnimationFrame(game.gameLoopFn);
}

/** Stop the rAF game loop and clear the handle. */
function stopGameLoop(game: CanvasGameState): void {
  cancelAnimationFrame(game.animationId);
  game.animationId = 0;
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
  onMapComplete,
  onGameStateChange,
  tutorialMode = false,
  tutorialStep = "completed",
  onTutorialCutSuccess,
  onBallTypeLocked,
  canvasOpacity = 0.9,
  fenceSpeedBase = 1200,
  fenceSpeedMin = 750,
  fenceSpeedPerLevel = 50,
  lockWinThresholdPercent = BALL_WON_REGION_THRESHOLD,
  lockMinRegionCells = 0,
  scopeCreep,
  regionColor: regionColorProp = "#1a3020",
  accentColor = "#00ff88",
  activeModifiers,
  cumulativeLockedBalls = 0,
  fenceDurability = null,
  parallaxTickRef,
  paused = false,
  showBallSpeeds = false,
  showPerfOverlay = false,
  freezeOnComplete = false,
}: GameCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startDissolveRef = useRef<((onComplete: () => void, tint?: string) => void) | null>(null);
  const onLevelCompleteRef = useRef(onLevelComplete);
  useEffect(() => { onLevelCompleteRef.current = onLevelComplete; }, [onLevelComplete]);
  const onMapCompleteRef = useRef(onMapComplete);
  useEffect(() => { onMapCompleteRef.current = onMapComplete; }, [onMapComplete]);
  const freezeOnCompleteRef = useRef(freezeOnComplete);
  useEffect(() => { freezeOnCompleteRef.current = freezeOnComplete; }, [freezeOnComplete]);
  const onGameEndRef = useRef(onGameEnd);
  useEffect(() => { onGameEndRef.current = onGameEnd; }, [onGameEnd]);
  const onBallTypeLockedRef = useRef(onBallTypeLocked);
  useEffect(() => { onBallTypeLockedRef.current = onBallTypeLocked; }, [onBallTypeLocked]);
  // Live ref so toggling the speed-label overlay takes effect without restarting
  // the render loop (the rctx is rebuilt only per level).
  const showBallSpeedsRef = useRef(showBallSpeeds);
  useEffect(() => { showBallSpeedsRef.current = showBallSpeeds; }, [showBallSpeeds]);
  const showPerfOverlayRef = useRef(showPerfOverlay);
  useEffect(() => { showPerfOverlayRef.current = showPerfOverlay; }, [showPerfOverlay]);
  // Keep the lock-rule config live on the game state (initGame also seeds it),
  // so tuning game-config.yml applies without waiting for the next level init.
  useEffect(() => {
    gameRef.current.lockWinThresholdPercent = lockWinThresholdPercent;
    gameRef.current.lockMinRegionCells = lockMinRegionCells;
  }, [lockWinThresholdPercent, lockMinRegionCells]);
  // Same live-config treatment for the Scope Creep tuning.
  useEffect(() => {
    if (scopeCreep) gameRef.current.creepConfig = scopeCreep;
  }, [scopeCreep]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game.gameLoopFn || game.gameOver || game.levelComplete) return;
    if (paused) {
      stopGameLoop(game);
      // Drop any in-progress swipe so a drag can't resume mid-gesture
      game.swipeStart = null;
      game.swipeRegionId = null;
      game.currentSwipePos = null;
      game.swipePointerId = null;
    } else {
      game.lastTime = 0; // reset to avoid a dt spike on the first resumed frame
      startGameLoop(game);
    }
  }, [paused]);

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
  // CSS (layout) size of the canvas, used to position the tutorial overlay.
  // NOTE: game.screenSize is in physical pixels (×devicePixelRatio); the overlay
  // lives in CSS-pixel/viewport space, so it must use these instead.
  const [canvasCssWidth, setCanvasCssWidth] = useState(0);
  const [canvasCssHeight, setCanvasCssHeight] = useState(0);
  const [tutorialCutMade, setTutorialCutMade] = useState(false);
  const [debugInfo, setDebugInfo] = useState({ boardWidth: 0, boardHeight: 0, scale: 0 });
  const [lockedBallsCount, setLockedBallsCount] = useState(0);
  const [bonusPulseKey, setBonusPulseKey] = useState(0);
  // Scope Creep: current speed boost in percent, stepped by onCreepStep (~4x/level).
  const [creepPercent, setCreepPercent] = useState(0);

  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameInitializedRef = useRef(false);
  const initializedLevelRef = useRef<string | null>(null);

  const livesRef = useRef(lives);
  useEffect(() => {
    livesRef.current = lives;
    setDisplayLives(lives);
  }, [lives]);

  const [pushMode, setPushMode] = useState<"none" | "prompt" | "pushing">("none");
  const [clearedPercent, setClearedPercent] = useState<number | null>(null);

  const gameRef = useRef<CanvasGameState>({
    spaceGrid: null as SpaceGrid | null,
    gridRegions: [] as GridRegion[],
    regions: [] as Region[],
    walls: [] as Wall[],
    obstaclePolygons: [] as Polygon[],
    mirrorPolygons: [] as Polygon[],
    boardPolygon: null as Polygon | null,
    originalArea: 0,
    basePlayableArea: 0,
    balls: [],
    movers: [],
    activeWall: null as GrowingWall | null,
    gameOver: false,
    levelComplete: false,
    swipeStart: null as Vector2 | null,
    swipeRegionId: null as string | null,
    currentSwipePos: null as Vector2 | null,
    swipePointerId: null as number | null,
    swipeTrail: null as { start: Vector2; end: Vector2; createdAt: number } | null,
    lastTime: 0,
    accumulator: 0,
    animationId: 0,
    lastAutoFreezeAt: 0,
    activePlaySeconds: 0,
    clearedActiveSeconds: null as number | null,
    creepFactor: 1,
    creepConfig: DEFAULT_SCOPE_CREEP,
    screenSize: { width: 0, height: 0 },
    boardRect: { left: 0, top: 0, width: 0, height: 0, scale: 1 } as BoardRect,
    backgroundColor: "#0a1a10",
    regionColor: "#1a3020",
    wallCount: 0,
    wallShieldsRemaining: 0,
    fastestBallId: null as string | null,
    pushMode: "none" as "none" | "prompt" | "pushing",
    bestRemainingPercent: 100,
    pushStartPercent: 100,
    levelClearedTime: 0,
    shimmerStart: 0,
    shimmerFrozen: false,
    gameLoopFn: null as ((timestamp: number) => void) | null,
    isRecovering: false,
    recoveryEndTime: 0,
    initialSamplePoints: [] as Vector2[],
    frozenBallId: null as string | null,
    frozenBallVelocity: null as Vector2 | null,
    frozenBallPosition: null as Vector2 | null,
    lockedBallsCount: 0,
    lockBonus: 0,
    moneyMultiplier: 1,
    ballSpeedScale: 1,
    assimilations: new Map<string, LockFlashState>(),
    dissolve: null as DissolveState | null,
    bonusCutCells: new Set<string>(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockMinRegionCells: 0,
    fenceDurability: null as number | null,
    pendingWallBreaks: [] as Wall[],
    destructibles: [] as import("@/types/game").DestructibleState[],
    pendingDestroys: [] as import("@/types/game").DestructibleState[],
    objectDebris: [] as import("@/types/game").ObjectDebrisState[],
    stackObjects: [] as import("@/types/game").StackObject[],
    fallingObjects: [] as import("@/types/game").FallingObject[],
    objectivesTotal: 0,
    objectivesBroken: 0,
    breakBonus: 0,
    lastDudAt: 0,
  });

  useGameInput(canvasRef, gameRef, activeModifiers, setCutCount, setIsPlayerDragging);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    if (initializedLevelRef.current !== level.id) {
      gameInitializedRef.current = false;
      initializedLevelRef.current = level.id;
    }

    const game = gameRef.current;
    game.regionColor = regionColorProp;
    // Second Wind capstone: N fence-hit shields granted fresh every map.
    game.wallShieldsRemaining = Math.max(0, Math.round(activeModifiers.wallShieldsPerMap));
    setWallShieldCount(game.wallShieldsRemaining);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // ── Blur canvas (legacy — now unused, kept for canvas element compatibility) ──
    let removedSamples: Vector2[] = [];
    let removedSamplesSet: Set<string> = new Set();

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
      if (newSamples.length > 0) removedSamples.push(...newSamples);
    };

    // ── Region / board-grid offscreen canvases ───────────────────────────────
    const boardGridCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const regionCanvas    = new OffscreenCanvas(canvas.width, canvas.height);

    const scanlineTile = new OffscreenCanvas(4, 4);
    (() => {
      const stCtx = scanlineTile.getContext('2d')!;
      stCtx.clearRect(0, 0, 4, 4);
      stCtx.fillStyle = 'rgba(0,0,0,0.18)';
      stCtx.fillRect(0, 3, 4, 1);
    })();

    const paintBoardGrid = () => {
      const gCtx = boardGridCanvas.getContext("2d");
      if (!gCtx) return;
      const { width: sw, height: sh } = game.screenSize;
      if (boardGridCanvas.width !== sw || boardGridCanvas.height !== sh) {
        boardGridCanvas.width = sw; boardGridCanvas.height = sh;
      }
      gCtx.clearRect(0, 0, boardGridCanvas.width, boardGridCanvas.height);
      if (game.initialSamplePoints.length === 0) return;
      const { boardRect, regionColor } = game;
      const gridSize = 15, halfGrid = 7.5, cellPadding = 3;
      const size = Math.round((gridSize + cellPadding * 2) * boardRect.scale);
      gCtx.save();
      gCtx.globalAlpha = canvasOpacity * 0.55;
      gCtx.fillStyle = regionColor;
      for (const s of game.initialSamplePoints) {
        const sx = Math.round(boardRect.left + (s.x - halfGrid - cellPadding) * boardRect.scale);
        const sy = Math.round(boardRect.top  + (s.y - halfGrid - cellPadding) * boardRect.scale);
        gCtx.fillRect(sx, sy, size, size);
      }
      gCtx.restore();
    };

    const repaintRegionCanvas = () => {
      paintBoardGrid();
      const rCtx = regionCanvas.getContext("2d");
      if (!rCtx) return;
      const { width: sw, height: sh } = game.screenSize;
      if (regionCanvas.width !== sw || regionCanvas.height !== sh) {
        regionCanvas.width = sw; regionCanvas.height = sh;
      }
      rCtx.clearRect(0, 0, regionCanvas.width, regionCanvas.height);
      const { boardRect, regionColor } = game;
      // Step 1: solid board = captured territory
      rCtx.save();
      rCtx.globalAlpha = canvasOpacity * 0.8;
      rCtx.fillStyle = regionColor;
      rCtx.fillRect(boardRect.left, boardRect.top, boardRect.width, boardRect.height);
      rCtx.restore();
      // Step 2: punch transparent holes over the ACTIVE (playable) area.
      const grid = game.spaceGrid;
      if (grid) {
        // Authoritative + smooth: trace the ACTIVE/removed boundary straight from
        // the space grid (the single source of truth, so captured space behind an
        // obstacle can never leak a hole — the old "shadow behind the obstacle")
        // and punch it as one anti-aliased path with rounded corners, instead of
        // stamping hard 15px cells. Even-odd fill keeps interior captured holes
        // (obstacles inside the playable area) intact.
        const loops = traceActiveContours(grid);
        rCtx.save();
        rCtx.globalCompositeOperation = "destination-out";
        rCtx.beginPath();
        for (const loop of loops) {
          for (let i = 0; i < loop.length; i++) {
            const sx = boardRect.left + loop[i].x * boardRect.scale;
            const sy = boardRect.top + loop[i].y * boardRect.scale;
            if (i === 0) rCtx.moveTo(sx, sy);
            else rCtx.lineTo(sx, sy);
          }
          rCtx.closePath();
        }
        rCtx.fill("evenodd");
        rCtx.restore();
      } else {
        // Fallback (no space grid): stamp active region cells as before.
        const gridSize = 15, halfGrid = 7.5, cellPadding = 3;
        const size = Math.round((gridSize + cellPadding * 2) * boardRect.scale);
        for (const region of game.regions) {
          for (const sample of (region.samplePoints ?? [])) {
            const sx = Math.round(boardRect.left + (sample.x - halfGrid - cellPadding) * boardRect.scale);
            const sy = Math.round(boardRect.top  + (sample.y - halfGrid - cellPadding) * boardRect.scale);
            rCtx.clearRect(sx, sy, size, size);
          }
        }
      }
      // Step 2b: accent-tint LOCKED territory. Marks where balls were locked
      // (vs plain fenced-off space) with a persistent accent wash. Traced from the
      // grid's lock-captured mask, not the ray-cast lock polygon, so it's uniform
      // behind obstacles and can't leave the "shadow behind the obstacle" wedge.
      // source-atop keeps it on the captured fill only (never over active holes).
      if (grid?.lockCaptured) {
        const mask = grid.lockCaptured;
        const gw = grid.width;
        const lockLoops = traceContours(grid, (col, row) => mask[row * gw + col] === 1);
        if (lockLoops.length > 0) {
          rCtx.save();
          rCtx.globalCompositeOperation = 'source-atop';
          rCtx.globalAlpha = canvasOpacity * 0.3;
          rCtx.fillStyle = accentColor;
          rCtx.beginPath();
          for (const loop of lockLoops) {
            for (let i = 0; i < loop.length; i++) {
              const sx = boardRect.left + loop[i].x * boardRect.scale;
              const sy = boardRect.top + loop[i].y * boardRect.scale;
              if (i === 0) rCtx.moveTo(sx, sy);
              else rCtx.lineTo(sx, sy);
            }
            rCtx.closePath();
          }
          rCtx.fill('evenodd');
          rCtx.restore();
        }
      }
      // Step 3: scanline overlay on captured fill only
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

    const paintOverlayCanvas = () => {
      const oc = overlayCanvasRef.current;
      if (!oc) return;
      const { width: w, height: h } = canvas;
      oc.width = w; oc.height = h;
      // Do NOT set oc.style.width/height — the canvas is `absolute inset-0` and
      // fills its container at CSS pixel size. Setting it to canvas.width (physical
      // pixels) would make it 2× too large on HiDPI screens, causing blur + overflow.
      const oCtx = oc.getContext('2d');
      if (!oCtx) return;
      oCtx.clearRect(0, 0, w, h);
      const tile = new OffscreenCanvas(3, 3);
      const tCtx = tile.getContext('2d')!;
      tCtx.clearRect(0, 0, 3, 3);
      tCtx.fillStyle = 'rgba(0,0,0,0.08)';
      tCtx.beginPath(); tCtx.arc(1.5, 1.5, 0.6, 0, Math.PI * 2); tCtx.fill();
      const pattern = oCtx.createPattern(tile, 'repeat')!;
      oCtx.fillStyle = pattern;
      oCtx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const vign = oCtx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.72);
      vign.addColorStop(0, 'rgba(0,0,0,0)');
      vign.addColorStop(1, 'rgba(0,0,0,0.22)');
      oCtx.fillStyle = vign;
      oCtx.fillRect(0, 0, w, h);
    };

    const rainState: RainState = { particles: [], lastTime: 0 };

    const initGame = () => {
      game.assimilations.clear();
      game.bonusCutCells.clear();
      game.lockWinThresholdPercent = lockWinThresholdPercent;
      game.lockMinRegionCells = lockMinRegionCells;
      game.fenceDurability = fenceDurability;
      game.pendingWallBreaks = [];
      game.pendingDestroys = [];
      game.objectDebris = [];
      game.fallingObjects = [];
      game.objectivesBroken = 0;
      game.breakBonus = 0;
      game.lastDudAt = 0;
      game.moneyMultiplier = 1;
      game.ballSpeedScale = activeModifiers.ballSpeedMultiplier;
      const data = createInitialGameData(level, levelNumber, activeModifiers);
      game.walls              = data.walls;
      game.movers             = data.movers;
      game.obstaclePolygons   = data.obstaclePolygons;
      game.mirrorPolygons     = data.mirrorPolygons;
      game.boardPolygon       = data.boardPolygon;
      game.originalArea       = data.originalArea;
      game.basePlayableArea   = data.basePlayableArea;
      game.balls              = data.balls;
      game.destructibles      = data.destructibles;
      game.stackObjects       = data.stackObjects;
      game.objectivesTotal    = data.objectivesTotal;
      game.initialSamplePoints = data.initialSamplePoints;
      game.spaceGrid          = data.spaceGrid;
      game.gridRegions        = data.gridRegions;
      game.regions            = data.regions;
      if (game.spaceGrid) paintCellRegionIds(game.spaceGrid, game.regions);
      game.fastestBallId      = data.fastestBallId;
      removedSamples = [];
      removedSamplesSet = new Set();
      repaintRegionCanvas();
      game.activeWall = null;
      game.gameOver = false;
      game.levelComplete = false;
      game.shimmerStart = 0;
      game.shimmerFrozen = false;
      game.swipeStart = null;
      game.swipeRegionId = null;
      game.currentSwipePos = null;
      game.swipePointerId = null;
      game.lastTime = 0;
      game.accumulator = 0;
      game.lastAutoFreezeAt = 0; // Cron Job: restart the auto-freeze clock each map
      // Time factor: fresh active-play clock and Scope Creep state each map.
      game.activePlaySeconds = 0;
      game.clearedActiveSeconds = null;
      game.creepFactor = 1;
      game.creepConfig = scopeCreep ?? DEFAULT_SCOPE_CREEP;
      setCreepPercent(0);
      game.wallCount = 0;
      clearWallImpacts();
      setCutCount(0);
      // Not always 100: startingCapturePercent (Equity Grant) starts the run lower
      setRemainingPercent(game.spaceGrid ? Math.round(getRemainingPercent(game.spaceGrid)) : 100);
      rainState.particles = createRainParticles(40);
      rainState.lastTime = 0;
    };

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = getDevicePixelRatio();
      const physW = Math.round(width * dpr);
      const physH = Math.round(height * dpr);
      canvas.width = physW; canvas.height = physH;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      game.screenSize = { width: physW, height: physH };
      game.boardRect = computeBoardRect(physW, physH);
      clearBallRenderCache();
      clearBallSphereCache();
      clearRainGlyphCache();
      clearBallEffectsCache();
      repaintRegionCanvas();
      paintOverlayCanvas();
      setDebugInfo({
        boardWidth: Math.round(game.boardRect.width),
        boardHeight: Math.round(game.boardRect.height),
        scale: Math.round(game.boardRect.scale * 1000) / 1000,
      });
      if (!gameInitializedRef.current) {
        gameInitializedRef.current = true;
        initGame();
      }
    };

    const rctx: RenderContext = {
      accentColor, activeModifiers, boardGridCanvas, regionCanvas, rain: rainState,
      spaceThreshold: level.sizeThreshold, showBallSpeeds: showBallSpeedsRef.current,
      infoUnlockedLabel: t('game.infoUnlocked'),
    };
    const render = () => {
      rctx.showBallSpeeds = showBallSpeedsRef.current;
      renderFrame(ctx, game, rctx);
      // Perf HUD drawn after renderFrame (which returns early on normal frames),
      // so it always lands on top. Its cost counts toward the measured render ms.
      if (showPerfOverlayRef.current) drawPerfOverlay(ctx, game);
    };

    const startDissolve = (onComplete: () => void, tint?: string) => {
      const TILE = 28;
      const W = canvas.width, H = canvas.height;
      const captured = document.createElement('canvas');
      captured.width = W; captured.height = H;
      const cctx = captured.getContext('2d')!;
      cctx.drawImage(canvas, 0, 0);
      if (tint) { cctx.fillStyle = tint; cctx.fillRect(0, 0, W, H); }

      const cols = Math.ceil(W / TILE), rows = Math.ceil(H / TILE);
      const tiles: DissolveTile[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
          const dx = cx - W / 2, dy = cy - H / 2;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = 120 + Math.random() * 360;
          tiles.push({
            sx: c * TILE, sy: r * TILE,
            sw: Math.min(TILE, W - c * TILE), sh: Math.min(TILE, H - r * TILE),
            cx, cy,
            vx: (dx / dist) * speed * 0.4 + (Math.random() - 0.5) * 120,
            vy: (dy / dist) * speed * 0.15 + Math.random() * 80 - 20,
            rotSpeed: (Math.random() - 0.5) * 8,
            delay: Math.random() * 0.6,
          });
        }
      }
      game.dissolve = { captured, tiles, startTime: performance.now(), onComplete };
      startGameLoop(game);
    };
    startDissolveRef.current = startDissolve;

    // Build callbacks object for extracted physics functions
    const callbacks: GameCallbacks = {
      setLockedBallsCount,
      setRemainingPercent,
      setTutorialCutMade,
      setPushMode,
      setClearedPercent,
      setScreenFlash,
      setIsShaking,
      setIsRecovering,
      setWallShieldCount,
      setDisplayLives,
      onLevelComplete: d => onLevelCompleteRef.current(d),
      onMapComplete: () => onMapCompleteRef.current?.(),
      freezeOnComplete: () => freezeOnCompleteRef.current,
      onGameEnd: r => onGameEndRef.current(r),
      onLivesChange,
      onTutorialCutSuccess,
      onBallTypeLocked: id => onBallTypeLockedRef.current?.(id) ?? false,
      getLives: () => livesRef.current,
      setLivesRef: n => { livesRef.current = n; },
      flashTimeoutRef,
      shakeTimeoutRef,
      repaintRegionCanvas,
      collectAndDrawRemovedSamples,
      render,
      startDissolve,
    };

    const applyCut = (wall: GrowingWall) => {
      vibrateFenceComplete();
      applyCutFn(wall, game, level, levelNumber, activeModifiers, tutorialMode, tutorialCutMade, cumulativeLockedBalls, callbacks);
    };

    const updateWall = (dt: number) =>
      updateFenceWallFn(dt, game, level, levelNumber, activeModifiers, fenceSpeedBase, fenceSpeedMin, fenceSpeedPerLevel, callbacks);

    const gameLoopCallbacks: GameLoopCallbacks = {
      updateWall: (dt: number) => updateWall(dt),
      applyCut: (wall) => applyCut(wall),
      render,
      processWallBreaks: () =>
        processWallBreaksFn(game, {
          repaintRegionCanvas,
          setRemainingPercent,
          onFenceBroke: () => { playFenceBreakSound(); vibrateFenceBreak(); },
        }),
      processDestroys: () =>
        processDestroysFn(game, {
          repaintRegionCanvas,
          setRemainingPercent,
          onObjectDestroyed: () => { playFenceBreakSound(); vibrateFenceBreak(); },
        }),
      onCreepStep: setCreepPercent,
    };
    const gameLoop = createGameLoop(game, canvas, ctx, parallaxTickRef, gameLoopCallbacks, activeModifiers.autoFreezeDuration, activeModifiers.freezeNoCooldown);
    game.gameLoopFn = gameLoop;

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    startGameLoop(game);

    // Once the level has run long enough for the perf window to fill, try (once)
    // to ramp the render resolution up if the device has frame-time headroom.
    // Poll for a few seconds while the window fills, then give up. resizeCanvas
    // re-applies the raised DPR ceiling.
    let dprRampChecks = 0;
    const dprRampInterval = window.setInterval(() => {
      dprRampChecks++;
      if (maybeRampDpr(resizeCanvas) || dprRampChecks >= 8) {
        window.clearInterval(dprRampInterval);
      }
    }, 1000);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.clearInterval(dprRampInterval);
      stopGameLoop(game);
      // Cancel any pending flash/shake/game-over timeouts so they can't fire a
      // React setter (or onGameEnd, via the 1s game-over timeout) after unmount
      // when the canvas is torn down mid-animation (Main Menu, Continue-remount).
      if (flashTimeoutRef.current) { clearTimeout(flashTimeoutRef.current); flashTimeoutRef.current = null; }
      if (shakeTimeoutRef.current) { clearTimeout(shakeTimeoutRef.current); shakeTimeoutRef.current = null; }
      clearBallRenderCache();
      clearBallSphereCache();
      clearRainGlyphCache();
      clearBallEffectsCache();
      clearRenderFrameCache();
    };
  }, [level, levelNumber, activeModifiers, fenceDurability]);

  const handleBankAndContinue = useCallback(() => {
    const game = gameRef.current;
    game.levelComplete = true;
    // Clear the prompt so the loop reaches its levelComplete branch (it bails
    // early while pushMode is "prompt") and the prompt overlay is dismissed,
    // revealing the board for the shimmer.
    game.pushMode = "none";
    setPushMode("none");
    // Same celebratory shimmer as a normal clear before the overlay mounts.
    // The push-your-luck prompt halted the rAF loop (it returns without
    // rescheduling), so restart it here or the shimmer window renders no frames.
    game.shimmerStart = performance.now();
    game.shimmerFrozen = freezeOnCompleteRef.current;
    onMapCompleteRef.current?.(); // freeze the background code for the "dead" beat
    startGameLoop(game);
    // Dev/playground freeze: play the shimmer, hold the drained frame, no overlay.
    if (freezeOnCompleteRef.current) return;
    const areaAtPushStart = game.pushStartPercent;
    const areaCleared = Math.max(0, areaAtPushStart - game.bestRemainingPercent);
    const chunkSize = areaAtPushStart * 0.25;
    const pushBonus = chunkSize > 0
      ? Math.round(Math.floor(areaCleared / chunkSize) * activeModifiers.pushBonusMultiplier)
      : 0;
    // Ship Early: the tempo clock froze when the prompt opened, so push time
    // never counts against it.
    const shipEarlyBonus = getShipEarlyBonus(game.clearedActiveSeconds);
    // Fold lock + push + ship-early bonuses in before the cap (issue #43).
    // Previously this site added lockBonus + pushBonus AFTER calculateScore,
    // letting a banked push exceed the per-map ceiling every other path enforces.
    const { levelScore, breakdown } = calculateScore(
      game.wallCount, level.expectedCuts, game.bestRemainingPercent, level.sizeThreshold, level.points, {
        scoreMultiplier: activeModifiers.scoreMultiplier,
        extraBonus: game.lockBonus + pushBonus + shipEarlyBonus,
        spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
        overtimeCapBonus: activeModifiers.overtimeCapBonus,
      },
    );

    setTimeout(() => {
      onLevelCompleteRef.current({
        levelNumber, levelId: level.id, cutCount: game.wallCount,
        expectedCuts: level.expectedCuts, basePoints: level.points,
        levelScore,
        remainingPercent: game.bestRemainingPercent, overcutBonus: 0,
        thresholdPercent: level.sizeThreshold, pushBonus,
        underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
        spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent, lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
        shipEarlyBonus, clearTimeSeconds: game.clearedActiveSeconds ?? undefined,
      });
      startDissolveRef.current?.(() => {});
    }, 150 + LEVEL_CLEAR_SHIMMER_MS);
  }, [level, levelNumber, activeModifiers]);

  useEffect(() => {
    if (onGameStateChange) {
      onGameStateChange({
        cutsUsed: cutCount,
        spaceRemaining: remainingPercent,
        lockedBalls: lockedBallsCount,
        pushMode,
        creepPercent,
        onBankAndContinue: handleBankAndContinue,
      });
    }
  }, [cutCount, remainingPercent, pushMode, creepPercent, handleBankAndContinue, onGameStateChange, lockedBallsCount]);

  const handlePushYourLuck = useCallback(() => {
    const game = gameRef.current;
    game.pushMode = "pushing";
    setPushMode("pushing");
  }, []);

  useEffect(() => {
    if (pushMode !== "pushing") return;
    const game = gameRef.current;
    game.lastTime = 0;
    game.accumulator = 0;
    startGameLoop(game);
  }, [pushMode]);

  useEffect(() => {
    const updateCanvasPosition = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setCanvasOffsetTop(rect.top);
      setCanvasOffsetLeft(rect.left);
      setCanvasCssWidth(rect.width);
      setCanvasCssHeight(rect.height);
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
      {screenFlash === "red" && <div className="absolute inset-0 z-50 pointer-events-none bg-red-500/40" />}

      {process.env.NODE_ENV === "development" && (
        <div className="absolute top-2 right-2 text-xs text-muted-foreground/50 font-mono z-10">
          {debugInfo.boardWidth}×{debugInfo.boardHeight} @ {debugInfo.scale}x
        </div>
      )}

      <div ref={containerRef} className="flex-1 min-h-0 relative overflow-visible" style={{ height: "70%" }}>
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
        <canvas ref={canvasRef} className="absolute inset-0 touch-none cursor-crosshair" style={{ zIndex: 2 }} />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 3, opacity: 1 }}
        />
      </div>

      <div className="flex-shrink-0 px-4 py-3 flex justify-center items-center" style={{ minHeight: "15%" }} />

      {pushMode === "prompt" && clearedPercent !== null && (
        <PushYourLuckOverlay
          remainingPercent={clearedPercent}
          thresholdPercent={level.sizeThreshold}
          basePoints={level.points}
          onBank={handleBankAndContinue}
          onPush={handlePushYourLuck}
        />
      )}

      {tutorialMode && tutorialStep !== "completed" && !tutorialCutMade && (
        <InteractiveTutorialOverlay
          tutorialStep={tutorialStep}
          isPlayerDragging={isPlayerDragging}
          canvasWidth={canvasCssWidth}
          canvasHeight={canvasCssHeight}
          canvasOffsetTop={canvasOffsetTop}
          canvasOffsetLeft={canvasOffsetLeft}
        />
      )}
    </div>
  );
}
