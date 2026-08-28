import { LevelConfig } from '@/types/level';
import { MIN_MAP_LIGHT } from "@/lib/rendering/sleek/boardWash";
import { ScoringPreviewPanel } from './ScoringPreviewPanel';
import { WinConditionsPanel } from './WinConditionsPanel';

interface LevelPanelProps {
  level: LevelConfig;
  onUpdateLevel: (level: LevelConfig) => void;
}

export function LevelPanel({ level, onUpdateLevel }: LevelPanelProps) {
  return (
    <div className="border-b border-border">
      <div className="p-3">
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
            <span className="text-muted-foreground">Expected Cuts (Par)</span>
            <input
              type="number"
              value={level.expectedCuts}
              onChange={(e) => onUpdateLevel({ ...level, expectedCuts: Number(e.target.value) })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={1}
            />
          </label>
          
          <label className="space-y-1">
            <span className="text-muted-foreground">Base Points</span>
            <input
              type="number"
              value={level.points}
              onChange={(e) => onUpdateLevel({ ...level, points: Number(e.target.value) })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={1}
            />
          </label>

          {/* Map light: 1 (or blank) is the normal board; lower is an authored
              dark map. Blank rather than 1 when unset, so the YAML stays clean
              and a map that never wanted this carries no field. */}
          <label className="space-y-1">
            <span className="text-muted-foreground">
              Map Light ({MIN_MAP_LIGHT}-1, blank = normal)
            </span>
            <input
              type="number"
              value={level.light ?? ''}
              placeholder="1"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = { ...level };
                if (raw === '') delete next.light;
                else next.light = Math.max(MIN_MAP_LIGHT, Math.min(1, Number(raw)));
                onUpdateLevel(next);
              }}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={MIN_MAP_LIGHT}
              max={1}
              step={0.05}
            />
          </label>

          <label className="space-y-1">
            <span className="text-muted-foreground">Random Shapes %</span>
            <input
              type="number"
              value={level.randomShapes ?? 20}
              onChange={(e) => onUpdateLevel({ ...level, randomShapes: Number(e.target.value) })}
              className="w-full px-2 py-1 rounded bg-background border border-border"
              min={0}
              max={100}
            />
          </label>
        </div>
      </div>
      
      {/* What this map actually asks of the player, above the payout preview:
          the win is the design decision, the score is its consequence. */}
      <WinConditionsPanel level={level} onUpdateLevel={onUpdateLevel} />

      {/* Scoring Preview Panel */}
      <ScoringPreviewPanel level={level} />
    </div>
  );
}