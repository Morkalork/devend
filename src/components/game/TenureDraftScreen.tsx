/**
 * TenureDraftScreen — the run-start Tenure pick (issue #75).
 *
 * The checkpoint replacement: getting deep in a run pays out at the START of
 * the next one. Shown BEFORE the loadout draft, because a free lock chain
 * should be allowed to steer which loadout you take.
 *
 * Each card is a whole upgrade chain, already resolved: the player earned the
 * chain, not the fork, so any `choiceGroup` or branch was decided for them and
 * the card shows exactly what lands. Mirrors RunDraftScreen's card UI.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Rocket, Play, ChevronsUp } from 'lucide-react';
import { isContinuation, type TenureOffer } from '@/lib/tenure';
import { CRTBackground } from './CRTBackground';
import { contentText } from '@/i18n/content';

interface TenureDraftScreenProps {
  /** Resolved offers; the caller rolls them so a retry gets a fresh draw. */
  offers: TenureOffer[];
  /** Levels reached in the previous run, shown as the reason for the reward. */
  earnedAtLevel: number;
  /** Upgrades the previous run owned; one offer is guaranteed to continue them. */
  lastRunUpgradeIds?: string[];
  /** Called with the chosen chain head id. */
  onConfirm: (headId: string) => void;
  accentColor?: string;
}

export function TenureDraftScreen({
  offers,
  earnedAtLevel,
  lastRunUpgradeIds = [],
  onConfirm,
  accentColor = '#00ff88',
}: TenureDraftScreenProps) {
  const { t } = useTranslation();
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
              <Rocket className="w-9 h-9" style={{ color: accentColor }} />
            </motion.div>
            <h1
              className="text-3xl sm:text-4xl font-display font-black tracking-wider uppercase"
              style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}88` }}
            >
              {t('tenure.title')}
            </h1>
            <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {t('tenure.subtitle', { level: earnedAtLevel })}
            </p>
            <p className="mt-1 text-xs" style={{ color: '#4a7a5a' }}>
              {t('tenure.pickHint')}
            </p>
          </div>

          {/* Offer cards. A thin pool can return fewer than three; center two
              rather than leaving a hole in a three-wide grid. */}
          <div
            className={`grid grid-cols-1 gap-3 w-full ${
              offers.length === 2 ? 'sm:grid-cols-2 sm:max-w-xl sm:mx-auto' : 'sm:grid-cols-3'
            }`}
          >
            {offers.map((offer, i) => {
              const selected = selectedId === offer.headId;
              return (
                <motion.button
                  key={offer.headId}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedId(selected ? null : offer.headId)}
                  className="text-left rounded-lg p-4 transition-colors"
                  style={{
                    backgroundColor: selected ? `${accentColor}1a` : 'rgba(255,255,255,0.04)',
                    border: `2px solid ${selected ? accentColor : `${accentColor}44`}`,
                    boxShadow: selected ? `0 0 24px ${accentColor}66` : 'none',
                  }}
                >
                  <p
                    className="font-display font-bold text-base mb-1"
                    style={{ color: accentColor, textShadow: selected ? `0 0 12px ${accentColor}88` : 'none' }}
                  >
                    {contentText.upgradeName(t, offer.upgrades[0])}
                  </p>
                  {/* Without this the guaranteed slot is invisible: the card
                      looks like any other draw, so the continuity never lands. */}
                  {isContinuation(offer, lastRunUpgradeIds) && (
                    <p
                      className="text-[10px] uppercase tracking-wide mb-2"
                      style={{ color: accentColor, opacity: 0.75 }}
                    >
                      {t('tenure.continued')}
                    </p>
                  )}
                  <div className="mb-2" />
                  {/* Every tier that lands, so a 30-level reward visibly beats a
                      20-level one rather than looking like the same card. */}
                  {offer.upgrades.map(u => (
                    <div key={u.id} className="flex items-start gap-2 mb-2 last:mb-0">
                      <ChevronsUp className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                      <div>
                        <p className="text-[10px] uppercase tracking-wide" style={{ color: accentColor, opacity: 0.8 }}>
                          {contentText.tier(t, u.tier)}
                        </p>
                        <p className="text-sm leading-relaxed" style={{ color: '#c8ffd8' }}>
                          {contentText.upgradeDesc(t, u)}
                        </p>
                      </div>
                    </div>
                  ))}
                </motion.button>
              );
            })}
          </div>

          {/* Actions. No skip: this is pure upside, so the only choice that
              matters is which chain. */}
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
              {selectedId ? t('tenure.confirmButton') : t('tenure.pickToStart')}
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
