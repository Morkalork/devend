import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Trophy, ArrowRight, Sparkles, TrendingUp, TrendingDown, Target, Lock, Clock, Zap, Medal, Hammer } from 'lucide-react';
import { LevelScoreData } from '@/types/game';
import { Certificate } from '@/types/certificate';
import { contentText } from '@/i18n/content';

interface LevelCompleteOverlayProps {
  scoreData: LevelScoreData;
  totalScore: number;
  onContinue: () => void;
  accentColor?: string;
  /** ms to wait before enabling the Continue button (lets the dissolve animation finish) */
  buttonDelay?: number;
  /** Certs newly unlocked this level — shown before the Continue button */
  newlyUnlockedCerts?: Certificate[];
}

export function LevelCompleteOverlay({ scoreData, totalScore, onContinue, accentColor, buttonDelay = 900, newlyUnlockedCerts }: LevelCompleteOverlayProps) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(false);
  const [buttonReady, setButtonReady] = useState(buttonDelay === 0);
  const [displayLevelScore, setDisplayLevelScore] = useState(0);
  const [displayTotalScore, setDisplayTotalScore] = useState(0);

  useEffect(() => {
    if (buttonDelay <= 0) return;
    const timer = setTimeout(() => setButtonReady(true), buttonDelay);
    return () => clearTimeout(timer);
  }, [buttonDelay]);

  useEffect(() => {
    const DELAY = 380;
    const DURATION = 900;
    const startTime = performance.now() + DELAY;
    let rafId: number;
    const animate = (now: number) => {
      if (now < startTime) { rafId = requestAnimationFrame(animate); return; }
      const progress = Math.min(1, (now - startTime) / DURATION);
      const ease = 1 - (1 - progress) * (1 - progress) * (1 - progress);
      setDisplayLevelScore(Math.round(scoreData.levelScore * ease));
      setDisplayTotalScore(Math.round(totalScore * ease));
      if (progress < 1) rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [scoreData.levelScore, totalScore]);
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
    breakBonus = 0,
  } = scoreData;

  const isOverPar = fencesOverPar > 0;
  const isSpaceDisabled = fencesOverPar >= 3;
  const hasLockBonus = lockBonus > 0;
  const hasBreakBonus = breakBonus > 0;
  const hasInterest = interestGain > 0;
  const hasPushBonus = pushBonus > 0;
  const scaledBase = Math.floor(basePoints * performanceMultiplier);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 bg-background/30 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      />

      {/* Modal container */}
      <motion.div
        className="level-complete-modal fixed z-50 overflow-y-auto"
        style={{
          bottom: '1rem',
          left: '1rem',
          right: '1rem',
          maxHeight: 'calc(100vh - 2rem)',
        }}
        initial={{ opacity: 0, y: 55, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 310, damping: 26, mass: 0.85 }}
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

        <div className="bg-card/60 backdrop-blur-md border border-border rounded-xl p-4 sm:p-6 shadow-2xl">
          {/* Header */}
          <motion.div
            className="flex items-center justify-center gap-2 sm:gap-3 mb-4 sm:mb-6"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.22 }}
          >
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-success/20 flex items-center justify-center">
              <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-success" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-display font-bold text-foreground">{t('levelComplete.title')}</h2>
              <p className="text-muted-foreground text-xs sm:text-sm">{levelId}</p>
            </div>
          </motion.div>

          {/* Push Failed Warning */}
          {pushFailed && (
            <div className="mb-4 p-3 bg-warning/10 border border-warning/30 rounded-lg text-center">
              <p className="text-warning text-sm font-medium">
                {t('levelComplete.pushFailed')}{hasPushBonus ? t('levelComplete.pushFailedBonus', { bonus: pushBonus }) : t('levelComplete.pushFailedNoBonus')}
              </p>
            </div>
          )}

          {/* Stats Grid */}
          <motion.div
            className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 text-sm sm:text-base"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, duration: 0.28 }}
          >
            <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
              <span className="text-muted-foreground">{t('levelComplete.level')}</span>
              <span className="font-bold text-foreground">{levelNumber}</span>
            </div>

            <div className="flex justify-between items-center py-1.5 sm:py-2 border-b border-border">
              <span className="text-muted-foreground">{t('levelComplete.remaining')}</span>
              <span className="font-bold text-foreground">{remainingPercent}%</span>
            </div>

            {/* Fence Efficiency Section */}
            <div className="py-2 border-b border-border">
              <div className="flex justify-between items-center mb-1">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  {t('levelComplete.fencesUsed')}
                </span>
                <span className="font-bold text-foreground">
                  {cutCount} / {expectedCuts}
                </span>
              </div>

              {fencesUnderPar > 0 && (
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-success flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {t('levelComplete.underPar', { count: fencesUnderPar })}
                  </span>
                  <span className="font-bold text-success">+{underParBonus}h</span>
                </div>
              )}

              {fencesOverPar > 0 && (
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-destructive flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    {t('levelComplete.overPar', { count: fencesOverPar })}
                  </span>
                  <span className="text-destructive text-xs">
                    {t('levelComplete.baseMultiplier', { multiplier: performanceMultiplier })}
                    {isSpaceDisabled && t('levelComplete.noSpaceBonus')}
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
                    {t('levelComplete.extraSpaceRemoved')}
                  </span>
                  <span className="font-bold text-foreground">+{(extraPercent * 100).toFixed(0)}%</span>
                </div>

                <div className="flex justify-between items-center text-sm">
                  <span className={isSpaceDisabled ? 'text-destructive' : 'text-primary'}>
                    {t('levelComplete.spaceBonus')}
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
                {t('levelComplete.baseOvertime')}
                {isOverPar && (
                  <span className="text-destructive text-xs">{t('levelComplete.multiplierParen', { multiplier: performanceMultiplier })}</span>
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
                  {t('levelComplete.threadLocks', { count: lockedBallsCount })}
                </span>
                <span className="font-bold text-cyan-400">+{lockBonus}h</span>
              </div>
            )}

            {/* Break Bonus Section (issue #38) */}
            {hasBreakBonus && (
              <div className="flex justify-between items-center py-2 border-b border-amber-500/30 bg-amber-500/10 rounded px-2">
                <span className="text-amber-400 flex items-center gap-1">
                  <Hammer className="w-3 h-3 sm:w-4 sm:h-4" />
                  {t('levelComplete.breakBonus')}
                </span>
                <span className="font-bold text-amber-400">+{breakBonus}h</span>
              </div>
            )}

            {/* Interest Gain */}
            {hasInterest && (
              <div className="flex justify-between items-center py-2 border-b border-primary/30 bg-primary/10 rounded px-2">
                <span className="text-primary flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                  {t('levelComplete.interest')}
                </span>
                <span className="font-bold text-primary">+{interestGain}h</span>
              </div>
            )}

            {/* Push Bonus Section */}
            {hasPushBonus && (
              <div className="flex justify-between items-center py-2 border-b border-orange-500/30 bg-orange-500/10 rounded px-2">
                <span className="text-orange-400 flex items-center gap-1">
                  <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                  {t('levelComplete.pushBonus')}
                </span>
                <span className="font-bold text-orange-400">+{pushBonus}h</span>
              </div>
            )}

            {/* Total Bonus Summary */}
            {(underParBonus > 0 || spaceBonus > 0 || lockBonus > 0 || pushBonus > 0 || breakBonus > 0) && (
              <div className="flex justify-between items-center py-2 sm:py-3 bg-success/10 rounded-lg px-2 sm:px-3">
                <span className="font-semibold text-foreground">{t('levelComplete.totalBonus')}</span>
                <span className="text-lg sm:text-xl font-bold text-success">+{underParBonus + spaceBonus + lockBonus + pushBonus + breakBonus}h</span>
              </div>
            )}

            <div className="flex justify-between items-center py-2 sm:py-3 bg-primary/10 rounded-lg px-2 sm:px-3">
              <span className="font-semibold text-foreground">{t('levelComplete.overtimeEarned')}</span>
              <span className="text-xl sm:text-2xl font-bold text-primary">{displayLevelScore}h</span>
            </div>

            <div className="flex justify-between items-center py-2 sm:py-3 bg-accent/10 rounded-lg px-2 sm:px-3">
              <span className="font-semibold text-foreground">{t('levelComplete.totalOvertime')}</span>
              <span className="text-xl sm:text-2xl font-bold text-accent-foreground">{displayTotalScore}h</span>
            </div>
          </motion.div>

          {/* Newly unlocked certificates */}
          {newlyUnlockedCerts && newlyUnlockedCerts.length > 0 && (
            <motion.div
              className="mb-4 space-y-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.32, duration: 0.22 }}
            >
              {newlyUnlockedCerts.map(cert => (
                <div
                  key={cert.id}
                  className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10"
                >
                  <Medal className="w-4 h-4 text-yellow-400 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider">{t('levelComplete.certificateUnlocked')}</p>
                    <p className="text-sm text-foreground font-semibold">{contentText.certName(t, cert)}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* Continue Button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.22 }}
          >
            <button
              disabled={chosen || !buttonReady}
              className="arcade-button-primary w-full rounded-lg flex items-center justify-center gap-2 text-sm sm:text-base py-2 sm:py-3 hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:pointer-events-none"
              onClick={() => { setChosen(true); onContinue(); }}
            >
              {t('levelComplete.nextLevel')}
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}
