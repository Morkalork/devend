import { GameCanvas } from './GameCanvas';

interface GameScreenProps {
  onGameEnd: (isWin: boolean, remainingPercent: number) => void;
}

export function GameScreen({ onGameEnd }: GameScreenProps) {
  return (
    <div className="fixed inset-0 bg-void">
      <GameCanvas onGameEnd={onGameEnd} />
    </div>
  );
}
