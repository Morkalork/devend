import { GameCanvas } from './GameCanvas';
import { CRTBackground } from './CRTBackground';
import { LevelConfig } from '@/types/level';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import { SvgIcon } from '@/components/ui/SvgIcon';
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
}: GameScreenProps) {
  const { config, getBackgroundColor, getRegionColor, getAccentColor } = useGameConfig();
  
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  return (
    <>
      {/* CRT Terminal Background */}
      <CRTBackground accentColor={getAccentColor()} />
      
      <div className="fixed inset-0 flex flex-col z-10">
      {/* Minimal Top HUD bar */}
      <div className="flex-shrink-0 px-2 py-0.5 flex items-center justify-between" style={{ backgroundColor: getBackgroundColor(config.visuals.hud_opacity) }}>
        {/* Level and Score - minimal */}
        <div className="flex gap-2 items-center text-xs">
          <span className="font-display font-bold text-primary">
            L{levelNumber}/{totalLevels}
          </span>
          <span className="font-display font-bold text-accent">
            {totalScore}pts
          </span>
        </div>

        {/* Owned Upgrades Display - minimal */}
        {ownedUpgrades.length > 0 && (
          <div className="flex gap-0.5">
            {ownedUpgrades.map((upgrade) => (
              <div
                key={upgrade.id}
                className="w-4 h-4 rounded bg-white/10 p-0.5 flex items-center justify-center"
                title={upgrade.name}
              >
                <SvgIcon
                  src={upgrade.icon}
                  className="w-full h-full text-primary [&>svg]:w-full [&>svg]:h-full"
                  alt={upgrade.name}
                />
              </div>
            ))}
          </div>
        )}
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
          tutorialMode={tutorialMode}
          tutorialStep={tutorialStep}
          onTutorialCutSuccess={onTutorialCutSuccess}
          canvasOpacity={config.visuals.canvas_opacity}
          regionColor={getRegionColor()}
          accentColor={getAccentColor()}
        />
      </div>
    </div>
    </>
  );
}
