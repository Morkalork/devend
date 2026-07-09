/**
 * GameScreen — the in-game layout: GameTopBar above, GameCanvas in the
 * middle, GameBottomBar below, plus background layers, the in-game menu and
 * tutorial overlays.
 *
 * Tapping the top/bottom bars opens their full-screen counterparts
 * (TopBarDetailsPanel / BottomBarDetailsPanel).
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateScore } from '@/lib/scoring';
import { Menu, Home, RotateCcw, Pause, Play } from 'lucide-react';
import { GameCanvas, GameStateInfo } from './GameCanvas';
import { GameTopBar } from './GameTopBar';
import { GameBottomBar } from './GameBottomBar';
import { TopBarDetailsPanel } from './TopBarDetailsPanel';
import { BottomBarDetailsPanel } from './BottomBarDetailsPanel';
import { CRTBackground } from './CRTBackground';
import { MemoryParallaxLayer } from './MemoryParallaxLayer';
import { TutorialOverlay } from './TutorialOverlay';
import { LevelConfig } from '@/types/level';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import { LoadoutConfig } from '@/types/loadout';
import { useGameConfig } from '@/hooks/useGameConfig';
import { playMusicForLevel } from '@/lib/gameMusic';
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
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
  /** Fired once per ball the instant it locks, with its ball-type id (drives the
   *  tutorial's "encountered ball types" tracking). */
  onBallTypeLocked?: (typeId: string) => void;
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
  accentColor?: string;
  certificateProgress?: CertificateHourProgress;
  achievementBonuses?: Partial<Record<string, number>>;
  activeModifiers: GameModifiers;
  modifierSources?: ModifierSource[];
  cumulativeLockedBalls?: number;
  ascensionDepth?: number;
  /** Best score per map id, for the Benchmarking highscore bar (#45). */
  mapHighscores?: Record<string, number>;
  activeLoadouts?: LoadoutConfig[];
  /** Ball hits a fence survives (Ascension); null = indestructible. */
  fenceDurability?: number | null;
  /** Admin/Playground: draw a live speed label above each ball. */
  showBallSpeeds?: boolean;
  /** Admin/Playground: draw the frame-timing perf HUD (physics/render ms, FPS). */
  showPerfOverlay?: boolean;
  /** Admin/Playground: on clear, freeze on the drained frame instead of completing. */
  freezeOnClear?: boolean;
  /** Admin/Playground: fired the instant the map is won (before the shimmer). */
  onMapComplete?: () => void;
}

export function GameScreen({
  level,
  levelNumber,
  totalLevels,
  totalScore,
  ownedUpgradeIds,
  upgrades,
  lives,
  continuesRemaining = 0,
  onLivesChange,
  onGameEnd,
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
  accentColor: externalAccentColor,
  certificateProgress,
  achievementBonuses,
  activeModifiers,
  modifierSources = [],
  cumulativeLockedBalls = 0,
  ascensionDepth = 0,
  mapHighscores,
  activeLoadouts = [],
  fenceDurability = null,
  showBallSpeeds = false,
  showPerfOverlay = false,
  freezeOnClear = false,
  onMapComplete,
}: GameScreenProps) {
  const { t } = useTranslation();
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

  // Game state for top bar
  const [gameState, setGameState] = useState<GameStateInfo>({
    cutsUsed: 0,
    spaceRemaining: 100,
    lockedBalls: 0,
    pushMode: "none",
    onBankAndContinue: undefined,
  });

  const handleGameStateChange = useCallback((state: GameStateInfo) => {
    setGameState(state);
  }, []);

  // Map-highscore bar (#45): only with the Benchmarking upgrade and a stored
  // highscore for this map. `projectedScore` is the score the map would pay if
  // it ended now (same formula as the real level score, sans lock/break bonus),
  // so the bar tracks how close the run is to beating the record.
  const showHighscoreBar = activeModifiers.showHighscoreProgress > 0;
  const highscoreTarget = mapHighscores?.[level.id] ?? 0;
  const projectedScore = useMemo(() => {
    if (!showHighscoreBar || highscoreTarget <= 0) return 0;
    return calculateScore(
      gameState.cutsUsed, level.expectedCuts, gameState.spaceRemaining,
      level.sizeThreshold, level.points, activeModifiers.scoreMultiplier, levelNumber, 0,
    ).levelScore;
  }, [showHighscoreBar, highscoreTarget, gameState.cutsUsed, gameState.spaceRemaining,
      level.expectedCuts, level.sizeThreshold, level.points, activeModifiers.scoreMultiplier, levelNumber]);

  const totalLockedBalls = cumulativeLockedBalls + gameState.lockedBalls;
  
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  const accentColor = externalAccentColor || getAccentColor();

  const [topPanelOpen, setTopPanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // Set once the map is won; freezes the scrolling-code background through the
  // clear shimmer. Resets naturally when the next map remounts this screen.
  const [mapComplete, setMapComplete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const memParallaxTickRef = useRef<((timestamp: number) => void) | null>(null);

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
  const showBreakOverlay = showBreakIntro && !showMoverOverlay;
  // The bar tutorials are split across maps so they never stack on level 1's
  // Level Cleared overlay: top bar on map 2, bottom bar on map 3.
  const showTopBarOverlay =
    levelNumber === 2 && showTopBarTutorial && !showMoverOverlay && !showBreakIntro;
  const showBottomBarOverlay =
    levelNumber === 3 && showBottomBarTutorial && !showMoverOverlay && !showBreakIntro;
  const modalOverlayActive =
    topPanelOpen || bottomPanelOpen || menuOpen ||
    showMoverOverlay || showBreakOverlay || showTopBarOverlay || showBottomBarOverlay;

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
            spaceRequired={100 - level.sizeThreshold}
            lockedBalls={totalLockedBalls}
            threadLockRequired={level.threadLockRequired}
            ownedUpgrades={ownedUpgrades}
            accentColor={accentColor}
            certificateProgress={certificateProgress}
            microManagerPerLock={activeModifiers.microManagerPerLock}
            ascensionDepth={ascensionDepth}
            showHighscoreBar={showHighscoreBar}
            highscoreCurrent={projectedScore}
            highscoreTarget={highscoreTarget}
            onExpand={() => setTopPanelOpen(true)}
          />
        </div>

        {/* Game Canvas Area */}
        <div className="flex-1 min-h-0">
          <GameCanvas
            level={level}
            levelNumber={levelNumber}
            totalLevels={totalLevels}
            totalScore={totalScore}
            lives={lives}
            onLivesChange={onLivesChange}
            onGameEnd={handleGameEnd}
            onLevelComplete={handleLevelComplete}
            onBallTypeLocked={onBallTypeLocked}
            onMapComplete={() => { setMapComplete(true); onMapComplete?.(); }}
            freezeOnComplete={freezeOnClear}
            onGameStateChange={handleGameStateChange}
            paused={isPaused || modalOverlayActive}
            tutorialMode={inGameStep === 'fence'}
            tutorialStep={inGameStep === 'fence' ? 'waitingForSuccessfulCut' : 'completed'}
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

        {/* Stats Panel at bottom */}
        <GameBottomBar
          activeModifiers={activeModifiers}
          accentColor={accentColor}
          lockedBalls={totalLockedBalls}
          onExpand={() => setBottomPanelOpen(true)}
        />
      </div>

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

      {/* Mover tutorial overlay — shown on first level with moving obstacles */}
      <TutorialOverlay
        visible={showMoverOverlay}
        onDismiss={() => {
          setMoverTutorialDismissed(true);
          onMoverTutorialSeen?.();
        }}
        accentColor="#ff8800"
        title={t('game.moverTutorialTitle')}
        body={t('game.moverTutorialBody')}
      />

      {/* Breaking-obstacles tutorial — first break-objective level (issue #38) */}
      <TutorialOverlay
        visible={showBreakOverlay}
        onDismiss={() => {
          setShowBreakIntro(false);
          try { localStorage.setItem('devend_break_tutorial_seen', '1'); } catch { /* ignore */ }
        }}
        accentColor="#ffb454"
        title={t('game.breakTutorialTitle')}
        body={t('game.breakTutorialBody')}
      />

      {/* Top bar tutorial — map 2, first run only */}
      <TutorialOverlay
        visible={showTopBarOverlay}
        onDismiss={onTopBarTutorialSeen}
        accentColor={accentColor}
        title={t('game.topBarTutorialTitle')}
        body={t('game.topBarTutorialBody')}
      />

      {/* Bottom bar tutorial — map 3, first run only */}
      <TutorialOverlay
        visible={showBottomBarOverlay}
        onDismiss={onBottomBarTutorialSeen}
        accentColor={accentColor}
        title={t('game.bottomBarTutorialTitle')}
        body={t('game.bottomBarTutorialBody')}
      />

      {/* Full-screen top info panel */}
      <TopBarDetailsPanel
        visible={topPanelOpen}
        onClose={() => setTopPanelOpen(false)}
        levelNumber={levelNumber}
        cutsUsed={gameState.cutsUsed}
        parCuts={level.expectedCuts}
        lives={lives}
        continuesRemaining={continuesRemaining}
        spaceRemaining={gameState.spaceRemaining}
        spaceRequired={100 - level.sizeThreshold}
        lockedBalls={totalLockedBalls}
        threadLockRequired={level.threadLockRequired}
        ownedUpgrades={ownedUpgrades}
        accentColor={accentColor}
        certificateProgress={certificateProgress}
        microManagerPerLock={activeModifiers.microManagerPerLock}
        ascensionDepth={ascensionDepth}
        activeLoadouts={activeLoadouts}
      />

      {/* Full-screen bottom stats panel */}
      <BottomBarDetailsPanel
        visible={bottomPanelOpen}
        onClose={() => setBottomPanelOpen(false)}
        activeModifiers={activeModifiers}
        modifierSources={modifierSources}
        accentColor={accentColor}
        lockedBalls={totalLockedBalls}
      />
    </>
  );
}
