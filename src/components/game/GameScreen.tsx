/**
 * GameScreen — the in-game layout: GameTopBar above, GameCanvas in the
 * middle, GameBottomBar below, plus background layers, the in-game menu and
 * tutorial overlays.
 *
 * Tapping the top/bottom bars opens their full-screen counterparts
 * (TopBarDetailsPanel / BottomBarDetailsPanel).
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { MutatorConfig } from '@/types/mutator';
import { useGameConfig } from '@/hooks/useGameConfig';
import { GameModifiers } from '@/hooks/useActiveModifiers';

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
  onLivesChange: (newLives: number) => void;
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
  onMainMenu: () => void;
  onRestart: () => void;
  showInGameTutorial?: boolean;
  onFenceSeen?: () => void;
  showMoverTutorial?: boolean;
  onMoverTutorialSeen?: () => void;
  showInfoPanelsTutorial?: boolean;
  onInfoPanelsTutorialSeen?: () => void;
  accentColor?: string;
  certificateProgress?: CertificateHourProgress;
  achievementBonuses?: Partial<Record<string, number>>;
  activeModifiers: GameModifiers;
  cumulativeLockedBalls?: number;
  ascensionDepth?: number;
  activeMutators?: MutatorConfig[];
  /** Ball hits a fence survives (Ascension); null = indestructible. */
  fenceDurability?: number | null;
}

export function GameScreen({
  level,
  levelNumber,
  totalLevels,
  totalScore,
  ownedUpgradeIds,
  upgrades,
  lives,
  onLivesChange,
  onGameEnd,
  onLevelComplete,
  onMainMenu,
  onRestart,
  showInGameTutorial = false,
  onFenceSeen,
  showMoverTutorial = false,
  onMoverTutorialSeen,
  showInfoPanelsTutorial = false,
  onInfoPanelsTutorialSeen,
  accentColor: externalAccentColor,
  certificateProgress,
  achievementBonuses,
  activeModifiers,
  cumulativeLockedBalls = 0,
  ascensionDepth = 0,
  activeMutators = [],
  fenceDurability = null,
}: GameScreenProps) {
  const { t } = useTranslation();
  const { config, getBackgroundColor, getRegionColor, getAccentColor } = useGameConfig();

  // In-game tutorial step state
  const [inGameStep, setInGameStep] = useState<InGameStep>(
    showInGameTutorial ? 'fence' : 'done'
  );

  const levelHasMovers = (level.entities ?? []).some(e => e.kind === 'mover');
  const [moverTutorialDismissed, setMoverTutorialDismissed] = useState(false);
  const showMoverOverlay = showMoverTutorial && levelHasMovers && !moverTutorialDismissed;

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

  const totalLockedBalls = cumulativeLockedBalls + gameState.lockedBalls;
  
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  const accentColor = externalAccentColor || getAccentColor();

  const [topPanelOpen, setTopPanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
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

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <>
      {/* CRT Terminal Background */}
      <CRTBackground accentColor={accentColor} />
      
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
            spaceRemaining={gameState.spaceRemaining}
            spaceRequired={100 - level.sizeThreshold}
            lockedBalls={totalLockedBalls}
            threadLockRequired={level.threadLockRequired}
            ownedUpgrades={ownedUpgrades}
            accentColor={accentColor}
            certificateProgress={certificateProgress}
            microManagerPerLock={activeModifiers.microManagerPerLock}
            ascensionDepth={ascensionDepth}
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
            onGameStateChange={handleGameStateChange}
            paused={isPaused}
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
            regionColor={getRegionColor()}
            accentColor={accentColor}
            activeModifiers={activeModifiers}
            cumulativeLockedBalls={cumulativeLockedBalls}
            fenceDurability={fenceDurability}
            parallaxTickRef={memParallaxTickRef}
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
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <RotateCcw className="w-4 h-4" />
              {t('game.restartRun')}
            </button>
            <button
              onClick={() => { setMenuOpen(false); onMainMenu(); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors"
              style={{ color: accentColor, backgroundColor: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
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

      {/* Info panels tutorial — shown after fence tutorial, first run only */}
      <TutorialOverlay
        visible={inGameStep === 'done' && showInfoPanelsTutorial && !showMoverOverlay}
        onDismiss={onInfoPanelsTutorialSeen}
        accentColor={accentColor}
        title={t('game.infoPanelsTutorialTitle')}
        body={t('game.infoPanelsTutorialBody')}
      />

      {/* Full-screen top info panel */}
      <TopBarDetailsPanel
        visible={topPanelOpen}
        onClose={() => setTopPanelOpen(false)}
        levelNumber={levelNumber}
        cutsUsed={gameState.cutsUsed}
        parCuts={level.expectedCuts}
        lives={lives}
        spaceRemaining={gameState.spaceRemaining}
        spaceRequired={100 - level.sizeThreshold}
        lockedBalls={totalLockedBalls}
        threadLockRequired={level.threadLockRequired}
        ownedUpgrades={ownedUpgrades}
        accentColor={accentColor}
        certificateProgress={certificateProgress}
        microManagerPerLock={activeModifiers.microManagerPerLock}
        ascensionDepth={ascensionDepth}
        activeMutators={activeMutators}
      />

      {/* Full-screen bottom stats panel */}
      <BottomBarDetailsPanel
        visible={bottomPanelOpen}
        onClose={() => setBottomPanelOpen(false)}
        activeModifiers={activeModifiers}
        accentColor={accentColor}
        lockedBalls={totalLockedBalls}
      />
    </>
  );
}
