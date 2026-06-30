/**
 * ContinuePrompt — the on-death revive overlay.
 *
 * Rendered over the game screen (from Index.tsx) when the player runs out of
 * lives but still has a Continue banked. Spending one refills lives and retries
 * the current level with score + upgrades intact; declining ends the run.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { RotateCcw, Flag, Heart } from 'lucide-react';

interface ContinuePromptProps {
  continuesRemaining: number;
  onSpend: () => void;
  onDecline: () => void;
  accentColor?: string;
}

export function ContinuePrompt({
  continuesRemaining,
  onSpend,
  onDecline,
  accentColor = '#00ff88',
}: ContinuePromptProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-6"
    >
      <motion.div
        initial={{ scale: 0.9, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        className="flex flex-col items-center gap-5 w-full max-w-sm rounded-xl p-6 text-center"
        style={{
          backgroundColor: '#0a0f0a',
          border: `2px solid ${accentColor}`,
          boxShadow: `0 0 40px ${accentColor}44`,
        }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ border: `2px solid ${accentColor}`, backgroundColor: `${accentColor}22`, boxShadow: `0 0 32px ${accentColor}55` }}
        >
          <Heart className="w-9 h-9" style={{ color: accentColor, fill: accentColor }} />
        </div>

        <div>
          <h2
            className="text-2xl font-display font-black uppercase tracking-wider"
            style={{ color: accentColor, textShadow: `0 0 24px ${accentColor}88` }}
          >
            {t('continue.title')}
          </h2>
          <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.8 }}>
            {t('continue.body', { count: continuesRemaining })}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
          <motion.button
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2 w-full"
            onClick={onSpend}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RotateCcw className="w-5 h-5" />
            {t('continue.spendButton')}
          </motion.button>
          <motion.button
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2 w-full"
            onClick={onDecline}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Flag className="w-5 h-5" />
            {t('continue.declineButton')}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
