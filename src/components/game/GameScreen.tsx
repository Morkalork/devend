import { GameCanvas } from './GameCanvas';
import { LevelConfig } from '@/types/level';
import { GameResult, LevelScoreData } from '@/types/game';
import { UpgradeConfig } from '@/types/upgrade';

interface GameScreenProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  totalScore: number;
  ownedUpgradeIds: string[];
  upgrades: UpgradeConfig[];
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
}

export function GameScreen({ 
  level, 
  levelNumber, 
  totalLevels, 
  totalScore, 
  ownedUpgradeIds,
  upgrades,
  onGameEnd, 
  onLevelComplete 
}: GameScreenProps) {
  return (
    <div className="fixed inset-0" style={{ backgroundColor: `#${level.backgroundColor}` }}>
      <GameCanvas 
        level={level}
        levelNumber={levelNumber}
        totalLevels={totalLevels}
        totalScore={totalScore}
        ownedUpgradeIds={ownedUpgradeIds}
        upgrades={upgrades}
        onGameEnd={onGameEnd}
        onLevelComplete={onLevelComplete}
      />
    </div>
  );
}
