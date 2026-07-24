/**
 * FeatureUnlockedModal — the general "Feature Unlocked" announcement. Shown
 * once, mid-run, when the player earns a new game feature (see features.ts).
 * The header is always "Feature Unlocked"; the icon, name and body come from
 * the feature (icon/colour from the catalogue, strings from i18n
 * `features.<id>.*`). Dismiss with a tap or the button.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Backpack, Sparkles, LucideIcon } from 'lucide-react';
import { GameFeature } from '@/lib/features';

// Resolves the `icon` NAME from features.yml to a lucide component. Add an entry
// here when a feature uses a new icon; unmapped names fall back to Sparkles.
const FEATURE_ICONS: Record<string, LucideIcon> = {
  Backpack,
  Sparkles,
};

interface FeatureUnlockedModalProps {
  /** The feature to announce, or null when nothing is pending. */
  feature: GameFeature | null;
  onDismiss: () => void;
}

export function FeatureUnlockedModal({ feature, onDismiss }: FeatureUnlockedModalProps) {
  const { t } = useTranslation();
  const accentColor = feature?.color ?? '#00ff88';
  const Icon = (feature && FEATURE_ICONS[feature.icon]) || Sparkles;

  return (
    <AnimatePresence>
      {feature && (
        <motion.div
          key="feature-unlocked"
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
            <span
              className="text-xs font-semibold uppercase tracking-[0.3em]"
              style={{ color: `${accentColor}aa` }}
            >
              {t('features.unlockedHeader')}
            </span>
            {Icon && (
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ border: `2px solid ${accentColor}`, backgroundColor: `${accentColor}22` }}
              >
                <Icon className="w-8 h-8" style={{ color: accentColor }} />
              </div>
            )}
            <h2
              className="font-display font-black text-xl uppercase tracking-wider"
              style={{ color: accentColor }}
            >
              {t(`features.${feature.id}.name`)}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: '#c8ffd8' }}>
              {t(`features.${feature.id}.body`)}
            </p>
            <button className="arcade-button-primary rounded-lg mt-1" onClick={onDismiss}>
              {t('features.dismiss')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
