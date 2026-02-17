import { useMemo } from 'react';
import { LevelConfig } from '@/types/level';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { generateScoringPreview } from '@/lib/scoring';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ScoringPreviewPanelProps {
  level: LevelConfig;
}

export function ScoringPreviewPanel({ level }: ScoringPreviewPanelProps) {
  const { config, loading } = useScoringConfig();

  const requiredRemovedRatio = (100 - level.sizeThreshold) / 100;
  const parFences = level.expectedCuts;
  const basePoints = level.points;

  const preview = useMemo(() => {
    return generateScoringPreview(parFences, requiredRemovedRatio, config, basePoints);
  }, [parFences, requiredRemovedRatio, config, basePoints]);

  if (loading) {
    return (
      <div className="p-3 border-b border-border">
        <div className="text-xs text-muted-foreground">Loading scoring config...</div>
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-border">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">
        Scoring Preview
      </h3>

      {/* Level Info */}
      <div className="grid grid-cols-3 gap-2 text-xs mb-4 p-2 bg-muted/50 rounded">
        <div>
          <span className="text-muted-foreground">Par:</span>
          <span className="ml-1 font-mono font-bold">{parFences}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Base:</span>
          <span className="ml-1 font-mono font-bold">{basePoints}h</span>
        </div>
        <div>
          <span className="text-muted-foreground">Remove:</span>
          <span className="ml-1 font-mono font-bold">{(requiredRemovedRatio * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Scenario Table */}
      <div className="space-y-2">
        {preview.map((scenario, idx) => {
          const { breakdown, earnedScore } = scenario;
          const isOverPar = breakdown.fencesOverPar > 0;
          const isSpaceDisabled = breakdown.fencesOverPar >= 3;

          return (
            <div
              key={idx}
              className={`p-2 rounded text-xs border ${
                breakdown.fencesUnderPar > 0
                  ? 'border-success/30 bg-success/5'
                  : breakdown.fencesOverPar > 0
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-border bg-muted/30'
              }`}
            >
              {/* Scenario Label */}
              <div className="flex items-center gap-1 mb-2 font-medium">
                {breakdown.fencesUnderPar > 0 ? (
                  <TrendingUp className="w-3 h-3 text-success" />
                ) : breakdown.fencesOverPar > 0 ? (
                  <TrendingDown className="w-3 h-3 text-destructive" />
                ) : (
                  <Minus className="w-3 h-3 text-muted-foreground" />
                )}
                <span>{scenario.label}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {scenario.usedFences} fences
                </span>
              </div>

              {/* Breakdown */}
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Base {isOverPar && `(x${breakdown.performanceMultiplier})`}
                  </span>
                  <span className={`font-mono ${isOverPar ? 'text-destructive' : ''}`}>
                    {Math.floor(basePoints * breakdown.performanceMultiplier)}h
                  </span>
                </div>

                {breakdown.underParBonus > 0 && (
                  <div className="flex justify-between">
                    <span className="text-success">Under-par bonus</span>
                    <span className="font-mono text-success">+{breakdown.underParBonus}h</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className={isSpaceDisabled ? 'text-destructive' : 'text-muted-foreground'}>
                    Space bonus {isSpaceDisabled && '(disabled)'}
                  </span>
                  <span className={`font-mono ${isSpaceDisabled ? 'text-destructive line-through' : ''}`}>
                    {breakdown.spaceBonus > 0 ? `+${breakdown.spaceBonus}h` : '0h'}
                  </span>
                </div>
              </div>

              {/* Total */}
              <div className="mt-2 pt-1.5 border-t border-border/50 flex justify-between items-center">
                <span className="text-muted-foreground">Earned:</span>
                <span className="font-bold text-lg">{earnedScore}h</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
