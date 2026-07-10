import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Trophy, Zap, ChevronLeft, Check } from 'lucide-react';
import { CRTBackground } from './CRTBackground';
import { Achievement, ACHIEVEMENT_STAT_LABELS } from '@/types/achievement';
import { MetaProgressionStats } from '@/types/metaProgression';
import { contentText } from '@/i18n/content';

interface AchievementsScreenProps {
  achievements: Achievement[];
  completedIds: string[];
  activatedIds: string[];
  metaStats: MetaProgressionStats;
  onActivate: (id: string) => void;
  onBack: () => void;
  accentColor?: string;
}

export function AchievementsScreen({
  achievements,
  completedIds,
  activatedIds,
  metaStats,
  onActivate,
  onBack,
  accentColor = '#00ff88',
}: AchievementsScreenProps) {
  const { t } = useTranslation();
  const { available, active, remaining } = useMemo(() => {
    const available = achievements.filter(
      a => completedIds.includes(a.id) && !activatedIds.includes(a.id)
    );
    const active = achievements.filter(a => activatedIds.includes(a.id));
    const remaining = achievements
      .filter(a => !completedIds.includes(a.id))
      .sort((a, b) => {
        const ra = metaStats[a.requirement.stat] / a.requirement.threshold;
        const rb = metaStats[b.requirement.stat] / b.requirement.threshold;
        return rb - ra;
      });
    return { available, active, remaining };
  }, [achievements, completedIds, activatedIds, metaStats]);

  const statLabels: Record<string, string> = ACHIEVEMENT_STAT_LABELS;

  function SectionHeader({ label, count }: { label: string; count: number }) {
    return (
      <div
        className="flex items-center gap-2 px-1 mb-2 mt-1"
        style={{ fontFamily: 'Morkalork Display, sans-serif' }}
      >
        <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: `${accentColor}88` }}>
          {label}
        </span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${accentColor}18`, color: `${accentColor}99` }}
        >
          {count}
        </span>
        <div className="flex-1 h-px" style={{ backgroundColor: `${accentColor}22` }} />
      </div>
    );
  }

  function AvailableCard({ achievement, index }: { achievement: Achievement; index: number }) {
    return (
      <motion.div
        key={achievement.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.05 }}
        className="rounded-lg p-4"
        style={{
          backgroundColor: 'rgba(10,15,10,0.9)',
          border: `1px solid #f59e0b88`,
          boxShadow: `0 0 12px #f59e0b22`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span
              className="font-bold text-sm"
              style={{ fontFamily: 'Morkalork Display, sans-serif', color: '#f59e0b' }}
            >
              {contentText.achName(t, achievement)}
            </span>
            <p
              className="text-xs leading-relaxed mt-0.5 mb-2"
              style={{ color: 'hsl(var(--muted-foreground))', fontFamily: "'JetBrains Mono', monospace" }}
            >
              {contentText.achDesc(t, achievement)}
            </p>
            <div
              className="text-[10px] font-semibold"
              style={{ color: '#f59e0b99', fontFamily: "'JetBrains Mono', monospace" }}
            >
              {t('achievements.bonusLabel')} {contentText.achBonus(t, achievement)}
            </div>
          </div>

          {/* Pulsing Activate button */}
          <motion.button
            onClick={() => onActivate(achievement.id)}
            animate={{ boxShadow: ['0 0 8px #f59e0b66', '0 0 20px #f59e0bcc', '0 0 8px #f59e0b66'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            whileTap={{ scale: 0.93 }}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold tracking-wider uppercase"
            style={{
              fontFamily: 'Morkalork Display, sans-serif',
              backgroundColor: '#f59e0b22',
              border: '1px solid #f59e0b',
              color: '#f59e0b',
            }}
          >
            <Zap className="w-3.5 h-3.5" />
            {t('achievements.activate')}
          </motion.button>
        </div>
      </motion.div>
    );
  }

  function ActiveCard({ achievement, index }: { achievement: Achievement; index: number }) {
    return (
      <motion.div
        key={achievement.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.04 }}
        className="rounded-lg p-4"
        style={{
          backgroundColor: `${accentColor}0d`,
          border: `1px solid ${accentColor}`,
        }}
      >
        <div className="flex items-start gap-3">
          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
          <div className="flex-1 min-w-0">
            <span
              className="font-bold text-sm"
              style={{ fontFamily: 'Morkalork Display, sans-serif', color: accentColor }}
            >
              {contentText.achName(t, achievement)}
            </span>
            <p
              className="text-xs leading-relaxed mt-0.5 mb-1"
              style={{ color: `${accentColor}cc`, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {contentText.achDesc(t, achievement)}
            </p>
            <div
              className="text-[10px] font-semibold"
              style={{ color: accentColor, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {t('achievements.bonusLabel')} {contentText.achBonus(t, achievement)}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  function RemainingCard({ achievement, index }: { achievement: Achievement; index: number }) {
    const current = metaStats[achievement.requirement.stat];
    const target = achievement.requirement.threshold;
    const ratio = Math.min(1, current / target);
    const pct = Math.round(ratio * 100);

    return (
      <motion.div
        key={achievement.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.03 }}
        className="rounded-lg p-4"
        style={{
          backgroundColor: 'rgba(10,15,10,0.9)',
          border: `1px solid ${accentColor}33`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span
              className="font-bold text-sm"
              style={{ fontFamily: 'Morkalork Display, sans-serif', color: 'hsl(var(--foreground))' }}
            >
              {contentText.achName(t, achievement)}
            </span>
            <p
              className="text-xs leading-relaxed mt-0.5 mb-2"
              style={{ color: 'hsl(var(--muted-foreground))', fontFamily: "'JetBrains Mono', monospace" }}
            >
              {contentText.achDesc(t, achievement)}
            </p>
            <div
              className="h-1.5 rounded-full overflow-hidden mb-1"
              style={{ backgroundColor: `${accentColor}22` }}
            >
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: index * 0.03 + 0.1 }}
                style={{ backgroundColor: accentColor }}
              />
            </div>
            <div
              className="text-[10px]"
              style={{ color: `${accentColor}88`, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {current} / {target} {t(`achievements.stat.${achievement.requirement.stat}`, { defaultValue: statLabels[achievement.requirement.stat] })}
            </div>
            <div
              className="text-[10px] font-semibold mt-1"
              style={{ color: `${accentColor}77`, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {t('achievements.bonusLabel')} {contentText.achBonus(t, achievement)}
            </div>
          </div>
          <div
            className="flex-shrink-0 text-right tabular-nums"
            style={{ color: `${accentColor}99`, fontFamily: "'JetBrains Mono', monospace" }}
          >
            <div className="text-lg font-bold leading-none">{pct}%</div>
          </div>
        </div>
      </motion.div>
    );
  }

  const isEmpty = achievements.length === 0;

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div
        className="absolute inset-0 z-50 flex flex-col"
        style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 py-3"
          style={{
            backgroundColor: 'rgba(0, 10, 5, 0.95)',
            borderBottom: `1px solid ${accentColor}44`,
          }}
        >
          <motion.button
            onClick={onBack}
            whileTap={{ scale: 0.92 }}
            className="flex items-center gap-1 text-sm font-semibold"
            style={{ color: accentColor }}
          >
            <ChevronLeft className="w-5 h-5" />
            {t('achievements.back')}
          </motion.button>
          <div className="flex items-center gap-2 ml-2">
            <Trophy className="w-5 h-5" style={{ color: accentColor }} />
            <span
              className="text-lg font-black tracking-widest uppercase"
              style={{ fontFamily: 'Morkalork Display, sans-serif', color: accentColor }}
            >
              {t('achievements.title')}
            </span>
          </div>
          <div className="ml-auto text-xs" style={{ color: `${accentColor}99`, fontFamily: "'JetBrains Mono', monospace" }}>
            {t('achievements.activeUnlocked', { active: activatedIds.length, unlocked: completedIds.length })}
          </div>
        </div>

        {/* Current Stats */}
        <div
          className="flex-shrink-0 flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 text-xs"
          style={{
            backgroundColor: 'rgba(0, 8, 4, 0.9)',
            borderBottom: `1px solid ${accentColor}22`,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {Object.entries(statLabels).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1">
              <span style={{ color: `${accentColor}88` }}>{t(`achievements.stat.${key}`, { defaultValue: label })}:</span>
              <span className="font-bold" style={{ color: accentColor }}>
                {metaStats[key as keyof MetaProgressionStats]}
              </span>
            </div>
          ))}
        </div>

        {/* Achievement List */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isEmpty ? (
            <div
              className="text-center mt-16 text-sm"
              style={{ color: `${accentColor}66`, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {t('achievements.noneLoaded')}
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-xl mx-auto">

              {/* Available to activate */}
              {available.length > 0 && (
                <>
                  <SectionHeader label={t('achievements.sectionAvailable')} count={available.length} />
                  {available.map((a, i) => <AvailableCard key={a.id} achievement={a} index={i} />)}
                </>
              )}

              {/* Active */}
              {active.length > 0 && (
                <>
                  <SectionHeader label={t('achievements.sectionActive')} count={active.length} />
                  {active.map((a, i) => <ActiveCard key={a.id} achievement={a} index={i} />)}
                </>
              )}

              {/* In progress */}
              {remaining.length > 0 && (
                <>
                  <SectionHeader label={t('achievements.sectionInProgress')} count={remaining.length} />
                  {remaining.map((a, i) => <RemainingCard key={a.id} achievement={a} index={i} />)}
                </>
              )}

            </div>
          )}
        </div>
      </div>
    </>
  );
}
