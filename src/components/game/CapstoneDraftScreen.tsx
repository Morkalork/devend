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
import { motion } from 'framer-motion';
import { Award, Play, Sparkles } from 'lucide-react';
import { CapstoneConfig } from '@/types/capstone';
import { TAG_COLORS } from '@/types/upgrade';
import { CRTBackground } from './CRTBackground';
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
            {offers.map((cap, i) => {
              const selected = selectedId === cap.id;
              const tc = cap.tag ? TAG_COLORS[cap.tag] : null;
              return (
                <motion.button
                  key={cap.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedId(prev => (prev === cap.id ? null : cap.id))}
                  className="text-left rounded-lg p-4 transition-colors"
                  style={{
                    backgroundColor: selected ? `${accentColor}1a` : 'rgba(255,255,255,0.04)',
                    border: `2px solid ${selected ? accentColor : `${accentColor}44`}`,
                    boxShadow: selected ? `0 0 24px ${accentColor}66` : 'none',
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <p
                      className="font-display font-bold text-base flex-1"
                      style={{ color: accentColor, textShadow: selected ? `0 0 12px ${accentColor}88` : 'none' }}
                    >
                      {contentText.capstoneName(t, cap)}
                    </p>
                    {tc && cap.tag && (
                      <span className={`px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider ${tc.bg} ${tc.text}`}>
                        {t(`upgradeShop.tags.${cap.tag}`)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>
                      {contentText.capstoneDesc(t, cap)}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </div>

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
    </>
  );
}
