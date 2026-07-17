/**
 * HallOfFameScreen — "Performance Review", the records viewer (HIGHSCORES.md
 * Phase B). Purely presentational: the all-time Top 10 run ladder, the six
 * archetype bests, deepest Ascension, and per-map records. All data lives in
 * useHallOfFame / useMetaProgression and arrives as props.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Medal, ArrowLeft, ArrowUpCircle, Award, CalendarDays, Flame, Map as MapIcon } from 'lucide-react';
import { RunLedgerEntry } from '@/types/hallOfFame';
import { MetaProgressionStats } from '@/types/metaProgression';
import { UpgradeTag } from '@/types/upgrade';
import { TAG_ORDER } from '@/lib/buildRecap';
import { CRTBackground } from './CRTBackground';
import { TagChip } from './TagChip';

interface HallOfFameScreenProps {
  topRuns: RunLedgerEntry[];
  /** Employee of the Month: best run per "YYYY-MM" (HIGHSCORES.md Phase C). */
  monthlyBests?: Record<string, RunLedgerEntry>;
  /** Daily Stand-up: best run per "YYYY-MM-DD" + attendance streak (Phase D). */
  dailyBests?: Record<string, RunLedgerEntry>;
  dailyStreak?: { count: number; lastKey: string };
  archetypeBests: Record<string, number>;
  mapHighscores: Record<string, number>;
  metaStats: MetaProgressionStats;
  onBack: () => void;
  accentColor?: string;
}

/** Rank medal colors: gold, silver, bronze, then muted. */
const RANK_COLORS = ['#ffd54a', '#c0c8d4', '#d0925a'];

export function HallOfFameScreen({
  topRuns,
  monthlyBests = {},
  dailyBests = {},
  dailyStreak = { count: 0, lastKey: '' },
  archetypeBests,
  mapHighscores,
  metaStats,
  onBack,
  accentColor = '#00ff88',
}: HallOfFameScreenProps) {
  const { t, i18n } = useTranslation();
  const tagLabel = (tag: UpgradeTag) => t(`upgradeShop.tags.${tag}`);

  const buildName = (run: RunLedgerEntry) =>
    run.primaryTag
      ? run.secondaryTag
        ? t('buildRecap.comboName', { a: tagLabel(run.primaryTag), b: tagLabel(run.secondaryTag) })
        : tagLabel(run.primaryTag)
      : t('buildRecap.generalist');

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' });

  // Map records in natural level order (level-2 before level-10).
  const mapRecords = Object.entries(mapHighscores)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  // Employee-of-the-Month plaques, newest month first ("YYYY-MM" keys sort
  // lexicographically). The month label is localized from the key.
  const plaques = Object.entries(monthlyBests).sort(([a], [b]) => b.localeCompare(a));
  const monthLabel = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' });
  };

  // Daily Stand-up: the most recent banked days, newest first.
  const recentDailies = Object.entries(dailyBests).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);
  const dayLabel = (key: string) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center bg-background/90 p-4 sm:p-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex flex-col items-center gap-6 w-full max-w-2xl pb-24"
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <Medal className="w-8 h-8" style={{ color: '#ffd54a' }} />
            <h1 className="text-2xl sm:text-4xl font-display font-black tracking-wider text-foreground">
              {t('hallOfFame.title')}
            </h1>
          </div>

          {/* All-time Top 10 */}
          <section className="w-full">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t('hallOfFame.topRuns')}
            </h2>
            {topRuns.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('hallOfFame.emptyLadder')}</p>
            )}
            <div className="flex flex-col gap-2">
              {topRuns.map((run, i) => (
                <motion.div
                  key={`${run.savedAt}-${i}`}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.04 }}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: i === 0 ? '#ffd54a66' : 'hsl(var(--border))',
                    background: i === 0 ? '#ffd54a12' : 'hsl(var(--card) / 0.5)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-8 text-lg font-display font-black tabular-nums shrink-0"
                      style={{ color: RANK_COLORS[i] ?? 'hsl(var(--muted-foreground))' }}
                    >
                      #{i + 1}
                    </span>
                    <span className="text-xl font-display font-bold tabular-nums" style={{ color: i === 0 ? '#ffd54a' : undefined }}>
                      {run.score}h
                    </span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(run.savedAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 pl-11 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {run.primaryTag && <TagChip tag={run.primaryTag} pill sizeClass="text-[9px]" />}
                      {run.secondaryTag && <TagChip tag={run.secondaryTag} pill sizeClass="text-[9px]" />}
                      {buildName(run)}
                    </span>
                    <span>{t('hallOfFame.mapsLabel', { count: run.levelsCompleted })}</span>
                    {run.ascensionDepth > 0 && (
                      <span className="flex items-center gap-0.5" style={{ color: '#ffb347' }}>
                        <ArrowUpCircle className="w-3 h-3" />
                        {t('hallOfFame.depthLabel', { depth: run.ascensionDepth })}
                      </span>
                    )}
                    {run.capstoneName && (
                      <span className="flex items-center gap-0.5">
                        <Award className="w-3 h-3 text-primary" />
                        {run.capstoneName}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* Archetype bests: one slot per build identity; empty slots are
              quiet quests ("no Freeze run yet"). */}
          <section className="w-full">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t('hallOfFame.archetypeBests')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TAG_ORDER.map(tag => {
                const best = archetypeBests[tag];
                return (
                  <div
                    key={tag}
                    className="rounded-lg border border-border bg-card/50 px-3 py-2 flex items-center justify-between gap-2"
                    style={{ opacity: best ? 1 : 0.55 }}
                  >
                    <TagChip tag={tag} pill sizeClass="text-[10px]" />
                    <span className="font-display font-bold tabular-nums text-sm">
                      {best ? `${best}h` : '-'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Daily Stand-up: attendance streak + the last banked days. */}
          {(recentDailies.length > 0 || dailyStreak.count > 0) && (
            <section className="w-full">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" />
                {t('hallOfFame.daily')}
              </h2>
              {dailyStreak.count > 0 && (
                <div className="flex items-center gap-1.5 text-sm mb-2" style={{ color: '#ffb347' }}>
                  <Flame className="w-4 h-4" />
                  <span className="font-bold tabular-nums">{t('hallOfFame.dailyStreak', { count: dailyStreak.count })}</span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                {recentDailies.map(([day, run]) => (
                  <div key={day} className="flex justify-between border-b border-border/50 py-1">
                    <span className="text-muted-foreground text-xs">{dayLabel(day)}</span>
                    <span className="font-bold tabular-nums text-xs">{run.score}h</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Employee of the Month plaques: one crown per calendar month, so
              there is always a fresh, winnable ladder on the 1st. */}
          {plaques.length > 0 && (
            <section className="w-full">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                {t('hallOfFame.employeeOfMonth')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {plaques.map(([month, run], i) => (
                  <div
                    key={month}
                    className="rounded-lg border px-3 py-2 flex items-center gap-3"
                    style={{
                      borderColor: i === 0 ? '#ffb34766' : 'hsl(var(--border))',
                      background: i === 0 ? '#ffb34712' : 'hsl(var(--card) / 0.5)',
                    }}
                  >
                    <Award className="w-5 h-5 shrink-0" style={{ color: '#ffb347' }} />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground capitalize">{monthLabel(month)}</p>
                      <p className="text-sm font-display font-bold tabular-nums">
                        {run.score}h
                        <span className="ml-2 font-sans font-normal text-xs text-muted-foreground">{buildName(run)}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Deepest ascension */}
          {metaStats.deepestAscension > 0 && (
            <section
              className="w-full rounded-xl px-6 py-3 text-center"
              style={{ border: '1px solid #ffb34755', backgroundColor: '#ffb34711' }}
            >
              <p className="text-xs uppercase tracking-wider mb-1 text-muted-foreground">
                {t('hallOfFame.deepestAscension')}
              </p>
              <p className="text-3xl font-display font-bold tabular-nums flex items-center justify-center gap-2" style={{ color: '#ffb347' }}>
                <ArrowUpCircle className="w-6 h-6" />
                {metaStats.deepestAscension}
              </p>
            </section>
          )}

          {/* Lifetime flavor stats: non-competitive garnish (HIGHSCORES.md
              keeps grind totals OUT of the ladders; they live here only). */}
          <section className="w-full">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t('hallOfFame.lifetime')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {([
                ['highestLevel', metaStats.highestLevelReached],
                ['fencesDrawn', metaStats.totalFencesDrawn],
                ['perfectMaps', metaStats.totalLevelsCompletedWithoutLoss],
                ['livesLost', metaStats.totalLivesLost],
              ] as const).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-border bg-card/50 px-2 py-2">
                  <p className="text-lg font-display font-bold tabular-nums">{value}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t(`hallOfFame.stats.${key}`)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Per-map records */}
          {mapRecords.length > 0 && (
            <section className="w-full">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <MapIcon className="w-3.5 h-3.5" />
                {t('hallOfFame.mapRecords')}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                {mapRecords.map(([mapId, score]) => (
                  <div key={mapId} className="flex justify-between border-b border-border/50 py-1">
                    <span className="text-muted-foreground text-xs">{mapId}</span>
                    <span className="font-bold tabular-nums text-xs">{score}h</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Back */}
          <motion.button
            className="arcade-button-secondary arcade-button-sm rounded-lg flex items-center justify-center gap-2 mt-2 min-w-[200px]"
            onClick={onBack}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <ArrowLeft className="w-5 h-5" />
            {t('hallOfFame.back')}
          </motion.button>
        </motion.div>
      </div>
    </>
  );
}
