import { useState, useCallback, useRef, useEffect } from 'react';
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

interface AugmentProgress {
  levelsCompleted: number;
  levelsToNextPoint: number;
  progressInCurrentPoint: number;
  pointsEarned: number;
  levelsPerPoint: number;
}

type InGameStep = 'topBar' | 'bottomBar' | 'fence' | 'done';

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
  onTopBarSeen?: () => void;
  onBottomBarSeen?: () => void;
  onFenceSeen?: () => void;
  accentColor?: string;
  augmentProgress?: AugmentProgress;
  achievementBonuses?: Partial<Record<string, number>>;
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
  onTopBarSeen,
  onBottomBarSeen,
  onFenceSeen,
  accentColor: externalAccentColor,
  augmentProgress,
  achievementBonuses,
}: GameScreenProps) {
  const { config, getBackgroundColor, getRegionColor, getAccentColor } = useGameConfig();

  // In-game tutorial step state
  const [inGameStep, setInGameStep] = useState<InGameStep>(
    showInGameTutorial ? 'topBar' : 'done'
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
  
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  const accentColor = externalAccentColor || getAccentColor();

  // Measure bar heights for spotlight overlays
  const topBarRef = useRef<HTMLDivElement>(null);
  const statsPanelRef = useRef<HTMLDivElement>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [statsPanelHeight, setStatsPanelHeight] = useState(0);

  useEffect(() => {
    if (topBarRef.current) setTopBarHeight(topBarRef.current.offsetHeight);
    if (statsPanelRef.current) setStatsPanelHeight(statsPanelRef.current.offsetHeight);
  }, []);

  return (
    <>
      {/* CRT Terminal Background */}
      <CRTBackground accentColor={accentColor} />
      
      {/* Memory Parallax Layer - between CRT and game */}
      <MemoryParallaxLayer accentColor={accentColor} />
      
      <div className="fixed inset-0 flex flex-col z-10">
        {/* Game Top Bar - Two rows */}
        <div ref={topBarRef}>
          <GameTopBar
            levelNumber={levelNumber}
            cutsUsed={gameState.cutsUsed}
            parCuts={level.expectedCuts}
            lives={lives}
            spaceRemaining={gameState.spaceRemaining}
            spaceRequired={100 - level.sizeThreshold}
            lockedBalls={gameState.lockedBalls}
            threadLockRequired={level.threadLockRequired}
            ownedUpgrades={ownedUpgrades}
            accentColor={accentColor}
            augmentProgress={augmentProgress}
            onMainMenu={onMainMenu}
            onRestart={onRestart}
          />
        </div>

        {/* Game Canvas Area */}
        <div className="flex-1 min-h-0">
          <GameCanvas
            level={level}
            levelNumber={levelNumber}
            totalLevels={totalLevels}
            totalScore={totalScore}
            ownedUpgradeIds={ownedUpgradeIds}
            upgrades={upgrades}
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
            achievementBonuses={achievementBonuses}
          />
        </div>

        {/* Stats Panel at bottom */}
        <GameStatsPanel
          ref={statsPanelRef}
          ownedUpgradeIds={ownedUpgradeIds}
          upgrades={upgrades}
          accentColor={accentColor}
          achievementBonuses={achievementBonuses}
        />
        
        {/* In-game tutorial overlays */}
        <TutorialOverlay
          visible={inGameStep === 'topBar'}
          arrowDirection="up"
          spotlightArea="top"
          spotlightHeightPx={topBarHeight}
          accentColor={accentColor}
          title="GAME STATUS"
          body="The top bar shows your progress: level, cuts vs par, lives, board space cleared, and augment progress."
          onDismiss={() => {
            setInGameStep('bottomBar');
            onTopBarSeen?.();
          }}
        />
        <TutorialOverlay
          visible={inGameStep === 'bottomBar'}
          arrowDirection="down"
          spotlightArea="bottom"
          spotlightHeightPx={statsPanelHeight}
          accentColor={accentColor}
          title="YOUR UPGRADES"
          body="The bottom bar shows all active modifiers from purchased upgrades. Highlighted values are boosted. Upgrades last until the run ends."
          onDismiss={() => {
            setInGameStep('fence');
            onBottomBarSeen?.();
          }}
        />

        {/* Bank button during push mode - fixed overlay at bottom */}
        {gameState.pushMode === "pushing" && gameState.onBankAndContinue && (
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
    </>
  );
}
