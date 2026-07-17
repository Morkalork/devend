/**
 * AscensionDraftScreen — shown after beating the final level.
 *
 * The player either retires (banks the run, sees the result screen) or
 * ascends: drafts one of three randomly offered loadouts (curse + blessing
 * bundles from public/loadouts.yml) and loops back to level 1 with every
 * drafted loadout still active.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowUpCircle, Flag, Skull, Sparkles } from 'lucide-react';
import { LoadoutConfig } from '@/types/loadout';
import { drawOffers } from '@/lib/loadoutDraft';
import { getRunRng } from '@/lib/runRng';
import { CRTBackground } from './CRTBackground';
import { contentText } from '@/i18n/content';

interface AscensionDraftScreenProps {
  loadouts: LoadoutConfig[];
  draftedLoadoutIds: string[];
  /** Depth completed so far; ascending enters depth + 1. */
  ascensionDepth: number;
  totalScore: number;
  onAscend: (loadoutId: string) => void;
  onRetire: () => void;
  accentColor?: string;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
}

export function AscensionDraftScreen({
  loadouts,
  draftedLoadoutIds,
  ascensionDepth,
  totalScore,
  onAscend,
  onRetire,
  accentColor = '#00ff88',
  showTutorial = false,
  onTutorialDismiss,
}: AscensionDraftScreenProps) {
  const { t } = useTranslation();
  // Drawn once per mount so re-renders don't reshuffle the offer. Seeded runs
  // key the roll by depth so each ascension draws fresh but deterministically.
  const [offers] = useState(() => drawOffers(loadouts, draftedLoadoutIds, 3, getRunRng(`ascDraft:${ascensionDepth}`)));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nextDepth = ascensionDepth + 1;

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center bg-background/90 p-4 sm:p-6 relative z-10 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 flex flex-col items-center gap-6 w-full max-w-3xl py-6"
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
              <ArrowUpCircle className="w-9 h-9" style={{ color: accentColor }} />
            </motion.div>
            <h1
              className="text-3xl sm:text-4xl font-display font-black tracking-wider uppercase"
              style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}88` }}
            >
              {t('ascension.allLevelsCleared')}
            </h1>
            <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {ascensionDepth > 0 ? t('ascension.ascensionComplete', { depth: ascensionDepth }) : ''}
              {t('ascension.retireOrAscend', { depth: nextDepth })}
            </p>
            <p className="mt-1 text-xs" style={{ color: '#4a7a5a' }}>
              {t('ascension.ascendedLevelsInfo', { multiplier: nextDepth + 1 })}
              {t('ascension.bankedOvertime', { score: totalScore })}
            </p>
          </div>

          {/* Loadout cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
            {offers.map((loadout, i) => {
              const selected = selectedId === loadout.id;
              return (
                <motion.button
                  key={loadout.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedId(selected ? null : loadout.id)}
                  className="text-left rounded-lg p-4 transition-colors"
                  style={{
                    backgroundColor: selected ? `${accentColor}1a` : 'rgba(255,255,255,0.04)',
                    border: `2px solid ${selected ? accentColor : `${accentColor}44`}`,
                    boxShadow: selected ? `0 0 24px ${accentColor}66` : 'none',
                  }}
                >
                  <p
                    className="font-display font-bold text-base mb-3"
                    style={{ color: accentColor, textShadow: selected ? `0 0 12px ${accentColor}88` : 'none' }}
                  >
                    {contentText.loadoutName(t, loadout)}
                  </p>
                  <div className="flex items-start gap-2 mb-2">
                    <Skull className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#ff6b6b' }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#ff6b6b' }}>{contentText.loadoutCurse(t, loadout)}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>{contentText.loadoutBlessing(t, loadout)}</p>
                  </div>
                </motion.button>
              );
            })}
            {offers.length === 0 && (
              <div
                className="sm:col-span-3 rounded-lg p-4 text-center text-xs"
                style={{ border: `1px solid ${accentColor}44`, color: '#4a7a5a' }}
              >
                {t('ascension.noLoadouts')}
              </div>
            )}
          </div>

          {/* Actions */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="flex flex-col sm:flex-row items-center gap-3"
          >
            <motion.button
              className="arcade-button-primary rounded-lg flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!selectedId}
              onClick={() => selectedId && onAscend(selectedId)}
              whileHover={selectedId ? { scale: 1.02 } : undefined}
              whileTap={selectedId ? { scale: 0.98 } : undefined}
            >
              <ArrowUpCircle className="w-5 h-5" />
              {selectedId ? t('ascension.ascendToDepth', { depth: nextDepth }) : t('ascension.selectLoadout')}
            </motion.button>
            <motion.button
              className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
              onClick={onRetire}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Flag className="w-5 h-5" />
              {t('ascension.retireBankRun')}
            </motion.button>
          </motion.div>
        </motion.div>

        {/* One-time intro overlay */}
        {showTutorial && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md rounded-lg p-6 text-center"
              style={{
                backgroundColor: '#0a0f0a',
                border: `2px solid ${accentColor}`,
                boxShadow: `0 0 40px ${accentColor}44`,
              }}
            >
              <h2
                className="font-display font-black text-xl uppercase tracking-wider mb-3"
                style={{ color: accentColor }}
              >
                {t('ascension.ascensionUnlocked')}
              </h2>
              <p className="text-sm leading-relaxed mb-4" style={{ color: '#c8ffd8' }}>
                {t('ascension.tutorialIntro1')}<b>{t('ascension.tutorialLoadoutWord')}</b>{t('ascension.tutorialIntro2')}
              </p>
              <button className="arcade-button-primary rounded-lg" onClick={onTutorialDismiss}>
                {t('ascension.gotIt')}
              </button>
            </motion.div>
          </div>
        )}
      </div>
    </>
  );
}
