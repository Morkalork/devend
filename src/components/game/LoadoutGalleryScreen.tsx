/**
 * LoadoutGalleryScreen — the between-runs loadout collection.
 *
 * Lists every loadout (public/loadouts.yml) split into unlocked and locked.
 * Locked loadouts show how many UNIQUE wins (runs beaten with distinct
 * run-start loadouts) are still needed, with a progress bar. This is the
 * long-term goal surface: purely presentational, unlock state lives in
 * useMetaProgression (wonLoadoutIds).
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Backpack, ArrowLeft, Lock, Skull, Sparkles } from 'lucide-react';
import { LoadoutConfig } from '@/types/loadout';
import { isLoadoutUnlocked } from '@/lib/loadoutUnlock';
import { CRTBackground } from './CRTBackground';
import { contentText } from '@/i18n/content';
import { Progress } from '@/components/ui/progress';

interface LoadoutGalleryScreenProps {
  loadouts: LoadoutConfig[];
  wonLoadoutIds: string[];
  onBack: () => void;
  accentColor?: string;
}

export function LoadoutGalleryScreen({
  loadouts,
  wonLoadoutIds,
  onBack,
  accentColor = '#00ff88',
}: LoadoutGalleryScreenProps) {
  const { t } = useTranslation();
  const uniqueWins = wonLoadoutIds.length;
  const totalGated = loadouts.filter(l => l.uniqueWinsRequired != null).length;

  const unlocked = loadouts.filter(l => isLoadoutUnlocked(l, uniqueWins));
  const locked = loadouts.filter(l => !isLoadoutUnlocked(l, uniqueWins));

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center bg-background/90 p-4 sm:p-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex flex-col items-center gap-6 w-full max-w-2xl"
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <Backpack className="w-8 h-8" style={{ color: accentColor }} />
            <h1 className="text-3xl sm:text-4xl font-display font-black tracking-wider text-foreground">
              {t('loadouts.title')}
            </h1>
          </div>

          {/* Unique-win counter */}
          <div
            className="rounded-xl px-6 py-3 text-center"
            style={{ border: `1px solid ${accentColor}55`, backgroundColor: `${accentColor}11` }}
          >
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {t('loadouts.uniqueWins')}
            </p>
            <p className="text-3xl font-display font-bold tabular-nums" style={{ color: accentColor }}>
              {uniqueWins} / {totalGated}
            </p>
          </div>

          <div className="w-full flex flex-col gap-6 max-h-[55vh] overflow-y-auto pr-1">
            {/* Unlocked */}
            {unlocked.length > 0 && (
              <Section title={t('loadouts.sectionUnlocked')}>
                {unlocked.map((loadout, i) => (
                  <motion.div
                    key={loadout.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.04 }}
                    className="p-4 rounded-lg"
                    style={{ border: `2px solid ${accentColor}44`, backgroundColor: 'rgba(255,255,255,0.04)' }}
                  >
                    <p className="font-display font-bold text-base mb-3" style={{ color: accentColor }}>
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
                  </motion.div>
                ))}
              </Section>
            )}

            {/* Locked */}
            {locked.length > 0 && (
              <Section title={t('loadouts.sectionLocked')}>
                {locked.map((loadout, i) => {
                  const required = loadout.uniqueWinsRequired ?? 0;
                  const remaining = Math.max(0, required - uniqueWins);
                  return (
                    <motion.div
                      key={loadout.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + i * 0.03 }}
                      className="p-4 rounded-lg border border-muted/30 bg-muted/5"
                      style={{ opacity: 0.7 }}
                    >
                      <div className="flex items-start gap-3">
                        <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-display font-bold text-sm text-muted-foreground">
                            {contentText.loadoutName(t, loadout)}
                          </p>
                          <p className="text-xs text-foreground/80 mt-1">
                            {t('loadouts.unlockRequirement', { count: remaining })}
                          </p>
                          <Progress
                            value={required > 0 ? (Math.min(uniqueWins, required) / required) * 100 : 0}
                            className="h-1.5 mt-2 bg-muted/40"
                          />
                          <p className="text-xs font-bold tabular-nums text-muted-foreground mt-1">
                            {t('loadouts.progress', { current: Math.min(uniqueWins, required), required })}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </Section>
            )}

            {loadouts.length === 0 && (
              <p className="text-center text-muted-foreground text-sm py-8">{t('loadouts.loading')}</p>
            )}
          </div>

          {/* Back */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={onBack}
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            {t('loadouts.back')}
          </motion.button>
        </motion.div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-display font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
