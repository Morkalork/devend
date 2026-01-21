import { useMemo } from 'react';
import { LevelConfig } from '@/types/level';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { generateScoringPreview, calculateScoreBreakdown } from '@/lib/scoring';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ScoringPreviewPanelProps {
  level: LevelConfig;
}

export function ScoringPreviewPanel({ level }: ScoringPreviewPanelProps) {
  const { config, loading } = useScoringConfig();

  // Calculate required removed ratio from size threshold
  // sizeThreshold is the % that must REMAIN, so required removed = (100 - sizeThreshold) / 100
  const requiredRemovedRatio = (100 - level.sizeThreshold) / 100;
  const parFences = level.expectedCuts;

  const preview = useMemo(() => {
    return generateScoringPreview(parFences, requiredRemovedRatio, config);
  }, [parFences, requiredRemovedRatio, config]);

  const maxFenceBonus = config.scoring.fenceEfficiency.maxBonus;
  const maxSpaceBonus = config.scoring.spaceOptimization.maxBonus;
  const maxTotal = maxFenceBonus + maxSpaceBonus;

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
      <div className="grid grid-cols-2 gap-2 text-xs mb-4 p-2 bg-muted/50 rounded">
        <div>
          <span className="text-muted-foreground">Par Fences:</span>
          <span className="ml-1 font-mono font-bold">{parFences}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Min Removed:</span>
          <span className="ml-1 font-mono font-bold">{(requiredRemovedRatio * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Max Bonus Display */}
      <div className="mb-3 p-2 bg-primary/10 rounded text-xs">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Max Possible Bonus:</span>
          <span className="font-bold text-primary">{maxTotal}</span>
        </div>
        <div className="flex gap-2 mt-1 text-[10px]">
          <span className="text-muted-foreground">Fence: {maxFenceBonus}</span>
          <span className="text-muted-foreground">Space: {maxSpaceBonus}</span>
        </div>
      </div>

      {/* Scenario Table */}
      <div className="space-y-2">
        {preview.map((scenario, idx) => {
          const { breakdown } = scenario;
          const isPenalized = breakdown.penaltyMultiplier < 1;
          const isDisabled = breakdown.penaltyMultiplier === 0;

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
              </div>

              {/* Bonus Bars */}
              <div className="space-y-1">
                {/* Fence Bonus Bar */}
                <div className="flex items-center gap-2">
                  <span className="w-12 text-muted-foreground shrink-0">Fence:</span>
                  <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full bg-success transition-all"
                      style={{ width: `${(breakdown.fenceBonus / maxFenceBonus) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono">{breakdown.fenceBonus}</span>
                </div>

                {/* Space Bonus Bar */}
                <div className="flex items-center gap-2">
                  <span className="w-12 text-muted-foreground shrink-0">Space:</span>
                  <div className="flex-1 h-3 bg-muted rounded overflow-hidden relative">
                    {/* Raw bonus (faded) */}
                    {isPenalized && !isDisabled && (
                      <div
                        className="absolute inset-y-0 left-0 bg-amber-500/30"
                        style={{ width: `${(breakdown.spaceBonusRaw / maxSpaceBonus) * 100}%` }}
                      />
                    )}
                    {/* Actual bonus */}
                    <div
                      className={`h-full transition-all relative ${
                        isDisabled
                          ? 'bg-destructive/50'
                          : isPenalized
                          ? 'bg-amber-500'
                          : 'bg-primary'
                      }`}
                      style={{ width: `${(breakdown.spaceBonus / maxSpaceBonus) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono">
                    {isDisabled ? (
                      <span className="text-destructive">0</span>
                    ) : isPenalized ? (
                      <span className="text-amber-500">{breakdown.spaceBonus}</span>
                    ) : (
                      breakdown.spaceBonus
                    )}
                  </span>
                </div>
              </div>

              {/* Penalty Indicator */}
              {isPenalized && (
                <div className="mt-1.5 text-[10px] text-amber-500">
                  {isDisabled
                    ? '⚠ Space bonus disabled (+3 over par)'
                    : `⚠ Space ×${breakdown.penaltyMultiplier} (${breakdown.fencesOverPar} over par)`}
                </div>
              )}

              {/* Total */}
              <div className="mt-2 pt-1.5 border-t border-border/50 flex justify-between items-center">
                <span className="text-muted-foreground">Total Bonus:</span>
                <span className="font-bold text-lg">{breakdown.totalBonus}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
