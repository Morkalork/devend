/**
 * GameScreen — the in-game layout: GameTopBar above, GameCanvas in the
 * middle, GameBottomBar below, plus background layers, the in-game menu and
 * tutorial overlays.
 *
 * Tapping the top/bottom bars opens their full-screen counterparts
 * (TopBarDetailsPanel / BottomBarDetailsPanel).
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Menu, Home, RotateCcw } from 'lucide-react';
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
  const menuRef = useRef<HTMLDivElement>(null);
  const memParallaxTickRef = useRef<((timestamp: number) => void) | null>(null);

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
            onGameEnd={onGameEnd}
            onLevelComplete={onLevelComplete}
            onGameStateChange={handleGameStateChange}
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

      {/* Always-visible menu — floats above all overlays */}
      <div ref={menuRef} className="fixed top-2 left-2 z-[70]">
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          className="flex items-center justify-center w-8 h-8 rounded-md transition-all"
          style={{
            backgroundColor: menuOpen ? `${accentColor}33` : 'rgba(0,10,5,0.85)',
            border: `1px solid ${accentColor}55`,
            color: accentColor,
          }}
          aria-label="Game menu"
        >
          <Menu className="w-5 h-5" />
        </button>
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
              Restart Run
            </button>
            <button
              onClick={() => { setMenuOpen(false); onMainMenu(); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors"
              style={{ color: accentColor, backgroundColor: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = `${accentColor}18`)}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Home className="w-4 h-4" />
              Main Menu
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
        title="⚠ Moving Obstacles"
        body={
          "Orange obstacles move back and forth on a fixed track.\n\n" +
          "Balls bounce off them — but if your growing fence touches one, you lose a life.\n\n" +
          "Watch the track lines and time your fences carefully!"
        }
      />

      {/* Info panels tutorial — shown after fence tutorial, first run only */}
      <TutorialOverlay
        visible={inGameStep === 'done' && showInfoPanelsTutorial && !showMoverOverlay}
        onDismiss={onInfoPanelsTutorialSeen}
        accentColor={accentColor}
        title="Info Panels"
        body={
          "The status bars are expandable!\n\n" +
          "Tap the TOP BAR to see full level details, all your active upgrades with descriptions, and certificate-hour progress.\n\n" +
          "Tap the BOTTOM BAR to view every active modifier explained in plain language."
        }
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
