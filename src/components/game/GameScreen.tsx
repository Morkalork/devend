/**
 * GameScreen — the in-game layout: GameTopBar above, GameCanvas in the
 * middle, the live action bars (ability controls, Ship Early countdown,
 * ability timers) pinned to the bottom, plus background layers, the in-game
 * menu and tutorial overlays.
 *
 * The top bar's Specs button (and tapping the bar) opens the full-screen
 * TopBarDetailsPanel: the run's build, upgrades, assignment and attributes.
 */
import { useState, useCallback, useRef, useEffect, useMemo, isValidElement, cloneElement, type MutableRefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ownedTagCounts, withVirtualTag, DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { shopLeanOf } from '@/lib/sprintOffers';
import { fencesLeft } from '@/lib/fenceBudget';
import { winConditions, winConditionsBody, shouldAnnounceWinConditions, type Criterion } from '@/lib/winConditions';
import { MapTuningModal } from '@/ui/game/MapTuningModal';
import { GameCanvas, GameStateInfo } from './GameCanvas';
import { useMeasuredBottomBars, BOTTOM_BARS_FALLBACK_PX } from '@/hooks/useBottomBarsHeight';
import { hasSeenFenceSwitching, markFenceSwitchingSeen } from '@/lib/fenceSeen';
import { SuperiorLockInfoModal } from '@/ui/game/SuperiorLockInfoModal';
import { BoardEntityInfoModal } from '@/ui/game/BoardEntityInfoModal';
import type { BoardEntityHit } from '@/lib/boardEntityInfo';
import { GameTopBar } from '@/ui/game/GameTopBar';
import { MapRuleBanner } from '@/ui/game/MapRuleBanner';
import { MapFailedOverlay } from '@/ui/game/MapFailedOverlay';
import type { MapFailure } from '@/lib/mapFailure';
import { ShipEarlyBar } from '@/ui/game/ShipEarlyBar';
import { AbilityBar } from '@/ui/game/AbilityBar';
import { FenceSlotBar } from '@/ui/game/FenceSlotBar';
import { STANDARD_FENCE_ID } from '@/lib/fences';
import { GameMessageBar } from '@/ui/game/GameMessageBar';
import { AbilityCountdownBar } from '@/ui/game/AbilityCountdownBar';
import { TopBarDetailsPanel, type PanelFocus } from '@/ui/game/TopBarDetailsPanel';
import { shouldAutoPause, shouldPauseForZoom } from '@/lib/autoPause';
import { CRTBackground } from './CRTBackground';
import { MemoryParallaxLayer } from './MemoryParallaxLayer';
import { TutorialOverlay } from '@/ui/game/TutorialOverlay';
import { AcceptanceCriteriaModal } from '@/ui/game/AcceptanceCriteriaModal';
import { LockDebugOverlay } from '@/ui/game/LockDebugOverlay';
import { isLockDebugEnabled } from '@/lib/lockDiagnostics';
import { fileManualEntry } from '@/lib/manual';
import { circuitSeenKey, FIRST_CIRCUIT_MAP_ID, LEGACY_CIRCUIT_SEEN_KEY, BOX_SEEN_KEY, LAUNCHER_SEEN_KEY } from '@/lib/circuitHint';
import { isStaticBgEnabled } from '@/lib/rendering/perfStats';
import { FenceArt } from '@/ui/game/TutorialArt';
import { BossBanner } from '@/ui/game/BossBanner';
import { contentText } from '@/i18n/content';
import { playDeadlineTickSound, playHeartbeatSound } from '@/lib/gameAudio';
import { deadlineMilestone } from '@/lib/deadlineDisplay';
import { LevelConfig } from '@/types/level';
import { getMapTimeLimit, TIME_LIMIT_EXEMPT_MAX_LEVEL } from '@/lib/mapTiming';
import { selectMapMutator, getMapMutators, mutatorById } from '@/lib/mapMutators';
import { debugMutatorId, devFenceSlots } from '@/lib/devFlags';
import type { MapMutator } from '@/types/mapMutator';
import { selectMapObjective, evaluateObjective } from '@/lib/mapObjectives';
import { getRunRng } from '@/lib/runRng';
import { GameResult, LevelScoreData, type AcceptanceRow } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import type { RunOffer } from '@/types/offer';
import type { ScalingReadout } from '@/lib/upgradeScaling';
import { CapstoneConfig } from '@/types/capstone';
import { useGameConfig } from '@/hooks/useGameConfig';
import { playMusicForLevel } from '@/lib/gameMusic';
import { isSoundMuted, setSoundMuted } from '@/lib/soundSettings';
import { GameModifiers, ModifierSource } from '@/hooks/useActiveModifiers';
import { PushExitBar } from '@/ui/game/PushExitBar';
import { canStopPushing } from '@/lib/pushLuck';
import { WinGateFrame } from '@/ui/game/WinGateFrame';
import { extraGoals, outstandingGoals } from '@/lib/goalTracker';
import { BoardAlert } from '@/ui/game/BoardAlert';
import { pickContext } from '@/lib/hudContext';
import { unreadManualCount } from '@/lib/manual';
import { PairTurnOverlay } from '@/ui/game/PairTurnOverlay';
import { PARTNER_FENCE_HEX } from '@/lib/net/pairTurn';
import { getLocalPlayer } from '@/lib/net/commands';
import { getAllAbilities } from '@/lib/abilities';
import { CanvasLayer } from '@/ui/CanvasLayer';
import { UiFrame } from '@/ui/UiFrame';
import { PlayFrameContext, useScreenBox } from '@/ui/screenBox';
import { View } from '@/ui/kit/ui';
import { PlayLayout, type PlayRegion } from '@/ui/game/PlayLayout';
import { HUD, topBarHeight, bottomStackHeight } from '@/ui/game/hudMetrics';
import { ControlsRow } from '@/ui/game/ControlsRow';
import { PlayChips } from '@/ui/game/PlayChips';
import { ScreenFx } from '@/ui/game/ScreenFx';
import { PauseOverlay } from '@/ui/game/PauseOverlay';
import { useActiveSeconds } from '@/lib/activeClock';

interface CertificateHourProgress {
  levelsCompleted: number;
  levelsToNextHour: number;
  progressInCurrentHour: number;
  hoursEarned: number;
  levelsPerHour: number;
}

type InGameStep = 'fence' | 'done';

interface GameScreenProps {
  /** Registers a BACK handler while the game screen is active: the popstate
   *  guard in Index calls it so a back gesture opens/closes the pause menu
   *  instead of exiting the app. */
  backRef?: MutableRefObject<(() => void) | null>;
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  totalScore: number;
  ownedUpgradeIds: string[];
  upgrades: UpgradeConfig[];
  lives: number;
  /**
   * The browser's zoom got through and would not go back (useZoomGuard).
   *
   * The map pauses on it: a board that no longer fits the screen must not go on
   * costing lives while the player fights the view. See lib/viewportZoom.
   */
  viewportZoomStuck?: boolean;
  /**
   * The lockstep session, when this map is being played by a pair
   * (TWO_PLAYER_PLAN.md). Passed straight through to the canvas; absent means
   * solo, which is every other path into this screen.
   */
  lockstep?: () => import("@/lib/net/lockstep").LockstepSession | null;
  /**
   * Overlay for the state of the pair's link, drawn over the board
   * (TWO_PLAYER_PLAN.md step 7). Absent in solo play and while the link is
   * healthy, which is nearly always.
   */
  pairBanner?: React.ReactNode;
  /** True on the phone that is not the host of a pair run. */
  isPairGuest?: boolean;
  /** The host's name, for the guest's "waiting for" card. */
  pairPartnerName?: string;
  /** Per-run revives banked; shown in the HUD. */
  continuesRemaining?: number;
  onLivesChange: (newLives: number) => void;
  /** A chest granted one charge of an ability; the session banks it run-wide (#38). */
  onGrantAbility?: (abilityId: string) => void;
  /** The player spent one ability charge (pressed the ability button). */
  onSpendAbility?: (abilityId: string) => void;
  /** Run-wide banked ability charges: { abilityId -> count }, for the ability bar. */
  abilityCharges?: Record<string, number>;
  /** Distinct abilities holdable at once. */
  abilitySlots?: number;
  /** The fence types in the player's slots (FENCE_TYPES_PLAN.md). */
  fenceSlotIds?: string[];
  onGameEnd: (result: GameResult) => void;
  /** Out of time with lives left: restart the current level (session remount). */
  /** Dismissing the failure overlay is what triggers this: the session
   *  remounts the level for the retry. */
  onMapTimedOut?: () => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
  /** Fired once per ball the instant it locks, with its ball-type id (drives the
   *  tutorial's "encountered ball types" tracking). Returns true iff this was
   *  the first-ever lock of that type. */
  onBallTypeLocked?: (typeId: string) => boolean;
  onMainMenu: () => void;
  onRestart: () => void;
  showInGameTutorial?: boolean;
  onFenceSeen?: () => void;
  showMoverTutorial?: boolean;
  onMoverTutorialSeen?: () => void;
  showTopBarTutorial?: boolean;
  onTopBarTutorialSeen?: () => void;
  showBottomBarTutorial?: boolean;
  onBottomBarTutorialSeen?: () => void;
  showTimeLimitTutorial?: boolean;
  onTimeLimitTutorialSeen?: () => void;
  accentColor?: string;
  certificateProgress?: CertificateHourProgress;
  achievementBonuses?: Partial<Record<string, number>>;
  activeModifiers: GameModifiers;
  modifierSources?: ModifierSource[];
  cumulativeLockedBalls?: number;
  /** The run's Promotion, for the Specs panel. */
  capstone?: CapstoneConfig | null;
  /** The Sprint Planning offer the run took, for the Specs panel. */
  runOffer?: RunOffer | null;
  /** What build scaling is paying right now (upgradeScaling.ts). */
  scalingReadouts?: ScalingReadout[];
  /** Admin: unlocks the live map tuner in the in-game menu. */
  adminMode?: boolean;
  /**
   * Admin/Playground: no card at all. The explainer queue (the map's ticket,
   * the tutorials, the boss intro, the objective-met card), the first-sight
   * cards of the fence and ability bars, and every tap-and-hold card (fence
   * type, ability, superior lock, board entity, space detail, the lock
   * explainer) stay closed. The admin map tuner is a tool, not a card, and
   * still opens from the menu.
   */
  noCards?: boolean;
  /** Admin/Playground: draw a live speed label above each ball. */
  showBallSpeeds?: boolean;
  /** Admin/Playground: draw the frame-timing perf HUD (physics/render ms, FPS). */
  showPerfOverlay?: boolean;
  /** Admin/Playground: forwarded live game state (for the ability tester panel). */
  onGameStateChange?: (state: GameStateInfo) => void;
  /** Admin/Playground: on clear, freeze on the drained frame instead of completing. */
  freezeOnClear?: boolean;
  /** Admin/Playground: fired the instant the map is won (before the shimmer). */
  onMapComplete?: () => void;
  /** The first map of a run: its board opens with the longer boot reveal
   *  (BoardBoot), with the grid compiling cell by cell before the sweep. */
  runStartIntro?: boolean;
  /** Owned upgrades of a tag needed to activate its set bonus (build readout). */
  tagSetThreshold?: number;
  /**
   * Lock the page while the play screen's canvas interface is up (index.css
   * `canvas-ui`). The admin Playground hosts this screen inside a scrolling
   * DOM page and passes false so its own controls keep scrolling.
   */
  canvasPageLock?: boolean;
}

/** The mutator named by ?mutator=<id>, if it is in the catalogue. */
function forcedMutator(): MapMutator | null {
  return mutatorById(debugMutatorId());
}

export function GameScreen({
  backRef,
  level,
  levelNumber,
  totalLevels,
  totalScore,
  ownedUpgradeIds,
  upgrades,
  lives,
  viewportZoomStuck = false,
  lockstep,
  pairBanner,
  isPairGuest,
  pairPartnerName,
  continuesRemaining = 0,
  onLivesChange,
  onGrantAbility,
  onSpendAbility,
  abilityCharges,
  abilitySlots,
  fenceSlotIds,
  onGameEnd,
  onMapTimedOut,
  onLevelComplete,
  onBallTypeLocked,
  onMainMenu,
  onRestart,
  showInGameTutorial = false,
  onFenceSeen,
  showMoverTutorial = false,
  onMoverTutorialSeen,
  showTopBarTutorial = false,
  onTopBarTutorialSeen,
  showBottomBarTutorial = false,
  onBottomBarTutorialSeen,
  showTimeLimitTutorial = false,
  onTimeLimitTutorialSeen,
  accentColor: externalAccentColor,
  certificateProgress,
  achievementBonuses,
  activeModifiers,
  modifierSources = [],
  cumulativeLockedBalls = 0,
  capstone = null,
  runOffer = null,
  scalingReadouts = [],
  adminMode = false,
  noCards = false,
  showBallSpeeds = false,
  showPerfOverlay = false,
  onGameStateChange,
  freezeOnClear = false,
  onMapComplete,
  runStartIntro = false,
  tagSetThreshold = DEFAULT_TAG_SET_THRESHOLD,
  canvasPageLock = true,
}: GameScreenProps) {
  const { t } = useTranslation();
  // Hard map deadline (null on the tutorial band, where the countdown bar and
  // Ship Early are both suppressed). Drives the ShipEarlyBar countdown.
  const mapTimeLimit = getMapTimeLimit(level, levelNumber);
  const { config, getBackgroundColor, getRegionColor, getAccentColor } = useGameConfig();

  // Background music, selected by 5-level band. Idempotent within a band, so it
  // plays continuously across levels and the per-round remount, switching only at
  // band boundaries. A missing band track falls back to main.ogg (see gameMusic).
  useEffect(() => {
    playMusicForLevel(levelNumber);
  }, [levelNumber]);

  // In-game tutorial step state. The interactive fence tutorial is level 1 only,
  // so it can never re-arm on a later map even if it was never marked seen.
  const [inGameStep, setInGameStep] = useState<InGameStep>(
    showInGameTutorial && levelNumber === 1 ? 'fence' : 'done'
  );
  // Draw-A-Fence tutorial is two steps (#62): a centered, PAUSED explainer modal
  // first, then (once dismissed) the running board with the draw-hint animation.
  // The modal was previously an overlay on the LIVE board, which hid it.
  const [fenceIntroOpen, setFenceIntroOpen] = useState(showInGameTutorial && levelNumber === 1);

  /**
   * The map ran out of time and a life went with it. Held here so the RESTART
   * waits on the explanation instead of racing it: the remount only happens
   * when the overlay is dismissed. Before this, the level came back inside the
   * red flash and a player who blinked never learned the clock had run out.
   */
  const [mapFailure, setMapFailure] = useState<MapFailure | null>(null);
  const handleMapFailed = useCallback((failure: MapFailure) => setMapFailure(failure), []);
  const dismissMapFailure = useCallback(() => {
    setMapFailure(null);
    onMapTimedOut?.();
  }, [onMapTimedOut]);

  const levelHasMovers = (level.entities ?? []).some(e => e.kind === 'mover');
  const [moverTutorialDismissed, setMoverTutorialDismissed] = useState(false);
  const showMoverOverlay = showMoverTutorial && levelHasMovers && !moverTutorialDismissed;

  // Breaking-obstacles intro — shown the first time a break-objective level loads
  // (issue #38). Persisted in localStorage; self-contained (no session wiring).
  const levelHasBreakObjective = (level.entities ?? []).some(
    e => e.kind === 'wall' && e.breakable === true && e.objective === true,
  );
  const [showBreakIntro, setShowBreakIntro] = useState(false);
  useEffect(() => {
    if (!levelHasBreakObjective) { setShowBreakIntro(false); return; }
    let seen = false;
    try { seen = !!localStorage.getItem('devend_break_tutorial_seen'); } catch { /* ignore */ }
    setShowBreakIntro(!seen);
  }, [levelHasBreakObjective, level.id]);

  // The delivery box: a genuinely new rule (a door that only opens inward, and
  // holds space hostage until fed), so it earns a real modal rather than being
  // filed quietly like the mover or the breakable.
  const levelHasBox = (level.entities ?? []).some(e => e.kind === 'box');
  const [showBoxIntro, setShowBoxIntro] = useState(false);
  useEffect(() => {
    if (!levelHasBox) { setShowBoxIntro(false); return; }
    let seen = false;
    try { seen = !!localStorage.getItem(BOX_SEEN_KEY); } catch { /* ignore */ }
    setShowBoxIntro(!seen);
  }, [levelHasBox, level.id]);

  // The launcher: the map does not start until you fire it, and the shot sets
  // the map's difficulty AND its pay for good. A player who does not know that
  // will flick it and never learn what the pull was for, so it earns a modal.
  const levelHasLauncher = (level.entities ?? []).some(e => e.kind === 'launcher');
  const [showLauncherIntro, setShowLauncherIntro] = useState(false);
  useEffect(() => {
    if (!levelHasLauncher) { setShowLauncherIntro(false); return; }
    let seen = false;
    try { seen = !!localStorage.getItem(LAUNCHER_SEEN_KEY); } catch { /* ignore */ }
    setShowLauncherIntro(!seen);
  }, [levelHasLauncher, level.id]);

  // "Wire the Integration" intro — shown the first time EACH circuit map loads.
  //
  // It used to be one flag for the whole game, so it appeared on level 15 and
  // never again. Level 16 is the map whose point is waking BOTH terminals, and
  // level 31 is sixteen levels further on with the mechanic crossed against a
  // one-way membrane; both were silent, and a returning player met a teal dot
  // with nothing attached to it. Per map is the smallest honest fix: three
  // maps, three explanations, still never twice for the same one.
  //
  // The old key is still read, so a player who has seen level 15's copy is not
  // shown it again on their next run through level 15.
  const levelHasCircuit = !!level.circuit;
  const [showCircuitIntro, setShowCircuitIntro] = useState(false);
  useEffect(() => {
    if (!levelHasCircuit) { setShowCircuitIntro(false); return; }
    let seen = false;
    try {
      seen = !!localStorage.getItem(circuitSeenKey(level.id))
        || (level.id === FIRST_CIRCUIT_MAP_ID && !!localStorage.getItem(LEGACY_CIRCUIT_SEEN_KEY));
    } catch { /* ignore */ }
    setShowCircuitIntro(!seen);
  }, [levelHasCircuit, level.id]);

  // Scope Creep explainer — shown once, the first time a speed surge actually
  // lands (the red Gauge chip appears). Persisted in localStorage; the game
  // pauses beneath it like the other modal tutorials.
  const [creepIntroSeen, setCreepIntroSeen] = useState(() => {
    try { return !!localStorage.getItem('devend_creep_tutorial_seen'); } catch { return false; }
  });
  // Power-up explainer (#59) — shown once, the first time a power-up appears on
  // the board (around level 8). Persisted in localStorage; the game pauses
  // beneath it like the other modal tutorials.
  const [pickupIntroSeen, setPickupIntroSeen] = useState(() => {
    try { return !!localStorage.getItem('devend_pickup_intro_seen'); } catch { return false; }
  });
  // Boss intro seen flag, keyed per boss map so each boss teaches its rules once.
  const [bossIntroSeen, setBossIntroSeen] = useState(false);
  useEffect(() => {
    if (!level.boss) { setBossIntroSeen(true); return; }
    try { setBossIntroSeen(!!localStorage.getItem(`devend_boss_intro_${level.id}`)); }
    catch { setBossIntroSeen(false); }
  }, [level.boss, level.id]);

  // Game state for top bar
  const [gameState, setGameState] = useState<GameStateInfo>({
    cutsUsed: 0,
    completedCuts: 0,
    spaceRemaining: 100,
    lockedBalls: 0,
    superiorLocks: 0,
    bossActive: false,
    bossHp: 0,
    bossMaxHp: 0,
    bossDefeated: false,
    freezeUsesRemaining: 0,
    moverDerailsRemaining: 0,
    moverBandsRemaining: 0,
    pushMode: "none",
    creepPercent: 0,
    ballCount: 1,
    pickupPresent: false,
    onBankAndContinue: undefined,
    pushBonusSoFar: 0,
    goals: [],
    ballsInPlay: 0,
    gameMessage: null,
  });

  // The board's boot cue: the board takes a moment (renderer chunk, WebGL
  // init) before it first presents. GameCanvas fires onCanvasReady the instant
  // it does, and its boot reveal (BoardBoot) starts once nothing covers it.
  const [canvasReady, setCanvasReady] = useState(false);
  const handleCanvasReady = useCallback(() => setCanvasReady(true), []);

  // Where the board's top edge sits inside the canvas area, as a percentage.
  // The board is square and centred in a taller frame, so the gutter above it
  // depends on the surface size and only GameCanvas can measure it. The
  // map-rule banner is centred in that gutter rather than pinned under the top
  // bar. 5 is GameCanvas's own pre-measurement default.
  const [boardTopPct, setBoardTopPct] = useState(5);
  const handleBoardTopPct = useCallback((pct: number) => setBoardTopPct(pct), []);

  // How much of the bottom of the canvas the pinned bars are sitting on. They
  // are opaque and they take taps, so a board drawn underneath them could not
  // be cut along its bottom edge at all (issue #78). Measured off the live
  // stack rather than reserved as a percentage: it is five rows deep on a bad
  // day and the ability row wraps, so no constant survives contact.
  // Null until the first reading: the board lays out against the live stack
  // rather than a guess (lib/boardLayoutLatch).
  const bottomBarsPx = useMeasuredBottomBars();

  /**
   * The first special fence a player ever owns, and the thing nobody told them.
   *
   * Acquiring one auto-opens that TYPE's card, which says what that fence does.
   * Nothing said the bar is a CHOOSER: that a cut now comes in kinds, that the
   * choice is a mode which stays until changed, and that standard is still
   * there in slot 1. The card mentions selection in a footer line, which is
   * where a reader who already knows looks and a reader who does not never
   * does.
   *
   * Shown BEFORE the type's own card, not after, for two reasons. The card's
   * footer would otherwise repeat what was just read, and the order matches
   * what is being learned: here is the row, then here is the thing you just put
   * in it.
   */
  // Resolved here, the way GameCanvas resolves it (the run's slots, else the
  // admin's dev slots), so the first render already knows whether the slot
  // row is drawn and the board is laid out once around it.
  const ownsSpecialFence = useMemo(
    () => (fenceSlotIds && fenceSlotIds.length > 0 ? fenceSlotIds : devFenceSlots()).some(id => id !== STANDARD_FENCE_ID),
    [fenceSlotIds],
  );
  const [fenceSwitchIntro, setFenceSwitchIntro] = useState(false);
  useEffect(() => {
    if (!ownsSpecialFence || hasSeenFenceSwitching()) return;
    // Marked on ARMING, not on dismiss: dying on the map that granted the fence
    // would otherwise re-arm it on the retry, and again on the next run.
    markFenceSwitchingSeen();
    setFenceSwitchIntro(true);
  }, [ownsSpecialFence]);

  const handleGameStateChange = useCallback((state: GameStateInfo) => {
    setGameState(state);
    onGameStateChange?.(state); // forward to a parent (Playground ability tester)
  }, [onGameStateChange]);

  // Read once per mount: the flag is flipped in the admin screen, which can only
  // be reached by leaving the game, so it cannot change while a map is running.
  const [lockDebug] = useState(isLockDebugEnabled);
  // Admin A/B for the unattributed frame time; see isStaticBgEnabled.
  const [staticBg] = useState(isStaticBgEnabled);

  /**
   * Locks THIS MAP, for every readout that sits next to a per-map requirement.
   *
   * It used to be `cumulativeLockedBalls + gameState.lockedBalls`, a whole-RUN
   * tally (reset only at run start, added to after every level), handed to a
   * HUD that compares it against `threadLockRequired`, which is per-map. The
   * gate is per-map too - checkSpaceWin reads game.lockedBallsCount - so from
   * the second level onward the top bar and Specs both announced an objective
   * the map had not met and would not clear on: "47/1", and "Lock objective
   * met! 84 of 2 balls locked" on an untouched board.
   *
   * One meaning per readout. The lock chip is part of the map HUD, so it counts
   * the map, with or without a requirement to compare against; the run-long
   * tally still drives the Micro Manager speed cap, which is the thing that
   * actually wanted it.
   */
  const mapLockedBalls = gameState.lockedBalls;

  // Scope Creep tuning (game-config.yml snake_case -> ScopeCreepConfig).
  // Memoized so GameCanvas's live-config effect only re-runs on real changes.
  // Hard Deadline door: removes the grace window, so the first surge lands at
  // second 0 of active play.
  const scopeCreepConfig = useMemo(() => ({
    graceSeconds: (activeModifiers.scopeCreepImmediate > 0 || level.boss?.creepFromStart) ? 0 : config.scope_creep.grace_seconds,
    stepSeconds: config.scope_creep.step_seconds,
    stepPercent: config.scope_creep.step_percent,
    maxSteps: config.scope_creep.max_steps,
  }), [config.scope_creep, activeModifiers.scopeCreepImmediate, level.boss]);

  // Per-map mutator (issue #54): one environmental modifier rolled per eligible
  // map (level 11+) from the run seed. A boss map (#56) forces its authored
  // mutator instead of rolling.
  const mapMutator = useMemo(
    // noneWeight 0 removes the "vanilla map" bucket, so every eligible map
    // draws a real mutator. Maps below the procedural band stay unmutated:
    // that gate is about teaching order, not about difficulty.
    // Authored first: a boss's forced mutator, then a map that pins one
    // (issue #77), and only then the procedural roll.
    // Authored first (a boss's forced mutator, then a map that pins one), then
    // the ?mutator= debug override, then the procedural roll. The override sits
    // below the authored pins so it can never silently replace a set-piece.
    // Authored pins are IDS into mapMutators.yml and have to be looked up; the
    // catalogue entry is what carries the name, description and behavior the
    // rest of the game reads off `mapMutator`.
    () => mutatorById(level.boss?.mutator) ?? mutatorById(level.mutator)
      ?? forcedMutator() ?? selectMapMutator(
        levelNumber, getRunRng(`mapMutator:${level.id}`),
      ),
    [levelNumber, level.id, level.boss, level.mutator],
  );

  // Per-map objective (issue #55): an optional goal rolled 0-or-1 per eligible
  // map from the run seed. A boss map (#56) uses its authored objective as the
  // MANDATORY win gate instead. Live progress is a pure read of mirrored counters.
  const mapObjective = useMemo(
    () => level.boss?.objective ?? selectMapObjective(levelNumber, getRunRng(`objective:${level.id}`)),
    [levelNumber, level.id, level.boss],
  );
  // The clock, read only on a map that shows time (lib/activeClock.ts).
  const activeSeconds = useActiveSeconds(mapTimeLimit != null || !!level.boss || mapObjective?.kind === "speedClear");
  const objectiveProgress = useMemo(
    () => mapObjective
      ? evaluateObjective(mapObjective, {
          lockedBalls: gameState.lockedBalls,
          superiorLocks: gameState.superiorLocks,
          cuts: gameState.cutsUsed,
          par: level.expectedCuts,
          activeSeconds: activeSeconds,
          bossDefeated: gameState.bossDefeated,
        })
      : null,
    [mapObjective, gameState.lockedBalls, gameState.superiorLocks, gameState.cutsUsed, activeSeconds, level.expectedCuts, gameState.bossDefeated],
  );

  
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  // Build readout for the bottom bar: owned upgrades per archetype tag.
  // A Specialisation counts toward its set, so its chip lights when the set does.
  const tagCounts = useMemo(() => {
    const lean = shopLeanOf(runOffer);
    return withVirtualTag(ownedTagCounts(ownedUpgradeIds, upgrades), lean?.tag, lean?.countsTowardSet ?? 0);
  }, [ownedUpgradeIds, upgrades, runOffer]);

  // ── Boss escalation feedback (issue #56) ─────────────────────────────────
  // Phase banner: flash "HOTFIX INCOMING" / "PANIC MODE" as the boss loses HP.
  const [bossPhaseLabel, setBossPhaseLabel] = useState<string | null>(null);
  const prevBossHpRef = useRef<number | null>(null);
  useEffect(() => {
    if (!level.boss || !gameState.bossActive) { prevBossHpRef.current = null; return; }
    const hp = gameState.bossHp;
    const prev = prevBossHpRef.current;
    prevBossHpRef.current = hp;
    if (prev == null || hp >= prev || gameState.bossDefeated) return; // only a real pre-defeat HP drop
    // Order matters: the first hit (hp === maxHp - 1) fires the clawback, so it
    // shows REVERTED even for a low-HP boss where that hit is also the last life.
    const label = hp === gameState.bossMaxHp - 1
      ? t('boss.reverted')            // first hit: the regression clawback fires
      : hp <= 1
        ? t('boss.panicMode')         // last life
        : t('boss.hotfixIncoming');
    setBossPhaseLabel(label);
    const timer = setTimeout(() => setBossPhaseLabel(null), 1800);
    return () => clearTimeout(timer);
  }, [gameState.bossHp, gameState.bossMaxHp, gameState.bossActive, gameState.bossDefeated, level.boss, t]);

  // "SHIPPED IT" flash the moment the boss is defeated (before the clear wave).
  const [shippedIt, setShippedIt] = useState(false);
  const prevDefeatedRef = useRef(false);
  useEffect(() => {
    if (gameState.bossDefeated && !prevDefeatedRef.current) {
      prevDefeatedRef.current = true;
      setShippedIt(true);
      const timer = setTimeout(() => setShippedIt(false), 1600);
      return () => clearTimeout(timer);
    }
    if (!gameState.bossDefeated) prevDefeatedRef.current = false;
  }, [gameState.bossDefeated]);

  // Boss maps (issue #56) re-skin the whole arena danger-red: accentColor threads
  // into the CRT background, board, fences and UI, so this one override recolours
  // everything at once.
  const BOSS_ACCENT = '#ff2d55';
  const accentColor = level.boss ? BOSS_ACCENT : (externalAccentColor || getAccentColor());

  const [topPanelOpen, setTopPanelOpen] = useState(false);
  /**
   * What the player asked about, when Specs was opened by tapping something
   * rather than by the Specs button. Cleared on close so the next plain open
   * is an ordinary browse.
   */
  const [topPanelFocus, setTopPanelFocus] = useState<PanelFocus>(null);
  const [abilityInfoOpen, setAbilityInfoOpen] = useState(false);
  const [fenceInfoOpen, setFenceInfoOpen] = useState(false);
  const [superiorInfoOpen, setSuperiorInfoOpen] = useState(false);
  // Press-and-hold on a board object. Owned here rather than in GameCanvas so it
  // joins modalOverlayActive and PAUSES the map: reading an explainer while the
  // balls keep bouncing behind it is how you lose a life to a tooltip.
  const [entityInfo, setEntityInfo] = useState<BoardEntityHit | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  /** Admin live map tuner (par / clear threshold), opened from the menu. */
  const [tuningOpen, setTuningOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // "How to win" modal: shown at the start of every map (win conditions now vary
  // by map), and reopenable from the top-left menu. Dismissing it lets the board
  // dissolve in behind it (the overlay's backdrop fades on tap). Starts false and
  // is armed by the level-id effect (which runs on mount too): this makes `paused`
  // transition false -> true so GameCanvas's pause effect actually fires and stops
  // the loop — initialising true would leave the loop running on the first map,
  // because the pause effect early-returns before the loop exists and never re-runs.
  const [winModalOpen, setWinModalOpen] = useState(false);
  // Announce the win conditions only when the map has something to say beyond
  // "clear X%", which the top bar already shows permanently. Every map still
  // has the menu entry, so this hides an interruption, not information.
  useEffect(() => {
    // The RUN's rules, not the map's: a loadout that adds a clause has made
    // this map worth announcing even when the map alone was not.
    setWinModalOpen(shouldAnnounceWinConditions(t, level, levelNumber, activeModifiers));
  }, [level, levelNumber, t, activeModifiers]);

  // Handle a BACK gesture while the game is active (wired via backRef from the
  // popstate guard in Index): close an open pause overlay/menu, otherwise open
  // the menu (Resume / Restart / Main Menu). This is what stops back from
  // exiting the app mid-run.
  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (menuOpen) setMenuOpen(false);
      else if (isPaused) setIsPaused(false);
      else setMenuOpen(true);
    };
    return () => { backRef.current = null; };
  }, [backRef, menuOpen, isPaused]);

  const [soundMuted, setSoundMutedState] = useState(() => isSoundMuted());
  // Set once the map is won; freezes the scrolling-code background through the
  // clear shimmer. Resets naturally when the next map remounts this screen.
  const [mapComplete, setMapComplete] = useState(false);
  const memParallaxTickRef = useRef<((timestamp: number) => void) | null>(null);

  // Deadline tension ramp (issue #56): in the final 10s of a timed map a red
  // vignette pulses and a heartbeat thumps once per second (the effect re-fires
  // as the whole-second countdown changes).
  const manualUnread = unreadManualCount();

  const contextLane = pickContext({
    mapComplete,
    hasMessage: gameState.gameMessage != null,
    shipEarlyVisible: mapTimeLimit != null && gameState.pushMode === 'none',
    timerCount: gameState.abilityTimers?.length ?? 0,
  });

  const deadlineRemaining = mapTimeLimit != null
    ? Math.max(0, Math.ceil(mapTimeLimit - activeSeconds))
    : null;
  const deadlineUrgent = deadlineRemaining != null && deadlineRemaining > 0 && deadlineRemaining <= 10
    && !gameState.bossDefeated && !mapComplete;
  useEffect(() => {
    if (deadlineUrgent) playHeartbeatSound();
  }, [deadlineUrgent, deadlineRemaining]);
  // The clock on the board's frame (DeadlineFrame), for as long as it can
  // still run out; and a soft tick as it passes each milestone on the way
  // down to the heartbeat.
  const deadlineShown = deadlineRemaining != null && !gameState.bossDefeated && !mapComplete;
  useEffect(() => {
    if (deadlineShown && deadlineRemaining != null && mapTimeLimit != null
      && deadlineMilestone(deadlineRemaining, mapTimeLimit) != null) {
      playDeadlineTickSound();
    }
  }, [deadlineShown, deadlineRemaining, mapTimeLimit]);

  // Close menu and unpause when the game ends so the overlays appear cleanly
  /**
   * The run-ending loss, held back until its reason has been read.
   *
   * Every OTHER way of losing a map already stops and says why (see
   * MapFailedOverlay), because that path is the retry path. The last life is
   * not on it, so the one death worth the most explanation - twenty minutes of
   * run, gone - was the only one delivered as a red flash and a screen change.
   */
  const [runEndingLoss, setRunEndingLoss] = useState<GameResult | null>(null);

  const handleGameEnd = useCallback((result: GameResult) => {
    setMenuOpen(false);
    setIsPaused(false);
    // A loss waits on its explanation; a win, and the theoretical loss with no
    // reason recorded, go straight through. `failure` is required by
    // handleGameOverFn, so the second case cannot happen today - but a screen
    // that would silently swallow the run if it ever did is not worth having.
    if (!result.isWin && result.failure) {
      setRunEndingLoss(result);
      return;
    }
    onGameEnd(result);
  }, [onGameEnd]);

  const dismissRunEndingLoss = useCallback(() => {
    setRunEndingLoss(prev => {
      if (prev) onGameEnd(prev);
      return null;
    });
  }, [onGameEnd]);

  /**
   * Set once the map ends, so the auto-pause below never drops a PAUSED sheet
   * over the results. GameScreen stays mounted underneath that overlay - it is
   * owned by the screen above this one - so "is the game running" is not
   * something this component can otherwise tell.
   */
  const levelEndedRef = useRef(false);
  useEffect(() => { levelEndedRef.current = false; }, [level.id, levelNumber]);

  // The ticket the player read before the map, with the marks the board
  // earned: same list, same words, so the Debrief and the failed screen are
  // that card filled in.
  const ticketRows = useCallback((marks: (boolean | null)[] | undefined): AcceptanceRow[] | undefined => (
    marks
      ? winConditions(t, level, levelNumber, activeModifiers).map((c, i) => ({
        group: c.group, text: c.text, met: marks[i] ?? null,
      }))
      : undefined
  ), [t, level, levelNumber, activeModifiers]);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    levelEndedRef.current = true;
    setIsPaused(false);
    const acceptance = ticketRows(scoreData.criteriaMet);
    onLevelComplete(acceptance ? { ...scoreData, acceptance } : scoreData);
  }, [onLevelComplete, ticketRows]);

  const canPause = gameState.pushMode === 'none';

  // Any modal/panel/menu that overlays the board should freeze the sim and
  // resume it on close (issue #41). The interactive fence tutorial is NOT a
  // modal — it needs the game running — so it is deliberately excluded.
  //
  // Each explainer trigger below is RAW (independent of the others). They are
  // rendered through a single-slot QUEUE (see the return body): only one modal
  // ever shows at a time, and dismissing it flips its own trigger off so the
  // next queued modal appears. This replaces the old ad-hoc `!showX` guards,
  // which only de-conflicted some pairs and still let e.g. the per-map "how to
  // win" modal stack on top of a one-time teaching overlay.
  const showBreakOverlay = showBreakIntro;
  const showCircuitOverlay = showCircuitIntro;
  const showTopBarOverlay = levelNumber === 2 && showTopBarTutorial;
  const showBottomBarOverlay = levelNumber === 3 && showBottomBarTutorial;
  // Time-limit intro: the first timed map (level 4, just past the exempt band).
  const showTimeLimitOverlay = levelNumber === TIME_LIMIT_EXEMPT_MAX_LEVEL + 1 && showTimeLimitTutorial;
  const showCreepOverlay = !creepIntroSeen && gameState.creepPercent > 0 && !level.boss;
  // Power-up explainer (#59): first time a power-up shows up on the board (not on
  // boss maps, which are teaching their own rules).
  const showPickupOverlay = !pickupIntroSeen && gameState.pickupPresent && !level.boss;
  // Boss intro card (issue #56): a one-time-per-boss explainer shown when a boss
  // map first loads, before anything else, so the fight's rules are clear.
  const showBossOverlay = !!level.boss && !bossIntroSeen;
  const showWinModal = winModalOpen && !mapComplete;
  // Any queued explainer modal is up (used to gate building the queue + to pause).
  // EVERY entry in the explainer queue below must appear here. This flag gates
  // whether the queue renders at all, and pauses the game behind it, so a modal
  // missing from this list is a modal that cannot show when it is the only one
  // waiting - and, because its open flag is then never cleared, one that
  // ambushes a later map by jumping the queue in front of that map's own
  // explainer.
  const anyExplainerModal = !noCards && (
    showTimeLimitOverlay || showCreepOverlay || showBossOverlay || showWinModal
    || fenceIntroOpen || showBoxIntro || showLauncherIntro
    || showCircuitOverlay || fenceSwitchIntro
  );

  // Whether the board may be revealed yet. Ready is not enough: a reveal played
  // behind the opening explainer would be over before anyone saw it, so the
  // boot stand-in stays until the board is ready with no card over it, once;
  // a card reopened mid-map does not bring it back.
  const [boardShown, setBoardShown] = useState(false);
  useEffect(() => {
    if (canvasReady && !anyExplainerModal) {
      setBoardShown(true);
    }
  }, [canvasReady, anyExplainerModal]);


  // Mechanics the player has just met. These used to stop the game to deliver a
  // paragraph; now they are filed in the Manual and the Specs button badges, so
  // the explanation stays available without costing the frame they were playing.
  // The original "seen" flags are still set, so nothing re-fires.
  useEffect(() => {
    if (showMoverOverlay) { fileManualEntry('mover'); setMoverTutorialDismissed(true); onMoverTutorialSeen?.(); }
  }, [showMoverOverlay, onMoverTutorialSeen]);
  useEffect(() => {
    if (showBreakOverlay) { fileManualEntry('break'); setShowBreakIntro(false); try { localStorage.setItem('devend_break_tutorial_seen', '1'); } catch { /* ignore */ } }
  }, [showBreakOverlay]);
  useEffect(() => {
    if (showTopBarOverlay) { fileManualEntry('topBar'); onTopBarTutorialSeen?.(); }
  }, [showTopBarOverlay, onTopBarTutorialSeen]);
  useEffect(() => {
    // The fence slots are filed alongside it. Both are about the strip under
    // the board, level 3 is where that strip gets explained, and level 4 is the
    // earliest the shop can offer a fence type - so this lands one map before
    // the player can own something to put in a slot.
    if (showBottomBarOverlay) {
      fileManualEntry('bottomBar');
      fileManualEntry('fenceSlots');
      onBottomBarTutorialSeen?.();
    }
  }, [showBottomBarOverlay, onBottomBarTutorialSeen]);
  useEffect(() => {
    if (showPickupOverlay) { fileManualEntry('pickup'); setPickupIntroSeen(true); try { localStorage.setItem('devend_pickup_intro_seen', '1'); } catch { /* ignore */ } }
  }, [showPickupOverlay]);

  const modalOverlayActive =
    topPanelOpen || menuOpen || abilityInfoOpen || fenceInfoOpen || superiorInfoOpen || !!entityInfo || anyExplainerModal;

  /**
   * Pause when the page is hidden: a call, a notification, a lock screen, an
   * app switch. See src/lib/autoPause.ts for why the conditions are worth their
   * own module.
   *
   * `visibilitychange` rather than `blur`: blur also fires when the player
   * clicks another window while still watching this one, and pausing a game
   * somebody is looking at is worse than not pausing one they are not.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (shouldAutoPause({
        hidden: document.visibilityState === 'hidden',
        alreadyPaused: isPaused,
        modalActive: modalOverlayActive,
        levelEnded: levelEndedRef.current,
      })) setIsPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isPaused, modalOverlayActive]);

  /**
   * Pause when the browser's zoom got through and stuck.
   *
   * Reported a fourth time as "I still accidentally zoom out some times and it
   * is breaking everything", which is the accurate half nobody had acted on:
   * three rounds of prevention all tried to stop the gesture and none of them
   * did anything about the board once it had happened. The page un-zooms itself
   * where it can (lib/viewportZoom) and this is what happens when it cannot -
   * the same hold a hidden page gets, for the same reason, and it resumes the
   * same way: by hand.
   */
  useEffect(() => {
    if (shouldPauseForZoom({
      zoomStuck: viewportZoomStuck,
      hidden: false,
      alreadyPaused: isPaused,
      modalActive: modalOverlayActive,
      levelEnded: levelEndedRef.current,
    })) setIsPaused(true);
  }, [viewportZoomStuck, isPaused, modalOverlayActive]);



  // The play screen's interface is drawn on the canvas (CANVAS_UI_PLAN.md):
  // the DOM keeps only the backgrounds, the board, and two spacers that
  // reserve the HUD's space so GameCanvas lays the board out exactly where
  // the canvas HUD leaves room for it (ui/game/hudMetrics).
  const topHeight = topBarHeight();
  // The pane the play screen fills: the window in the game, a pane beside its
  // controls in the admin Playground. The canvas interface is framed to it.
  const paneBox = useScreenBox(paneRef);
  const pushExitShown = canStopPushing({
    mapComplete,
    pushMode: gameState.pushMode,
    hasHandler: gameState.onBankAndContinue != null,
  });
  const hasAbilities = getAllAbilities().some(a => ((abilityCharges ?? {})[a.id] ?? 0) > 0);
  const stackHeight = bottomStackHeight({ mapComplete, hasFenceTypes: ownsSpecialFence, hasAbilities, pushExit: pushExitShown });
  const chip = (left: number, total: number) => ({ left, total: Math.round(total) });

  return (
    <>
      {/* CRT Terminal Background */}
      <CRTBackground accentColor={accentColor} paused={mapComplete || staticBg} />

      {/* Memory Parallax Layer - between CRT and game. Not mounted at all on a
          frozen background: unmounted, its tick ref stays null and the game
          loop skips the bg step, so a phone draws one background, not three. */}
      {!staticBg && <MemoryParallaxLayer accentColor={accentColor} externalTickRef={memParallaxTickRef} />}

      <div ref={paneRef} className="absolute inset-0 flex flex-col z-10">
        <div style={{ height: topHeight, flexShrink: 0 }} />
        <div className="flex-1 min-h-0 relative">
          <PlayFrameContext.Provider value={paneBox}>
            <GameCanvas
              level={level}
              levelNumber={levelNumber}
              totalLevels={totalLevels}
              totalScore={totalScore}
              lives={lives}
              lockstep={lockstep}
              isPairGuest={isPairGuest}
              pairPartnerName={pairPartnerName}
              onLivesChange={onLivesChange}
              onGrantAbility={onGrantAbility}
              abilityCharges={abilityCharges ?? {}}
              abilitySlots={abilitySlots}
              fenceSlotIds={fenceSlotIds}
              onSpendAbility={onSpendAbility}
              onRequestSuperiorInfo={() => setSuperiorInfoOpen(true)}
              onRequestEntityInfo={setEntityInfo}
              onGameEnd={handleGameEnd}
              onMapTimedOut={handleMapFailed}
              onLevelComplete={handleLevelComplete}
              onBallTypeLocked={onBallTypeLocked}
              onMapComplete={() => { setMapComplete(true); onMapComplete?.(); }}
              onCanvasReady={handleCanvasReady}
              onBoardTopPct={handleBoardTopPct}
              revealReady={boardShown}
              noCards={noCards}
              bottomInsetPx={bottomBarsPx}
              runStartIntro={runStartIntro}
              freezeOnComplete={freezeOnClear}
              onGameStateChange={handleGameStateChange}
              paused={isPaused || modalOverlayActive}
              tutorialMode={inGameStep === 'fence' && !fenceIntroOpen}
              tutorialStep={inGameStep === 'fence' && !fenceIntroOpen ? 'waitingForSuccessfulCut' : 'completed'}
              onTutorialCutSuccess={() => {
                setInGameStep('done');
                onFenceSeen?.();
              }}
              canvasOpacity={config.visuals.canvas_opacity}
              fenceSpeedBase={config.fence.speed_base}
              fenceSpeedMin={config.fence.speed_min}
              fenceSpeedPerLevel={config.fence.speed_per_level}
              moverFenceDragPerFence={config.mover.fence_drag_per_fence}
              moverFenceDragFloor={config.mover.fence_drag_floor}
              lockWinThresholdPercent={config.lock.win_threshold_percent}
              lockMinRegionCells={config.lock.min_region_cells}
              scopeCreep={scopeCreepConfig}
              mapMutator={mapMutator}
              objective={mapObjective}
              pickupConfig={config.pickups}
              bugConfig={config.bugs}
              shardBombConfig={config.shardBombs}
              regionColor={getRegionColor()}
              accentColor={accentColor}
              activeModifiers={activeModifiers}
              cumulativeLockedBalls={cumulativeLockedBalls}
              parallaxTickRef={memParallaxTickRef}
              showBallSpeeds={showBallSpeeds}
              showPerfOverlay={showPerfOverlay}
              deadlineSecondsLeft={deadlineShown ? deadlineRemaining : null}
              deadlineLimit={mapTimeLimit ?? null}
            />
          </PlayFrameContext.Provider>
        </div>
        {/* The bottom stack's space, held for the canvas bars. The admin
            Playground and GameCanvas measure the stack through this attribute,
            exactly as they measured the DOM stack. */}
        <div
          data-bottom-bars=""
          className="fixed bottom-0 left-0 right-0 pointer-events-none"
          style={{ height: stackHeight }}
        />
      </div>

      <CanvasLayer id="play" z={10} lock={canvasPageLock}>
        <UiFrame box={paneBox}>
          <PlayLayout
            topHeight={topHeight}
            top={
              <GameTopBar
                noInfo={noCards}
                levelNumber={levelNumber}
                cutsUsed={gameState.cutsUsed}
                parCuts={level.expectedCuts}
                lives={lives}
                continuesRemaining={continuesRemaining}
                spaceRemaining={gameState.spaceRemaining}
                spaceRequired={level.sizeThreshold}
                lockedBalls={mapLockedBalls}
                threadLockRequired={level.threadLockRequired}
                goals={gameState.goals}
                ballsInPlay={gameState.ballsInPlay}
                onExplainWin={() => setWinModalOpen(true)}
                scopeCreepPercent={gameState.creepPercent}
                accentColor={accentColor}
                certificateProgress={certificateProgress}
                // Opened to BROWSE, so nothing leads.
                onExpand={() => { setTopPanelFocus(null); setTopPanelOpen(true); }}
              />
            }
            region={r => (
              <>
                <PairTurnOverlay
                  turn={mapComplete ? null : gameState.pairTurn}
                  partnerName={pairPartnerName ?? t("pair.partner")}
                  myColor={getLocalPlayer() === 0 ? accentColor : PARTNER_FENCE_HEX}
                  partnerColor={getLocalPlayer() === 0 ? PARTNER_FENCE_HEX : accentColor}
                  onPass={gameState.onPassTurn}
                  origin={{ x: r.x, y: r.y }} width={r.width} height={r.height}
                />
                <LockDebugOverlay visible={lockDebug} origin={{ x: r.x, y: r.y }} width={r.width} height={r.height} />
                <PlayChips
                  accentColor={accentColor}
                  top={r.y}
                  freeze={activeModifiers.freezeUsesPerMap > 0 && !mapComplete
                    ? chip(gameState.freezeUsesRemaining, activeModifiers.freezeUsesPerMap) : null}
                  derails={activeModifiers.moverDerailPerMap > 0 && !mapComplete
                    ? chip(gameState.moverDerailsRemaining, activeModifiers.moverDerailPerMap) : null}
                  bands={activeModifiers.moverBandPerMap > 0 && !mapComplete
                    ? chip(gameState.moverBandsRemaining, activeModifiers.moverBandPerMap) : null}
                  fenceBudget={level.fenceBudget != null && !mapComplete
                    ? chip(fencesLeft(level.fenceBudget, gameState.completedCuts ?? 0), level.fenceBudget) : null}
                />
                {/* The map's rule, centred in the gutter between the top bar and
                    the board's top edge, costing the board no height. */}
                {mapMutator && (
                  <MapRuleBanner
                    mutator={mapMutator}
                    onExplain={() => { setTopPanelFocus('mapRule'); setTopPanelOpen(true); }}
                    layout={{
                      position: "absolute", left: r.x, top: r.y,
                      width: r.width, height: Math.max(0, (r.height * boardTopPct) / 100),
                    }}
                  />
                )}
                {level.boss && gameState.bossActive && (
                  <BossBanner
                    name={contentText.bossName(t, { id: level.id, name: level.boss.name })}
                    timeLimit={mapTimeLimit}
                    activeSeconds={activeSeconds}
                    hp={gameState.bossHp}
                    maxHp={gameState.bossMaxHp}
                    defeated={gameState.bossDefeated}
                    accentColor={accentColor}
                    layout={{ position: "absolute", left: 0, top: 70, width: r.width, alignItems: "center" }}
                  />
                )}
                {/* A dropped pair link covers the board, not the whole app. */}
                {pairBanner && isValidElement<{ region?: PlayRegion }>(pairBanner)
                  ? cloneElement(pairBanner, { region: r }) : pairBanner}
              </>
            )}
            edge={r => (
              <>
                {/* Out of time: round the region, red and pulsing, never takes a tap. */}
                <BoardAlert urgent={deadlineUrgent && !mapComplete} seconds={deadlineRemaining}
                  origin={{ x: r.x, y: r.y }} width={r.width} height={r.height} />
                {/* The UNUSUAL part of a map, so the extras rather than every goal. */}
                <WinGateFrame
                  present={extraGoals(gameState.goals).length > 0 && !mapComplete}
                  outstanding={outstandingGoals(extraGoals(gameState.goals)).length > 0}
                  origin={{ x: r.x, y: r.y }} width={r.width} height={r.height}
                />
              </>
            )}
            bottom={
              // Gone the instant the map is won: the bars must never outlive the board.
              <View visible={!mapComplete} layout={{ alignSelf: "stretch" }}>
                {/* Only once there is something to choose: Standard alone is no choice. */}
                {!mapComplete && ownsSpecialFence && (
                  <FenceSlotBar
                    slotIds={gameState.fenceSlotIds ?? []}
                    selectedId={gameState.selectedFenceTypeId ?? STANDARD_FENCE_ID}
                    accentColor={accentColor}
                    onSelect={gameState.onSelectFenceType ?? (() => {})}
                    shieldSpent={gameState.guardrailSpent ?? false}
                    onInfoOpenChange={setFenceInfoOpen}
                    deferAutoInfo={fenceSwitchIntro || noCards}
                    noInfo={noCards}
                  />
                )}
                {!mapComplete && (
                  <AbilityBar
                    charges={abilityCharges ?? {}}
                    accentColor={accentColor}
                    onUse={gameState.onUseAbility ?? (() => {})}
                    armedAbilityId={gameState.armedAbility}
                    onInfoOpenChange={setAbilityInfoOpen}
                    noInfo={noCards}
                  />
                )}
                {/* ONE lane for the three readouts (lib/hudContext); it holds its
                    height whether or not a readout is using it. */}
                {contextLane === 'message' ? (
                  <GameMessageBar message={gameState.gameMessage ?? null} accentColor={accentColor} visible />
                ) : contextLane === 'shipEarly' ? (
                  <ShipEarlyBar
                    seconds={activeSeconds}
                    ballCount={gameState.ballCount}
                    timeLimit={mapTimeLimit ?? 0}
                    extraSecondsPerBall={activeModifiers.shipEarlySecondsPerBall}
                    bonusMultiplier={activeModifiers.shipEarlyBonusMultiplier}
                    visible
                  />
                ) : contextLane === 'abilityTimers' ? (
                  <AbilityCountdownBar timers={gameState.abilityTimers ?? []} visible />
                ) : (
                  <View layout={{ height: HUD.contextLane }} />
                )}
                {/* An ACTION, not a readout: its own row, never queued behind a message. */}
                {pushExitShown && (
                  <PushExitBar
                    bonusSoFar={gameState.pushBonusSoFar}
                    onBank={gameState.onBankAndContinue!}
                    accentColor={accentColor}
                  />
                )}
                {/* Every control the map has, in one place, in the thumb zone. */}
                <ControlsRow
                  accentColor={accentColor}
                  menuOpen={menuOpen}
                  onToggleMenu={() => setMenuOpen(prev => !prev)}
                  onCloseMenu={() => setMenuOpen(false)}
                  canPause={canPause}
                  isPaused={isPaused}
                  onTogglePause={() => { setMenuOpen(false); setIsPaused(prev => !prev); }}
                  manualUnread={manualUnread}
                  onOpenSpecs={() => { setTopPanelFocus(null); setTopPanelOpen(true); }}
                  onOpenWin={() => setWinModalOpen(true)}
                  soundMuted={soundMuted}
                  onToggleSound={() => {
                    const next = !soundMuted;
                    setSoundMuted(next);
                    setSoundMutedState(next);
                  }}
                  adminMode={!!adminMode}
                  onOpenTuning={() => { setMenuOpen(false); setTuningOpen(true); }}
                  onRestart={() => { setMenuOpen(false); onRestart(); }}
                  onMainMenu={() => { setMenuOpen(false); onMainMenu(); }}
                />
              </View>
            }
            over={
              <>
                <ScreenFx
                  deadlineUrgent={deadlineUrgent}
                  bossPhaseLabel={bossPhaseLabel}
                  bossDefeated={!!gameState.bossDefeated}
                  shippedIt={!!shippedIt}
                />
                {/* Superior-lock explainer (opened by holding a superior lock's star) */}
                {superiorInfoOpen && !noCards && <SuperiorLockInfoModal onClose={() => setSuperiorInfoOpen(false)} />}
                {entityInfo && !noCards && (
                  <BoardEntityInfoModal hit={entityInfo} accentColor={accentColor} onClose={() => setEntityInfo(null)} />
                )}
                {isPaused && (
                  <PauseOverlay accentColor={accentColor} zoomStuck={viewportZoomStuck} onResume={() => setIsPaused(false)} />
                )}
                {anyExplainerModal && (() => {
          type Explainer = {
            show: boolean; accentColor: string; title: string; body: string;
            onDismiss: () => void; graphic?: ReactNode; align?: "center" | "left";
            /** The criteria as rows: drawn as the map's ticket, not the generic card. */
            criteria?: Criterion[];
            /** Cut a hole in the scrim over the thing being talked about. */
            spotlightArea?: 'top' | 'bottom'; spotlightHeightPx?: number;
          };
          const queue: Explainer[] = [
            ...(level.boss ? [{
              show: showBossOverlay,
              accentColor: '#ff4d6d',
              title: t('game.bossIntroTitle', { name: contentText.bossName(t, { id: level.id, name: level.boss.name }) }),
              body: contentText.bossIntro(t, { id: level.id, intro: level.boss.intro }),
              onDismiss: () => {
                setBossIntroSeen(true);
                try { localStorage.setItem(`devend_boss_intro_${level.id}`, '1'); } catch { /* ignore */ }
              },
            }] : []),
            {
              show: showLauncherIntro,
              accentColor: '#ffb347',
              title: t('game.launcherIntroTitle'),
              body: t('game.launcherIntroBody'),
              onDismiss: () => {
                fileManualEntry('launcher');
                setShowLauncherIntro(false);
                try { localStorage.setItem(LAUNCHER_SEEN_KEY, '1'); } catch { /* ignore */ }
              },
            },
            {
              show: showCircuitOverlay,
              accentColor: '#7fe3d4',
              title: t('game.circuitTutorialTitle'),
              body: t('game.circuitTutorialBody'),
              onDismiss: () => {
                fileManualEntry('circuit');
                setShowCircuitIntro(false);
                try { localStorage.setItem(circuitSeenKey(level.id), '1'); } catch { /* ignore */ }
              },
            },
            {
              show: showBoxIntro,
              accentColor: '#ffb347',
              title: t('game.boxIntroTitle'),
              body: t('game.boxIntroBody'),
              onDismiss: () => {
                fileManualEntry('box');
                setShowBoxIntro(false);
                try { localStorage.setItem(BOX_SEEN_KEY, '1'); } catch { /* ignore */ }
              },
            },
            {
              show: showWinModal, accentColor,
              title: t('winConditions.title'), body: winConditionsBody(t, level, levelNumber, activeModifiers),
              // The one explainer that is a LIST rather than a paragraph, so it
              // gets its own modal: the map's ticket, criteria as checklist rows.
              align: 'left' as const,
              criteria: winConditions(t, level, levelNumber, activeModifiers),
              onDismiss: () => setWinModalOpen(false),
            },
            {
              show: showTimeLimitOverlay, accentColor,
              title: t('game.timeLimitTutorialTitle'), body: t('game.timeLimitTutorialBody'),
              onDismiss: () => onTimeLimitTutorialSeen?.(),
            },
            {
              show: showCreepOverlay, accentColor: '#ff6b6b',
              title: t('game.creepTutorialTitle'), body: t('game.creepTutorialBody'),
              onDismiss: () => { setCreepIntroSeen(true); try { localStorage.setItem('devend_creep_tutorial_seen', '1'); } catch { /* ignore */ } },
            },
            {
              // The same words the Manual files under `fenceSlots`, deliberately:
              // one statement of how the bar works, read here the first time and
              // available from Specs forever after.
              show: fenceSwitchIntro, accentColor,
              title: t('game.fenceSlotsTutorialTitle'), body: t('game.fenceSlotsTutorialBody'),
              // Over the bar itself, which is the whole point: the scrim leaves
              // the slots lit so the player reads the sentence and the row it is
              // about at the same time. The height is the measured stack, so the
              // hole cannot drift from what it is cutting around.
              spotlightArea: 'bottom' as const, spotlightHeightPx: bottomBarsPx ?? BOTTOM_BARS_FALLBACK_PX,
              onDismiss: () => { fileManualEntry('fenceSlots'); setFenceSwitchIntro(false); },
            },
            {
              show: fenceIntroOpen, accentColor,
              title: t('interactiveTutorial.drawAFence'), body: t('interactiveTutorial.dragInstruction'), graphic: <FenceArt />,
              // Dismissing marks it seen. The modal IS the explanation; the guided
              // hint that follows is practice, and it still runs this map either
              // way. Previously only a successful tutorial cut persisted anything,
              // so dismissing this and then dying on level 1 - or reloading a
              // ?level= debug jump without finishing the map - re-armed
              // it on every single run, forever.
              onDismiss: () => { setFenceIntroOpen(false); onFenceSeen?.(); },
            },
          ];
          const active = queue.find(m => m.show);
          if (active?.criteria) {
            return (
              <AcceptanceCriteriaModal
                criteria={active.criteria}
                levelNumber={levelNumber}
                levelId={level.id}
                levelName={level.name}
                levelPremise={level.premise}
                accentColor={active.accentColor}
                onDismiss={active.onDismiss}
              />
            );
          }
          return active ? (
            <TutorialOverlay
              visible
              onDismiss={active.onDismiss}
              accentColor={active.accentColor}
              title={active.title}
              body={active.body}
              align={active.align}
              graphic={active.graphic}
              spotlightArea={active.spotlightArea}
              spotlightHeightPx={active.spotlightHeightPx}
            />
          ) : null;
        })()}
                {/* Admin live map tuner, showing the tuned view against the authored map. */}
                {tuningOpen && adminMode && (
                  <MapTuningModal level={level} onClose={() => setTuningOpen(false)} />
                )}
                {/* Full-screen Specs panel: build, objectives, assignment, status,
                    upgrades and the full attribute breakdown. */}
                <TopBarDetailsPanel
                  visible={topPanelOpen}
                  focus={topPanelFocus}
                  onClose={() => { setTopPanelOpen(false); setTopPanelFocus(null); }}
                  levelNumber={levelNumber}
                  cutsUsed={gameState.cutsUsed}
                  parCuts={level.expectedCuts}
                  lives={lives}
                  continuesRemaining={continuesRemaining}
                  spaceRemaining={gameState.spaceRemaining}
                  spaceRequired={level.sizeThreshold}
                  lockedBalls={mapLockedBalls}
                  threadLockRequired={level.threadLockRequired}
                  ownedUpgrades={ownedUpgrades}
                  accentColor={accentColor}
                  certificateProgress={certificateProgress}
                  microManagerPerLock={activeModifiers.microManagerPerLock}
                  scalingReadouts={scalingReadouts}
                  runOffer={runOffer}
                  tagCounts={tagCounts}
                  tagSetThreshold={tagSetThreshold}
                  activeModifiers={activeModifiers}
                  modifierSources={modifierSources}
                  capstone={capstone}
                  mapMutator={mapMutator}
                  objective={mapObjective}
                  objectiveProgress={objectiveProgress}
                />
                {/* Above everything: a life just went. The run-ending case first:
                    if both were ever set, the milder one would be the wrong choice. */}
                {runEndingLoss?.failure ? (
                  <MapFailedOverlay
                    failure={runEndingLoss.failure}
                    acceptance={ticketRows(runEndingLoss.failure.criteriaMet)}
                    levelNumber={levelNumber}
                    levelId={level.id}
                    levelName={level.name}
                    levelPremise={level.premise}
                    livesLeft={0}
                    runOver
                    accentColor={accentColor}
                    onDismiss={dismissRunEndingLoss}
                  />
                ) : mapFailure ? (
                  <MapFailedOverlay
                    failure={mapFailure}
                    acceptance={ticketRows(mapFailure.criteriaMet)}
                    levelNumber={levelNumber}
                    levelId={level.id}
                    levelName={level.name}
                    levelPremise={level.premise}
                    livesLeft={lives}
                    accentColor={accentColor}
                    onDismiss={dismissMapFailure}
                  />
                ) : null}
              </>
            }
          />
        </UiFrame>
      </CanvasLayer>
    </>
  );
}
