/**
 * The explainer behind press-and-hold on a board object.
 *
 * Deliberately reachable rather than taught: the one-time modals this is meant to
 * replace fire once, interrupt play to do it, and are then gone for good. A
 * player meeting a mirror for the third time, or returning after a week, had no
 * route back to the explanation. Here the player chooses the moment, which is
 * also why a non-blocking tooltip would be worse - the ball is still moving and
 * they cannot read it either way.
 */
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { BoardEntityHit } from '@/lib/boardEntityInfo';
import { getBug } from '@/lib/bugs';

export function BoardEntityInfoModal({
  hit,
  onClose,
  accentColor,
}: {
  hit: BoardEntityHit;
  onClose: () => void;
  accentColor?: string;
}) {
  const { t } = useTranslation();
  const accent = accentColor || '#00ff88';
  // A bug carries its own copy in the catalogue. Unknown ids fall through to
  // the generic `boardInfo.bug` strings rather than rendering a blank card: a
  // bugs.yml a deployed build could not fetch must still explain what the thing
  // under the finger is.
  const bug = hit.kind === 'bug' ? getBug(hit.detail) : undefined;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
    >
      <motion.div
        initial={{ scale: 0.92, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-xs max-h-full flex flex-col rounded-xl border-2 bg-card shadow-xl"
        style={{ borderColor: `${accent}66` }}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        {/* Bounded and scrollable: a `fixed inset-0` overlay with items-center
            clips a card taller than the viewport out of BOTH ends, and neither
            end can be scrolled to. The close button stays outside the scroller. */}
        <div className="overflow-y-auto p-5">

          <h3 className="font-display font-bold text-base mb-1.5 pr-6" style={{ color: bug ? bug.color : accent }}>
            {bug ? bug.name : t(`boardInfo.${hit.kind}.title`)}
          </h3>

          {bug ? (
            /* A bug says what it GIVES and what it COSTS, as two labelled
               blocks. Every entry in the pool is double-edged, and the two
               halves have to be legible as a pair: run them together into one
               paragraph and the card reads as pure reward, which is the one
               thing this pool must not look like. The copy comes from
               public/bugs.yml, beside the tuning it describes, so a rebalanced
               bug and its explanation cannot drift apart. */
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {t('boardInfo.bug.gives')}
                </p>
                <p className="text-sm text-foreground leading-relaxed">{bug.description}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {t('boardInfo.bug.costs')}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">{bug.cost}</p>
              </div>
              {bug.danger && (
                <p
                  className="text-sm font-semibold leading-relaxed rounded-lg px-3 py-2"
                  style={{ color: bug.color, backgroundColor: `${bug.color}1a` }}
                >
                  {t('boardInfo.bug.danger')}
                </p>
              )}
              {/* The rule itself, last: what a bug IS, for the player meeting
                  their first one. The per-bug copy above is useless without it. */}
              <p className="text-xs text-muted-foreground/80 leading-relaxed">
                {t('boardInfo.bug.body')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t(`boardInfo.${hit.kind}.body`)}
            </p>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground/60">
            {t('boardInfo.hint')}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
