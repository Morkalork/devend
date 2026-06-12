/**
 * AscensionDraftScreen — shown after beating the final level.
 *
 * The player either retires (banks the run, sees the result screen) or
 * ascends: drafts one of three randomly offered mutators (curse + blessing
 * bundles from public/mutators.yml) and loops back to level 1 with every
 * drafted mutator still active.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpCircle, Flag, Skull, Sparkles } from 'lucide-react';
import { MutatorConfig } from '@/types/mutator';
import { CRTBackground } from './CRTBackground';

interface AscensionDraftScreenProps {
  mutators: MutatorConfig[];
  draftedMutatorIds: string[];
  /** Depth completed so far; ascending enters depth + 1. */
  ascensionDepth: number;
  totalScore: number;
  onAscend: (mutatorId: string) => void;
  onRetire: () => void;
  accentColor?: string;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
}

/** Pick `count` random mutators not yet drafted (falls back to the full
 *  catalogue when the pool runs dry at extreme depths — duplicates stack). */
function drawOffers(mutators: MutatorConfig[], draftedIds: string[], count: number): MutatorConfig[] {
  let pool = mutators.filter(m => !draftedIds.includes(m.id));
  if (pool.length === 0) pool = [...mutators];
  const offers: MutatorConfig[] = [];
  const candidates = [...pool];
  while (offers.length < count && candidates.length > 0) {
    const i = Math.floor(Math.random() * candidates.length);
    offers.push(candidates.splice(i, 1)[0]);
  }
  return offers;
}

export function AscensionDraftScreen({
  mutators,
  draftedMutatorIds,
  ascensionDepth,
  totalScore,
  onAscend,
  onRetire,
  accentColor = '#00ff88',
  showTutorial = false,
  onTutorialDismiss,
}: AscensionDraftScreenProps) {
  // Drawn once per mount so re-renders don't reshuffle the offer
  const [offers] = useState(() => drawOffers(mutators, draftedMutatorIds, 3));
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
              All Levels Cleared
            </h1>
            <p className="mt-2 text-sm" style={{ color: '#c8ffd8', opacity: 0.75 }}>
              {ascensionDepth > 0 ? `Ascension ${ascensionDepth} complete. ` : ''}
              Retire and bank everything — or draft a mutator and ascend to depth {nextDepth}.
            </p>
            <p className="mt-1 text-xs" style={{ color: '#4a7a5a' }}>
              Ascended levels are faster and count {nextDepth + 1}× toward Certificate Hours.
              Banked overtime: {totalScore}h
            </p>
          </div>

          {/* Mutator cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
            {offers.map((mutator, i) => {
              const selected = selectedId === mutator.id;
              return (
                <motion.button
                  key={mutator.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedId(selected ? null : mutator.id)}
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
                    {mutator.name}
                  </p>
                  <div className="flex items-start gap-2 mb-2">
                    <Skull className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#ff6b6b' }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#ff6b6b' }}>{mutator.curse}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#c8ffd8' }}>{mutator.blessing}</p>
                  </div>
                </motion.button>
              );
            })}
            {offers.length === 0 && (
              <div
                className="sm:col-span-3 rounded-lg p-4 text-center text-xs"
                style={{ border: `1px solid ${accentColor}44`, color: '#4a7a5a' }}
              >
                No mutators available — mutators.yml failed to load. You can still retire below.
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
              {selectedId ? `Ascend to Depth ${nextDepth}` : 'Select a Mutator'}
            </motion.button>
            <motion.button
              className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2"
              onClick={onRetire}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Flag className="w-5 h-5" />
              Retire — Bank This Run
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
                Ascension Unlocked
              </h2>
              <p className="text-sm leading-relaxed mb-4" style={{ color: '#c8ffd8' }}>
                You beat every level — but the grind never ends. Ascend to start over at level 1
                with your score, upgrades and lives intact, plus one <b>mutator</b>: a curse bundled
                with a blessing. Mutators stack with every ascension, levels get faster, and each
                cleared level counts more toward Certificate Hours. Retire whenever you want to bank it all.
              </p>
              <button className="arcade-button-primary rounded-lg" onClick={onTutorialDismiss}>
                Got It
              </button>
            </motion.div>
          </div>
        )}
      </div>
    </>
  );
}
