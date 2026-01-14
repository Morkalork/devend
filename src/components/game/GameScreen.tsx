import { GameCanvas } from './GameCanvas';
import { LevelConfig } from '@/types/level';
import { GameResult } from '@/types/game';

interface GameScreenProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: () => void;
}

export function GameScreen({ level, levelNumber, totalLevels, onGameEnd, onLevelComplete }: GameScreenProps) {
  return (
    <div className="fixed inset-0" style={{ backgroundColor: `#${level.backgroundColor}` }}>
      <GameCanvas 
        level={level}
        levelNumber={levelNumber}
        totalLevels={totalLevels}
        onGameEnd={onGameEnd}
        onLevelComplete={onLevelComplete}
      />
    </div>
  );
}
