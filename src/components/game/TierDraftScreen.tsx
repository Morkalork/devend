/**
 * TierDraftScreen — the "pick a tier" assignment reward (issue #60).
 *
 * Shown when a completed assignment's reached tier pays a `tierDraft` reward:
 * a free 1-of-3 upgrade of a given tier (the tough-mission payoff). Mirrors the
 * capstone/door card UI; the pick is granted for the rest of the run.
 *
 * The headline is an INSTRUCTION, not a provenance label. It used to read
 * "Assignment Reward" in the largest type on screen with "pick one" beneath it
 * in small dimmed text, and the confirm button starts DISABLED reading "Select
 * an upgrade" - so a player who had not spotted that the cards are tappable saw
 * a title about a reward and a dead button, and asked whether this screen was
 * the reward itself. It also has to match the words on the button that led
 * here ("Pick your upgrade"), or the promise and the payoff are two different
 * things. Where the reward came from is still on the subtitle.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Trophy, Play, X } from 'lucide-react';
import { UpgradeConfig, UpgradeTier } from '@/types/upgrade';
import { CRTBackground } from './CRTBackground';
import { DraftCard } from './DraftCard';
import { getUpgradeIcon } from './upgradeIcons';
import { contentText } from '@/i18n/content';

interface TierDraftScreenProps {
  offers: UpgradeConfig[];
  tier: UpgradeTier;
  onSelect: (upgradeId: string) => void;
  accentColor?: string;
}

export function TierDraftScreen({
  offers,
  tier,
  onSelect,
  accentColor = '#00ff88',
}: TierDraftScreenProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const confirm = () => {
    const pick = offers.find(u => u.id === selectedId);
    if (pick) onSelect(pick.id);
  };

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
              <Trophy className="w-9 h-9" style={{ color: accentColor }} />
            </motion.div>
            <h1
              className="text-3xl sm:text-4xl font-display font-black tracking-wider uppercase"
              style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}88` }}
            >
              {t('tierDraft.title')}
            </h1>
            <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {t('tierDraft.subtitle', { tier: contentText.tier(t, tier) })}
            </p>
          </div>

          {/* Upgrade cards */}
          <div
            className={`grid grid-cols-1 gap-3 w-full ${
              offers.length === 2 ? 'sm:grid-cols-2 sm:max-w-xl sm:mx-auto' : 'sm:grid-cols-3'
            }`}
          >
            {offers.map((u, i) => {
              const Icon = getUpgradeIcon(u, offers);
              return (
                <DraftCard
                  key={u.id}
                  index={i}
                  accentColor={accentColor}
                  selected={selectedId === u.id}
                  onClick={() => setSelectedId(prev => (prev === u.id ? null : u.id))}
                  onLongPress={() => setDetailId(u.id)}
                  name={contentText.upgradeName(t, u)}
                  icon={Icon
                    ? <Icon className="w-10 h-10 shrink-0" strokeWidth={1.5} style={{ color: accentColor }} />
                    : undefined}
                >
                  {/* No second glyph beside the text: the leading icon above is
                      the card's identity, and the Sparkles that used to sit here
                      was decorating a line that now has room to speak for
                      itself. */}
                  <p className="text-lg leading-relaxed" style={{ color: '#c8ffd8' }}>
                    {contentText.upgradeDesc(t, u)}
                  </p>
                </DraftCard>
              );
            })}
          </div>

          <p className="text-[11px] text-center" style={{ color: '#4a7a5a' }}>
            {t('tierDraft.holdHint')}
          </p>

          {/* Confirm — no skip: it's a pure reward, but you must pick one */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!selectedId}
            onClick={confirm}
            whileHover={selectedId ? { scale: 1.02 } : undefined}
            whileTap={selectedId ? { scale: 0.98 } : undefined}
          >
            <Play className="w-5 h-5" />
            {selectedId ? t('tierDraft.confirmButton') : t('tierDraft.pickHint')}
          </motion.button>
        </motion.div>
      </div>

      {/* Press-and-hold detail overlay for one upgrade. */}
      <AnimatePresence>
        {detailId && (() => {
          const u = offers.find(o => o.id === detailId);
          if (!u) return null;
          const Icon = getUpgradeIcon(u, offers);
          return (
            <motion.div
              key="tier-detail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailId(null)}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            >
              <motion.div
                initial={{ scale: 0.92, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.92, y: 8, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm rounded-xl border-2 bg-card p-5 shadow-xl"
                style={{ borderColor: `${accentColor}66` }}
              >
                <button
                  onClick={() => setDetailId(null)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  aria-label={t('tierDraft.closeDetail')}
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2 mb-3 pr-6">
                  {Icon && <Icon className="w-6 h-6 shrink-0" strokeWidth={1.5} style={{ color: accentColor }} />}
                  <div className="text-base font-display font-bold flex-1" style={{ color: accentColor }}>
                    {contentText.upgradeName(t, u)} [{contentText.tier(t, u.tier)}]
                  </div>
                </div>
                <p className="text-base leading-relaxed" style={{ color: '#c8ffd8', opacity: 0.9 }}>
                  {contentText.upgradeDesc(t, u)}
                </p>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </>
  );
}
