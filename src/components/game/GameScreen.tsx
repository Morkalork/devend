import { GameCanvas } from './GameCanvas';
import { CRTBackground } from './CRTBackground';
import { LevelConfig } from '@/types/level';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';
import { SvgIcon } from '@/components/ui/SvgIcon';
import { TutorialStep } from '@/hooks/useInteractiveTutorial';

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
  // Get owned upgrade details
  const ownedUpgrades = upgrades.filter(u => ownedUpgradeIds.includes(u.id));

  return (
    <>
      {/* CRT Terminal Background */}
      <CRTBackground />
      
      <div className="fixed inset-0 flex flex-col z-10" style={{ backgroundColor: `#${level.backgroundColor}e8` }}>
      {/* Top HUD bar with level info and upgrades */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between gap-4" style={{ backgroundColor: `#${level.backgroundColor}` }}>
        {/* Level and Score */}
        <div className="flex gap-3">
          <div className="hud-display">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Level</span>
            <div className="text-xl font-display font-bold text-primary">
              {levelNumber} / {totalLevels}
            </div>
          </div>
          <div className="hud-display">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Score</span>
            <div className="text-xl font-display font-bold text-accent">
              {totalScore}
            </div>
          </div>
        </div>

        {/* Owned Upgrades Display */}
        {ownedUpgrades.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider mr-1">Upgrades:</span>
            <div className="flex gap-1.5">
              {ownedUpgrades.map((upgrade) => (
                <div
                  key={upgrade.id}
                  className="w-7 h-7 rounded bg-white/10 p-1 flex items-center justify-center"
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
        />
      </div>
    </div>
    </>
  );
}
