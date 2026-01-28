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
    pushMode: "none",
    onBankAndContinue: undefined,
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
