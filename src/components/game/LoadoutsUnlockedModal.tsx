/**
 * LoadoutsUnlockedModal — one-time announcement shown after the player's first
 * win, when the loadout system is revealed. From now on every run starts with
 * the Sprint Planning loadout draft. Dismiss with a tap or the button.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Backpack } from 'lucide-react';

interface LoadoutsUnlockedModalProps {
  visible: boolean;
  onDismiss: () => void;
  accentColor?: string;
}

export function LoadoutsUnlockedModal({
  visible,
  onDismiss,
  accentColor = '#00ff88',
}: LoadoutsUnlockedModalProps) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="loadouts-unlocked"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onDismiss}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 12 }}
            onClick={e => e.stopPropagation()}
            className="max-w-md w-full rounded-xl p-6 text-center flex flex-col items-center gap-3"
            style={{
              backgroundColor: '#0a0f0a',
              border: `2px solid ${accentColor}`,
              boxShadow: `0 0 40px ${accentColor}44`,
            }}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ border: `2px solid ${accentColor}`, backgroundColor: `${accentColor}22` }}
            >
              <Backpack className="w-8 h-8" style={{ color: accentColor }} />
            </div>
            <h2
              className="font-display font-black text-xl uppercase tracking-wider"
              style={{ color: accentColor }}
            >
              {t('loadouts.unlockedModalTitle')}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8ffd8' }}>
              {t('loadouts.unlockedModalBody')}
            </p>
            <button className="arcade-button-primary rounded-lg mt-1" onClick={onDismiss}>
              {t('loadouts.unlockedModalDismiss')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
