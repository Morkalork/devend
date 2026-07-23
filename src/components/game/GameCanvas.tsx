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
import { clearPickupSpriteCache } from "@/lib/rendering/pickupSprites";
import { effectivePickupChance } from "@/lib/pickups";
import { getAbility } from "@/lib/abilities";
import { fireAbility, fireTargetedAbility } from "@/lib/abilityEffects";
import { drawPerfOverlay } from "@/lib/rendering/perfStats";
import { RenderContext, RainState } from "@/lib/rendering/types";
import { calculateScore, ensureScoringConfigLoaded, getShipEarlyBonus } from "@/lib/scoring";
import { isTimingExempt } from "@/lib/mapTiming";
import { tickRainbowSpawns } from "@/lib/physics/rainbowSpawner";
import { tickBossPhases, tickBossSpit } from "@/lib/physics/bossPhases";
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
  LEVEL_CLEAR_HOLD_MS,
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
import { traceActiveContours, traceContours, snapContoursToWalls, ContourPoint } from "@/lib/rendering/regionContour";
import { maybeRampDpr } from "@/lib/rendering/adaptiveDpr";
import { playFenceBreakSound, playDeathSound, playBallLockSound, playPickupClaimedSound } from "@/lib/gameAudio";
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
import { PickupConfig, PickupState, PickupFeedback, PickupEffect, DEFAULT_PICKUP_CONFIG } from "@/types/pickups";
import { ScopeCreepConfig, DEFAULT_SCOPE_CREEP } from "@/lib/scopeCreep";
import { ActiveMapMutator } from "@/types/mapMutator";
import { ActiveMapObjective } from "@/types/objective";
import { createInitialGameData } from "@/lib/initGame";
import { useGameInput } from "@/hooks/useGameInput";
import { createGameLoop, GameLoopCallbacks } from "@/hooks/useGameLoop";
import { getRenderer, RendererKind } from "@/lib/rendering/rendererSettings";
import type { PixiGameRenderer } from "@/lib/rendering/pixi/PixiGameRenderer";
import { GameCallbacks } from "@/lib/physics/gameCallbacks";
import { applyCutFn, checkSpaceWin, evaluateWinConditions } from "@/lib/physics/applyCut";
import { updateFenceWallFn } from "@/lib/physics/updateFenceWall";
import { processWallBreaksFn } from "@/lib/physics/breakFenceWall";
import { processDestroysFn } from "@/lib/physics/destructibles";

export interface GameStateInfo {
  cutsUsed: number;
  spaceRemaining: number;
  lockedBalls: number;
  /** Superior (tight-pocket) locks this map, for the #55 objective HUD. */
  superiorLocks: number;
  /** Boss ball state (issue #56), for the boss banner + defeatBoss objective. */
  bossActive: boolean;
  bossHp: number;
  bossMaxHp: number;
  bossDefeated: boolean;
  /** Feature Freeze tap-freezes left this map (for the HUD counter). */
  freezeUsesRemaining: number;
  pushMode: "none" | "prompt" | "pushing";
  /** Current Scope Creep speed boost in percent (0 = not yet active). */
  creepPercent: number;
  /** Whole active-play seconds this map (1Hz; drives the Ship Early bar). */
  activeSeconds: number;
  /** Balls spawned on this map (scales the Ship Early windows). */
  ballCount: number;
  onBankAndContinue?: () => void;
  /** Fire a chest-earned ability by id (Freeze All / Slow All / Clear Fences). */
  onUseAbility?: (abilityId: string) => void;
  /** Active time-based abilities, for the countdown bar (drain in active-play seconds). */
  abilityTimers?: AbilityTimer[];
  /** A targeted ability (Magnet) armed and awaiting a board tap; else null. */
  armedAbility?: string | null;
}

/** A running time-based ability, for the countdown bar (#38). Wall-clock
 *  (performance.now) so the bar can drain to exactly zero the instant the
 *  effect ends, instead of lagging to the next whole-second cull tick. */
export interface AbilityTimer {
  kind: string;
  name: string;
  color: string;
  endMs: number;      // performance.now() at which it expires
  durationMs: number; // total length, for the fill ratio
}

interface GameCanvasProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  totalScore: number;
  lives: number;
  onLivesChange: (newLives: number) => void;
  /** A smashed chest granted one charge of an ability (issue #38): the session
   *  banks it run-wide so it persists into later maps. */
  onGrantAbility?: (abilityId: string) => void;
  /** The player spent one ability charge (pressed the ability button). */
  onSpendAbility?: (abilityId: string) => void;
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
  /** Fired the instant the map is won, so the shell can freeze the code background. */
  onMapComplete?: () => void;
  /** Run-start intro: the board ASSEMBLES from shatter tiles (the reverse of
   *  the level-clear dissolve) instead of popping in over the background code.
   *  Passed true only for the first map of a run. */
  introAssemble?: boolean;
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
  /** Per-map mutator (issue #54), rolled per map by GameScreen; null = vanilla. */
  mapMutator?: ActiveMapMutator | null;
  /** Per-map objective (issue #55), rolled per map by GameScreen; null = none. */
  objective?: ActiveMapObjective | null;
  /** Pickup tuning (from game-config.yml `pickups:`). */
  pickupConfig?: PickupConfig;
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
  /** Fired once when the board first becomes visible: the run-intro assemble
   *  starts presenting its tiles, or the loop's first frame for a normal start.
   *  Lets the shell fade out its "Loading..." overlay. */
  onCanvasReady?: () => void;
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
  onGrantAbility,
  onSpendAbility,
  onGameEnd,
  onLevelComplete,
  onMapComplete,
  introAssemble = false,
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
  mapMutator = null,
  objective = null,
  pickupConfig = DEFAULT_PICKUP_CONFIG,
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
  onCanvasReady,
}: GameCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Renderer flag: read once per mount (switching = remount). Under 'pixi' the
  // canvas gets a WebGL context via PixiGameRenderer (dynamic import, so the
  // 2D path never pays for the pixi chunk) and renders at NATIVE device
  // resolution. If WebGL init fails (old WebView, blocklisted GPU), we fall
  // back to canvas2d for the session: the state change remounts the canvas
  // element (key below) so the fallback gets a fresh, contextless canvas.
  const [rendererKind, setRendererKind] = useState<RendererKind>(() => getRenderer());
  const pixiRef = useRef<PixiGameRenderer | null>(null);
  const pixiInitStartedRef = useRef(false);
  const pixiSizeRef = useRef<{ w: number; h: number } | null>(null);
  const startDissolveRef = useRef<((onComplete: () => void, tint?: string) => void) | null>(null);
  const onLevelCompleteRef = useRef(onLevelComplete);
  useEffect(() => { onLevelCompleteRef.current = onLevelComplete; }, [onLevelComplete]);
  const onMapCompleteRef = useRef(onMapComplete);
  useEffect(() => { onMapCompleteRef.current = onMapComplete; }, [onMapComplete]);
  // Run-intro assemble plays at most once per mount: consumed on first use so
  // the per-level effect re-runs (and mid-run maps) never replay it.
  const introPendingRef = useRef(introAssemble);
  const freezeOnCompleteRef = useRef(freezeOnComplete);
  useEffect(() => { freezeOnCompleteRef.current = freezeOnComplete; }, [freezeOnComplete]);
  const onGameEndRef = useRef(onGameEnd);
  useEffect(() => { onGameEndRef.current = onGameEnd; }, [onGameEnd]);
  const onBallTypeLockedRef = useRef(onBallTypeLocked);
  useEffect(() => { onBallTypeLockedRef.current = onBallTypeLocked; }, [onBallTypeLocked]);
  const onCanvasReadyRef = useRef(onCanvasReady);
  useEffect(() => { onCanvasReadyRef.current = onCanvasReady; }, [onCanvasReady]);
  // Live ref so toggling the speed-label overlay takes effect without restarting
  // the render loop (the rctx is rebuilt only per level).
  const showBallSpeedsRef = useRef(showBallSpeeds);
  useEffect(() => { showBallSpeedsRef.current = showBallSpeeds; }, [showBallSpeeds]);
  const showPerfOverlayRef = useRef(showPerfOverlay);
  useEffect(() => { showPerfOverlayRef.current = showPerfOverlay; }, [showPerfOverlay]);
  // Keep the lock-rule config live on the game state (initGame also seeds it),
  // so tuning game-config.yml applies without waiting for the next level init.
  // Code Review folds its bonus percentage points into the threshold here and
  // in initGame, so the engine and readouts share one effective value.
  useEffect(() => {
    gameRef.current.lockWinThresholdPercent = lockWinThresholdPercent + activeModifiers.lockThresholdBonus;
    gameRef.current.lockBaseThresholdPercent = lockWinThresholdPercent;
    gameRef.current.lockMinRegionCells = lockMinRegionCells;
  }, [lockWinThresholdPercent, lockMinRegionCells, activeModifiers.lockThresholdBonus]);
  // Same live-config treatment for the Scope Creep tuning.
  useEffect(() => {
    if (scopeCreep) gameRef.current.creepConfig = scopeCreep;
  }, [scopeCreep]);
  // Per-map mutator: keep the live game in sync with the roll (also set at init
  // and per-map reset). Changing map remounts/rerolls, so this is belt-and-braces.
  useEffect(() => {
    gameRef.current.mapMutator = mapMutator ?? null;
  }, [mapMutator]);
  // Same live-sync for the per-map objective (issue #55).
  useEffect(() => {
    gameRef.current.objective = objective ?? null;
  }, [objective]);
  // Pickup tuning arrives async (game-config.yml fetch) — reseed the live game
  // instead of putting it in the init effect's deps (that would restart the
  // level when the config lands). Same chance/gate derivation as initGame.
  useEffect(() => {
    const game = gameRef.current;
    if (!game.spaceGrid) return; // not initialised yet — initGame will seed it
    const chance = effectivePickupChance(pickupConfig, levelNumber, level.pickupChance, activeModifiers.pickupChanceBonus);
    game.pickupConfig = chance > 0 ? { ...pickupConfig, spawnChance: chance } : null;
  }, [pickupConfig, level, levelNumber, activeModifiers.pickupChanceBonus]);

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
  // Repaint hook exposed for the ability bar's Clear All Fences (which fires
  // synchronously on a button press, outside the game loop's callbacks).
  const repaintRegionCanvasRef = useRef<() => void>(() => {});
  // Short lockout so a rapid double-press can't fire an ability twice off one
  // charge before React re-renders and disables the button.
  const abilityLockoutRef = useRef(0);
  // Latest targeted-ability tap handler, read by the input hook (which is wired
  // once, before the handler is defined below).
  const handleAbilityTargetRef = useRef<((id: string | null, pos: { x: number; y: number } | null) => void) | null>(null);
  // Running time-based abilities, surfaced to the countdown bar. Only changes
  // when an ability fires or expires (not per frame), so no render churn.
  const [abilityTimers, setAbilityTimers] = useState<AbilityTimer[]>([]);
  // A targeted ability (Magnet) armed and waiting for a board tap. Mirrored onto
  // the game ref so the input handler can consume the next tap as the target.
  const [armedAbility, setArmedAbility] = useState<string | null>(null);
  useEffect(() => { gameRef.current.armedAbility = armedAbility; }, [armedAbility]);
  // Treasure-chest reward toast: a brief rising label naming what a smashed
  // chest gave. Keyed so re-triggering restarts the CSS animation.
  const [chestToast, setChestToast] = useState<{ key: number; label: string; color: string } | null>(null);
  const chestToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (chestToastTimer.current) clearTimeout(chestToastTimer.current); }, []);
  const [displayLives, setDisplayLives] = useState(lives);
  const [screenFlash, setScreenFlash] = useState<"none" | "red">("none");
  const [isRecovering, setIsRecovering] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  // Boss ball HUD mirror (issue #56): updated on init and on every boss hit/defeat.
  const [bossHud, setBossHud] = useState({ active: false, hp: 0, maxHp: 0, defeated: false });
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
  // Feature Freeze tap-freezes left this map, mirrored from game.freezeUsesRemaining
  // for the HUD counter (updated on map init and on each freeze spent).
  const [freezeUsesRemaining, setFreezeUsesRemaining] = useState(0);
  const [bonusPulseKey, setBonusPulseKey] = useState(0);
  // Scope Creep: current speed boost in percent, stepped by onCreepStep (~4x/level).
  const [creepPercent, setCreepPercent] = useState(0);
  // Active-play clock mirrored to React at 1Hz (Ship Early countdown bar).
  const [activeSeconds, setActiveSeconds] = useState(0);
  // Balls spawned this map; scales the Ship Early windows (15s per ball).
  const [ballCount, setBallCount] = useState(1);

  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameInitializedRef = useRef(false);
  const initializedLevelRef = useRef<string | null>(null);

  const livesRef = useRef(lives);
  useEffect(() => {
    livesRef.current = lives;
    setDisplayLives(lives);
  }, [lives]);

  // Banked overtime, mirrored for the overtimePercent pickup (#52).
  const totalScoreRef = useRef(totalScore);
  useEffect(() => { totalScoreRef.current = totalScore; }, [totalScore]);

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
    lastCreepPct: -1,
    creepConfig: DEFAULT_SCOPE_CREEP,
    mapMutator: mapMutator ?? null,
    objective: objective ?? null,
    bossFiredPhases: [],
    bossActive: false,
    bossHp: 0,
    bossMaxHp: 0,
    bossDefeated: false,
    bossMinionCount: 0,
    screenSize: { width: 0, height: 0 },
    boardRect: { left: 0, top: 0, width: 0, height: 0, scale: 1 } as BoardRect,
    backgroundColor: "#0a1a10",
    regionColor: "#1a3020",
    wallCount: 0,
    wallShieldsRemaining: 0,
    fastestBallId: null as string | null,
    pushMode: "none" as "none" | "prompt" | "pushing",
    pushPromptPending: false,
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
    superiorLockCount: 0,
    superiorLockBonus: 0,
    moneyMultiplier: 1,
    ballSpeedScale: 1,
    assimilations: new Map<string, LockFlashState>(),
    dissolve: null as DissolveState | null,
    bonusCutCells: new Set<string>(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockBaseThresholdPercent: BALL_WON_REGION_THRESHOLD,
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
    breakMultiplier: 1,
    lastDudAt: 0,
    chestLoot: [] as import("@/types/game").ChestLoot[],
    chestRewardsLog: [] as string[],
    abilitySlowUntil: 0,
    abilitySlowMult: 1,
    abilityFenceRushUntil: 0,
    abilityFenceRushMult: 1,
    abilityFenceShieldUntil: 0,
    abilityFx: [] as import("@/types/game").AbilityFx[],
    pickups: [] as PickupState[],
    pickupConfig: null as PickupConfig | null,
    pickupSpots: [] as Vector2[],
    lastPickupRollAt: 0,
    pickupRollContext: 'pickups',
    pickupRollIndex: 0,
    pickupOvertime: 0,
    pickupCapBonus: 0,
    freezeCharges: 0,
    freezeChargeSeconds: 0,
    freeShopItems: 0,
    pickupsClaimedLog: [] as { effect: PickupEffect; value: number }[],
    freezeUsesRemaining: 0,
    freezePickups: false,
    pickupFeedback: [] as PickupFeedback[],
  });

  useGameInput(canvasRef, gameRef, activeModifiers, setCutCount, setIsPlayerDragging, setFreezeUsesRemaining, handleAbilityTargetRef);

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

    const isPixi = rendererKind === "pixi";
    const ctx = isPixi ? null : canvas.getContext("2d");
    if (!isPixi && !ctx) return;
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    // Pixi renderer: created once per component mount (async chunk, so the
    // 2D path never loads it); level-effect re-runs share the instance. Any
    // failure (chunk load, WebGL context) drops back to canvas2d for the
    // session via the renderer state, which remounts a fresh canvas element.
    if (isPixi && !pixiInitStartedRef.current) {
      pixiInitStartedRef.current = true;
      const fallback = (err: unknown) => {
        console.warn("[renderer] WebGL init failed, falling back to canvas2d:", err);
        try { pixiRef.current?.destroy(); } catch { /* half-initialized app */ }
        pixiRef.current = null;
        pixiInitStartedRef.current = false;
        setRendererKind("canvas2d");
      };
      import("@/lib/rendering/pixi/PixiGameRenderer").then(({ PixiGameRenderer }) => {
        if (pixiRef.current) return;
        const renderer = new PixiGameRenderer();
        pixiRef.current = renderer;
        const size = pixiSizeRef.current ?? { w: canvas.width || 1, h: canvas.height || 1 };
        renderer.init(canvas, size.w, size.h).then(() => {
          const latest = pixiSizeRef.current;
          if (latest && (latest.w !== size.w || latest.h !== size.h)) {
            renderer.resize(latest.w, latest.h);
          }
        }).catch(fallback);
      }).catch(fallback);
    }

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
        // Snap the traced lattice contour onto the walls that bound the pocket,
        // so the tint sits flush with the fence line instead of up to a cell
        // short/past it (the seam the lattice quantization leaves otherwise).
        // The mask stores lock INTENSITY (balls trapped by the sealing cut):
        // the base wash covers every locked pocket, and a second pass over the
        // multi-lock (>= 2) pockets doubles up the accent so a double trap
        // visibly outshines a single one - the visual twin of the x2 payout.
        const traceAtLeast = (min: number) =>
          snapContoursToWalls(
            traceContours(grid, (col, row) => mask[row * gw + col] >= min),
            game.walls,
            grid.cellSize * 1.05,
          );
        const fillLoops = (loops: ContourPoint[][], alpha: number) => {
          if (loops.length === 0) return;
          rCtx.save();
          rCtx.globalCompositeOperation = 'source-atop';
          rCtx.globalAlpha = alpha;
          rCtx.fillStyle = accentColor;
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
          rCtx.fill('evenodd');
          rCtx.restore();
        };
        fillLoops(traceAtLeast(1), canvasOpacity * 0.3);
        fillLoops(traceAtLeast(2), canvasOpacity * 0.35);
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
      // The Pixi renderer wraps these canvases as textures; tell it to re-upload.
      pixiRef.current?.markStaticDirty();
    };
    // Expose the repaint to the ability bar's Clear All Fences handler.
    repaintRegionCanvasRef.current = repaintRegionCanvas;

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
      game.lockWinThresholdPercent = lockWinThresholdPercent + activeModifiers.lockThresholdBonus;
      game.lockBaseThresholdPercent = lockWinThresholdPercent;
      game.lockMinRegionCells = lockMinRegionCells;
      game.fenceDurability = fenceDurability;
      game.pendingWallBreaks = [];
      game.pendingDestroys = [];
      game.objectDebris = [];
      game.fallingObjects = [];
      game.objectivesBroken = 0;
      game.breakBonus = 0;
      game.breakMultiplier = 1;
      game.lastDudAt = 0;
      game.chestLoot = [];
      game.chestRewardsLog = [];
      game.abilitySlowUntil = 0;
      game.abilitySlowMult = 1;
      game.abilityFenceRushUntil = 0;
      game.abilityFenceRushMult = 1;
      game.abilityFenceShieldUntil = 0;
      game.abilityFx = [];
      game.moneyMultiplier = 1;
      game.ballSpeedScale = activeModifiers.ballSpeedMultiplier;
      // Pickups: fresh token state each map. A map-level pickupChance override
      // both replaces the global chance AND bypasses the start_level gate (so a
      // teaching map can guarantee a token, or a set-piece can suppress them).
      game.pickups = [];
      game.pickupFeedback = [];
      game.lastPickupRollAt = 0;
      // Seeded (daily) runs: key spawn rolls by map so every player's roll N
      // draws identically (see updatePickups).
      game.pickupRollContext = `pickups:${level.id}`;
      game.pickupRollIndex = 0;
      game.pickupOvertime = 0;
      game.pickupCapBonus = 0;
      game.freezeCharges = 0;
      game.freezeChargeSeconds = 0;
      game.freeShopItems = 0;
      game.pickupsClaimedLog = [];
      // Feature Freeze tap-freezes refill to the owned per-map allowance.
      game.freezeUsesRemaining = Math.max(0, Math.round(activeModifiers.freezeUsesPerMap));
      setFreezeUsesRemaining(game.freezeUsesRemaining);
      // Cryo Protocol: freeze pickup tokens so they never expire this run.
      game.freezePickups = activeModifiers.freezePickups > 0;
      game.pickupSpots = (level.pickupSpots ?? []).map(s => ({ x: s.x, y: s.y }));
      {
        const chance = effectivePickupChance(pickupConfig, levelNumber, level.pickupChance, activeModifiers.pickupChanceBonus);
        game.pickupConfig = chance > 0 ? { ...pickupConfig, spawnChance: chance } : null;
      }
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
      // Boss ball (issue #56): seed the fight/HUD state from the freshly built map.
      game.bossActive         = data.bossActive;
      game.bossHp             = data.bossHp;
      game.bossMaxHp          = data.bossMaxHp;
      game.bossDefeated       = false;
      game.bossMinionCount    = 0;
      setBossHud({ active: data.bossActive, hp: data.bossHp, maxHp: data.bossMaxHp, defeated: false });
      // Cold Boot: the map boots frozen, all balls hold still for a planning
      // beat. Same frozenUntil path as tap-freeze; freezeReadyAt is left unset
      // so the spawn thaw carries no re-freeze cooldown.
      if (activeModifiers.spawnFreezeSeconds > 0) {
        const thaw = performance.now() + activeModifiers.spawnFreezeSeconds * 1000;
        for (const ball of game.balls) ball.frozenUntil = thaw;
      }
      removedSamples = [];
      removedSamplesSet = new Set();
      repaintRegionCanvas();
      game.activeWall = null;
      game.gameOver = false;
      game.levelComplete = false;
      game.pushPromptPending = false;
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
      game.lastCreepPct = -1;
      game.creepConfig = scopeCreep ?? DEFAULT_SCOPE_CREEP;
      game.mapMutator = mapMutator ?? null;
      game.objective = objective ?? null;
      game.bossFiredPhases = [];
      setCreepPercent(0);
      setActiveSeconds(0);
      setAbilityTimers([]);
      setArmedAbility(null);
      game.armedAbility = null;
      game.magnetMarker = undefined;
      setBallCount(game.balls.length || 1);
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
      // Pixi renders at native device resolution (3x sanity cap saturates any
      // panel); the 2D path keeps its capped + adaptive DPR.
      const dpr = isPixi ? Math.min(window.devicePixelRatio || 1, 3) : getDevicePixelRatio();
      const physW = Math.round(width * dpr);
      const physH = Math.round(height * dpr);
      pixiSizeRef.current = { w: physW, h: physH };
      if (isPixi && pixiRef.current?.isReady) {
        // The WebGL renderer manages canvas.width/height itself.
        pixiRef.current.resize(physW, physH);
      } else {
        canvas.width = physW; canvas.height = physH;
      }
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      game.screenSize = { width: physW, height: physH };
      game.boardRect = computeBoardRect(physW, physH);
      clearBallRenderCache();
      clearBallSphereCache();
      clearRainGlyphCache();
      clearBallEffectsCache();
      clearPickupSpriteCache(); // token bakes are scale-keyed
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
      superiorLockLabel: t('game.superiorLock'),
      pickupLabels: {
        fork: t('game.pickupFork'),
        capRaise: t('game.pickupCapRaise'),
        freezeCharge: t('game.pickupFreeze'),
        freeShopItem: t('game.pickupFreeShopItem'),
        extraLife: t('game.pickupExtraLife'),
        rainbowConvert: t('game.pickupRainbow'),
      },
    };
    // Run-intro hold (Pixi): between the renderer becoming ready and
    // startAssemble installing the reverse dissolve, the game loop would
    // present normal full-scene frames — the complete board flashed for a
    // frame or two before collapsing in. While this is set, render() presents
    // nothing; startAssemble clears it, making the assemble the renderer's
    // first visible frame. (The 2D path starts its assemble synchronously
    // before any frame, so it never needs the hold.)
    let introHold = false;

    // One-shot "board is now visible" signal, so the shell can fade its
    // "Loading..." overlay out exactly as the canvas starts presenting.
    let readyTimer: number | undefined;
    let readySignaled = false;
    const signalCanvasReady = () => {
      if (readySignaled) return;
      readySignaled = true;
      onCanvasReadyRef.current?.();
    };

    const render = () => {
      rctx.showBallSpeeds = showBallSpeedsRef.current;
      rctx.showPerfOverlay = showPerfOverlayRef.current;
      if (!ctx) {
        if (introHold && !game.dissolve) return;
        // Pixi path — a no-op until the async init lands (a few skipped frames).
        pixiRef.current?.render(game, rctx);
        return;
      }
      renderFrame(ctx, game, rctx);
      // Perf HUD drawn after renderFrame (which returns early on normal frames),
      // so it always lands on top. Its cost counts toward the measured render ms.
      if (showPerfOverlayRef.current) drawPerfOverlay(ctx, game);
    };

    const buildDissolveTiles = (W: number, H: number): DissolveTile[] => {
      const TILE = 28;
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
      return tiles;
    };

    const startDissolve = (onComplete: () => void, tint?: string) => {
      const W = canvas.width, H = canvas.height;
      const captured = document.createElement('canvas');
      captured.width = W; captured.height = H;
      if (isPixi) {
        // GPU-side snapshot: drawImage(webglCanvas) is a synchronous full-frame
        // readback — a visible hitch right when the shatter should start.
        pixiRef.current?.captureForDissolve(tint);
      } else {
        const cctx = captured.getContext('2d')!;
        cctx.drawImage(canvas, 0, 0);
        if (tint) { cctx.fillStyle = tint; cctx.fillRect(0, 0, W, H); }
      }
      game.dissolve = { captured, tiles: buildDissolveTiles(W, H), startTime: performance.now(), onComplete };
      startGameLoop(game);
    };
    startDissolveRef.current = startDissolve;

    // Run-start intro: the exact reverse of startDissolve. The map's first
    // frame is painted OFF-SCREEN (never presented), cut into the same
    // shatter tiles, and flown IN — the board assembles over the scrolling
    // background code instead of popping into place. Physics is held while
    // game.dissolve is set, so play begins when the last tile lands.
    // The capture always uses the 2D renderer (a parity port of the Pixi
    // scene): under Pixi the tiles then ride the DissolveLayer's CanvasSource
    // fallback, keeping the GPU snapshot machinery out of the very first
    // frames of a fresh WebGL context.
    const startAssemble = () => {
      // Lift the pre-assemble hold: from here on game.dissolve carries the
      // intro, and after it completes normal frames should present again.
      introHold = false;
      const W = canvas.width, H = canvas.height;
      const captured = document.createElement('canvas');
      captured.width = W; captured.height = H;
      const cctx = captured.getContext('2d');
      if (cctx) renderFrame(cctx, game, rctx);
      game.dissolve = {
        captured, tiles: buildDissolveTiles(W, H),
        // Start a beat in the FUTURE: the game screen slides in for ~280ms
        // (Index's framer-motion transition), and shards that fly during the
        // slide are never seen. The negative-elapsed window renders nothing
        // (tiles at full scatter, alpha clamped to 0), then the assemble
        // plays in full view.
        startTime: performance.now() + 450,
        reverse: true, onComplete: () => startGameLoop(game),
      };
      startGameLoop(game);
      // Fade the shell's "Loading..." overlay out just as the first tiles fly
      // in (at dissolve.startTime), so the wait is covered end to end.
      readyTimer = window.setTimeout(signalCanvasReady, Math.max(0, game.dissolve.startTime - performance.now()));
    };

    // Build callbacks object for extracted physics functions
    const callbacks: GameCallbacks = {
      setLockedBallsCount,
      onBossState: (hp: number, maxHp: number, defeated: boolean) => setBossHud({ active: !defeated, hp, maxHp, defeated }),
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
      // Fork pickup split a ball: rescale the Ship Early countdown windows.
      onBallCountChanged: setBallCount,
      getLives: () => livesRef.current,
      setLivesRef: n => { livesRef.current = n; },
      getBankedOvertime: () => totalScoreRef.current,
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
      processDestroys: () => {
        processDestroysFn(game, {
          repaintRegionCanvas,
          setRemainingPercent,
          onObjectDestroyed: () => { playFenceBreakSound(); vibrateFenceBreak(); },
          // A chest was smashed: the player earns one charge of the rolled
          // ability. Bank it run-wide in the session, and show a brief toast.
          onChestReward: (rewardId) => {
            playPickupClaimedSound();
            onGrantAbility?.(rewardId);
            const def = getAbility(rewardId);
            setChestToast({ key: performance.now(), label: def?.name ?? rewardId, color: def?.color ?? '#ffd76b' });
            if (chestToastTimer.current) clearTimeout(chestToastTimer.current);
            chestToastTimer.current = setTimeout(() => setChestToast(null), 1700);
          },
        }, levelNumber);
        // A destroy can capture pocket cells (destroy-recapture) and take the
        // remaining space past the goal with no fence involved — run the same
        // win check a completed cut runs, or the map shows CLEAR but never ends.
        checkSpaceWin(game, level, callbacks);
      },
      // Per-frame safety net (see useGameLoop): guarantees a cleared map always
      // finishes even if the space reached the goal by a path that didn't run
      // the win check, so the top bar can never stall showing CLEAR.
      checkWinCondition: () =>
        evaluateWinConditions(game, level, levelNumber, activeModifiers, callbacks),
      spawnTimedBalls: () => { tickRainbowSpawns(game, levelNumber); tickBossPhases(game, level, levelNumber); tickBossSpit(game, level); },
      onCreepStep: setCreepPercent,
      onActiveSecond: setActiveSeconds,
      // Deferred push prompt: the loop already set game.pushMode; mirror it
      // into React so the modal mounts.
      onPushPrompt: () => setPushMode("prompt"),
      renderEmpty: () => pixiRef.current?.presentEmpty(),
    };
    const gameLoop = createGameLoop(game, canvas, ctx, parallaxTickRef, gameLoopCallbacks, activeModifiers.autoFreezeDuration, activeModifiers.freezeNoCooldown);
    game.gameLoopFn = gameLoop;

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    let disposed = false;
    if (introPendingRef.current) {
      introPendingRef.current = false;
      if (!isPixi) {
        startAssemble(); // captures off-screen and starts the loop itself
      } else {
        // Pixi inits async: keep the loop (and the parallax background)
        // running while it loads — render() no-ops until ready — then let the
        // assemble be the renderer's first ever presented frame. The hold
        // covers the frames between init landing and startAssemble below (the
        // loop runs first in each rAF batch and would flash the full board).
        introHold = true;
        startGameLoop(game);
        const waitForRenderer = () => {
          if (disposed || game.dissolve) return;
          if (pixiRef.current?.isReady) { startAssemble(); return; }
          // A WebGL init failure re-runs this effect as canvas2d (no intro).
          requestAnimationFrame(waitForRenderer);
        };
        requestAnimationFrame(waitForRenderer);
      }
    } else {
      startGameLoop(game);
      signalCanvasReady(); // normal start: board is visible on the first frame
    }

    // Once the level has run long enough for the perf window to fill, try (once)
    // to ramp the render resolution up if the device has frame-time headroom.
    // Poll for a few seconds while the window fills, then give up. resizeCanvas
    // re-applies the raised DPR ceiling. Pixi already renders at native DPR, so
    // the ramp (whose cost model is 2D-fill-bound) is skipped entirely there.
    let dprRampInterval: number | undefined;
    if (!isPixi) {
      let dprRampChecks = 0;
      dprRampInterval = window.setInterval(() => {
        dprRampChecks++;
        if (maybeRampDpr(resizeCanvas) || dprRampChecks >= 8) {
          window.clearInterval(dprRampInterval);
        }
      }, 1000);
    }

    return () => {
      disposed = true;
      window.removeEventListener("resize", resizeCanvas);
      if (dprRampInterval !== undefined) window.clearInterval(dprRampInterval);
      if (readyTimer !== undefined) window.clearTimeout(readyTimer);
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
      clearPickupSpriteCache();
      clearRenderFrameCache();
    };
  }, [level, levelNumber, activeModifiers, fenceDurability, rendererKind]);

  // The Pixi renderer survives level changes (the effect above re-runs per
  // level); the GPU context is torn down only when the component unmounts.
  useEffect(() => () => {
    pixiRef.current?.destroy();
    pixiRef.current = null;
    pixiInitStartedRef.current = false;
  }, []);

  const handleBankAndContinue = useCallback(() => {
    const game = gameRef.current;
    // Locking the last ball mid-push completes the level via the per-frame win
    // check while the Bank button is still on screen; a tap then must not queue
    // a SECOND dissolve -> onLevelComplete pipeline (the duplicate resurrected
    // the level-complete overlay over the next screen and could re-run the
    // assignment phase - seen in the wild as two Promotion drafts in a row).
    if (game.levelComplete) return;
    game.levelComplete = true;
    game.levelCompleteTime = performance.now(); // anchors the space bar fade-out
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
    // never counts against it (disabled on the tutorial band, levels 1-3).
    const shipEarlyBonus = isTimingExempt(levelNumber)
      ? 0
      : getShipEarlyBonus(game.clearedActiveSeconds, game.balls.length, activeModifiers.shipEarlySecondsPerBall, activeModifiers.shipEarlyBonusMultiplier);
    // Fold lock + push + ship-early bonuses in before the cap (issue #43).
    // Previously this site added lockBonus + pushBonus AFTER calculateScore,
    // letting a banked push exceed the per-map ceiling every other path enforces.
    const { levelScore, breakdown } = calculateScore(
      game.wallCount, level.expectedCuts, game.bestRemainingPercent, level.sizeThreshold, level.points, {
        scoreMultiplier: activeModifiers.scoreMultiplier,
        extraBonus: game.lockBonus + game.breakBonus + pushBonus + shipEarlyBonus,
        spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
        // Comp Time pickups raise THIS map's cap; overtime pickups pay after it.
        overtimeCapBonus: activeModifiers.overtimeCapBonus + game.pickupCapBonus,
        postCapBonus: game.pickupOvertime,
        // Demolition multiplier: chests/breakables smashed before the push.
        payoutMultiplier: game.breakMultiplier ?? 1,
      },
    );

    // Same post-sweep beat as applyCut: hold the drained board, shatter it,
    // then mount the completion overlay.
    setTimeout(() => {
      startDissolveRef.current?.(() => {
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
          superiorLockCount: game.superiorLockCount, superiorLockBonus: game.superiorLockBonus,
          shipEarlyBonus, clearTimeSeconds: game.clearedActiveSeconds ?? undefined,
          breakBonus: game.breakBonus, breakMultiplier: game.breakMultiplier,
          pickupBonus: game.pickupOvertime || undefined,
          pickupsClaimed: game.pickupsClaimedLog.length > 0 ? [...game.pickupsClaimedLog] : undefined,
          chestRewards: (game.chestRewardsLog && game.chestRewardsLog.length > 0) ? [...game.chestRewardsLog] : undefined,
          freeShopItemsEarned: game.freeShopItems || undefined,
        });
      });
    }, 150 + LEVEL_CLEAR_SHIMMER_MS + LEVEL_CLEAR_HOLD_MS);
  }, [level, levelNumber, activeModifiers]);

  // Ability bar (#38): fire the pressed ability on the live game and spend one
  // banked charge in the session. The button is disabled at 0 charges; the
  // lockout guards a rapid double-press from firing twice off one charge.
  const handleUseAbility = useCallback((abilityId: string) => {
    const now = performance.now();
    if (now - abilityLockoutRef.current < 250) return;
    const game = gameRef.current;
    // Targeted abilities (Magnet) arm on tap and wait for a board tap; re-tapping
    // the armed ability cancels. The charge is spent when the target is picked.
    if (getAbility(abilityId)?.targeted) {
      setArmedAbility(prev => (prev === abilityId ? null : abilityId));
      return;
    }
    const fired = fireAbility(abilityId, game, now, {
      repaintRegionCanvas: () => repaintRegionCanvasRef.current(),
      setRemainingPercent,
      fenceColor: accentColor,
    });
    if (!fired) return;
    abilityLockoutRef.current = now;
    onSpendAbility?.(abilityId);
    // Time-based abilities (those with a duration) get a countdown-bar timer,
    // keyed by kind so re-firing the same one resets its window. Wall-clock so
    // the bar drains to exactly zero when the effect ends; a per-timer timeout
    // removes it right then (no 1Hz cull lag).
    const def = getAbility(abilityId);
    if (def && def.durationSeconds && def.durationSeconds > 0) {
      const durationMs = def.durationSeconds * 1000;
      const endMs = now + durationMs;
      const timer: AbilityTimer = { kind: def.kind, name: def.name, color: def.color, endMs, durationMs };
      setAbilityTimers(prev => [...prev.filter(t => t.kind !== def.kind), timer]);
      window.setTimeout(() => {
        setAbilityTimers(prev => prev.filter(t => !(t.kind === def.kind && t.endMs === endMs)));
      }, durationMs);
    }
  }, [onSpendAbility, accentColor]);

  // A board tap while a targeted ability is armed (Magnet): fire it at the point
  // and spend the charge; a tap outside the board (id/pos null) just cancels.
  const handleAbilityTarget = useCallback((abilityId: string | null, worldPos: { x: number; y: number } | null) => {
    setArmedAbility(null);
    gameRef.current.armedAbility = null;
    if (!abilityId || !worldPos) return;
    const fired = fireTargetedAbility(abilityId, gameRef.current, performance.now(), worldPos);
    if (fired) onSpendAbility?.(abilityId);
  }, [onSpendAbility]);
  useEffect(() => { handleAbilityTargetRef.current = handleAbilityTarget; }, [handleAbilityTarget]);

  useEffect(() => {
    if (onGameStateChange) {
      onGameStateChange({
        cutsUsed: cutCount,
        spaceRemaining: remainingPercent,
        lockedBalls: lockedBallsCount,
        // Superior locks change only when a ball locks, which also bumps
        // lockedBallsCount (an effect dep), so reading the live ref here stays fresh.
        superiorLocks: gameRef.current.superiorLockCount,
        bossActive: bossHud.active,
        bossHp: bossHud.hp,
        bossMaxHp: bossHud.maxHp,
        bossDefeated: bossHud.defeated,
        freezeUsesRemaining,
        pushMode,
        creepPercent,
        activeSeconds,
        ballCount,
        onBankAndContinue: handleBankAndContinue,
        onUseAbility: handleUseAbility,
        abilityTimers,
        armedAbility,
      });
    }
  }, [cutCount, remainingPercent, pushMode, creepPercent, activeSeconds, ballCount, handleBankAndContinue, handleUseAbility, onGameStateChange, lockedBallsCount, freezeUsesRemaining, bossHud, abilityTimers, armedAbility]);

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
        <canvas key={rendererKind} ref={canvasRef} className="absolute inset-0 touch-none cursor-crosshair" style={{ zIndex: 2 }} />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 3, opacity: 1 }}
        />
        {chestToast && (
          <div
            key={chestToast.key}
            className="absolute left-1/2 top-[18%] z-40 pointer-events-none animate-chest-toast whitespace-nowrap font-mono font-bold text-sm sm:text-base px-3 py-1.5 rounded-md"
            style={{
              color: chestToast.color,
              background: 'rgba(10,14,20,0.72)',
              border: `1px solid ${chestToast.color}`,
              boxShadow: `0 0 14px ${chestToast.color}66`,
            }}
          >
            {chestToast.label}
          </div>
        )}
        {armedAbility && (
          <div
            className="absolute left-1/2 top-[12%] -translate-x-1/2 z-40 pointer-events-none whitespace-nowrap font-mono font-bold text-xs sm:text-sm px-3 py-1.5 rounded-md animate-pulse"
            style={{
              color: getAbility(armedAbility)?.color ?? '#b98cff',
              background: 'rgba(10,14,20,0.8)',
              border: `1px solid ${getAbility(armedAbility)?.color ?? '#b98cff'}`,
            }}
          >
            Tap the board to attract balls
          </div>
        )}
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
