import { useState, useCallback, useRef, useEffect } from 'react';
import { Menu, Home, RotateCcw } from 'lucide-react';
import { GameCanvas, GameStateInfo } from './GameCanvas';
import { GameTopBar } from './GameTopBar';
import { GameStatsPanel } from './GameStatsPanel';
import { CRTBackground } from './CRTBackground';
import { MemoryParallaxLayer } from './MemoryParallaxLayer';
import { TutorialOverlay } from './TutorialOverlay';
import { LevelConfig } from '@/types/level';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import { useGameConfig } from '@/hooks/useGameConfig';
import { GameModifiers } from '@/hooks/useActiveModifiers';

interface AugmentProgress {
  levelsCompleted: number;
  levelsToNextPoint: number;
  progressInCurrentPoint: number;
  pointsEarned: number;
  levelsPerPoint: number;
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
  accentColor?: string;
  augmentProgress?: AugmentProgress;
  achievementBonuses?: Partial<Record<string, number>>;
  activeModifiers: GameModifiers;
  cumulativeLockedBalls?: number;
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
  accentColor: externalAccentColor,
  augmentProgress,
  achievementBonuses,
  activeModifiers,
  cumulativeLockedBalls = 0,
}: GameScreenProps) {
  const { config, getBackgroundColor, getRegionColor, getAccentColor } = useGameConfig();

  // In-game tutorial step state
  const [inGameStep, setInGameStep] = useState<InGameStep>(
    showInGameTutorial ? 'fence' : 'done'
  );

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

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      <MemoryParallaxLayer accentColor={accentColor} />
      
      <div className="fixed inset-0 flex flex-col z-10">
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
            augmentProgress={augmentProgress}
            microManagerPerLock={activeModifiers.microManagerPerLock}
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
          />
        </div>

        {/* Stats Panel at bottom */}
        <GameStatsPanel
          activeModifiers={activeModifiers}
          accentColor={accentColor}
          lockedBalls={totalLockedBalls}
        />
        

        {/* Bank button during push mode - fixed overlay at bottom */}
        {false && gameState.pushMode === "pushing" && gameState.onBankAndContinue && (
          <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center items-center py-4 pointer-events-none">
            <button
              onClick={gameState.onBankAndContinue}
              className="px-6 py-3 rounded-lg font-bold shadow-lg transition-colors flex items-center gap-2 pointer-events-auto"
              style={{
                backgroundColor: '#f97316',
                color: '#000000',
                boxShadow: '0 0 20px rgba(249, 115, 22, 0.6)',
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Bank & Continue
            </button>
          </div>
        )}
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
    </>
  );
}
