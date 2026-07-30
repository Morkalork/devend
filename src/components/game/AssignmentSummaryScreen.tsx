/**
 * AssignmentSummaryScreen — the "Assignment Complete" recap (issue #63).
 *
 * Shown at every assignment boundary (each 5-map block) AND at run end for the
 * final block, BEFORE the next draft / result screen. It closes the loop that
 * #60 opened: you took on a mission, and here is how it resolved and what you
 * earned, on its own screen instead of a small card the player might miss.
 *
 * Pure presentation: mission progress is read from evaluateAssignment over the
 * block's per-map results (the same engine the live HUD uses); the reward label
 * is whatever the session already granted. Shows even on a miss (closure). A
 * tier-draft reward is surfaced here first, then the 1-of-3 pick follows.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Ticket, CheckCircle2, Circle, Sparkles, Play, Target } from 'lucide-react';
import type { AssignmentConfig, AssignmentMapResult } from '@/types/assignment';
import { evaluateAssignment } from '@/lib/assignments';
import { contentText } from '@/i18n/content';
import { CRTBackground } from './CRTBackground';

interface AssignmentSummaryScreenProps {
  assignment: AssignmentConfig;
  results: AssignmentMapResult[];
  blockStats: { locks: number; livesLost: number };
  /** The reached tier's reward label, or null when the mission was missed. */
  rewardLabel: string | null;
  onContinue: () => void;
  accentColor?: string;
}

export function AssignmentSummaryScreen({
  assignment,
  results,
  blockStats,
  rewardLabel,
  onContinue,
  accentColor = '#ffb347',
}: AssignmentSummaryScreenProps) {
  const { t } = useTranslation();
  const progress = evaluateAssignment(assignment, results);

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center bg-background/90 p-4 sm:p-6 relative z-10 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 flex flex-col items-center gap-5 w-full max-w-xl py-6"
        >
          {/* Header */}
          <div className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center"
              style={{
                border: `2px solid ${accentColor}`,
                backgroundColor: `${accentColor}22`,
                boxShadow: `0 0 40px ${accentColor}55`,
              }}
            >
              <Ticket className="w-9 h-9" style={{ color: accentColor }} />
            </motion.div>
            <h1
              className="text-3xl sm:text-4xl font-display font-black tracking-wider uppercase"
              style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}88` }}
            >
              {t('assignmentSummary.title')}
            </h1>
            <p className="mt-2 text-sm font-display font-bold" style={{ color: '#ffe0b3' }}>
              {contentText.doorName(t, assignment)}
            </p>
          </div>

          {/* Mission recap + tier ladder */}
          <div
            className="w-full rounded-lg p-4"
            style={{ border: `1px solid ${accentColor}55`, backgroundColor: `${accentColor}0f` }}
          >
            <div className="flex items-start gap-2 mb-3">
              <Target className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
              <p className="text-sm leading-relaxed" style={{ color: '#ffe8cc' }}>
                {contentText.assignmentMission(t, assignment)}
              </p>
            </div>
            {/* How far you got: current metric over the block. */}
            <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: '#b58a5a' }}>
              {t('assignmentSummary.progress', { current: progress.current, target: progress.target })}
            </div>
            <div className="flex flex-col gap-1.5">
              {progress.tiers.map((tier, i) => (
                <div
                  key={tier.threshold}
                  className="flex items-center gap-2 text-xs"
                  style={{ opacity: tier.reached ? 1 : 0.45 }}
                >
                  {tier.reached ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                  ) : (
                    <Circle className="w-4 h-4 flex-shrink-0" style={{ color: '#6b5a44' }} />
                  )}
                  <span className="tabular-nums font-bold" style={{ color: tier.reached ? accentColor : '#8a7458' }}>
                    {tier.threshold}
                  </span>
                  <span className="opacity-70" style={{ color: '#c8ffd8' }}>{t('doorDraft.tierArrow')}</span>
                  <span style={{ color: '#c8ffd8' }}>{tier.label}</span>
                  {i === progress.highestReachedIndex && (
                    <span className="ml-auto text-[10px] uppercase tracking-wider font-bold" style={{ color: accentColor }}>
                      {t('assignmentSummary.reachedBadge')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Block stats: only what's relevant to the mission (locks landed) and
              the cost paid (lives lost). Overtime + map count were noise (#63). */}
          <div className="w-full flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm">
            {([
              ['contractLocks', String(blockStats.locks)],
              ['contractLivesLost', String(blockStats.livesLost)],
            ] as const).map(([key, value]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: '#b58a5a' }}>
                  {t(`doorDraft.${key}`)}
                </span>
                <span className="font-display font-bold tabular-nums text-foreground">{value}</span>
              </span>
            ))}
          </div>

          {/* Reward earned, or a "missed" note (closure either way). */}
          {rewardLabel ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="w-full rounded-lg p-4 flex flex-col items-center gap-1"
              style={{ border: '1px solid #ffd54a66', backgroundColor: '#ffd54a12' }}
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: '#ffd54a' }}>
                <Sparkles className="w-3.5 h-3.5" />
                {t('assignmentSummary.rewardEarnedLabel')}
              </div>
              <div className="text-xl font-display font-black" style={{ color: '#ffd54a', textShadow: '0 0 20px #ffd54a55' }}>
                {rewardLabel}
              </div>
            </motion.div>
          ) : (
            <div className="w-full text-center text-sm" style={{ color: '#b58a5a', opacity: 0.9 }}>
              {t('assignmentSummary.missed')}
            </div>
          )}

          {/* Continue */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
            onClick={onContinue}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Play className="w-5 h-5" />
            {t('assignmentSummary.continueButton')}
          </motion.button>
        </motion.div>
      </div>
    </>
  );
}
