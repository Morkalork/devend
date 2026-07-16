import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Trophy, Skull, Home, Hexagon, ArrowUpCircle, RotateCcw, Backpack, Award, Medal } from 'lucide-react';
import { GameResult } from '@/types/game';
import { RunRecap } from '@/lib/buildRecap';
import { RunRankInfo } from '@/lib/runLedger';
import { UpgradeTag } from '@/types/upgrade';
import { CRTBackground } from './CRTBackground';
import { TagChip } from './TagChip';

interface ResultScreenProps {
  result: GameResult;
  onMainMenu: () => void;
  onPlayAgain?: () => void;
  onRestart?: () => void;
  checkpointLevel?: number;
  accentColor?: string;
  runHoursAwarded?: number;
  runLevelsCompleted?: number;
  /** Names of loadouts that unlocked this run (celebrated below the title). */
  newlyUnlockedLoadouts?: string[];
  /** End-of-run build recap (archetype identity, capstone, personal best). */
  runRecap?: RunRecap | null;
  /**
   * Where this run landed on the all-time ladder (HIGHSCORES.md Phase A),
   * plus the near-miss pace epitaph. null = ineligible or nothing banked.
   */
  runRank?: (RunRankInfo & { aheadThroughMaps: number | null }) | null;
}

export function ResultScreen({
  result,
  onMainMenu,
  onPlayAgain,
  onRestart,
  checkpointLevel,
  accentColor,
  runHoursAwarded = 0,
  runLevelsCompleted = 0,
  newlyUnlockedLoadouts = [],
  runRecap = null,
  runRank = null,
}: ResultScreenProps) {
  const { t } = useTranslation();
  const { isWin, remainingPercent, levelId, levelNumber, completedAllLevels, ascensionDepth, loadoutNames } = result;

  // Build name: "Freeze-Lock" from the archetype lean, or Generalist. The
  // flavour title ("Cryo Engineer") keys off the primary archetype alone.
  const tagLabel = (tag: UpgradeTag) => t(`upgradeShop.tags.${tag}`);
  const buildName = runRecap?.primary
    ? runRecap.secondary
      ? t('buildRecap.comboName', { a: tagLabel(runRecap.primary), b: tagLabel(runRecap.secondary) })
      : tagLabel(runRecap.primary)
    : t('buildRecap.generalist');
  const buildTitle = runRecap?.primary
    ? t(`buildRecap.titles.${runRecap.primary}`)
    : t('buildRecap.generalistTitle');

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center bg-background/90 p-6 relative z-10">
      {/* Background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className={`absolute w-[600px] h-[600px] rounded-full blur-3xl ${
            isWin ? 'bg-success/10' : 'bg-danger/10'
          }`}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1 }}
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center gap-8"
      >
        {/* Icon */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
          className={`w-24 h-24 rounded-full flex items-center justify-center ${
            isWin
              ? 'bg-success/20 border-2 border-success'
              : 'bg-danger/20 border-2 border-danger'
          }`}
          style={{
            boxShadow: isWin
              ? '0 0 60px hsl(var(--success) / 0.4)'
              : '0 0 60px hsl(var(--danger) / 0.4)',
          }}
        >
          {isWin ? (
            <Trophy className="w-12 h-12 text-success" />
          ) : (
            <Skull className="w-12 h-12 text-danger" />
          )}
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={`text-4xl md:text-5xl font-display font-black tracking-wider ${
            isWin ? 'text-success' : 'text-danger'
          }`}
          style={{
            textShadow: isWin
              ? '0 0 30px hsl(var(--success) / 0.5)'
              : '0 0 30px hsl(var(--danger) / 0.5)',
          }}
        >
          {isWin ? t('result.youWin') : t('result.gameOver')}
        </motion.h1>

        {/* Completed all levels message */}
        {completedAllLevels && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="text-2xl font-display text-primary"
          >
            {t('result.completedAllLevels')}
          </motion.div>
        )}

        {/* Ascension summary */}
        {!!ascensionDepth && ascensionDepth > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-center"
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <ArrowUpCircle className="w-6 h-6" style={{ color: '#ffb347' }} />
              <p
                className="text-xl font-display font-bold"
                style={{ color: '#ffb347', textShadow: '0 0 16px #ffb34788' }}
              >
                {t('result.ascensionDepth', { depth: ascensionDepth })}
              </p>
            </div>
            {loadoutNames && loadoutNames.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('result.loadoutsBraved', { loadouts: loadoutNames.join(' · ') })}
              </p>
            )}
          </motion.div>
        )}

        {/* New loadout unlocks */}
        {newlyUnlockedLoadouts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="text-center flex flex-col items-center gap-1"
          >
            <div className="flex items-center justify-center gap-2">
              <Backpack className="w-5 h-5 text-primary" />
              <p className="text-sm font-display font-bold text-primary uppercase tracking-wider">
                {t('result.newLoadoutsUnlocked')}
              </p>
            </div>
            <p className="text-sm text-foreground">{newlyUnlockedLoadouts.join(' · ')}</p>
          </motion.div>
        )}

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center flex flex-col gap-4"
        >
          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-wider mb-1">
              {isWin ? t('result.completedLevel') : t('result.failedAtLevel')}
            </p>
            <p className="text-3xl font-display font-bold text-foreground">
              {levelNumber}
            </p>
            <p className="text-muted-foreground text-xs mt-1">{levelId}</p>
          </div>

          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-wider mb-1">
              {t('result.arenaRemaining')}
            </p>
            <p className="text-5xl font-display font-bold text-foreground">
              {remainingPercent}%
            </p>
          </div>

          {/* Certificate hours earned */}
          {runLevelsCompleted > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.45 }}
              className="mt-4 pt-4 border-t border-border"
            >
              <p className="text-muted-foreground text-sm uppercase tracking-wider mb-1">
                {t('result.levelsCompleted')}
              </p>
              <p className="text-3xl font-display font-bold text-foreground mb-2">
                {runLevelsCompleted}
              </p>
              {runHoursAwarded > 0 && (
                <div className="flex items-center justify-center gap-2">
                  <Hexagon className="w-6 h-6 text-white fill-white/20" />
                  <p className="text-2xl font-display font-bold text-white">
                    {t('result.certificateHours', { count: runHoursAwarded })}
                  </p>
                </div>
              )}
            </motion.div>
          )}

        </motion.div>

        {/* Ladder placement (HIGHSCORES.md): the run's banked overtime and
            where it landed on the all-time Top 10, with the near-miss gap
            printed as the next target. */}
        {runRank && result.totalScore !== undefined && result.totalScore > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="text-center flex flex-col items-center gap-1 pt-4 border-t border-border w-full"
          >
            <p className="text-muted-foreground text-sm uppercase tracking-wider">
              {t('result.bankedOvertime')}
            </p>
            <p className="text-4xl font-display font-bold text-foreground">
              {result.totalScore}h
            </p>
            {runRank.rank === 1 && (
              <div className="flex items-center justify-center gap-1.5 text-sm font-bold" style={{ color: '#ffd54a', textShadow: '0 0 12px #ffd54a66' }}>
                <Medal className="w-4 h-4" />
                <span>{t('result.newBestRun')}</span>
              </div>
            )}
            {runRank.rank !== null && runRank.rank > 1 && (
              <>
                <p className="text-sm font-bold" style={{ color: '#ffd54a' }}>
                  {t('result.rankAllTime', { rank: runRank.rank })}
                </p>
                {runRank.gapToNext !== null && (
                  <p className="text-xs text-muted-foreground">
                    {t('result.gapToNext', { hours: runRank.gapToNext, rank: runRank.rank - 1 })}
                  </p>
                )}
              </>
            )}
            {runRank.rank === null && runRank.gapToTop10 !== null && (
              <p className="text-xs text-muted-foreground">
                {t('result.gapToTop10', { hours: runRank.gapToTop10 })}
              </p>
            )}
            {runRank.aheadThroughMaps !== null && (
              <p className="text-xs text-muted-foreground italic">
                {t('result.paceEpitaph', { count: runRank.aheadThroughMaps })}
              </p>
            )}
          </motion.div>
        )}

        {/* Build recap: what this run WAS. Name the build from its archetype
            lean, credit the capstone, and celebrate a per-archetype best. */}
        {runRecap && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-center flex flex-col items-center gap-2 pt-4 border-t border-border w-full"
          >
            <p className="text-muted-foreground text-sm uppercase tracking-wider">
              {t('buildRecap.heading')}
            </p>
            <p className="text-2xl font-display font-bold text-foreground">
              {t('buildRecap.buildLine', { name: buildName, title: buildTitle })}
            </p>
            {Object.keys(runRecap.tagCounts).length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {Object.entries(runRecap.tagCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tag, count]) =>
                    count > 0
                      ? <TagChip key={tag} tag={tag as UpgradeTag} pill sizeClass="text-[10px]" suffix={String(count)} />
                      : null,
                  )}
              </div>
            )}
            {runRecap.capstoneName && (
              <div className="flex items-center justify-center gap-1.5 text-sm text-foreground">
                <Award className="w-4 h-4 text-primary" />
                <span>{t('buildRecap.capstoneLine', { name: runRecap.capstoneName })}</span>
              </div>
            )}
            {runRecap.primary && runRecap.isArchetypeRecord && (
              <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-yellow-400">
                <Medal className="w-4 h-4" />
                <span>
                  {runRecap.previousBest !== null
                    ? t('buildRecap.newRecord', { archetype: tagLabel(runRecap.primary), hours: runRecap.score, previous: runRecap.previousBest })
                    : t('buildRecap.firstRecord', { archetype: tagLabel(runRecap.primary), hours: runRecap.score })}
                </span>
              </div>
            )}
            {runRecap.primary && !runRecap.isArchetypeRecord && runRecap.previousBest !== null && (
              <p className="text-xs text-muted-foreground">
                {t('buildRecap.bestSoFar', { archetype: tagLabel(runRecap.primary), hours: runRecap.previousBest })}
              </p>
            )}
          </motion.div>
        )}

        {/* Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="mt-4 flex flex-col gap-3 w-full min-w-[200px]"
        >
          {checkpointLevel && checkpointLevel > 1 ? (
            <>
              {onPlayAgain && (
                <motion.button
                  className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
                  onClick={() => onPlayAgain()}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <RotateCcw className="w-5 h-5" />
                  {t('result.continueLevel', { level: checkpointLevel })}
                </motion.button>
              )}
              {onRestart && (
                <motion.button
                  className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
                  onClick={() => onRestart()}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <RotateCcw className="w-5 h-5" />
                  {t('result.restart')}
                </motion.button>
              )}
            </>
          ) : (
            onPlayAgain && (
              <motion.button
                className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
                onClick={() => onPlayAgain()}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <RotateCcw className="w-5 h-5" />
                {t('result.playAgain')}
              </motion.button>
            )
          )}
          <motion.button
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
            onClick={onMainMenu}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Home className="w-5 h-5" />
            {t('result.mainMenu')}
          </motion.button>
        </motion.div>
      </motion.div>
      </div>
    </>
  );
}
