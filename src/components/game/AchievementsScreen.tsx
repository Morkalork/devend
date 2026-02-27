import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Check, ChevronLeft } from 'lucide-react';
import { CRTBackground } from './CRTBackground';
import { Achievement } from '@/types/achievement';
import { MetaProgressionStats } from '@/types/metaProgression';

interface AchievementsScreenProps {
  achievements: Achievement[];
  completedIds: string[];
  metaStats: MetaProgressionStats;
  onBack: () => void;
  accentColor?: string;
}

export function AchievementsScreen({
  achievements,
  completedIds,
  metaStats,
  onBack,
  accentColor = '#00ff88',
}: AchievementsScreenProps) {
  // Top 10 incomplete achievements closest to completion, then completed ones
  const displayList = useMemo(() => {
    const incomplete = achievements
      .filter(a => !completedIds.includes(a.id))
      .sort((a, b) => {
        const ratioA = metaStats[a.requirement.stat] / a.requirement.threshold;
        const ratioB = metaStats[b.requirement.stat] / b.requirement.threshold;
        return ratioB - ratioA;
      })
      .slice(0, 10);

    const completed = achievements.filter(a => completedIds.includes(a.id));
    return [...incomplete, ...completed];
  }, [achievements, completedIds, metaStats]);

  const statLabels: Record<string, string> = {
    totalFencesDrawn: 'Fences drawn',
    highestLevelReached: 'Highest level',
    totalLevelsCompletedWithoutLoss: 'Flawless levels',
    totalLivesLost: 'Lives lost',
  };

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div
        className="fixed inset-0 z-50 flex flex-col"
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
            Back
          </motion.button>
          <div className="flex items-center gap-2 ml-2">
            <Trophy className="w-5 h-5" style={{ color: accentColor }} />
            <span
              className="text-lg font-black tracking-widest uppercase"
              style={{ fontFamily: 'Orbitron, sans-serif', color: accentColor }}
            >
              Achievements
            </span>
          </div>
          <div className="ml-auto text-xs" style={{ color: `${accentColor}99` }}>
            {completedIds.length}/{achievements.length} unlocked
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
              <span style={{ color: `${accentColor}88` }}>{label}:</span>
              <span className="font-bold" style={{ color: accentColor }}>
                {metaStats[key as keyof MetaProgressionStats]}
              </span>
            </div>
          ))}
        </div>

        {/* Achievement List */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {displayList.length === 0 ? (
            <div
              className="text-center mt-16 text-sm"
              style={{ color: `${accentColor}66`, fontFamily: "'JetBrains Mono', monospace" }}
            >
              No achievements loaded.
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-xl mx-auto">
              {displayList.map((achievement, index) => {
                const isCompleted = completedIds.includes(achievement.id);
                const current = metaStats[achievement.requirement.stat];
                const target = achievement.requirement.threshold;
                const ratio = Math.min(1, current / target);
                const pct = Math.round(ratio * 100);

                return (
                  <motion.div
                    key={achievement.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className="rounded-lg p-4"
                    style={{
                      backgroundColor: isCompleted ? `${accentColor}12` : 'rgba(10,15,10,0.9)',
                      border: `1px solid ${isCompleted ? accentColor : `${accentColor}33`}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Name + completed badge */}
                        <div className="flex items-center gap-2 mb-0.5">
                          {isCompleted && (
                            <Check
                              className="w-4 h-4 flex-shrink-0"
                              style={{ color: accentColor }}
                            />
                          )}
                          <span
                            className="font-bold text-sm"
                            style={{
                              fontFamily: 'Orbitron, sans-serif',
                              color: isCompleted ? accentColor : 'hsl(var(--foreground))',
                            }}
                          >
                            {achievement.name}
                          </span>
                        </div>

                        {/* Description */}
                        <p
                          className="text-xs leading-relaxed mb-2"
                          style={{
                            color: isCompleted ? `${accentColor}cc` : 'hsl(var(--muted-foreground))',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {achievement.description}
                        </p>

                        {/* Progress bar */}
                        {!isCompleted && (
                          <div className="mb-2">
                            <div
                              className="h-1.5 rounded-full overflow-hidden"
                              style={{ backgroundColor: `${accentColor}22` }}
                            >
                              <motion.div
                                className="h-full rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut', delay: index * 0.04 + 0.1 }}
                                style={{ backgroundColor: accentColor }}
                              />
                            </div>
                            <div
                              className="text-[10px] mt-0.5"
                              style={{ color: `${accentColor}88`, fontFamily: "'JetBrains Mono', monospace" }}
                            >
                              {current} / {target} {statLabels[achievement.requirement.stat]} ({pct}%)
                            </div>
                          </div>
                        )}

                        {/* Bonus */}
                        <div
                          className="text-[10px] font-semibold"
                          style={{
                            color: isCompleted ? accentColor : `${accentColor}77`,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          Bonus: {achievement.bonus.description}
                        </div>
                      </div>

                      {/* Progress % (right side, only if incomplete) */}
                      {!isCompleted && (
                        <div
                          className="flex-shrink-0 text-right tabular-nums"
                          style={{ color: `${accentColor}99`, fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          <div className="text-lg font-bold leading-none">{pct}%</div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
