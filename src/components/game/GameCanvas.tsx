/**
 * GameCanvas — the playable game board.
 *
 * Bridges React and the imperative game world: all per-frame state lives in
 * a mutable CanvasGameState ref (src/types/gameState.ts), driven by a
 * fixed-timestep loop (src/hooks/useGameLoop.ts) and drawn by
 * src/lib/rendering/sleek/. React state here is only for UI-visible
 * values (lives, cut count, flashes).
 *
 * Subsystem entry points:
 *   - input:     src/hooks/useGameInput.ts (pointer → fence cuts)
 *   - physics:   src/lib/physics/* (ball movement, fence growth, cuts)
 *   - level init src/lib/initGame.ts (board, obstacles, balls, regions)
 *   - rendering: src/lib/rendering/sleek/SleekRenderer.ts
 */
import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Ball, GrowingWall, Vector2, GameResult, Region, LevelScoreData } from "@/types/game";
import { pendingLauncher, fireLauncher, type LauncherState } from "@/lib/physics/launcher";
import { launchAim, type LaunchAim } from "@/lib/launcher";
import { LaunchOverlay } from "@/components/game/LaunchOverlay";
import type { MapFailure } from "@/lib/mapFailure";
import { LevelConfig } from "@/types/level";

import { GameModifiers } from "@/hooks/useActiveModifiers";
import { clearBallRenderCache } from "@/lib/ballRenderCache";
import { clearBallSphereCache } from "@/lib/ballSphereCache";
import { clearRainGlyphCache } from "@/lib/rendering/rainGlyphCache";
import { clearBallEffectsCache } from "@/lib/ballEffects";
import { renderFallbackBoard } from "@/lib/rendering/fallbackBoard";
import { clearPickupSpriteCache } from "@/lib/rendering/pickupSprites";
import { effectivePickupChance } from "@/lib/pickups";
import { getAbility } from "@/lib/abilities";
import { fireAbility, fireTargetedAbility } from "@/lib/abilityEffects";
import { drawPerfOverlay, recordSurface, isPerfHudEnabled } from "@/lib/rendering/perfStats";
import { PerfOverlay } from "./PerfOverlay";
import { RenderContext, RainState } from "@/lib/rendering/types";
import { calculateScore, ensureScoringConfigLoaded, getShipEarlyPercent } from "@/lib/scoring";
import { raiseMessage, type GameMessage, type GameMessageId } from "@/lib/gameMessages";
import { readLockAxes } from "@/lib/lockCapacity";
import { isTimingExempt, getMapTimeLimit } from "@/lib/mapTiming";
import { tickRainbowSpawns } from "@/lib/physics/rainbowSpawner";
import { tickBossPhases, tickBossSpit, tickBossFenceWipe } from "@/lib/physics/bossPhases";
import { clearAllFences } from "@/lib/abilityEffects";
import { tickMapBeats, type BeatEffectLine } from "@/lib/physics/mapBeats";
import { PushYourLuckOverlay } from "./PushYourLuckOverlay";
import type { BoardEntityHit } from "@/lib/boardEntityInfo";
import { LockExplainerModal } from "./LockExplainerModal";
import { AbilityIcon } from "./AbilityIcon";
import { InteractiveTutorialOverlay } from "./InteractiveTutorialOverlay";
import { circuitHintTarget, circuitHintGesture, type HintTerminal } from "@/lib/circuitHint";
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
  computeBallTrajectory,
} from "@/lib/gameUtils";
import { Wall, WALL_THICKNESS } from "@/lib/wallGeometry";
import { rotatePoint, rotateColoredArea, rotateGravityWell } from "@/lib/mapRotation";
import { fileManualEntry } from "@/lib/manual";
import {
  registerWallImpact,
  clearWallImpacts,
  clearObstacleImpacts
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
import { normaliseGravity } from "@/lib/physics/gravity";
import { ActiveMapObjective } from "@/types/objective";
import { createInitialGameData } from "@/lib/initGame";
import { useGameInput } from "@/hooks/useGameInput";
import { createGameLoop, GameLoopCallbacks } from "@/hooks/useGameLoop";
import type { BoardRenderer } from "@/lib/rendering/boardRenderer";
import { GameCallbacks } from "@/lib/physics/gameCallbacks";
import { applyCutFn, checkSpaceWin, evaluateWinConditions } from "@/lib/physics/applyCut";
import { updateFenceWallFn, clearFreeze } from "@/lib/physics/updateFenceWall";
import { processWallBreaksFn } from "@/lib/physics/breakFenceWall";
import { processDestroysFn } from "@/lib/physics/destructibles";
import { pushBonusEarned } from "@/lib/pushLuck";
import { extraGates } from "@/lib/winHud";
import { resolveWinSpec } from "@/lib/winSpec";
import { readWinSnapshot } from "@/lib/physics/applyCut";
import type { WinConditionProgress } from "@/types/winSpec";
import { missedAreaShare } from "@/lib/coloredAreaShare";

export interface GameStateInfo {
  cutsUsed: number;
  /** Completed fences (successful partitions) this map, for the fence-budget HUD. */
  completedCuts: number;
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
  /** True once a power-up has appeared this map, for the one-time explainer (#59). */
  pickupPresent: boolean;
  onBankAndContinue?: () => void;
  /**
   * Hours a push has earned so far, for the exit button's readout. Computed
   * with the same pushBonusEarned the payout uses, so the number on the button
   * is the number that gets banked.
   */
  pushBonusSoFar: number;
  /**
   * The map's unusual win requirements with live progress, for the top-bar
   * chips and the board frame. Empty on an ordinary space-and-locks map.
   * Read through the same evaluator the win check uses, so a chip cannot claim
   * a requirement the gate disagrees with.
   */
  winGates: WinConditionProgress[];
  /** The one live feedback message, or null. See lib/gameMessages. */
  gameMessage?: GameMessage | null;
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
  /** Run-wide banked charges, mirrored onto the game so the chest roll can
   *  honour the slot cap from inside the physics step. */
  abilityCharges?: Record<string, number>;
  /** Distinct abilities holdable at once. */
  abilitySlots?: number;
  /** The player spent one ability charge (pressed the ability button). */
  onSpendAbility?: (abilityId: string) => void;
  /** Press-and-hold on a superior-lock star: open the lock explainer modal. */
  onRequestSuperiorInfo?: () => void;
  /** Press-and-hold on a board object: opens its explainer (owned by GameScreen
   *  so it can pause the map while it is open). */
  onRequestEntityInfo?: (hit: BoardEntityHit) => void;
  onGameEnd: (result: GameResult) => void;
  /** Out of time with lives to spare: the session should restart this level. */
  onMapTimedOut?: (failure: MapFailure) => void;
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
  moverFenceDragPerFence?: number;
  moverFenceDragFloor?: number;
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
  /**
   * The board's top edge, as a percentage of this canvas's height.
   *
   * Only this component knows it: the board is square and centred in a taller
   * frame, so how much gutter sits above it depends on the surface size. Sent
   * up so GameScreen can place the map-rule banner in the middle of that
   * gutter instead of guessing. Fires on resize, not per frame.
   */
  onBoardTopPct?: (pct: number) => void;
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

// Countdown color bands -> time-pressure tiers, matching ShipEarlyBar's green ->
// red drain: tier 0 fresh (>66% left), 1 yellow, 2 orange, 3 red (<=15% left).
// Each downward crossing fires a crunch-style toast (i18n keys, index by tier).
const TIME_TIER_ANNOUNCE: readonly (string | null)[] = [null, 'game.timeTier1', 'game.timeTier2', 'game.timeTier3'];
function timeTierFor(remainingFraction: number): number {
  if (remainingFraction > 0.66) return 0;
  if (remainingFraction > 0.33) return 1;
  if (remainingFraction > 0.15) return 2;
  return 3;
}

export function GameCanvas({
  level,
  levelNumber,
  totalLevels,
  totalScore,
  lives,
  onLivesChange,
  onGrantAbility,
  abilityCharges,
  abilitySlots,
  onSpendAbility,
  onRequestSuperiorInfo,
  onRequestEntityInfo,
  onGameEnd,
  onMapTimedOut,
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
  moverFenceDragPerFence = 0.45,
  moverFenceDragFloor = 0.3,
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
  onBoardTopPct,
}: GameCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The board is drawn by the sleek WebGL renderer. This flag flips to true
  // ONLY if its init fails (old WebView, blocklisted GPU); the state change
  // remounts the canvas element (key below) so the emergency 2D board gets a
  // fresh, contextless canvas — one that has had a WebGL context cannot hand
  // out a 2D one.
  const [useFallback2d, setUseFallback2d] = useState(false);
  const pixiRef = useRef<BoardRenderer | null>(null);
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
  const onMapTimedOutRef = useRef(onMapTimedOut);
  useEffect(() => { onMapTimedOutRef.current = onMapTimedOut; }, [onMapTimedOut]);
  const onBallTypeLockedRef = useRef(onBallTypeLocked);
  useEffect(() => { onBallTypeLockedRef.current = onBallTypeLocked; }, [onBallTypeLocked]);
  const onCanvasReadyRef = useRef(onCanvasReady);
  useEffect(() => { onCanvasReadyRef.current = onCanvasReady; }, [onCanvasReady]);
  const onBoardTopPctRef = useRef(onBoardTopPct);
  useEffect(() => { onBoardTopPctRef.current = onBoardTopPct; }, [onBoardTopPct]);
  // Live ref so toggling the speed-label overlay takes effect without restarting
  // the render loop (the rctx is rebuilt only per level).
  const showBallSpeedsRef = useRef(showBallSpeeds);
  useEffect(() => { showBallSpeedsRef.current = showBallSpeeds; }, [showBallSpeeds]);
  // Read once per mount: flipped in the admin screen, which can only be reached
  // by leaving the game, so it cannot change mid-map.
  const [perfHudPersisted] = useState(isPerfHudEnabled);
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
    gameRef.current.moverFenceDragPerFence = moverFenceDragPerFence;
    gameRef.current.moverFenceDragFloor = moverFenceDragFloor;
  }, [lockWinThresholdPercent, lockMinRegionCells, activeModifiers.lockThresholdBonus,
      moverFenceDragPerFence, moverFenceDragFloor]);
  // Same live-config treatment for the Scope Creep tuning.
  // Mirror the banked ability charges onto the game so the chest roll can honour
  // the slot cap. Live rather than set once at map init, because a chest smashed
  // mid-map changes what is held and the very next chest must see it.
  useEffect(() => {
    gameRef.current.heldAbilityIds = Object.entries(abilityCharges ?? {})
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([id]) => id);
    gameRef.current.abilitySlots = abilitySlots;
  }, [abilityCharges, abilitySlots]);

  useEffect(() => {
    if (scopeCreep) gameRef.current.creepConfig = scopeCreep;
  }, [scopeCreep]);
  // Per-map mutator: keep the live game in sync with the roll (also set at init
  // and per-map reset). Changing map remounts/rerolls, so this is belt-and-braces.
  useEffect(() => {
    gameRef.current.mapMutator = mapMutator ?? null;
    gameRef.current.gravityConfig = mapMutator?.behavior === "gravity"
      ? normaliseGravity(mapMutator.gravity) : null;
  }, [mapMutator]);
  // The map's authored light. Lives on the game state rather than being read
  // from the level inside the renderer, so the renderer keeps taking one object
  // and nothing has to thread a LevelConfig down through the layers.
  useEffect(() => {
    gameRef.current.mapLight = level.light;
  }, [level]);
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

  /**
   * The cup still holding its ball, mirrored into React so the overlay can
   * mount. Null on every map without a launcher.
   *
   * While this is set the board is HELD: the aim happens on a frozen map, so
   * the Tempo clock is not running while the player lines up a shot and the
   * other balls are not free to wander into a position the preview never
   * predicted. That is the same treatment the explainer modals get, and it is
   * why the launch is a decision rather than a race.
   */
  const [pendingLaunch, setPendingLaunch] = useState<LauncherState | null>(null);

  useEffect(() => {
    const game = gameRef.current;
    // Mirror onto the ref FIRST (before any early return): the loop body reads
    // game.paused to self-halt, which covers the case where the intro assemble
    // starts the loop after this effect has already run for the initial mount.
    // A loaded cup holds the board exactly as a modal does. Folded in here
    // rather than bolted on at the call site so there is ONE expression that
    // decides whether the map is running.
    game.paused = paused || !!pendingLaunch;
    if (!game.gameLoopFn || game.gameOver || game.levelComplete) return;
    if (game.paused) {
      // A LAUNCHER hold keeps the loop turning; a modal stops it dead.
      //
      // Both hold physics - the loop's own `paused` guard returns before the
      // step either way - but they differ in what the player is looking at. A
      // modal covers the board, so there is nothing to draw. The launcher does
      // not: the board IS the thing being aimed at, and stopping the loop here
      // stopped it before the map's first paint, leaving the band, the aim cone
      // and the loaded balls hanging over the page background with no board
      // underneath them.
      if (pendingLaunch && !paused) startGameLoop(game);
      else stopGameLoop(game);
      // Drop any in-progress swipe so a drag can't resume mid-gesture
      game.swipeStart = null;
      game.swipeRegionId = null;
      game.currentSwipePos = null;
      game.swipePointerId = null;
    } else {
      game.lastTime = 0; // reset to avoid a dt spike on the first resumed frame
      // A run-intro assemble armed while paused (e.g. behind the "How to win"
      // modal) has a wall-clock startTime that elapsed during the pause, so it
      // would snap instead of flying in. Rebase a still-pending assemble
      // (game.dissolve is nulled on completion) to now, so it dissolves in fresh
      // when the modal is dismissed.
      if (game.dissolve && game.dissolve.reverse) {
        game.dissolve.startTime = performance.now();
      }
      startGameLoop(game);
    }
  }, [paused, pendingLaunch]);

  // Pick the cup up off the freshly built board. Runs on every level change,
  // so a retry re-arms the plunger rather than starting an unfired map moving.
  useEffect(() => {
    setPendingLaunch(pendingLauncher(gameRef.current));
  }, [level.id, levelNumber]);

  const [remainingPercent, setRemainingPercent] = useState(100);
  const [cutCount, setCutCount] = useState(0);
  const [completedCuts, setCompletedCuts] = useState(0);
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
  // Superior-lock-star hold handler (opens the explainer), read by the input hook.
  const handleSuperiorInfoRef = useRef<(() => void) | null>(null);
  const handleEntityInfoRef = useRef<((hit: BoardEntityHit) => void) | null>(null);
  // Chest loot-gem tap handler (collects the reward), read by the input hook.
  const handleLootCollectRef = useRef<((rewardId: string) => void) | null>(null);
  // White ball tapped away (#57): pop + ball-count sync, read by the input hook.
  const handleTapRemoveRef = useRef<((info: { x: number; y: number; color: string }) => void) | null>(null);
  // Running time-based abilities, surfaced to the countdown bar. Only changes
  // when an ability fires or expires (not per frame), so no render churn.
  const [abilityTimers, setAbilityTimers] = useState<AbilityTimer[]>([]);
  // A targeted ability (Magnet) armed and waiting for a board tap. Mirrored onto
  // the game ref so the input handler can consume the next tap as the target.
  const [armedAbility, setArmedAbility] = useState<string | null>(null);
  useEffect(() => { gameRef.current.armedAbility = armedAbility; }, [armedAbility]);
  // A fading icon shown at the board centre when a (non-targeted) ability fires.
  const [abilityIconFx, setAbilityIconFx] = useState<{ key: number; kind: string; color: string; xPct: number; yPct: number } | null>(null);
  const abilityIconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (abilityIconTimer.current) clearTimeout(abilityIconTimer.current); }, []);
  // Treasure-chest reward toast: a brief rising label naming what a smashed
  // chest gave. Keyed so re-triggering restarts the CSS animation.
  const [chestToast, setChestToast] = useState<{ key: number; label: string; color: string } | null>(null);
  const chestToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (chestToastTimer.current) clearTimeout(chestToastTimer.current); }, []);
  // Map-beat telegraph banner (LEVELDESIGN.md Turn): a warning shown ahead of a
  // beat firing so the player is not ambushed. `announce` is an i18n key.
  const [beatBanner, setBeatBanner] = useState<
    { key: number; announce: string; effects?: BeatEffectLine[] } | null
  >(null);
  const beatBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (beatBannerTimer.current) clearTimeout(beatBannerTimer.current); }, []);
  // Highest time-pressure tier reached this map (0 fresh .. 3 final), so each
  // downward crossing of a countdown color band toasts exactly once (#timeTier).
  const lastTimeTierRef = useRef(0);
  const [displayLives, setDisplayLives] = useState(lives);
  const [screenFlash, setScreenFlash] = useState<"none" | "red">("none");
  const [isRecovering, setIsRecovering] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  // False while the run-intro assemble is still flying the board in; flipped
  // true when the board has fully materialized (so the tutorial overlay waits
  // for it). A normal start has no assemble, so it's materialized immediately.
  const [boardMaterialized, setBoardMaterialized] = useState(!introAssemble);
  // Safety net: never leave the tutorial hidden if the assemble's onComplete
  // doesn't fire (e.g. a renderer hiccup). The assemble lands well under 3s.
  useEffect(() => {
    if (boardMaterialized) return;
    const id = window.setTimeout(() => setBoardMaterialized(true), 3000);
    return () => window.clearTimeout(id);
  }, [boardMaterialized]);
  // Boss ball HUD mirror (issue #56): updated on init and on every boss hit/defeat.
  const [bossHud, setBossHud] = useState({ active: false, hp: 0, maxHp: 0, defeated: false });
  const [isPlayerDragging, setIsPlayerDragging] = useState(false);

  /**
   * The circuit nudge: after a while on a map with an unlit terminal, draw the
   * gesture that lights one instead of leaving the player to guess.
   *
   * Polled rather than driven from the physics loop. The decision changes at
   * most twice a map - once when the delay elapses, once when a terminal
   * lights - so putting it on the 120Hz path to be recomputed and discarded
   * thousands of times would be all cost and no benefit. Half a second is far
   * below the threshold at which a hint appearing feels late.
   */
  const [circuitHint, setCircuitHint] = useState<HintTerminal | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const game = gameRef.current;
      const next = circuitHintTarget({
        terminals: game?.circuit?.terminals,
        activePlaySeconds: game?.activePlaySeconds ?? 0,
        paused: !!game?.paused,
        levelEnded: !!game?.levelComplete || !!game?.gameOver,
        isDragging: isPlayerDragging,
      });
      // Compare by identity of the terminal's position, not by object: the
      // runtime terminal is mutated in place when it lights, so a reference
      // check would never see the change.
      setCircuitHint(prev =>
        (prev?.x === next?.x && prev?.y === next?.y) ? prev : next);
    }, 500);
    return () => window.clearInterval(id);
  }, [isPlayerDragging]);
  const [canvasOffsetTop, setCanvasOffsetTop] = useState(0);
  const [canvasOffsetLeft, setCanvasOffsetLeft] = useState(0);
  // CSS (layout) size of the canvas, used to position the tutorial overlay.
  // NOTE: game.screenSize is in physical pixels (×devicePixelRatio); the overlay
  // lives in CSS-pixel/viewport space, so it must use these instead.
  const [canvasCssWidth, setCanvasCssWidth] = useState(0);
  const [canvasCssHeight, setCanvasCssHeight] = useState(0);
  const [tutorialCutMade, setTutorialCutMade] = useState(false);
  const [debugInfo, setDebugInfo] = useState({ boardWidth: 0, boardHeight: 0, scale: 0, boardTopPct: 5 });
  const [lockedBallsCount, setLockedBallsCount] = useState(0);
  // Did the player lock ANY ball this map? Set true whenever a lock fires
  // (setLockedBallsCount is only called on a lock), reset per map. Drives the
  // one-time "how locks work" explainer shown before the first zero-lock prompt.
  const madeLockThisMapRef = useRef(false);
  const [lockExplainerOpen, setLockExplainerOpen] = useState(false);
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
  // True once a power-up has appeared on the board this map (#59): drives the
  // one-time "Power-Ups" explainer. Latches on (the intro only needs one shot)
  // and resets on map init.
  const [pickupPresent, setPickupPresent] = useState(false);

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
  /**
   * The single feedback slot. One message at a time by construction: raising a
   * new one replaces whatever was there, and repeating the same one refreshes
   * its clock rather than queueing a second copy of the same sentence.
   */
  const [gameMessage, setGameMessage] = useState<GameMessage | null>(null);
  const raiseGameMessage = useCallback((id: GameMessageId) => {
    setGameMessage(current => raiseMessage(current, id, Date.now()));
  }, []);
  const onMessageRef = useRef<((id: GameMessageId) => void) | null>(null);
  onMessageRef.current = raiseGameMessage;
  const [clearedPercent, setClearedPercent] = useState<number | null>(null);

  const gameRef = useRef<CanvasGameState>({
    spaceGrid: null as SpaceGrid | null,
    gridRegions: [] as GridRegion[],
    regions: [] as Region[],
    walls: [] as Wall[],
    obstaclePolygons: [] as Polygon[],
    obstacleRules: new Map() as import('@/lib/physics/obstacleRules').ObstacleRuleMap,
    deliveryBoxes: [] as import('@/lib/physics/deliveryBox').DeliveryBoxState[],
    fenceZones: [] as import('@/lib/physics/fenceZones').FenceZone[],
    mirrorPolygons: [] as Polygon[],
    boardPolygon: null as Polygon | null,
    originalArea: 0,
    basePlayableArea: 0,
    balls: [],
    movers: [],
    activeWalls: [] as GrowingWall[],
    gameOver: false,
    levelComplete: false,
    paused: false,
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
    // Normalised once per map rather than per frame; a malformed authored block
    // yields null, which simply disables gravity instead of half-applying it.
    gravityConfig: mapMutator?.behavior === "gravity" ? normaliseGravity(mapMutator.gravity) : null,
    objective: objective ?? null,
    bossFiredPhases: [],
    firedBeats: [],
    warnedBeats: [],
    pendingBeats: [],
    beatSpeedMult: 1,
    coloredAreas: [],
    coloredAreaSatisfied: false,
    circuit: null,
    charges: [],
    dataStream: null,
    bossActive: false,
    bossHp: 0,
    bossMaxHp: 0,
    bossDefeated: false,
    bossMinionCount: 0,
    chains: [],
    phasingObjects: [],
    screenSize: { width: 0, height: 0 },
    boardRect: { left: 0, top: 0, width: 0, height: 0, scale: 1 } as BoardRect,
    backgroundColor: "#0a1a10",
    regionColor: "#1a3020",
    wallCount: 0,
    completedCuts: 0,
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
    frozenBallReleaseAt: null as number | null,
    frozenBallVelocity: null as Vector2 | null,
    frozenBallPosition: null as Vector2 | null,
    lockedBallsCount: 0,
    mapBasePoints: 20,
    lockBonus: 0,
    lockDeliveryBonus: 0,
    coloredAreaTargets: 0,
    lockedByType: {},
    superiorLockCount: 0,
    superiorLockBonus: 0,
    breakablesSmashed: 0,
    zoneLockCount: 0,
    zoneLockBonus: 0,
    multiLockBonus: 0,
    multiLockBest: 1,
    moneyMultiplier: 1,
    ballSpeedScale: 1,
    assimilations: new Map<string, LockFlashState>(),
    dissolve: null as DissolveState | null,
    bonusCutCells: new Set<string>(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockBaseThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockMinRegionCells: 0,
    moverFriction: [],
    moverFenceDragPerFence: 0.45,
    moverFenceDragFloor: 0.3,
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
    claimFlashes: [] as { contours: import('@/lib/polygon').Vector2[][]; startTime: number }[],
    slowAreas: [] as import('@/types/game').SlowArea[],
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

  useGameInput(canvasRef, gameRef, activeModifiers, setCutCount, setIsPlayerDragging, setFreezeUsesRemaining, handleAbilityTargetRef, handleSuperiorInfoRef, handleTapRemoveRef, handleEntityInfoRef, onMessageRef);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    if (initializedLevelRef.current !== level.id) {
      gameInitializedRef.current = false;
      initializedLevelRef.current = level.id;
      // A refusal from the previous map explains nothing about this one.
      setGameMessage(null);
    }

    const game = gameRef.current;
    game.regionColor = regionColorProp;
    // Second Wind capstone: N fence-hit shields granted fresh every map.
    game.wallShieldsRemaining = Math.max(0, Math.round(activeModifiers.wallShieldsPerMap));
    setWallShieldCount(game.wallShieldsRemaining);

    // The sleek WebGL renderer is the only renderer. `useFallback2d` is set ONLY
    // when its init fails (old WebView, blocklisted GPU), and swaps in the
    // emergency 2D board so the player gets something legible rather than a
    // black rectangle. It is not a user-selectable alternative.
    const ctx = useFallback2d ? canvas.getContext("2d") : null;
    if (useFallback2d && !ctx) return;
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    // Created once per component mount (async chunk); level-effect re-runs share
    // the instance.
    if (!useFallback2d && !pixiInitStartedRef.current) {
      pixiInitStartedRef.current = true;
      const fallback = (err: unknown) => {
        console.warn("[renderer] WebGL init failed, using the emergency 2D board:", err);
        try { pixiRef.current?.destroy(); } catch { /* half-initialized app */ }
        pixiRef.current = null;
        pixiInitStartedRef.current = false;
        // Remounts the canvas element (see its key) so the 2D path gets a fresh,
        // contextless canvas — a canvas that has had a WebGL context cannot
        // hand out a 2D one.
        setUseFallback2d(true);
      };
      import("@/lib/rendering/sleek/SleekRenderer").then(m => {
        if (pixiRef.current) return;
        const renderer = new m.SleekRenderer();
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
    // The board grid and region fills used to be painted here into two
    // full-screen OffscreenCanvases and handed to the renderer as textures.
    // The sleek renderer draws the board from the space grid instead and never
    // read either one, so this was rasterising two native-DPR surfaces (2.3Mpx
    // each on a phone) on every cut and throwing both away.
    //
    // The one part that mattered is the signal: markStaticDirty tells the
    // renderer the board shape changed, which is what gates its contour trace.
    const repaintRegionCanvas = () => {
      pixiRef.current?.markStaticDirty();
    };
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
      game.moverFenceDragPerFence = moverFenceDragPerFence;
      game.moverFenceDragFloor = moverFenceDragFloor;
      game.fenceDurability = fenceDurability;
      game.pendingWallBreaks = [];
      game.pendingDestroys = [];
      game.objectDebris = [];
      game.fallingObjects = [];
      game.objectivesBroken = 0;
      game.breakBonus = 0;
      // This map's overtime scale, for sizing overtime pickups proportionately (#68).
      game.mapBasePoints = level.points ?? 20;
      game.breakMultiplier = 1;
      game.lastDudAt = 0;
      game.chestLoot = [];
      game.ballPops = [];
      game.chestRewardsLog = [];
      // Slow Areas are per-MAP, not per-run: a zone you paid to place is a
      // decision about this board, and carrying it to the next one would hand
      // over a board the player never read.
      game.slowAreas = [];
      game.abilitySlowUntil = 0;
      game.abilitySlowMult = 1;
      game.abilityFenceRushUntil = 0;
      game.abilityFenceRushMult = 1;
      game.abilityFenceShieldUntil = 0;
      game.claimFlashes = [];
      game.abilityFx = [];
      game.moneyMultiplier = 1;
      game.ballSpeedScale = activeModifiers.ballSpeedMultiplier;
      // Pickups: fresh token state each map. A map-level pickupChance override
      // both replaces the global chance AND bypasses the start_level gate (so a
      // teaching map can guarantee a token, or a set-piece can suppress them).
      game.pickups = [];
      game.pickupFeedback = [];
      game.pickupLockMarkers = [];
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
      // Free Fall (Escape Velocity): soften how hard wells and gravity maps
      // bend your headings.
      game.gravityBendMultiplier = activeModifiers.gravityBendMultiplier;
      {
        const chance = effectivePickupChance(pickupConfig, levelNumber, level.pickupChance, activeModifiers.pickupChanceBonus);
        game.pickupConfig = chance > 0 ? { ...pickupConfig, spawnChance: chance } : null;
      }
      const data = createInitialGameData(level, levelNumber, activeModifiers);
      // Pickup spots are authored in the standard orientation; rotate them into
      // the same frame as the (rotated) obstacles so tokens still land where the
      // designer intended relative to the layout.
      game.pickupSpots = (level.pickupSpots ?? []).map(s => rotatePoint(s.x, s.y, data.mapRotation));
      // Colored Areas (gate + bonus pockets): rotate into the board's frame.
      game.coloredAreas = (level.coloredAreas ?? []).map(a => rotateColoredArea(a, data.mapRotation));
      game.gravityWells = (level.gravityWells ?? []).map(w => rotateGravityWell(w, data.mapRotation));
      // File the well explainer the first time a map actually has one. Filed
      // rather than shown: a well is visible, quiet and never instantly fatal,
      // so it does not earn an interruption (see manual.ts on what does).
      if (game.gravityWells.length > 0) fileManualEntry('gravityWell');
      game.coloredAreaSatisfied = false;
      // One-way membranes and ball-type gates, keyed by polygon identity, and
      // the fence-speed ground - both already rotated in initGame.
      game.obstacleRules = data.obstacleRules;
      game.deliveryBoxes = data.deliveryBoxes;
      game.fenceZones = data.fenceZones;
      // "Wire the Integration" circuit (already rotated + sealed in initGame).
      game.circuit = data.circuit;
      // The launcher barrels, and the whole reason the plunger appears at all.
      //
      // This assignment was missing, and the failure was total but silent:
      // `game.launchers` stayed undefined, so `pendingLauncher` always answered
      // null, the LaunchOverlay never mounted, and a launcher map opened with
      // its balls asleep and nothing on screen to wake them. No error, no
      // warning - just a map that could not be started or lost, because the
      // dormant balls also hold their region uncapturable.
      //
      // It is the exact failure this block's own comment warns about: gameRef
      // is built once and mutated per map, so a field this block forgets is a
      // field that is never set at all.
      game.launchers = data.launchers ?? [];
      // "Deploy Charge" fuses (already rotated in initGame).
      game.charges = data.charges ?? [];
      // "Data Stream" seam (already rotated in initGame).
      game.dataStream = data.dataStream ?? null;
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
      // Chains + phasing (#64): built at init, reset per map.
      game.chains             = data.chains ?? [];
      game.phasingObjects     = data.phasingObjects ?? [];
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
      game.activeWalls = [];
      // The post-break freeze does NOT belong to the next map.
      //
      // gameRef is built once and mutated per map, so anything this block
      // forgets survives the transition. A freeze that did was the worst kind
      // of leftover: `frozenBallId` holds a `${type.id}-${index}` id, which is
      // only unique within one map, so the new map's ball of the same name was
      // skipped by updateBall and by collisions for the whole level - a ball
      // standing still in mid-air from the opening frame - or teleported to the
      // previous map's coordinates when the pending shake timer fired.
      clearFreeze(game);
      // Same reasoning: a map must not open inside the previous map's recovery
      // window, unable to cut.
      game.isRecovering = false;
      game.recoveryEndTime = 0;
      setIsRecovering(false);
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
      game.gravityConfig = mapMutator?.behavior === "gravity"
        ? normaliseGravity(mapMutator.gravity) : null;
      game.objective = objective ?? null;
      game.bossFiredPhases = [];
      game.firedBeats = [];
      game.warnedBeats = [];
      game.pendingBeats = [];
      game.beatSpeedMult = 1;
      setBeatBanner(null);
      lastTimeTierRef.current = 0; // fresh map: re-arm the time-tier toasts
      setPickupPresent(false);
      setCreepPercent(0);
      setActiveSeconds(0);
      setAbilityTimers([]);
      setArmedAbility(null);
      game.armedAbility = null;
      game.magnetMarker = undefined;
      setAbilityIconFx(null);
      setBallCount(game.balls.length || 1);
      game.breakablesSmashed = 0;
      game.wallCount = 0;
      game.completedCuts = 0;
      setCompletedCuts(0);
      madeLockThisMapRef.current = false; // fresh map: no locks yet (#zero-lock explainer)
      clearWallImpacts();
      clearObstacleImpacts();
      setCutCount(0);
      // Not always 100: startingCapturePercent (Equity Grant) starts the run lower
      setRemainingPercent(game.spaceGrid ? Math.round(getRemainingPercent(game.spaceGrid)) : 100);
      rainState.particles = [];
      rainState.lastTime = 0;
    };

    const resizeCanvas = () => {
      const { width, height } = container.getBoundingClientRect();
      // Native device resolution (3x sanity cap saturates any panel); the
      // emergency 2D board keeps the capped + adaptive DPR.
      const dpr = !useFallback2d ? Math.min(window.devicePixelRatio || 1, 3) : getDevicePixelRatio();
      const physW = Math.round(width * dpr);
      const physH = Math.round(height * dpr);
      pixiSizeRef.current = { w: physW, h: physH };
      recordSurface(physW, physH); // so the perf HUD can report pixels, not just ms
      if (!useFallback2d && pixiRef.current?.isReady) {
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
        // The board's top edge as a % of the container height (dpr cancels out).
        // Top-anchored toasts use this to sit ABOVE the board, never over it.
        boardTopPct: physH > 0 ? (game.boardRect.top / physH) * 100 : 5,
      });
      onBoardTopPctRef.current?.(physH > 0 ? (game.boardRect.top / physH) * 100 : 5);
      if (!gameInitializedRef.current) {
        gameInitializedRef.current = true;
        initGame();
      }
    };

    const rctx: RenderContext = {
      accentColor, activeModifiers, rain: rainState,
      spaceThreshold: level.sizeThreshold, showBallSpeeds: showBallSpeedsRef.current,
      infoUnlockedLabel: t('game.infoUnlocked'),
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
      renderFallbackBoard(ctx, game, rctx);
      // Perf HUD on top of the emergency board. Its cost counts toward the
      // measured render ms.
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
      if (!useFallback2d) {
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
      // Snapshot the map's first frame from the renderer that will actually
      // draw it. Under the emergency 2D board there is no renderer to extract
      // from, so the assemble is simply skipped (the board appears directly).
      const snap = pixiRef.current?.captureSceneCanvas?.(game, rctx) ?? null;
      const cctx = captured.getContext('2d');
      if (cctx && snap) cctx.drawImage(snap, 0, 0);
      game.dissolve = {
        captured, tiles: buildDissolveTiles(W, H),
        // Start a beat in the FUTURE: the game screen slides in for ~280ms
        // (Index's framer-motion transition), and shards that fly during the
        // slide are never seen. The negative-elapsed window renders nothing
        // (tiles at full scatter, alpha clamped to 0), then the assemble
        // plays in full view.
        startTime: performance.now() + 450,
        // The board has finished flying in: reveal the tutorial overlay now.
        reverse: true, onComplete: () => { setBoardMaterialized(true); startGameLoop(game); },
      };
      startGameLoop(game);
      // Fade the shell's "Loading..." overlay out just as the first tiles fly
      // in (at dissolve.startTime), so the wait is covered end to end.
      readyTimer = window.setTimeout(signalCanvasReady, Math.max(0, game.dissolve.startTime - performance.now()));
    };

    // Build callbacks object for extracted physics functions
    const callbacks: GameCallbacks = {
      // Called only when a ball locks: mirror the count AND flag that a lock
      // happened this map (for the zero-lock explainer).
      setLockedBallsCount: (n: number) => { setLockedBallsCount(n); madeLockThisMapRef.current = true; },
      onBossState: (hp: number, maxHp: number, defeated: boolean) => setBossHud({ active: !defeated, hp, maxHp, defeated }),
      setRemainingPercent,
      setTutorialCutMade,
      setPushMode,
      setClearedPercent,
      setScreenFlash,
      setIsShaking,
      setIsRecovering,
      setWallShieldCount,
      setCompletedCuts,
      setDisplayLives,
      onLevelComplete: d => onLevelCompleteRef.current(d),
      onMapComplete: () => onMapCompleteRef.current?.(),
      freezeOnComplete: () => freezeOnCompleteRef.current,
      onGameEnd: r => onGameEndRef.current(r),
      onLivesChange,
      onMapTimedOut: (failure: MapFailure) => onMapTimedOutRef.current?.(failure),
      onTutorialCutSuccess,
      onBallTypeLocked: id => onBallTypeLockedRef.current?.(id) ?? false,
      // Fork pickup split a ball: rescale the Ship Early countdown windows.
      onBallCountChanged: setBallCount,
      // A circuit completed and its vault opened: flash the telegraph banner.
      onCircuitComplete: (announce?: string) => {
        if (!announce) return;
        setBeatBanner({ key: performance.now(), announce });
        if (beatBannerTimer.current) clearTimeout(beatBannerTimer.current);
        beatBannerTimer.current = setTimeout(() => setBeatBanner(null), 2200);
      },
      // A Deploy Charge fuse was armed by a routed fence: flash the wind-up cue.
      onChargeArmed: () => {
        setBeatBanner({ key: performance.now(), announce: "game.chargeArmed" });
        if (beatBannerTimer.current) clearTimeout(beatBannerTimer.current);
        beatBannerTimer.current = setTimeout(() => setBeatBanner(null), 1600);
      },
      // A Data Stream span was harvested by a fence running along it.
      onStreamHarvested: (_hours, announce) => {
        setBeatBanner({ key: performance.now(), announce: announce ?? "game.streamHarvested" });
        if (beatBannerTimer.current) clearTimeout(beatBannerTimer.current);
        beatBannerTimer.current = setTimeout(() => setBeatBanner(null), 1600);
      },
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

    const updateWall = (dt: number) => {
      // Grow every concurrent fence. A snapshot, because a ball/mover hit clears
      // all active walls (a failed cut) and flips recovery - stop there.
      for (const wall of [...game.activeWalls]) {
        if (wall.isComplete) continue;
        updateFenceWallFn(dt, game, level, levelNumber, activeModifiers, fenceSpeedBase, fenceSpeedMin, fenceSpeedPerLevel, callbacks, wall);
        if (game.isRecovering || game.gameOver || game.levelComplete) break;
      }
    };

    const gameLoopCallbacks: GameLoopCallbacks = {
      updateWall: (dt: number) => updateWall(dt),
      applyCut: (wall) => applyCut(wall),
      render,
      // A Deploy Charge detonated its slab: flash the payoff banner.
      onChargeBlown: (announce?: string) => {
        setBeatBanner({ key: performance.now(), announce: announce ?? "game.chargeBlown" });
        if (beatBannerTimer.current) clearTimeout(beatBannerTimer.current);
        beatBannerTimer.current = setTimeout(() => setBeatBanner(null), 2200);
      },
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
          // Smashing the chest IS the interaction, so the reward lands here. The
          // gem it drops is a receipt showing what came out of it.
          onChestReward: (rewardId) => handleLootCollectRef.current?.(rewardId),
        }, levelNumber, activeModifiers);
        // A destroy can capture pocket cells (destroy-recapture) and take the
        // remaining space past the goal with no fence involved — run the same
        // win check a completed cut runs, or the map shows CLEAR but never ends.
        checkSpaceWin(game, level, callbacks, levelNumber, activeModifiers);
      },
      // Per-frame safety net (see useGameLoop): guarantees a cleared map always
      // finishes even if the space reached the goal by a path that didn't run
      // the win check, so the top bar can never stall showing CLEAR.
      checkWinCondition: () =>
        evaluateWinConditions(game, level, levelNumber, activeModifiers, callbacks),
      spawnTimedBalls: () => {
        tickRainbowSpawns(game, levelNumber);
        tickBossPhases(game, level, levelNumber);
        tickBossSpit(game, level);
        // Boss fence-wipe attack (#64): telegraphs, then clears every fence.
        tickBossFenceWipe(game, level, () =>
          clearAllFences(game, { repaintRegionCanvas, setRemainingPercent, fenceColor: "#ff5b5b" }),
        );
        tickMapBeats(game, level, levelNumber, (announce, effects) => {
          setBeatBanner({ key: performance.now(), announce, effects });
          if (beatBannerTimer.current) clearTimeout(beatBannerTimer.current);
          // Outlasts the beat's lead, so the banner is still up when the effect
          // it described actually lands.
          beatBannerTimer.current = setTimeout(() => setBeatBanner(null), 3000);
        });
      },
      onCreepStep: setCreepPercent,
      onActiveSecond: (s: number) => {
        setActiveSeconds(s);
        // Latch "a power-up appeared" for the one-time explainer (#59). Setting
        // the same `true` again is a no-op, so this is cheap at 1Hz.
        if (game.pickups && game.pickups.length > 0) setPickupPresent(true);
        // Time-tier toast (#timeTier): each time the countdown drops into a
        // lower color band, flash the same crunch-style banner to add pressure.
        const tl = getMapTimeLimit(level, levelNumber);
        if (tl == null) return;
        const tier = timeTierFor(Math.max(0, 1 - s / tl));
        if (tier > lastTimeTierRef.current) {
          lastTimeTierRef.current = tier;
          const announce = TIME_TIER_ANNOUNCE[tier];
          if (announce) {
            setBeatBanner({ key: performance.now(), announce });
            if (beatBannerTimer.current) clearTimeout(beatBannerTimer.current);
            beatBannerTimer.current = setTimeout(() => setBeatBanner(null), 2200);
          }
        }
      },
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
      if (useFallback2d) {
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
    if (useFallback2d) {
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
    };
  }, [level, levelNumber, activeModifiers, fenceDurability, useFallback2d]);

  // The renderer survives level changes (the effect above re-runs per
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
    // Pays on the BEST remaining reached, not the current: space creeping back
    // after a good cut must not take an already-earned hour away.
    const pushBonus = pushBonusEarned(
      game.pushStartPercent, game.bestRemainingPercent, activeModifiers.pushBonusMultiplier,
    );
    // Ship Early: the tempo clock froze when the prompt opened, so push time
    // never counts against it (disabled on the tutorial band, levels 1-3).
    const shipEarlyPercent = isTimingExempt(levelNumber)
      ? 0
      : getShipEarlyPercent(game.clearedActiveSeconds, game.balls.length, activeModifiers.shipEarlySecondsPerBall);
    // Fold lock + push in before the cap (issue #43); ship-early pays a percent
    // above the cap. Previously this site added lockBonus + pushBonus AFTER
    // calculateScore, letting a banked push exceed the per-map ceiling.
    // Colored areas carry a share of what the MAP pays (40% by default), in
    // proportion to how many were satisfied.
    //
    // Passed to calculateScore rather than applied to basePoints, which was the
    // first attempt and was nearly invisible: basePoints feeds only the first
    // term of `multipliedBase + axes.total`, so on a level-3 run it was 20h of
    // a 130h payout and withholding 40% of it cost 8h. The share has to come
    // off the map's pay or it does not mean what the number says.
    const zoneShareMissed = missedAreaShare(level, game.coloredAreas);

    const { levelScore, breakdown, shipEarlyBonus } = calculateScore(
      game.wallCount, level.expectedCuts, game.bestRemainingPercent, level.sizeThreshold, level.points, {
        zoneShareMissed,
        scoreMultiplier: activeModifiers.scoreMultiplier,
        locks: readLockAxes(game),
        tempoCeilingMultiplier: activeModifiers.shipEarlyBonusMultiplier,
        greedBonus: pushBonus + game.breakBonus,
        spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
        // Comp Time pickups raise THIS map's cap; overtime pickups pay after it.
        flatBonus: activeModifiers.overtimeCapBonus + game.pickupCapBonus,
        postCapBonus: game.pickupOvertime,
        // Finishing fast pays a percent of the capped overtime, above the cap.
        shipEarlyPercent,
        // Demolition multiplier: chests/breakables smashed before the push.
        payoutMultiplier: game.breakMultiplier ?? 1,
        // What the plunger was pulled to. Multiplies the flat base only.
        launchPower: game.launchPower ?? 1,
      },
    );

    // Same post-sweep beat as applyCut: hold the drained board, shatter it,
    // then mount the completion overlay.
    setTimeout(() => {
      startDissolveRef.current?.(() => {
        onLevelCompleteRef.current({
          levelNumber, levelId: level.id, cutCount: game.wallCount,
          expectedCuts: level.expectedCuts, basePoints: level.points,
          zoneShareWithheld: breakdown.zoneShareWithheld ?? 0,
          multipliedBase: breakdown.multipliedBase,
          mapCeiling: breakdown.mapCeiling,
          levelScore,
          remainingPercent: game.bestRemainingPercent, overcutBonus: 0,
          thresholdPercent: level.sizeThreshold, pushBonus,
          // Reached only by banking the Push Your Luck prompt, and the prompt
          // only ever opens on a space clear.
          winReason: 'space' as const,
          underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
          spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
          fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
          extraPercent: breakdown.extraPercent, axes: breakdown.axes, lockBonus: game.lockBonus,
          lockedBallsCount: game.lockedBallsCount,
          superiorLockCount: game.superiorLockCount, superiorLockBonus: game.superiorLockBonus,
          zoneLockCount: game.zoneLockCount, zoneLockBonus: game.zoneLockBonus,
          multiLockBonus: game.multiLockBonus, multiLockBest: game.multiLockBest,
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
    const def = getAbility(abilityId);
    // Icon burst at the board centre so each ability reads at a glance.
    if (def) {
      const br = game.boardRect, ss = game.screenSize;
      const xPct = ss.width ? ((br.left + br.width / 2) / ss.width) * 100 : 50;
      const yPct = ss.height ? ((br.top + br.height / 2) / ss.height) * 100 : 50;
      setAbilityIconFx({ key: now, kind: def.kind, color: def.color, xPct, yPct });
      if (abilityIconTimer.current) clearTimeout(abilityIconTimer.current);
      abilityIconTimer.current = setTimeout(() => setAbilityIconFx(null), 1100);
    }
    // Time-based abilities (those with a duration) get a countdown-bar timer,
    // keyed by kind so re-firing the same one resets its window. Wall-clock so
    // the bar drains to exactly zero when the effect ends; a per-timer timeout
    // removes it right then (no 1Hz cull lag).
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
  useEffect(() => { handleSuperiorInfoRef.current = onRequestSuperiorInfo ?? null; }, [onRequestSuperiorInfo]);
  useEffect(() => { handleEntityInfoRef.current = onRequestEntityInfo ?? null; }, [onRequestEntityInfo]);

  // A chest was smashed: bank the ability run-wide, log it for the level recap,
  // and flash the reward toast. Fired from the smash itself, so the gem that
  // drops alongside is a receipt showing what was won, not a thing to chase.
  const handleLootCollect = useCallback((rewardId: string) => {
    playPickupClaimedSound();
    (gameRef.current.chestRewardsLog ??= []).push(rewardId);
    onGrantAbility?.(rewardId);
    const def = getAbility(rewardId);
    setChestToast({ key: performance.now(), label: def?.name ?? rewardId, color: def?.color ?? '#ffd76b' });
    if (chestToastTimer.current) clearTimeout(chestToastTimer.current);
    chestToastTimer.current = setTimeout(() => setChestToast(null), 1700);
  }, [onGrantAbility]);
  useEffect(() => { handleLootCollectRef.current = handleLootCollect; }, [handleLootCollect]);

  // A white "tappable" ball was tapped away (#57): the input layer already
  // removed it from game.balls. Play a pop, resync the ball count (Ship Early
  // windows scale by it), and let the per-frame win check pick up the change.
  const handleTapRemove = useCallback((info: { x: number; y: number; color: string }) => {
    const game = gameRef.current;
    (game.ballPops ??= []).push({ ...info, startTime: performance.now() });
    setBallCount(game.balls.length || 1);
    playFenceBreakSound();
    vibrateFenceBreak();
  }, []);
  useEffect(() => { handleTapRemoveRef.current = handleTapRemove; }, [handleTapRemove]);

  // What the push has banked so far. bestRemainingPercent is a ref updated in
  // the loop, so this is recomputed each render rather than tracked separately;
  // remainingPercent is a dep of the state push below and moves with it.
  const pushBonusSoFar = pushMode === "pushing"
    ? pushBonusEarned(
        gameRef.current.pushStartPercent,
        gameRef.current.bestRemainingPercent,
        activeModifiers.pushBonusMultiplier,
      )
    : 0;

  // The unusual win requirements, recomputed each render off the live game.
  // resolveWinSpec + readWinSnapshot are exactly what applyCut's win check
  // calls, so there is one reading of the map's win, not two.
  const winGates = extraGates(resolveWinSpec(level), readWinSnapshot(gameRef.current, level));

  useEffect(() => {
    if (onGameStateChange) {
      onGameStateChange({
        cutsUsed: cutCount,
        completedCuts,
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
        pickupPresent,
        onBankAndContinue: handleBankAndContinue,
        pushBonusSoFar,
        winGates,
        gameMessage,
        onUseAbility: handleUseAbility,
        abilityTimers,
        armedAbility,
      });
    }
  }, [cutCount, completedCuts, remainingPercent, pushMode, creepPercent, activeSeconds, ballCount, pickupPresent, handleBankAndContinue, pushBonusSoFar, winGates, handleUseAbility, onGameStateChange, lockedBallsCount, freezeUsesRemaining, bossHud, abilityTimers, armedAbility, gameMessage]);

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

  // First time you finish a map having locked NOTHING, teach how locks work
  // before the bank / push-your-luck choice. The modal renders over the push
  // prompt (which is already mounted + paused); dismissing it reveals the choice.
  useEffect(() => {
    if (pushMode !== "prompt") { setLockExplainerOpen(false); return; }
    let seen = false;
    try { seen = localStorage.getItem("devend_lock_tutorial_seen") === "1"; } catch { /* private mode */ }
    if (!madeLockThisMapRef.current && !seen) setLockExplainerOpen(true);
  }, [pushMode]);

  useEffect(() => {
    const updateCanvasPosition = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // The tutorial overlay renders `absolute inset-0` INSIDE this container, so
      // it shares the container's coordinate space (and any page-transition
      // transform). Give it the ACTUAL board box relative to the container's
      // top-left: the board is letterboxed inside the container and pushed down
      // by the reserved top-UI band (computeBoardRect). game.boardRect is in
      // physical px; convert to the container's CSS px with its CSS/phys ratio.
      const game = gameRef.current;
      const br = game?.boardRect;
      const ss = game?.screenSize;
      if (br && ss && ss.width > 0 && ss.height > 0 && br.width > 0) {
        const kx = rect.width / ss.width;   // physical -> CSS
        const ky = rect.height / ss.height;
        setCanvasOffsetLeft(br.left * kx);
        setCanvasOffsetTop(br.top * ky);
        setCanvasCssWidth(br.width * kx);
        setCanvasCssHeight(br.height * ky);
      } else {
        setCanvasOffsetTop(0);
        setCanvasOffsetLeft(0);
        setCanvasCssWidth(rect.width);
        setCanvasCssHeight(rect.height);
      }
    };
    updateCanvasPosition();
    window.addEventListener("resize", updateCanvasPosition);
    // Re-read a few times while the board settles (it is computed after mount,
    // and its size/offset only stabilises once the container has its final box).
    const timeouts = [100, 300, 600, 1000].map(ms => setTimeout(updateCanvasPosition, ms));
    return () => {
      window.removeEventListener("resize", updateCanvasPosition);
      timeouts.forEach(clearTimeout);
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
        <canvas key={useFallback2d ? '2d' : 'gl'} ref={canvasRef} className="absolute inset-0 touch-none cursor-crosshair" style={{ zIndex: 2 }} />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 3, opacity: 1 }}
        />
        {/* Frame-timing HUD. Absolute INSIDE this positioned container (the root
            div is unpositioned, and page transforms break `fixed`), and outside
            the canvas so it costs the renderer nothing and can never land inside
            the render time it reports. */}
        <PerfOverlay visible={showPerfOverlay || perfHudPersisted} />
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
        {beatBanner && (
          <div
            key={beatBanner.key}
            // Anchored just ABOVE the board's top edge (translateY(-100%)) so the
            // toast sits in the gutter over the HUD, never covering the map. Kept
            // compact (chest-toast sizing) so it fits the thin band above the board.
            className="absolute left-1/2 z-40 pointer-events-none animate-pulse whitespace-nowrap font-mono font-bold text-sm sm:text-base px-3 py-1.5 rounded-md flex items-center gap-2"
            style={{
              top: `${debugInfo.boardTopPct}%`,
              transform: 'translate(-50%, calc(-100% - 4px))',
              color: '#ffcf7a',
              background: 'rgba(30,10,4,0.82)',
              border: '1px solid #ffb45499',
              boxShadow: '0 0 18px #ff8a5b55',
            }}
          >
            <span aria-hidden>⚠</span>
            {t(beatBanner.announce)}
            {/* What the beat is about to DO. The flavour name alone telegraphs
                that something is coming but not what, which is how an extra
                ball still arrived unexplained. Kept on the same line so the
                toast stays inside the thin band above the board. */}
            {beatBanner.effects?.map(effect => (
              <span key={effect.key} className="font-normal opacity-90">
                · {t(effect.key, effect.values)}
              </span>
            ))}
          </div>
        )}
        {abilityIconFx && (
          <div
            key={abilityIconFx.key}
            className="absolute z-40 pointer-events-none animate-ability-icon"
            style={{
              left: `${abilityIconFx.xPct}%`,
              top: `${abilityIconFx.yPct}%`,
              color: abilityIconFx.color,
              filter: `drop-shadow(0 0 10px ${abilityIconFx.color})`,
            }}
          >
            <AbilityIcon kind={abilityIconFx.kind} className="w-16 h-16 sm:w-20 sm:h-20" />
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
        {tutorialMode && tutorialStep !== "completed" && !tutorialCutMade && boardMaterialized && (
          <InteractiveTutorialOverlay
            tutorialStep={tutorialStep}
            isPlayerDragging={isPlayerDragging}
            canvasWidth={canvasCssWidth}
            canvasHeight={canvasCssHeight}
            canvasOffsetTop={canvasOffsetTop}
            canvasOffsetLeft={canvasOffsetLeft}
          />
        )}
        {/* The plunger. Board-aligned and mounted only while a cup is loaded,
            which is also exactly while the board is held. */}
        {pendingLaunch && boardMaterialized && (() => {
          const game = gameRef.current;
          const loaded = pendingLaunch.ballIds
            .map(id => game.balls.find(b => b.id === id))
            .filter((b): b is NonNullable<typeof b> => !!b);
          // The ball at the muzzle is the one the preview follows: it is the
          // first thing out and the only one whose path is not perturbed by the
          // fan behind it.
          const ball = loaded[0];
          if (!ball) return null;
          return (
            <LaunchOverlay
              canvasWidth={canvasCssWidth}
              canvasHeight={canvasCssHeight}
              canvasOffsetTop={canvasOffsetTop}
              canvasOffsetLeft={canvasOffsetLeft}
              ballPosition={ball.position}
              inner={pendingLaunch.inner}
              angle={pendingLaunch.angle}
              facing={pendingLaunch.facing}
              predict={(aim: LaunchAim) => {
                // The SAME predictor the Scrum Master preview uses, fed the
                // velocity the ball is actually about to get. A hand-rolled ray
                // per bounce would draw a line the ball never takes, and this
                // one already knows about movers, gravity and the other balls.
                const speed = (ball.baseSpeed || 250) * aim.power;
                const v = { x: aim.direction.x * speed, y: aim.direction.y * speed };
                return computeBallTrajectory(
                  ball.position, v, game.walls, 3, ball.radius,
                  game.obstaclePolygons, [], game.creepFactor || 1,
                );
              }}
              onFire={(aim: LaunchAim) => {
                fireLauncher(game, pendingLaunch, aim);
                // Re-read rather than clearing: a map with two cups arms the
                // next one instead of starting while a ball is still asleep.
                setPendingLaunch(pendingLauncher(game));
              }}
            />
          );
        })()}
        {/* The same hand, aimed. Board-aligned, so it lives in the container's
            coordinate space with the rest of the overlays rather than in the
            viewport's - a `fixed` element here would be thrown off by the page
            transition's transform. */}
        {circuitHint && boardMaterialized && !tutorialMode && (
          <InteractiveTutorialOverlay
            tutorialStep="showingHint"
            isPlayerDragging={isPlayerDragging}
            canvasWidth={canvasCssWidth}
            canvasHeight={canvasCssHeight}
            canvasOffsetTop={canvasOffsetTop}
            canvasOffsetLeft={canvasOffsetLeft}
            gesture={(() => {
              const g = circuitHintGesture(circuitHint, BOARD_WIDTH);
              const sx = (wx: number) => canvasOffsetLeft + (wx / BOARD_WIDTH) * canvasCssWidth;
              const sy = (wy: number) => canvasOffsetTop + (wy / BOARD_HEIGHT) * canvasCssHeight;
              return { fromX: sx(g.from.x), fromY: sy(g.from.y), toX: sx(g.to.x), toY: sy(g.to.y) };
            })()}
          />
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

      {/* One-time lock explainer, over the push prompt, on the first zero-lock finish. */}
      {lockExplainerOpen && (
        <LockExplainerModal
          onClose={() => {
            try { localStorage.setItem("devend_lock_tutorial_seen", "1"); } catch { /* private mode */ }
            setLockExplainerOpen(false);
          }}
        />
      )}

    </div>
  );
}
