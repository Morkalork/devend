/**
 * RunDraftScreen — the run-start loadout draft ("Sprint Planning").
 *
 * Shown once at the start of every fresh run. The player either picks one of
 * the randomly offered curse + blessing loadouts (from public/loadouts.yml,
 * filtered to the unlocked set by the caller) to shape the run from level 1, or
 * skips and plays vanilla. Mirrors AscensionDraftScreen's card UI; the chosen
 * loadout rides the same modifier pipeline (draftedLoadoutIds) at depth 0.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ClipboardList, Play, SkipForward, Skull, Sparkles } from 'lucide-react';
import { LoadoutConfig } from '@/types/loadout';
import { drawOffers } from '@/lib/loadoutDraft';
import { getRunRng } from '@/lib/runRng';
import { CRTBackground } from './CRTBackground';
import { contentText } from '@/i18n/content';

interface RunDraftScreenProps {
  /** Already filtered to the player's unlocked loadouts by the caller. */
  loadouts: LoadoutConfig[];
  draftedLoadoutIds: string[];
  /** Called with the chosen loadout id, or null when the player skips. */
  onConfirm: (loadoutId: string | null) => void;
  accentColor?: string;
}

export function RunDraftScreen({
  loadouts,
  draftedLoadoutIds,
  onConfirm,
  accentColor = '#00ff88',
}: RunDraftScreenProps) {
  const { t } = useTranslation();
  // Drawn once per mount so re-renders don't reshuffle the offer. Seeded runs
  // (Daily Stand-up) get the same offers via the run-rng context.
  const [offers] = useState(() => drawOffers(loadouts, draftedLoadoutIds, 3, getRunRng('runDraft')));
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
              <ClipboardList className="w-9 h-9" style={{ color: accentColor }} />
            </motion.div>
            <h1
              className="text-3xl sm:text-4xl font-display font-black tracking-wider uppercase"
              style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}88` }}
            >
              {t('runDraft.title')}
            </h1>
            <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {t('runDraft.subtitle')}
            </p>
            <p className="mt-1 text-xs" style={{ color: '#4a7a5a' }}>
              {t('runDraft.pickHint')}
            </p>
          </div>

          {/* Loadout cards. With only two unlocked loadouts the draw returns two
              cards; center them instead of leaving a gap in a three-wide grid. */}
          <div
            className={`grid grid-cols-1 gap-3 w-full ${
              offers.length === 2 ? 'sm:grid-cols-2 sm:max-w-xl sm:mx-auto' : 'sm:grid-cols-3'
            }`}
          >
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
                {t('runDraft.noLoadouts')}
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
              onClick={() => selectedId && onConfirm(selectedId)}
              whileHover={selectedId ? { scale: 1.02 } : undefined}
              whileTap={selectedId ? { scale: 0.98 } : undefined}
            >
              <Play className="w-5 h-5" />
              {selectedId ? t('runDraft.startButton') : t('runDraft.pickToStart')}
            </motion.button>
            <motion.button
              className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
              onClick={() => onConfirm(null)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <SkipForward className="w-5 h-5" />
              {t('runDraft.skipButton')}
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
