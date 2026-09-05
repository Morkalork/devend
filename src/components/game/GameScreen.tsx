/**
 * GameScreen — the in-game layout: GameTopBar above, GameCanvas in the
 * middle, the live action bars (ability controls, Ship Early countdown,
 * ability timers) pinned to the bottom, plus background layers, the in-game
 * menu and tutorial overlays.
 *
 * The top bar's Specs button (and tapping the bar) opens the full-screen
 * TopBarDetailsPanel: the run's build, upgrades, assignment and attributes.
 */
import { useState, useCallback, useRef, useEffect, useMemo, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateScore } from '@/lib/scoring';
import { ownedTagCounts, DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { Menu, Home, RotateCcw, Pause, Play, Volume2, VolumeX, Snowflake, Fence, Target, SlidersHorizontal, TrendingUp, Landmark, ClipboardList } from 'lucide-react';
import { fencesLeft } from '@/lib/fenceBudget';
import { winConditionsBody, shouldAnnounceWinConditions } from '@/lib/winConditions';
import { ascensionAnnouncement, rungsUpTo, shouldAnnounceAscension } from '@/lib/ascensionLadder';
import { MapTuningModal } from './MapTuningModal';
import { GameCanvas, GameStateInfo } from './GameCanvas';
import { SuperiorLockInfoModal } from './SuperiorLockInfoModal';
import { BoardEntityInfoModal } from './BoardEntityInfoModal';
import type { BoardEntityHit } from '@/lib/boardEntityInfo';
import { GameTopBar } from './GameTopBar';
import { AnimatePresence } from 'framer-motion';
import { MapRuleBanner } from './MapRuleBanner';
import { MapFailedOverlay } from './MapFailedOverlay';
import type { MapFailure } from '@/lib/mapFailure';
import { ShipEarlyBar } from './ShipEarlyBar';
import { AbilityBar } from './AbilityBar';
import { GameMessageBar } from './GameMessageBar';
import { AbilityCountdownBar } from './AbilityCountdownBar';
import { TopBarDetailsPanel, type PanelFocus } from './TopBarDetailsPanel';
import { shouldAutoPause } from '@/lib/autoPause';
import { CRTBackground } from './CRTBackground';
import { MemoryParallaxLayer } from './MemoryParallaxLayer';
import { TutorialOverlay } from './TutorialOverlay';
import { LockDebugOverlay } from './LockDebugOverlay';
import { isLockDebugEnabled } from '@/lib/lockDiagnostics';
import { fileManualEntry } from '@/lib/manual';
import { circuitSeenKey, FIRST_CIRCUIT_MAP_ID, LEGACY_CIRCUIT_SEEN_KEY, BOX_SEEN_KEY, LAUNCHER_SEEN_KEY } from '@/lib/circuitHint';
import { isStaticBgEnabled } from '@/lib/rendering/perfStats';
import { MoverArt, BreakArt, CircuitArt, PickupArt, FenceArt } from './TutorialArt';
import { BossBanner } from './BossBanner';
import { contentText } from '@/i18n/content';
import { playHeartbeatSound } from '@/lib/gameAudio';
import { LevelConfig } from '@/types/level';
import { getMapTimeLimit, TIME_LIMIT_EXEMPT_MAX_LEVEL } from '@/lib/mapTiming';
import { selectMapMutator, getMapMutators } from '@/lib/mapMutators';
import { debugMutatorId } from '@/lib/devFlags';
import type { MapMutator } from '@/types/mapMutator';
import { selectMapObjective, evaluateObjective } from '@/lib/mapObjectives';
import { getRunRng } from '@/lib/runRng';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import { LoadoutConfig, AscensionRung } from '@/types/loadout';
import type { ScalingReadout } from '@/lib/upgradeScaling';
import { AssignmentConfig, AssignmentMapResult } from '@/types/assignment';
import { evaluateAssignment } from '@/lib/assignments';
import { CapstoneConfig } from '@/types/capstone';
import { useGameConfig } from '@/hooks/useGameConfig';
import { playMusicForLevel } from '@/lib/gameMusic';
import { isSoundMuted, setSoundMuted } from '@/lib/soundSettings';
import { GameModifiers, ModifierSource } from '@/hooks/useActiveModifiers';
import { PushExitBar } from '@/components/game/PushExitBar';
import { canStopPushing } from '@/lib/pushLuck';
import { WinGateFrame } from '@/components/game/WinGateFrame';
import { gateSatisfied } from '@/lib/winHud';
import { BoardAlert } from '@/components/game/BoardAlert';
import { pickContext } from '@/lib/hudContext';
import { unreadManualCount } from '@/lib/manual';

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
  /** Per-run revives banked; shown in the HUD. */
  continuesRemaining?: number;
  onLivesChange: (newLives: number) => void;
  /** A chest granted one charge of an ability; the session banks it run-wide (#38). */
  onGrantAbility?: (abilityId: string) => void;
  /** The player spent one ability charge (pressed the ability button). */
  onSpendAbility?: (abilityId: string) => void;
  /** Run-wide banked ability charges: { abilityId -> count }, for the ability bar. */
  abilityCharges?: Record<string, number>;
  /** Distinct abilities holdable at once (ascension can tighten it). */
  abilitySlots?: number;
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
  ascensionDepth?: number;
  /** Best score per map id, for the Benchmarking highscore bar (#45). */
  mapHighscores?: Record<string, number>;
  /** Run-pace delta vs the best run (HIGHSCORES.md); rides Benchmarking. */
  runPaceDelta?: number | null;
  /** Active assignment + Promotion, for the top bar's contract chips (#49). */
  activeDoor?: AssignmentConfig | null;
  /** Per-map mission results this block (#60), for live progress in the Specs panel. */
  blockResults?: AssignmentMapResult[];
  capstone?: CapstoneConfig | null;
  activeLoadouts?: LoadoutConfig[];
  /** Ball hits a fence survives (Ascension); null = indestructible. */
  fenceDurability?: number | null;
  /** The ladder rungs themselves, for the "what does this depth add" modal. */
  ascensionLadder?: AscensionRung[];
  /** What build scaling is paying right now (upgradeScaling.ts). */
  scalingReadouts?: ScalingReadout[];
  /** Constant Change (ascension rung 9): every eligible map rolls a mutator. */
  everyMapMutated?: boolean;
  /** Use It Or Lose It (ascension rung 7): multiplies pickup token lifetime. */
  pickupLifetimeFactor?: number;
  /** Admin: unlocks the live map tuner in the in-game menu. */
  adminMode?: boolean;
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
  /** Run-start intro: the board assembles from shatter tiles (reverse of the
   *  level-clear dissolve). Only true for the first map of a run. */
  introAssemble?: boolean;
  /** Owned upgrades of a tag needed to activate its set bonus (build readout). */
  tagSetThreshold?: number;
}

/**
 * A mutator by `id`, or null when the catalogue has no such entry.
 *
 * Every pinned mutator goes through here: an unknown id leaves the map vanilla
 * rather than handing the UI a half-object. map.yml pinned `gravity` for a
 * while, which is the BEHAVIOR name and not any entry's id, and because the pin
 * used to be dropped straight into `mapMutator` unresolved, the map showed an
 * empty rule card and never actually pulled. mapPins.test.ts refuses a pin that
 * names nothing now.
 *
 * At module scope because it closes over nothing: declared inside the component
 * it is a new function every render, which the mutator useMemo would then have
 * to list as a dependency and re-roll on.
 */
function mutatorById(id: string | undefined | null): MapMutator | null {
  if (!id) return null;
  return getMapMutators().find(m => m.id === id) ?? null;
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
  continuesRemaining = 0,
  onLivesChange,
  onGrantAbility,
  onSpendAbility,
  abilityCharges,
  abilitySlots,
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
  ascensionDepth = 0,
  mapHighscores,
  runPaceDelta = null,
  activeDoor = null,
  blockResults = [],
  capstone = null,
  activeLoadouts = [],
  fenceDurability = null,
  ascensionLadder = [],
  scalingReadouts = [],
  everyMapMutated = false,
  pickupLifetimeFactor = 1,
  adminMode = false,
  showBallSpeeds = false,
  showPerfOverlay = false,
  onGameStateChange,
  freezeOnClear = false,
  onMapComplete,
  introAssemble = false,
  tagSetThreshold = DEFAULT_TAG_SET_THRESHOLD,
}: GameScreenProps) {
  const { t } = useTranslation();
  // Hard map deadline (null on the tutorial band, where the countdown bar and
  // Ship Early are both suppressed). Drives the ShipEarlyBar countdown.
  const mapTimeLimit = getMapTimeLimit(level, levelNumber);
  const { config, getBackgroundColor, getRegionColor, getAccentColor } = useGameConfig();

  // Background music, selected by 5-level band. Idempotent within a band, so it
  // plays continuously across levels and the per-round remount, switching only at
  // band boundaries. A missing band track falls back to main.mp3 (see gameMusic).
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
    pushMode: "none",
    creepPercent: 0,
    activeSeconds: 0,
    ballCount: 1,
    pickupPresent: false,
    onBankAndContinue: undefined,
    pushBonusSoFar: 0,
    winGates: [],
    ballsInPlay: 0,
    gameMessage: null,
  });

  // "Loading..." overlay for the run-start intro: the board takes ~half a
  // second (renderer init + the assemble's slide-in delay) before it begins
  // flying in over the background code. GameCanvas fires onCanvasReady the
  // instant the first tiles present, and this fades out to reveal them.
  const [canvasReady, setCanvasReady] = useState(false);
  const handleCanvasReady = useCallback(() => setCanvasReady(true), []);

  // Where the board's top edge sits inside the canvas area, as a percentage.
  // The board is square and centred in a taller frame, so the gutter above it
  // depends on the surface size and only GameCanvas can measure it. The
  // map-rule banner is centred in that gutter rather than pinned under the top
  // bar. 5 is GameCanvas's own pre-measurement default.
  const [boardTopPct, setBoardTopPct] = useState(5);
  const handleBoardTopPct = useCallback((pct: number) => setBoardTopPct(pct), []);

  const handleGameStateChange = useCallback((state: GameStateInfo) => {
    setGameState(state);
    onGameStateChange?.(state); // forward to a parent (Playground ability tester)
  }, [onGameStateChange]);

  // Map-highscore bar (#45): only with the Benchmarking certificate and a stored
  // highscore for this map. `projectedScore` is the score the map would pay if
  // it ended now (same formula as the real level score, sans lock/break bonus),
  // so the bar tracks how close the run is to beating the record.
  const showHighscoreBar = activeModifiers.showHighscoreProgress > 0;
  // Read once per mount: the flag is flipped in the admin screen, which can only
  // be reached by leaving the game, so it cannot change while a map is running.
  const [lockDebug] = useState(isLockDebugEnabled);
  // Admin A/B for the unattributed frame time; see isStaticBgEnabled.
  const [staticBg] = useState(isStaticBgEnabled);
  const highscoreTarget = mapHighscores?.[level.id] ?? 0;
  const projectedScore = useMemo(() => {
    if (!showHighscoreBar || highscoreTarget <= 0) return 0;
    return calculateScore(
      gameState.cutsUsed, level.expectedCuts, gameState.spaceRemaining, level.sizeThreshold, level.points, {
        scoreMultiplier: activeModifiers.scoreMultiplier,
        spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
        flatBonus: activeModifiers.overtimeCapBonus,
      },
    ).levelScore;
  }, [showHighscoreBar, highscoreTarget, gameState.cutsUsed, gameState.spaceRemaining,
      level.expectedCuts, level.sizeThreshold, level.points, activeModifiers.scoreMultiplier,
      activeModifiers.spaceBonusMultiplier, activeModifiers.overtimeCapBonus]);

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
        levelNumber, getRunRng(`mapMutator:${level.id}`), undefined,
        everyMapMutated ? 0 : undefined,
      ),
    [levelNumber, level.id, level.boss, level.mutator, everyMapMutated],
  );

  // Per-map objective (issue #55): an optional goal rolled 0-or-1 per eligible
  // map from the run seed. A boss map (#56) uses its authored objective as the
  // MANDATORY win gate instead. Live progress is a pure read of mirrored counters.
  const mapObjective = useMemo(
    () => level.boss?.objective ?? selectMapObjective(levelNumber, getRunRng(`objective:${level.id}`)),
    [levelNumber, level.id, level.boss],
  );
  const objectiveProgress = useMemo(
    () => mapObjective
      ? evaluateObjective(mapObjective, {
          lockedBalls: gameState.lockedBalls,
          superiorLocks: gameState.superiorLocks,
          cuts: gameState.cutsUsed,
          par: level.expectedCuts,
          activeSeconds: gameState.activeSeconds,
          bossDefeated: gameState.bossDefeated,
        })
      : null,
    [mapObjective, gameState.lockedBalls, gameState.superiorLocks, gameState.cutsUsed, gameState.activeSeconds, level.expectedCuts, gameState.bossDefeated],
  );

  // Live assignment mission progress (issue #60): completed maps this block plus
  // a provisional snapshot of the in-progress map, so the Specs panel tracks the
  // multi-map task as it plays.
  const assignmentProgress = useMemo(() => {
    if (!activeDoor) return null;
    const liveMap: AssignmentMapResult = {
      locks: gameState.lockedBalls,
      superiorLocks: gameState.superiorLocks,
      cutsDelta: gameState.cutsUsed - level.expectedCuts,
      clearSeconds: gameState.activeSeconds,
      ballCount: gameState.ballCount,
      allBallsLocked: gameState.ballCount > 0 && gameState.lockedBalls >= gameState.ballCount,
    };
    return evaluateAssignment(activeDoor, [...blockResults, liveMap]);
  }, [activeDoor, blockResults, gameState.lockedBalls, gameState.superiorLocks, gameState.cutsUsed, gameState.activeSeconds, gameState.ballCount, level.expectedCuts]);
  
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  // Build readout for the bottom bar: owned upgrades per archetype tag.
  const tagCounts = useMemo(() => ownedTagCounts(ownedUpgradeIds, upgrades), [ownedUpgradeIds, upgrades]);

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
  const [superiorInfoOpen, setSuperiorInfoOpen] = useState(false);
  // Press-and-hold on a board object. Owned here rather than in GameCanvas so it
  // joins modalOverlayActive and PAUSES the map: reading an explainer while the
  // balls keep bouncing behind it is how you lose a life to a tooltip.
  const [entityInfo, setEntityInfo] = useState<BoardEntityHit | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
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
    setWinModalOpen(shouldAnnounceWinConditions(t, level, levelNumber));
  }, [level, levelNumber, t]);

  /**
   * Announce the ascension rules once per DEPTH, not once per map.
   *
   * Keyed on the depth rather than on reaching level 1, because the debug jump
   * (?ascension=9&level=12) never passes through level 1 and would otherwise
   * drop you into a run governed by nine rules nobody mentioned. Re-openable
   * from the menu, like the win conditions.
   */
  const announcement = useMemo(
    () => ascensionAnnouncement(t, ascensionDepth, ascensionLadder),
    [t, ascensionDepth, ascensionLadder],
  );
  /** The rungs in force, for the Specs panel. Memoised so the panel is not
   *  handed a fresh array on every frame of a running game. */
  const rungsInForce = useMemo(
    () => rungsUpTo(ascensionDepth, ascensionLadder),
    [ascensionDepth, ascensionLadder],
  );
  const [ascModalOpen, setAscModalOpen] = useState(false);
  const announcedDepth = useRef<number | null>(null);
  /**
   * Announce the ascension rules on LEVEL 1 of a depth, and nowhere else.
   *
   * The gate used to be the `announcedDepth` ref alone, on the reasoning that a
   * depth should be announced once rather than once per map. The reasoning was
   * right and the mechanism could not deliver it: Index renders this component
   * only while `currentScreen === 'game'` and the level-complete overlay is
   * down, so GameScreen UNMOUNTS after every single map (through the overlay,
   * the shop, every draft) and the ref went back to null with it. A ref cannot
   * remember something across the remount it is supposed to survive, so the
   * modal reappeared on every map of an ascended run.
   *
   * Level 1 is the honest test, and it needs no memory at all: an ascension
   * always restarts at level 1, so that IS the moment a depth begins. The ref
   * stays to stop a re-render firing it twice within one mount, which is all a
   * ref can honestly promise here.
   *
   * The cost is the debug jump (`?ascension=9&level=12`), which never passes
   * through level 1 and so no longer self-announces. That is covered: the rules
   * are re-openable from the pause menu (`ascension.menuItem`), which is where
   * a player who wants them again looks anyway.
   */
  useEffect(() => {
    if (!shouldAnnounceAscension(ascensionDepth, levelNumber, ascensionLadder)) return;
    if (announcedDepth.current === ascensionDepth) return;
    announcedDepth.current = ascensionDepth;
    setAscModalOpen(true);
  }, [ascensionDepth, levelNumber, ascensionLadder]);

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
  const menuRef = useRef<HTMLDivElement>(null);
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
    ? Math.max(0, Math.ceil(mapTimeLimit - gameState.activeSeconds))
    : null;
  const deadlineUrgent = deadlineRemaining != null && deadlineRemaining > 0 && deadlineRemaining <= 10
    && !gameState.bossDefeated && !mapComplete;
  useEffect(() => {
    if (deadlineUrgent) playHeartbeatSound();
  }, [deadlineUrgent, deadlineRemaining]);

  // Close menu and unpause when the game ends so the overlays appear cleanly
  const handleGameEnd = useCallback((result: GameResult) => {
    setMenuOpen(false);
    setIsPaused(false);
    onGameEnd(result);
  }, [onGameEnd]);

  /**
   * Set once the map ends, so the auto-pause below never drops a PAUSED sheet
   * over the results. GameScreen stays mounted underneath that overlay - it is
   * owned by the screen above this one - so "is the game running" is not
   * something this component can otherwise tell.
   */
  const levelEndedRef = useRef(false);
  useEffect(() => { levelEndedRef.current = false; }, [level.id, levelNumber]);

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
    levelEndedRef.current = true;
    setIsPaused(false);
    onLevelComplete(scoreData);
  }, [onLevelComplete]);

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
  const anyExplainerModal =
    showTimeLimitOverlay || showCreepOverlay || showBossOverlay || showWinModal
    || fenceIntroOpen || ascModalOpen || showBoxIntro || showLauncherIntro
    || showCircuitOverlay;


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
    if (showBottomBarOverlay) { fileManualEntry('bottomBar'); onBottomBarTutorialSeen?.(); }
  }, [showBottomBarOverlay, onBottomBarTutorialSeen]);
  useEffect(() => {
    if (showPickupOverlay) { fileManualEntry('pickup'); setPickupIntroSeen(true); try { localStorage.setItem('devend_pickup_intro_seen', '1'); } catch { /* ignore */ } }
  }, [showPickupOverlay]);

  const modalOverlayActive =
    topPanelOpen || menuOpen || abilityInfoOpen || superiorInfoOpen || !!entityInfo || anyExplainerModal;

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


  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    // pointerdown covers touch/pen/mouse uniformly; mousedown alone is
    // unreliable on the touch-only Android WebView target.
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  return (
    <>
      {/* CRT Terminal Background */}
      <CRTBackground accentColor={accentColor} paused={mapComplete || staticBg} />
      
      {/* Memory Parallax Layer - between CRT and game */}
      <MemoryParallaxLayer accentColor={accentColor} externalTickRef={memParallaxTickRef} />

      {/* Boss nameplate (issue #56): name + deadline countdown + HP bar */}
      {level.boss && gameState.bossActive && (
        <BossBanner
          name={contentText.bossName(t, { id: level.id, name: level.boss.name })}
          timeLimit={mapTimeLimit}
          activeSeconds={gameState.activeSeconds}
          hp={gameState.bossHp}
          maxHp={gameState.bossMaxHp}
          defeated={gameState.bossDefeated}
          accentColor={accentColor}
        />
      )}

      {/* Deadline tension: pulsing red vignette in the final seconds. */}
      {deadlineUrgent && (
        <div
          className="pointer-events-none absolute inset-0 z-20 animate-pulse"
          style={{ boxShadow: 'inset 0 0 140px 40px rgba(255, 30, 60, 0.55)' }}
        />
      )}

      {/* Boss phase banner: HOTFIX INCOMING / PANIC MODE as HP drops. */}
      {bossPhaseLabel && !gameState.bossDefeated && (
        <div className="pointer-events-none absolute left-1/2 top-1/3 z-40 -translate-x-1/2 -translate-y-1/2">
          <span
            className="font-display text-2xl font-bold uppercase tracking-widest animate-pulse"
            style={{ color: '#ff2d55', textShadow: '0 0 18px #ff2d55, 0 0 6px #000' }}
          >
            {bossPhaseLabel}
          </span>
        </div>
      )}

      {/* SHIPPED IT: the boss-defeat payoff flash. */}
      {shippedIt && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle, rgba(74,222,128,0.18) 0%, transparent 60%)' }} />
          <span
            className="font-display text-4xl sm:text-5xl font-bold uppercase tracking-widest animate-pulse"
            style={{ color: '#4ade80', textShadow: '0 0 24px #4ade80, 0 0 8px #000' }}
          >
            {t('boss.shippedIt')}
          </span>
        </div>
      )}

      <div className="absolute inset-0 flex flex-col z-10">
        {/* Game Top Bar - Two rows */}
        <div>
          <GameTopBar
            levelNumber={levelNumber}
            cutsUsed={gameState.cutsUsed}
            parCuts={level.expectedCuts}
            lives={lives}
            continuesRemaining={continuesRemaining}
            spaceRemaining={gameState.spaceRemaining}
            spaceRequired={level.sizeThreshold}
            lockedBalls={mapLockedBalls}
            threadLockRequired={level.threadLockRequired}
            winGates={gameState.winGates}
            ballsInPlay={gameState.ballsInPlay}
            onExplainWin={() => setWinModalOpen(true)}
            scopeCreepPercent={gameState.creepPercent}
            accentColor={accentColor}
            certificateProgress={certificateProgress}
            ascensionDepth={ascensionDepth}
            showHighscoreBar={showHighscoreBar}
            highscoreCurrent={projectedScore}
            highscoreTarget={highscoreTarget}
            runPaceDelta={runPaceDelta}
            // Opened to BROWSE, so nothing leads. Clearing here as well as on
            // close means this does not depend on the panel having been closed
            // the tidy way to behave correctly.
            onExpand={() => { setTopPanelFocus(null); setTopPanelOpen(true); }}
          />
        </div>

        {/* Game Canvas Area */}
        <div className="flex-1 min-h-0 relative">
          {/* The map's rule, if it has one: centred in the gutter between the
              top bar and the board's top edge, rather than pinned under the bar.
              Floating rather than in the flow so it costs the board no height.
              The wrapper takes no pointer events; the banner itself does, so it
              can never swallow a cut aimed near the top of the board. */}
          {mapMutator && (
            <div
              className="absolute left-0 right-0 z-30 flex justify-center pointer-events-none"
              style={{ top: `${boardTopPct / 2}%`, transform: 'translateY(-50%)' }}
            >
              {/* w-full so the announcing strip spans the frame, and centred
                  so the collapsed chip sits in the middle rather than hugging
                  the left edge. */}
              <div className="pointer-events-auto w-full flex justify-center">
                <MapRuleBanner
                  mutator={mapMutator}
                  onExplain={() => { setTopPanelFocus('mapRule'); setTopPanelOpen(true); }}
                />
              </div>
            </div>
          )}
          {/* Run-start "Loading..." sign: sits over the animating background
              while the board loads, and fades out the moment the canvas begins
              assembling in. Only for the run-intro map (introAssemble). */}
          {introAssemble && (
            <div
              className={`absolute inset-0 z-20 flex items-center justify-center pointer-events-none transition-opacity duration-500 ${canvasReady ? 'opacity-0' : 'opacity-100'}`}
            >
              <span
                className="font-display text-xl font-bold tracking-[0.35em] uppercase animate-pulse"
                style={{ color: accentColor, textShadow: `0 0 18px ${accentColor}` }}
              >
                {t('common.loading')}
              </span>
            </div>
          )}
          {/* Feature Freeze: tap-freezes left this map. Only shown when the
              upgrade (or Runway's freeze) is active, and hidden once the map is
              won. Dims to signal "out" at zero. */}
          {activeModifiers.freezeUsesPerMap > 0 && !mapComplete && (
            <div
              className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md px-2 py-1 pointer-events-none"
              style={{
                backgroundColor: 'rgba(0,10,5,0.7)',
                border: `1px solid ${accentColor}44`,
                color: accentColor,
                opacity: gameState.freezeUsesRemaining > 0 ? 1 : 0.4,
              }}
              aria-label={t('game.freezeUsesLeft', { count: gameState.freezeUsesRemaining })}
            >
              <Snowflake className="w-3.5 h-3.5" />
              <span className="font-display text-sm font-bold tabular-nums">
                {gameState.freezeUsesRemaining}/{Math.round(activeModifiers.freezeUsesPerMap)}
              </span>
            </div>
          )}
          {/* Fence budget / WIP Limit: completed fences left this map. Warns
              (amber) at 2 or fewer, dims at zero. Only shown when the map sets
              a budget and it isn't already won. */}
          {level.fenceBudget != null && !mapComplete && (() => {
            const left = fencesLeft(level.fenceBudget, gameState.completedCuts ?? 0);
            const col = left <= 2 ? '#ff8a5b' : accentColor;
            return (
              <div
                className="absolute top-2 left-2 z-20 flex items-center gap-1 rounded-md px-2 py-1 pointer-events-none"
                style={{
                  backgroundColor: 'rgba(0,10,5,0.7)',
                  border: `1px solid ${col}44`,
                  color: col,
                  opacity: left > 0 ? 1 : 0.4,
                }}
                aria-label={t('game.fenceBudgetLeft', { count: left })}
              >
                <Fence className="w-3.5 h-3.5" />
                <span className="font-display text-sm font-bold tabular-nums">
                  {left}/{level.fenceBudget}
                </span>
              </div>
            );
          })()}
          <GameCanvas
            level={level}
            levelNumber={levelNumber}
            totalLevels={totalLevels}
            totalScore={totalScore}
            lives={lives}
            onLivesChange={onLivesChange}
            onGrantAbility={onGrantAbility}
            abilityCharges={abilityCharges ?? {}}
            abilitySlots={abilitySlots}
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
            introAssemble={introAssemble}
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
            pickupConfig={pickupLifetimeFactor === 1 ? config.pickups : {
              ...config.pickups,
              // Use It Or Lose It (ascension rung 7). Floor at 1s so a deep
              // ladder can never round a token's life down to zero, which
              // would delete it on the frame it spawned.
              lifetimeSeconds: Math.max(1, Math.round(config.pickups.lifetimeSeconds * pickupLifetimeFactor)),
            }}
            regionColor={getRegionColor()}
            accentColor={accentColor}
            activeModifiers={activeModifiers}
            cumulativeLockedBalls={cumulativeLockedBalls}
            fenceDurability={fenceDurability}
            parallaxTickRef={memParallaxTickRef}
            showBallSpeeds={showBallSpeeds}
            showPerfOverlay={showPerfOverlay}
          />
          {/* Out of time. Over the board because that is where the eyes are;
              red and pulsing so it stays separable from the win frame's steady
              amber on the same edge. Never takes a tap. */}
          <BoardAlert urgent={deadlineUrgent && !mapComplete} seconds={deadlineRemaining} />
          {/* This map wants something beyond an ordinary clear. One state, not
              a colour per kind: see WinGateFrame for why a border language does
              not survive being seen three times in a run. */}
          <WinGateFrame
            present={gameState.winGates.length > 0 && !mapComplete}
            outstanding={gameState.winGates.some(g => !gateSatisfied(g))}
          />
          {/* Admin lock diagnostics. `absolute` inside this relative wrapper, not
              `fixed`: the page-transition transform breaks fixed positioning. */}
          <LockDebugOverlay visible={lockDebug} />
        </div>

        {/* Live action bars pinned to the bottom in their own fixed wrapper (a
            plain sibling in the flex column would sit under the board). Ability
            controls, the Ship Early countdown and ability timers ride here; the
            modifier stats they used to sit beside now live in the Specs panel.
            Once the map is won they go visibility:hidden instantly - they must
            never outlive the board (a fade lagged behind the wave on-device).
            The wrapper is click-through; only the AbilityBar re-enables taps. */}
        <div
          className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none"
          style={{ visibility: mapComplete ? 'hidden' : 'visible' }}
        >
          {!mapComplete && gameState.onUseAbility && (
            <div className="pointer-events-auto">
              <AbilityBar
                charges={abilityCharges ?? {}}
                accentColor={accentColor}
                onUse={gameState.onUseAbility}
                armedAbilityId={gameState.armedAbility}
                onInfoOpenChange={setAbilityInfoOpen}
              />
            </div>
          )}
          {/* ONE line for the three readouts that used to have a bar each.
              None of them is on most of the time, but each appeared and
              disappeared independently, so the whole bottom of the screen moved
              whenever any of them changed - with the ability buttons directly
              underneath. The wrapper reserves its height whether or not a lane
              is using it, which is the part that stops the shifting; see
              lib/hudContext for who gets the slot. */}
          <div className="min-h-[34px] flex items-end">
            {contextLane === 'message' && (
              <GameMessageBar
                message={gameState.gameMessage ?? null}
                accentColor={accentColor}
                visible
              />
            )}
            {contextLane === 'shipEarly' && (
              <ShipEarlyBar
                seconds={gameState.activeSeconds}
                ballCount={gameState.ballCount}
                timeLimit={mapTimeLimit ?? 0}
                extraSecondsPerBall={activeModifiers.shipEarlySecondsPerBall}
                bonusMultiplier={activeModifiers.shipEarlyBonusMultiplier}
                visible
              />
            )}
            {contextLane === 'abilityTimers' && (
              <AbilityCountdownBar timers={gameState.abilityTimers ?? []} visible />
            )}
          </div>

          {/* Stays its own row rather than joining the slot above: it is an
              ACTION, not a readout, and it was reported missing once already
              while it was on screen. It is not going into a queue behind a
              transient message. */}
          {canStopPushing({
            mapComplete,
            pushMode: gameState.pushMode,
            hasHandler: gameState.onBankAndContinue != null,
          }) && (
            <PushExitBar
              bonusSoFar={gameState.pushBonusSoFar}
              onBank={gameState.onBankAndContinue!}
              accentColor={accentColor}
            />
          )}
                {/* Every control the map has, in one place, in the thumb zone.
                    These used to float at top-left at 32px, on top of the status
                    bar, while abilities sat at the bottom - four homes for one
                    category of thing, which is why nothing could be found. */}
                <div ref={menuRef} className="pointer-events-auto relative flex items-center justify-center gap-2 px-3 pb-2 pt-1">
            <button
              onClick={() => setMenuOpen(prev => !prev)}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-all"
              style={{
                backgroundColor: menuOpen ? `${accentColor}33` : 'rgba(0,10,5,0.85)',
                border: `1px solid ${accentColor}55`,
                color: accentColor,
              }}
              aria-label={t('game.gameMenu')}
            >
              <Menu className="w-5 h-5" />
            </button>
            {canPause && (
              <button
                onClick={() => { setMenuOpen(false); setIsPaused(prev => !prev); }}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-all"
                style={{
                  backgroundColor: isPaused ? `${accentColor}33` : 'rgba(0,10,5,0.85)',
                  border: `1px solid ${accentColor}55`,
                  color: accentColor,
                }}
                aria-label={isPaused ? t('game.resume') : t('game.pause')}
              >
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
            )}
              <button
                onClick={() => { setTopPanelFocus(null); setTopPanelOpen(true); }}
                className="relative flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-all"
                style={{
                  backgroundColor: 'rgba(0,10,5,0.85)',
                  border: `1px solid ${accentColor}55`,
                  color: accentColor,
                }}
                aria-label={t('topBar.specs')}
              >
                <ClipboardList className="w-5 h-5" strokeWidth={1.5} />
                {/* A new mechanic has been filed in the Manual. The badge came
                    with the button: it is what replaced the modal that used to
                    announce one, so the player learns something is there
                    without losing the frame they were playing. */}
                {manualUnread > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                    style={{ background: accentColor, color: '#04160d' }}
                    aria-label={t('topBar.specsNew', { count: manualUnread })}
                  >
                    {manualUnread}
                  </span>
                )}
              </button>
              <button
                onClick={() => setWinModalOpen(true)}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-all"
                style={{
                  backgroundColor: 'rgba(0,10,5,0.85)',
                  border: `1px solid ${accentColor}55`,
                  color: accentColor,
                }}
                aria-label={t('winConditions.menuItem')}
              >
                <Target className="w-5 h-5" />
              </button>
            {menuOpen && (
              <div
                className="absolute bottom-full left-0 mb-2 rounded-lg overflow-hidden min-w-[180px]"
                style={{
                  backgroundColor: 'rgba(0, 15, 8, 0.95)',
                  border: `1px solid ${accentColor}55`,
                  boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 15px ${accentColor}22`,
                }}
              >
                <button
                  onClick={() => {
                    const next = !soundMuted;
                    setSoundMuted(next);
                    setSoundMutedState(next);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-bold transition-colors"
                  style={{ color: accentColor, backgroundColor: 'transparent' }}
                  onPointerEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
                  onPointerDown={e => (e.currentTarget.style.backgroundColor = `${accentColor}30`)}
                  onPointerUp={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerCancel={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  {soundMuted ? t('game.soundOff') : t('game.soundOn')}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setWinModalOpen(true); }}
                  className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-bold transition-colors"
                  style={{ color: accentColor, backgroundColor: 'transparent' }}
                  onPointerEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
                  onPointerDown={e => (e.currentTarget.style.backgroundColor = `${accentColor}30`)}
                  onPointerUp={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerCancel={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Target className="w-4 h-4" />
                  {t('winConditions.menuItem')}
                </button>
                {announcement && (
                  <button
                    onClick={() => { setMenuOpen(false); setAscModalOpen(true); }}
                    className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-bold transition-colors"
                    style={{ color: '#ffb347', backgroundColor: 'transparent' }}
                    onPointerEnter={e => (e.currentTarget.style.backgroundColor = '#ffb34718')}
                    onPointerDown={e => (e.currentTarget.style.backgroundColor = '#ffb34730')}
                    onPointerUp={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onPointerLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onPointerCancel={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <TrendingUp className="w-4 h-4" />
                    {t('ascension.menuItem')}
                  </button>
                )}
                {adminMode && (
                  <button
                    onClick={() => { setMenuOpen(false); setTuningOpen(true); }}
                    className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-bold transition-colors"
                    style={{ color: accentColor, backgroundColor: 'transparent' }}
                    onPointerEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
                    onPointerDown={e => (e.currentTarget.style.backgroundColor = `${accentColor}30`)}
                    onPointerUp={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onPointerLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onPointerCancel={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    Tune map
                  </button>
                )}
                <button
                  onClick={() => { setMenuOpen(false); onRestart(); }}
                  className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-bold transition-colors"
                  style={{ color: accentColor, backgroundColor: 'transparent' }}
                  onPointerEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
                  onPointerDown={e => (e.currentTarget.style.backgroundColor = `${accentColor}30`)}
                  onPointerUp={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerCancel={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('game.restartRun')}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onMainMenu(); }}
                  className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-bold transition-colors"
                  style={{ color: accentColor, backgroundColor: 'transparent' }}
                  onPointerEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
                  onPointerDown={e => (e.currentTarget.style.backgroundColor = `${accentColor}30`)}
                  onPointerUp={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onPointerCancel={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Home className="w-4 h-4" />
                  {t('game.mainMenu')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Superior-lock explainer (opened by holding a superior lock's star) */}
      {superiorInfoOpen && <SuperiorLockInfoModal onClose={() => setSuperiorInfoOpen(false)} />}
      {entityInfo && (
        <BoardEntityInfoModal hit={entityInfo} accentColor={accentColor} onClose={() => setEntityInfo(null)} />
      )}

      {/* Pause overlay */}
      {isPaused && (
        <div
          className="fixed inset-0 z-[65] flex flex-col items-center justify-center gap-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}
        >
          <p
            className="font-display text-4xl font-bold tracking-widest"
            style={{ color: accentColor, textShadow: `0 0 24px ${accentColor}` }}
          >
            {t('game.paused')}
          </p>
          <button
            className="arcade-button-primary px-8 py-3 rounded-lg flex items-center gap-2 text-base font-bold"
            onClick={() => setIsPaused(false)}
          >
            <Play className="w-5 h-5" />
            {t('game.resume')}
          </button>
        </div>
      )}

      {/* Always-visible menu — floats above all overlays */}

      {/* Explainer modal QUEUE: only ONE shows at a time. Ordered by priority;
          dismissing the active one flips its trigger off, so the next queued
          modal appears (a natural queue). The game stays paused via
          modalOverlayActive until the whole queue is cleared. Boss context
          first, then the per-map "how to win", then one-time teaching overlays,
          and finally the Draw-A-Fence coach (#62). */}
      {anyExplainerModal && (() => {
        type Explainer = { show: boolean; accentColor: string; title: string; body: string; onDismiss: () => void; graphic?: React.ReactNode };
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
          ...(announcement ? [{
            show: ascModalOpen,
            accentColor: '#ffb347',
            title: announcement.title,
            body: announcement.body,
            onDismiss: () => setAscModalOpen(false),
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
            title: t('winConditions.title'), body: winConditionsBody(t, level, levelNumber),
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
            show: fenceIntroOpen, accentColor,
            title: t('interactiveTutorial.drawAFence'), body: t('interactiveTutorial.dragInstruction'), graphic: <FenceArt />,
            // Dismissing marks it seen. The modal IS the explanation; the guided
            // hint that follows is practice, and it still runs this map either
            // way. Previously only a successful tutorial cut persisted anything,
            // so dismissing this and then dying on level 1 - or reloading a
            // ?level= / ?ascension= debug jump without finishing the map - re-armed
            // it on every single run, forever.
            onDismiss: () => { setFenceIntroOpen(false); onFenceSeen?.(); },
          },
        ];
        const active = queue.find(m => m.show);
        return active ? (
          <TutorialOverlay
            visible
            onDismiss={active.onDismiss}
            accentColor={active.accentColor}
            title={active.title}
            body={active.body}
            graphic={active.graphic}
          />
        ) : null;
      })()}

      {/* Admin live map tuner. `level` here is already the tuned view, so the
          modal shows what is in play and compares against the authored map. */}
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
        ascensionDepth={ascensionDepth}
        ascensionRungs={rungsInForce}
        scalingReadouts={scalingReadouts}
        activeLoadouts={activeLoadouts}
        tagCounts={tagCounts}
        tagSetThreshold={tagSetThreshold}
        activeModifiers={activeModifiers}
        modifierSources={modifierSources}
        activeDoor={activeDoor}
        assignmentProgress={assignmentProgress}
        capstone={capstone}
        mapMutator={mapMutator}
        objective={mapObjective}
        objectiveProgress={objectiveProgress}
      />

      {/* Above everything: a life just went, and nothing else on screen says
          why. Dismissing it is what restarts the map. */}
      <AnimatePresence>
        {mapFailure && (
          <MapFailedOverlay
            failure={mapFailure}
            livesLeft={lives}
            accentColor={accentColor}
            onDismiss={dismissMapFailure}
          />
        )}
      </AnimatePresence>
    </>
  );
}
