import { GameCanvas } from './GameCanvas';
import { LevelConfig } from '@/types/level';
import { GameResult, LevelScoreData } from '@/types/game';

interface GameScreenProps {
  level: LevelConfig;
  levelNumber: number;
  totalLevels: number;
  totalScore: number;
  onGameEnd: (result: GameResult) => void;
  onLevelComplete: (scoreData: LevelScoreData) => void;
}

export function GameScreen({ level, levelNumber, totalLevels, totalScore, onGameEnd, onLevelComplete }: GameScreenProps) {
  return (
    <div className="fixed inset-0" style={{ backgroundColor: `#${level.backgroundColor}` }}>
      <GameCanvas 
        level={level}
        levelNumber={levelNumber}
        totalLevels={totalLevels}
        totalScore={totalScore}
        onGameEnd={onGameEnd}
        onLevelComplete={onLevelComplete}
      />
    </div>
  );
}
