import { useRef, useEffect, useState, useCallback } from "react";
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from "@/types/game";
import { LevelConfig } from "@/types/level";

import { GameModifiers } from "@/hooks/useActiveModifiers";
import { clearBallRenderCache } from "@/lib/ballRenderCache";
import { clearBallEffectsCache } from "@/lib/ballEffects";
import { renderFrame, createRainParticles } from "@/lib/rendering/renderFrame";
import { RenderContext, RainState } from "@/lib/rendering/types";
import { calculateScore, ensureScoringConfigLoaded } from "@/hooks/useScoring";
import { PushYourLuckOverlay } from "./PushYourLuckOverlay";
import { InteractiveTutorialOverlay } from "./InteractiveTutorialOverlay";
import { TutorialStep } from "@/hooks/useInteractiveTutorial";
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
} from "@/lib/regionOwnership";
import {
  SpaceGrid,
  GridRegion,
  CellState,
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
import { GameCallbacks } from "@/lib/physics/gameCallbacks";
import { applyCutFn } from "@/lib/physics/applyCut";
import { updateFenceWallFn } from "@/lib/physics/updateFenceWall";

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
    lastTime: 0,
    accumulator: 0,
    animationId: 0,
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
    gameLoopFn: null as ((timestamp: number) => void) | null,
    isRecovering: false,
    recoveryEndTime: 0,
    initialSamplePoints: [] as Vector2[],
    frozenBallId: null as string | null,
    frozenBallVelocity: null as Vector2 | null,
    frozenBallPosition: null as Vector2 | null,
    lockedBallsCount: 0,
    lockBonus: 0,
    assimilations: new Map<string, LockFlashState>(),
    dissolve: null as DissolveState | null,
    bonusCutCells: new Set<string>(),
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
    game.wallShieldsRemaining = 0;
    setWallShieldCount(0);

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
      const size = (gridSize + cellPadding * 2) * boardRect.scale;
      gCtx.save();
      gCtx.globalAlpha = canvasOpacity * 0.55;
      gCtx.fillStyle = regionColor;
      for (const s of game.initialSamplePoints) {
        const sx = boardRect.left + (s.x - halfGrid - cellPadding) * boardRect.scale;
        const sy = boardRect.top  + (s.y - halfGrid - cellPadding) * boardRect.scale;
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
      // Step 2: punch transparent holes for active region cells
      const gridSize = 15, halfGrid = 7.5, cellPadding = 3;
      const size = (gridSize + cellPadding * 2) * boardRect.scale;
      for (const region of game.regions) {
        for (const sample of (region.samplePoints ?? [])) {
          const sx = boardRect.left + (sample.x - halfGrid - cellPadding) * boardRect.scale;
          const sy = boardRect.top  + (sample.y - halfGrid - cellPadding) * boardRect.scale;
          rCtx.clearRect(sx, sy, size, size);
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
      oc.style.width = `${w}px`; oc.style.height = `${h}px`;
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
      const data = createInitialGameData(level, levelNumber, activeModifiers);
      game.walls              = data.walls;
      game.movers             = data.movers;
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
      removedSamples = [];
      removedSamplesSet = new Set();
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
      clearWallImpacts();
      setCutCount(0);
      setRemainingPercent(100);
      rainState.particles = createRainParticles(40);
      rainState.lastTime = 0;
    };

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const physW = Math.round(width * dpr);
      const physH = Math.round(height * dpr);
      canvas.width = physW; canvas.height = physH;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      game.screenSize = { width: physW, height: physH };
      game.boardRect = computeBoardRect(physW, physH);
      clearBallRenderCache();
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

    const rctx: RenderContext = { accentColor, activeModifiers, boardGridCanvas, regionCanvas, rain: rainState, spaceThreshold: level.sizeThreshold };
    const render = () => renderFrame(ctx, game, rctx);

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
      game.animationId = requestAnimationFrame(gameLoop);
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
      onGameEnd: r => onGameEndRef.current(r),
      onLivesChange,
      onTutorialCutSuccess,
      getLives: () => livesRef.current,
      setLivesRef: n => { livesRef.current = n; },
      flashTimeoutRef,
      shakeTimeoutRef,
      repaintRegionCanvas,
      collectAndDrawRemovedSamples,
      render,
      startDissolve,
    };

    const applyCut = (wall: GrowingWall) =>
      applyCutFn(wall, game, level, levelNumber, activeModifiers, tutorialMode, tutorialCutMade, cumulativeLockedBalls, callbacks);

    const updateWall = (dt: number) =>
      updateFenceWallFn(dt, game, level, levelNumber, activeModifiers, fenceSpeedBase, fenceSpeedMin, fenceSpeedPerLevel, callbacks);

    const gameLoopCallbacks: GameLoopCallbacks = {
      updateWall: (dt: number) => updateWall(dt),
      applyCut: (wall) => applyCut(wall),
      render,
    };
    const gameLoop = createGameLoop(game, canvas, ctx, parallaxTickRef, gameLoopCallbacks);
    game.gameLoopFn = gameLoop;

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    game.animationId = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(game.animationId);
    };
  }, [level, levelNumber, activeModifiers]);

  const handleBankAndContinue = useCallback(() => {
    const game = gameRef.current;
    game.levelComplete = true;
    const { levelScore, breakdown } = calculateScore(
      game.wallCount, level.expectedCuts, game.bestRemainingPercent,
      level.sizeThreshold, level.points, activeModifiers.scoreMultiplier, levelNumber,
    );
    const areaAtPushStart = game.pushStartPercent;
    const areaCleared = Math.max(0, areaAtPushStart - game.bestRemainingPercent);
    const chunkSize = areaAtPushStart * 0.25;
    const pushBonus = chunkSize > 0 ? Math.floor(areaCleared / chunkSize) : 0;

    setTimeout(() => {
      onLevelCompleteRef.current({
        levelNumber, levelId: level.id, cutCount: game.wallCount,
        expectedCuts: level.expectedCuts, basePoints: level.points,
        levelScore: levelScore + game.lockBonus + pushBonus,
        remainingPercent: game.bestRemainingPercent, overcutBonus: 0,
        thresholdPercent: level.sizeThreshold, pushBonus,
        underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
        spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent, lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
      });
      startDissolveRef.current?.(() => {});
    }, 150);
  }, [level, levelNumber, activeModifiers]);

  useEffect(() => {
    if (onGameStateChange) {
      onGameStateChange({
        cutsUsed: cutCount,
        spaceRemaining: remainingPercent,
        lockedBalls: lockedBallsCount,
        pushMode,
        onBankAndContinue: handleBankAndContinue,
      });
    }
  }, [cutCount, remainingPercent, pushMode, handleBankAndContinue, onGameStateChange, lockedBallsCount]);

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
    if (game.gameLoopFn) {
      cancelAnimationFrame(game.animationId);
      requestAnimationFrame(() => {
        game.lastTime = 0;
        game.accumulator = 0;
        game.animationId = requestAnimationFrame(game.gameLoopFn!);
      });
    }
  }, [pushMode]);

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
          canvasWidth={gameRef.current.screenSize.width}
          canvasHeight={gameRef.current.screenSize.height}
          canvasOffsetTop={canvasOffsetTop}
          canvasOffsetLeft={canvasOffsetLeft}
        />
      )}
    </div>
  );
}
