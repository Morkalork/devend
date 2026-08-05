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
import { Menu, Home, RotateCcw, Pause, Play, Volume2, VolumeX, Snowflake, Fence, Target } from 'lucide-react';
import { fencesLeft } from '@/lib/fenceBudget';
import { winConditionsBody } from '@/lib/winConditions';
import { GameCanvas, GameStateInfo } from './GameCanvas';
import { SuperiorLockInfoModal } from './SuperiorLockInfoModal';
import { GameTopBar } from './GameTopBar';
import { ShipEarlyBar } from './ShipEarlyBar';
import { AbilityBar } from './AbilityBar';
import { AbilityCountdownBar } from './AbilityCountdownBar';
import { TopBarDetailsPanel } from './TopBarDetailsPanel';
import { CRTBackground } from './CRTBackground';
import { MemoryParallaxLayer } from './MemoryParallaxLayer';
import { TutorialOverlay } from './TutorialOverlay';
import { MoverArt, BreakArt, CircuitArt, PickupArt, FenceArt } from './TutorialArt';
import { BossBanner } from './BossBanner';
import { contentText } from '@/i18n/content';
import { playHeartbeatSound } from '@/lib/gameAudio';
import { LevelConfig } from '@/types/level';
import { getMapTimeLimit, TIME_LIMIT_EXEMPT_MAX_LEVEL } from '@/lib/mapTiming';
import { selectMapMutator } from '@/lib/mapMutators';
import { selectMapObjective, evaluateObjective } from '@/lib/mapObjectives';
import { getRunRng } from '@/lib/runRng';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import { LoadoutConfig } from '@/types/loadout';
import { AssignmentConfig, AssignmentMapResult } from '@/types/assignment';
import { evaluateAssignment } from '@/lib/assignments';
import { CapstoneConfig } from '@/types/capstone';
import { useGameConfig } from '@/hooks/useGameConfig';
import { playMusicForLevel } from '@/lib/gameMusic';
import { isSoundMuted, setSoundMuted } from '@/lib/soundSettings';
import { GameModifiers, ModifierSource } from '@/hooks/useActiveModifiers';

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
  onGameEnd: (result: GameResult) => void;
  /** Out of time with lives left: restart the current level (session remount). */
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

  // "Wire the Integration" intro — shown the first time a circuit map loads.
  const levelHasCircuit = !!level.circuit;
  const [showCircuitIntro, setShowCircuitIntro] = useState(false);
  useEffect(() => {
    if (!levelHasCircuit) { setShowCircuitIntro(false); return; }
    let seen = false;
    try { seen = !!localStorage.getItem('devend_circuit_tutorial_seen'); } catch { /* ignore */ }
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
  });

  // "Loading..." overlay for the run-start intro: the board takes ~half a
  // second (renderer init + the assemble's slide-in delay) before it begins
  // flying in over the background code. GameCanvas fires onCanvasReady the
  // instant the first tiles present, and this fades out to reveal them.
  const [canvasReady, setCanvasReady] = useState(false);
  const handleCanvasReady = useCallback(() => setCanvasReady(true), []);

  const handleGameStateChange = useCallback((state: GameStateInfo) => {
    setGameState(state);
    onGameStateChange?.(state); // forward to a parent (Playground ability tester)
  }, [onGameStateChange]);

  // Map-highscore bar (#45): only with the Benchmarking upgrade and a stored
  // highscore for this map. `projectedScore` is the score the map would pay if
  // it ended now (same formula as the real level score, sans lock/break bonus),
  // so the bar tracks how close the run is to beating the record.
  const showHighscoreBar = activeModifiers.showHighscoreProgress > 0;
  const highscoreTarget = mapHighscores?.[level.id] ?? 0;
  const projectedScore = useMemo(() => {
    if (!showHighscoreBar || highscoreTarget <= 0) return 0;
    return calculateScore(
      gameState.cutsUsed, level.expectedCuts, gameState.spaceRemaining, level.sizeThreshold, level.points, {
        scoreMultiplier: activeModifiers.scoreMultiplier,
        spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
        overtimeCapBonus: activeModifiers.overtimeCapBonus,
      },
    ).levelScore;
  }, [showHighscoreBar, highscoreTarget, gameState.cutsUsed, gameState.spaceRemaining,
      level.expectedCuts, level.sizeThreshold, level.points, activeModifiers.scoreMultiplier,
      activeModifiers.spaceBonusMultiplier, activeModifiers.overtimeCapBonus]);

  const totalLockedBalls = cumulativeLockedBalls + gameState.lockedBalls;

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
    () => level.boss?.mutator ?? selectMapMutator(levelNumber, getRunRng(`mapMutator:${level.id}`)),
    [levelNumber, level.id, level.boss],
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
  const [abilityInfoOpen, setAbilityInfoOpen] = useState(false);
  const [superiorInfoOpen, setSuperiorInfoOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // "How to win" modal: shown at the start of every map (win conditions now vary
  // by map), and reopenable from the top-left menu. Dismissing it lets the board
  // dissolve in behind it (the overlay's backdrop fades on tap). Starts false and
  // is armed by the level-id effect (which runs on mount too): this makes `paused`
  // transition false -> true so GameCanvas's pause effect actually fires and stops
  // the loop — initialising true would leave the loop running on the first map,
  // because the pause effect early-returns before the loop exists and never re-runs.
  const [winModalOpen, setWinModalOpen] = useState(false);
  useEffect(() => { setWinModalOpen(true); }, [level.id]);

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

  const handleLevelComplete = useCallback((scoreData: LevelScoreData) => {
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
  const anyExplainerModal =
    showMoverOverlay || showBreakOverlay || showCircuitOverlay || showTopBarOverlay || showBottomBarOverlay ||
    showTimeLimitOverlay || showCreepOverlay || showPickupOverlay || showBossOverlay || showWinModal || fenceIntroOpen;
  const modalOverlayActive =
    topPanelOpen || menuOpen || abilityInfoOpen || superiorInfoOpen || anyExplainerModal;

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
      <CRTBackground accentColor={accentColor} paused={mapComplete} />
      
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
            lockedBalls={totalLockedBalls}
            threadLockRequired={level.threadLockRequired}
            scopeCreepPercent={gameState.creepPercent}
            accentColor={accentColor}
            certificateProgress={certificateProgress}
            ascensionDepth={ascensionDepth}
            showHighscoreBar={showHighscoreBar}
            highscoreCurrent={projectedScore}
            highscoreTarget={highscoreTarget}
            runPaceDelta={runPaceDelta}
            onExpand={() => setTopPanelOpen(true)}
          />
        </div>

        {/* Game Canvas Area */}
        <div className="flex-1 min-h-0 relative">
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
            onSpendAbility={onSpendAbility}
            onRequestSuperiorInfo={() => setSuperiorInfoOpen(true)}
            onGameEnd={handleGameEnd}
            onMapTimedOut={onMapTimedOut}
            onLevelComplete={handleLevelComplete}
            onBallTypeLocked={onBallTypeLocked}
            onMapComplete={() => { setMapComplete(true); onMapComplete?.(); }}
            onCanvasReady={handleCanvasReady}
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
            lockWinThresholdPercent={config.lock.win_threshold_percent}
            lockMinRegionCells={config.lock.min_region_cells}
            scopeCreep={scopeCreepConfig}
            mapMutator={mapMutator}
            objective={mapObjective}
            pickupConfig={config.pickups}
            regionColor={getRegionColor()}
            accentColor={accentColor}
            activeModifiers={activeModifiers}
            cumulativeLockedBalls={cumulativeLockedBalls}
            fenceDurability={fenceDurability}
            parallaxTickRef={memParallaxTickRef}
            showBallSpeeds={showBallSpeeds}
            showPerfOverlay={showPerfOverlay}
          />
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
          <ShipEarlyBar
            seconds={gameState.activeSeconds}
            ballCount={gameState.ballCount}
            timeLimit={mapTimeLimit ?? 0}
            extraSecondsPerBall={activeModifiers.shipEarlySecondsPerBall}
            bonusMultiplier={activeModifiers.shipEarlyBonusMultiplier}
            visible={mapTimeLimit != null && gameState.pushMode === 'none' && !mapComplete}
          />
          <AbilityCountdownBar
            timers={gameState.abilityTimers ?? []}
            visible={!mapComplete}
          />
        </div>
      </div>

      {/* Superior-lock explainer (opened by holding a superior lock's star) */}
      {superiorInfoOpen && <SuperiorLockInfoModal onClose={() => setSuperiorInfoOpen(false)} />}

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
      <div ref={menuRef} className="fixed top-2 left-2 z-[70] flex items-center gap-1">
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          className="flex items-center justify-center w-8 h-8 rounded-md transition-all"
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
            className="flex items-center justify-center w-8 h-8 rounded-md transition-all"
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
        {menuOpen && (
          <div
            className="absolute top-full left-0 mt-1 rounded-lg overflow-hidden min-w-[160px]"
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
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors"
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
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors"
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
            <button
              onClick={() => { setMenuOpen(false); onRestart(); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors"
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
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors"
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
          {
            show: showWinModal, accentColor,
            title: t('winConditions.title'), body: winConditionsBody(t, level, levelNumber),
            onDismiss: () => setWinModalOpen(false),
          },
          {
            show: showMoverOverlay, accentColor: '#ff8800',
            title: t('game.moverTutorialTitle'), body: t('game.moverTutorialBody'), graphic: <MoverArt />,
            onDismiss: () => { setMoverTutorialDismissed(true); onMoverTutorialSeen?.(); },
          },
          {
            show: showBreakOverlay, accentColor: '#ffb454',
            title: t('game.breakTutorialTitle'), body: t('game.breakTutorialBody'), graphic: <BreakArt />,
            onDismiss: () => { setShowBreakIntro(false); try { localStorage.setItem('devend_break_tutorial_seen', '1'); } catch { /* ignore */ } },
          },
          {
            show: showCircuitOverlay, accentColor: '#7fe3d4',
            title: t('game.circuitTutorialTitle'), body: t('game.circuitTutorialBody'), graphic: <CircuitArt />,
            onDismiss: () => { setShowCircuitIntro(false); try { localStorage.setItem('devend_circuit_tutorial_seen', '1'); } catch { /* ignore */ } },
          },
          {
            show: showTimeLimitOverlay, accentColor,
            title: t('game.timeLimitTutorialTitle'), body: t('game.timeLimitTutorialBody'),
            onDismiss: () => onTimeLimitTutorialSeen?.(),
          },
          {
            show: showTopBarOverlay, accentColor,
            title: t('game.topBarTutorialTitle'), body: t('game.topBarTutorialBody'),
            onDismiss: () => onTopBarTutorialSeen?.(),
          },
          {
            show: showBottomBarOverlay, accentColor,
            title: t('game.bottomBarTutorialTitle'), body: t('game.bottomBarTutorialBody'),
            onDismiss: () => onBottomBarTutorialSeen?.(),
          },
          {
            show: showCreepOverlay, accentColor: '#ff6b6b',
            title: t('game.creepTutorialTitle'), body: t('game.creepTutorialBody'),
            onDismiss: () => { setCreepIntroSeen(true); try { localStorage.setItem('devend_creep_tutorial_seen', '1'); } catch { /* ignore */ } },
          },
          {
            show: showPickupOverlay, accentColor: '#e879f9',
            title: t('game.pickupTutorialTitle'), body: t('game.pickupTutorialBody'), graphic: <PickupArt />,
            onDismiss: () => { setPickupIntroSeen(true); try { localStorage.setItem('devend_pickup_intro_seen', '1'); } catch { /* ignore */ } },
          },
          {
            show: fenceIntroOpen, accentColor,
            title: t('interactiveTutorial.drawAFence'), body: t('interactiveTutorial.dragInstruction'), graphic: <FenceArt />,
            onDismiss: () => setFenceIntroOpen(false),
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

      {/* Full-screen Specs panel: build, objectives, assignment, status,
          upgrades and the full attribute breakdown. */}
      <TopBarDetailsPanel
        visible={topPanelOpen}
        onClose={() => setTopPanelOpen(false)}
        levelNumber={levelNumber}
        cutsUsed={gameState.cutsUsed}
        parCuts={level.expectedCuts}
        lives={lives}
        continuesRemaining={continuesRemaining}
        spaceRemaining={gameState.spaceRemaining}
        spaceRequired={level.sizeThreshold}
        lockedBalls={totalLockedBalls}
        threadLockRequired={level.threadLockRequired}
        ownedUpgrades={ownedUpgrades}
        accentColor={accentColor}
        certificateProgress={certificateProgress}
        microManagerPerLock={activeModifiers.microManagerPerLock}
        ascensionDepth={ascensionDepth}
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
    </>
  );
}
