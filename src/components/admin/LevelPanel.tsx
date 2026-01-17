import { LevelConfig } from '@/types/level';

interface LevelPanelProps {
  level: LevelConfig;
  onUpdateLevel: (level: LevelConfig) => void;
}

export function LevelPanel({ level, onUpdateLevel }: LevelPanelProps) {
  return (
    <div className="p-3 border-b border-border">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Level Settings</h3>
      
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1 col-span-2">
          <span className="text-muted-foreground">Level ID</span>
          <input
            type="text"
            value={level.id}
            onChange={(e) => onUpdateLevel({ ...level, id: e.target.value })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
          />
        </label>
        
        <label className="space-y-1">
          <span className="text-muted-foreground">Size Threshold %</span>
          <input
            type="number"
            value={level.sizeThreshold}
            onChange={(e) => onUpdateLevel({ ...level, sizeThreshold: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
            min={1}
            max={99}
          />
        </label>
        
        <label className="space-y-1">
          <span className="text-muted-foreground">Expected Cuts</span>
          <input
            type="number"
            value={level.expectedCuts}
            onChange={(e) => onUpdateLevel({ ...level, expectedCuts: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
            min={1}
          />
        </label>
        
        <label className="space-y-1 col-span-2">
          <span className="text-muted-foreground">Base Points</span>
          <input
            type="number"
            value={level.points}
            onChange={(e) => onUpdateLevel({ ...level, points: Number(e.target.value) })}
            className="w-full px-2 py-1 rounded bg-background border border-border"
            min={1}
          />
        </label>
      </div>
    </div>
  );
}
