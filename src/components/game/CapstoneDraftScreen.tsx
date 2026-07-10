/**
 * CapstoneDraftScreen — the once-per-run perk draft ("Promotion").
 *
 * Offered at the first shop exit at/past the trigger level (capstones.yml).
 * The pick is mandatory (it's a pure gift) and permanent for the rest of the
 * run; the two passed-over capstones are gone for good, which is what makes
 * the choice a run-defining moment. Mirrors the door/loadout card UI.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Award, Play, Sparkles, X } from 'lucide-react';
import { CapstoneConfig } from '@/types/capstone';
import { CRTBackground } from './CRTBackground';
import { DraftCard } from './DraftCard';
import { TagChip } from './TagChip';
import { contentText } from '@/i18n/content';

interface CapstoneDraftScreenProps {
  offers: CapstoneConfig[];
  onSelect: (capstone: CapstoneConfig) => void;
  accentColor?: string;
}

export function CapstoneDraftScreen({
  offers,
  onSelect,
  accentColor = '#00ff88',
}: CapstoneDraftScreenProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Capstone whose press-and-hold detail overlay is open.
  const [detailId, setDetailId] = useState<string | null>(null);

  const confirm = () => {
    const pick = offers.find(c => c.id === selectedId);
    if (pick) onSelect(pick);
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
              <Award className="w-9 h-9" style={{ color: accentColor }} />
            </motion.div>
            <h1
              className="text-3xl sm:text-4xl font-display font-black tracking-wider uppercase"
              style={{ color: accentColor, textShadow: `0 0 30px ${accentColor}88` }}
            >
              {t('capstoneDraft.title')}
            </h1>
            <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {t('capstoneDraft.subtitle')}
            </p>
            <p className="mt-1 text-xs" style={{ color: '#4a7a5a' }}>
              {t('capstoneDraft.exclusiveHint')}
            </p>
          </div>

          {/* Capstone cards */}
          <div
            className={`grid grid-cols-1 gap-3 w-full ${
              offers.length === 2 ? 'sm:grid-cols-2 sm:max-w-xl sm:mx-auto' : 'sm:grid-cols-3'
            }`}
          >
            {offers.map((cap, i) => (
              <DraftCard
                key={cap.id}
                index={i}
                accentColor={accentColor}
                selected={selectedId === cap.id}
                onClick={() => setSelectedId(prev => (prev === cap.id ? null : cap.id))}
                onLongPress={() => setDetailId(cap.id)}
                name={contentText.capstoneName(t, cap)}
                headerExtra={cap.tag ? <TagChip tag={cap.tag} /> : undefined}
              >
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>
                    {contentText.capstoneDesc(t, cap)}
                  </p>
                </div>
              </DraftCard>
            ))}
          </div>

          {/* Press-and-hold discovery hint */}
          <p className="text-[11px] text-center" style={{ color: '#4a7a5a' }}>
            {t('capstoneDraft.holdHint')}
          </p>

          {/* Confirm — no skip: a capstone is a pure gift, but an exclusive one */}
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
            {selectedId ? t('capstoneDraft.confirmButton') : t('capstoneDraft.pickHint')}
          </motion.button>
        </motion.div>
      </div>

      {/* Press-and-hold detail overlay: the fuller briefing for one capstone.
          Tapping the backdrop or the X closes it. */}
      <AnimatePresence>
        {detailId && (() => {
          const cap = offers.find(c => c.id === detailId);
          if (!cap) return null;
          const clarify = contentText.capstoneClarify(t, cap);

          return (
            <motion.div
              key="capstone-detail"
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
                  aria-label={t('capstoneDraft.closeDetail')}
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Header */}
                <div className="flex items-center gap-2 mb-3 pr-6">
                  <Award className="w-6 h-6 shrink-0" style={{ color: accentColor }} />
                  <div className="text-base font-display font-bold flex-1" style={{ color: accentColor }}>
                    {contentText.capstoneName(t, cap)}
                  </div>
                  {cap.tag && <TagChip tag={cap.tag} />}
                </div>

                {/* Effect recap */}
                <div className="flex items-start gap-2 mb-3">
                  <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                  <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>{contentText.capstoneDesc(t, cap)}</p>
                </div>

                {/* Clarification */}
                {clarify && (
                  <p className="text-sm leading-relaxed mb-3" style={{ color: '#c8ffd8', opacity: 0.9 }}>{clarify}</p>
                )}

                {/* Scope note */}
                <p
                  className="text-[11px] leading-relaxed pt-2.5"
                  style={{ color: '#4a7a5a', borderTop: `1px solid ${accentColor}22` }}
                >
                  {t('capstoneDraft.scopeNote')}
                </p>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </>
  );
}
