import { useState } from 'react';
import { Trophy, ArrowRight, Sparkles, TrendingUp, TrendingDown, Target, Lock, Clock, Zap } from 'lucide-react';
import { LevelScoreData } from '@/types/game';

interface LevelCompleteOverlayProps {
  scoreData: LevelScoreData;
  totalScore: number;
  onContinue: () => void;
  accentColor?: string;
}

export function LevelCompleteOverlay({ scoreData, totalScore, onContinue, accentColor }: LevelCompleteOverlayProps) {
  const [chosen, setChosen] = useState(false);
  const {
    levelNumber,
    levelId,
    cutCount,
    expectedCuts,
    basePoints,
    levelScore,
    remainingPercent,
    overcutBonus = 0,
    pushFailed = false,
    underParBonus = 0,
    spaceBonus = 0,
    spaceBonusRaw = 0,
    performanceMultiplier = 1,
    fencesUnderPar = 0,
    fencesOverPar = 0,
    extraPercent = 0,
    lockBonus = 0,
    lockedBallsCount = 0,
    interestGain = 0,
    pushBonus = 0,
  } = scoreData;

  const isOverPar = fencesOverPar > 0;
  const isSpaceDisabled = fencesOverPar >= 3;
  const hasLockBonus = lockBonus > 0;
  const hasInterest = interestGain > 0;
  const hasPushBonus = pushBonus > 0;
  const scaledBase = Math.floor(basePoints * performanceMultiplier);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm" />

      {/* Modal container */}
      <div
        className="level-complete-modal fixed z-50 overflow-y-auto"
        style={{
          bottom: '1rem',
          left: '1rem',
          right: '1rem',
          maxHeight: 'calc(100vh - 2rem)',
        }}
      >
        <style>{`
          @media (min-width: 640px) {
            .level-complete-modal {
              top: 50% !important;
              bottom: auto !important;
              left: 50% !important;
              right: auto !important;
              width: 420px !important;
              max-height: 90vh !important;
              margin-left: -210px !important;
              margin-top: -320px !important;
            }
          }
        `}</style>

        <div className="bg-card border border-border rounded-xl p-4 sm:p-6 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-success/20 flex items-center justify-center">
              <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-success" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-display font-bold text-foreground">Level Complete!</h2>
              <p className="text-muted-foreground text-xs sm:text-sm">{levelId}</p>
            </div>
          </div>

          {/* Push Failed Warning */}
          {pushFailed && (
            <div className="mb-4 p-3 bg-warning/10 border border-warning/30 rounded-lg text-center">
              <p className="text-warning text-sm font-medium">
                Push failed!{hasPushBonus ? ` But you earned +${pushBonus}h bonus.` : ' No extra bonus earned.'}
              </p>
            </div>
          )}

          {/* Stats Grid */}
          <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 text-sm sm:text-base">
            <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
              <span className="text-muted-foreground">Level</span>
              <span className="font-bold text-foreground">{levelNumber}</span>
            </div>

            <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
              <span className="text-muted-foreground">Remaining</span>
              <span className="font-bold text-foreground">{remainingPercent}%</span>
            </div>

            {/* Fence Efficiency Section */}
            <div className="py-2 border-b border-border">
              <div className="flex justify-between items-center mb-1">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Fences Used
                </span>
                <span className="font-bold text-foreground">
                  {cutCount} / {expectedCuts}
                </span>
              </div>

              {fencesUnderPar > 0 && (
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-success flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {fencesUnderPar} under par
                  </span>
                  <span className="font-bold text-success">+{underParBonus}h</span>
                </div>
              )}

              {fencesOverPar > 0 && (
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-destructive flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    {fencesOverPar} over par
                  </span>
                  <span className="text-destructive text-xs">
                    Base x{performanceMultiplier}
                    {isSpaceDisabled && ' · No space bonus'}
                  </span>
                </div>
              )}
            </div>

            {/* Space Optimization Section */}
            {extraPercent > 0 && (
              <div className="py-2 border-b border-border">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Extra Space Removed
                  </span>
                  <span className="font-bold text-foreground">+{(extraPercent * 100).toFixed(0)}%</span>
                </div>

                <div className="flex justify-between items-center text-sm">
                  <span className={isSpaceDisabled ? 'text-destructive' : 'text-primary'}>
                    Space Bonus
                  </span>
                  <span className={`font-bold ${isSpaceDisabled ? 'text-destructive line-through' : 'text-primary'}`}>
                    {isSpaceDisabled ? `${spaceBonusRaw}h` : spaceBonus > 0 ? `+${spaceBonus}h` : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Base Overtime with performance multiplier */}
            <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Base Overtime
                {isOverPar && (
                  <span className="text-destructive text-xs">(x{performanceMultiplier})</span>
                )}
              </span>
              <span className={`font-bold ${isOverPar ? 'text-destructive' : 'text-foreground'}`}>
                {scaledBase}h
              </span>
            </div>

            {/* Thread Lock Bonus Section */}
            {hasLockBonus && (
              <div className="flex justify-between items-center py-2 border-b border-cyan-500/30 bg-cyan-500/10 rounded px-2">
                <span className="text-cyan-400 flex items-center gap-1">
                  <Lock className="w-3 h-3 sm:w-4 sm:h-4" />
                  Thread Locks ({lockedBallsCount})
                </span>
                <span className="font-bold text-cyan-400">+{lockBonus}h</span>
              </div>
            )}

            {/* Interest Gain */}
            {hasInterest && (
              <div className="flex justify-between items-center py-2 border-b border-primary/30 bg-primary/10 rounded px-2">
                <span className="text-primary flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                  Interest
                </span>
                <span className="font-bold text-primary">+{interestGain}h</span>
              </div>
            )}

            {/* Push Bonus Section */}
            {hasPushBonus && (
              <div className="flex justify-between items-center py-2 border-b border-orange-500/30 bg-orange-500/10 rounded px-2">
                <span className="text-orange-400 flex items-center gap-1">
                  <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                  Push Bonus
                </span>
                <span className="font-bold text-orange-400">+{pushBonus}h</span>
              </div>
            )}

            {/* Total Bonus Summary */}
            {(underParBonus > 0 || spaceBonus > 0 || lockBonus > 0 || pushBonus > 0) && (
              <div className="flex justify-between items-center py-2 sm:py-3 bg-success/10 rounded-lg px-2 sm:px-3">
                <span className="font-semibold text-foreground">Total Bonus</span>
                <span className="text-lg sm:text-xl font-bold text-success">+{underParBonus + spaceBonus + lockBonus + pushBonus}h</span>
              </div>
            )}

            <div className="flex justify-between items-center py-2 sm:py-3 bg-primary/10 rounded-lg px-2 sm:px-3">
              <span className="font-semibold text-foreground">Overtime Earned</span>
              <span className="text-xl sm:text-2xl font-bold text-primary">{levelScore}h</span>
            </div>

            <div className="flex justify-between items-center py-2 sm:py-3 bg-accent/10 rounded-lg px-2 sm:px-3">
              <span className="font-semibold text-foreground">Total Overtime</span>
              <span className="text-xl sm:text-2xl font-bold text-accent-foreground">{totalScore}h</span>
            </div>
          </div>

          {/* Continue Button */}
          <button
            className="arcade-button-primary w-full rounded-lg flex items-center justify-center gap-2 text-sm sm:text-base py-2 sm:py-3 hover:scale-[1.02] active:scale-[0.98] transition-transform"
            onClick={onContinue}
          >
            Next Level
            <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>
    </>
  );
}
