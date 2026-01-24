import { useState, useCallback } from 'react';
import { GameCanvas, GameStateInfo } from './GameCanvas';
import { GameTopBar } from './GameTopBar';
import { GameStatsPanel } from './GameStatsPanel';
import { CRTBackground } from './CRTBackground';
import { LevelConfig } from '@/types/level';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import { TutorialStep } from '@/hooks/useInteractiveTutorial';
import { useGameConfig } from '@/hooks/useGameConfig';

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
  tutorialMode?: boolean;
  tutorialStep?: TutorialStep;
  onTutorialCutSuccess?: () => void;
  accentColor?: string;
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
  tutorialMode = false,
  tutorialStep = 'completed',
  onTutorialCutSuccess,
  accentColor: externalAccentColor,
}: GameScreenProps) {
  const { config, getBackgroundColor, getRegionColor, getAccentColor } = useGameConfig();
  
  // Game state for top bar
  const [gameState, setGameState] = useState<GameStateInfo>({
    cutsUsed: 0,
    spaceRemaining: 100,
    lockedBalls: 0,
  });

  const handleGameStateChange = useCallback((state: GameStateInfo) => {
    setGameState(state);
  }, []);
  
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  const accentColor = externalAccentColor || getAccentColor();

  return (
    <>
      {/* CRT Terminal Background */}
      <CRTBackground accentColor={accentColor} />
      
      <div className="fixed inset-0 flex flex-col z-10">
        {/* Game Top Bar - Two rows */}
        <GameTopBar
          levelNumber={levelNumber}
          cutsUsed={gameState.cutsUsed}
          parCuts={level.expectedCuts}
          lives={lives}
          spaceRemaining={gameState.spaceRemaining}
          spaceRequired={100 - level.sizeThreshold}
          lockedBalls={gameState.lockedBalls}
          ownedUpgrades={ownedUpgrades}
          accentColor={accentColor}
        />

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
            tutorialMode={tutorialMode}
            tutorialStep={tutorialStep}
            onTutorialCutSuccess={onTutorialCutSuccess}
            canvasOpacity={config.visuals.canvas_opacity}
            regionColor={getRegionColor()}
            accentColor={accentColor}
          />
        </div>

        {/* Stats Panel at bottom */}
        <GameStatsPanel
          ownedUpgradeIds={ownedUpgradeIds}
          upgrades={upgrades}
          accentColor={accentColor}
        />
      </div>
    </>
  );
}
