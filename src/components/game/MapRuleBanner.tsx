/**
 * MapRuleBanner - the map is not playing by normal rules, said twice.
 *
 * Third attempt, and the two failures before it are the design.
 *
 * A chip in the top bar's stats row was first, and was reported straight back:
 * "the technical gravity sign isn't working up there, it has to be clearer,
 * like a warning sign." It was competing with six numbers the player reads
 * constantly, in the same size and weight as all of them, so a rule that
 * changes the physics read as another stat and disappeared.
 *
 * A full-width caution strip was second, and was reported as "too big and you
 * can't see all of it". Both halves of that are true and they have one cause:
 * the strip was doing TWO jobs on one line. The name was set in black
 * letterspaced caps and marked flex-shrink-0, so on a 393px phone it took the
 * whole row and truncated the description to "Everything is pulled ..." - the
 * clause that actually stops bent trajectories reading as a bug. A row that is
 * too tall to spare AND too narrow to finish its sentence is not a size problem,
 * it is two things in one place.
 *
 * So it is two states in one place instead:
 *
 *   ANNOUNCE, for the first few seconds of the map. The band above the board is
 *     empty - a square board in a taller frame leaves about 150px there - so the
 *     rule gets a real block: named, and what it does underneath in a sentence
 *     that WRAPS instead of truncating. This is the half that has to be noticed,
 *     and it can afford to be big because it is temporary.
 *
 *   REMIND, for the rest of the map. It collapses to a compact hazard chip:
 *     glyph and name, no prose. This is the half that has to persist, and it can
 *     afford to be small because it is no longer the only signal - which is
 *     exactly what the first attempt got wrong.
 *
 * Same position for both, so the player learns where the rule lives. Never over
 * the board: it sits in slack that was empty anyway, so nothing is covered and
 * no cut is ever swallowed.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { motion } from 'framer-motion';
import { contentText } from '@/i18n/content';
import { MAP_RULE_VIOLET } from './mapRuleTheme';
import type { ActiveMapMutator } from '@/types/mapMutator';

/**
 * How long the rule is announced before it collapses to the chip.
 *
 * Long enough to read a short sentence twice at a glance, short enough that it
 * is gone before the board gets busy. It is not a modal and costs no tap, so
 * erring long is cheap; erring short means the player never read it, which is
 * the whole defect.
 */
export const ANNOUNCE_MS = 5000;

interface MapRuleBannerProps {
  /** The map's mutator. Nothing renders without one, which is most maps. */
  mutator?: ActiveMapMutator | null;
  /** Opens the Specs panel, which carries the full explanation. */
  onExplain?: () => void;
}

export function MapRuleBanner({ mutator, onExplain }: MapRuleBannerProps) {
  const { t } = useTranslation();
  const [announcing, setAnnouncing] = useState(true);

  // Keyed on the mutator, so a new map announces its rule again rather than
  // inheriting the previous map's collapsed chip.
  useEffect(() => {
    if (!mutator) return;
    setAnnouncing(true);
    const timer = setTimeout(() => setAnnouncing(false), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mutator]);

  if (!mutator) return null;

  const name = contentText.mutatorName(t, mutator);
  const detail = contentText.mutatorDesc(t, mutator);

  return (
    <motion.button
      onClick={onExplain}
      aria-label={t('topBar.mutatorTitle', { name })}
      layout
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={
        announcing
          ? 'w-full flex flex-col items-center gap-1 px-4 py-2.5 focus:outline-none'
          : 'flex items-center gap-1.5 px-2.5 py-1 rounded-full focus:outline-none'
      }
      style={{
        // Announcing spans the frame, so a hazard rule top and bottom rather
        // than a box, which would read as a second top bar. The chip is a
        // bordered pill instead: it has to look like an object, not a heading.
        borderTop: announcing ? `1px solid ${MAP_RULE_VIOLET}55` : undefined,
        borderBottom: announcing ? `1px solid ${MAP_RULE_VIOLET}55` : undefined,
        border: announcing ? undefined : `1px solid ${MAP_RULE_VIOLET}77`,
        background: announcing
          ? `linear-gradient(90deg, transparent, ${MAP_RULE_VIOLET}1f 20%, ${MAP_RULE_VIOLET}1f 80%, transparent)`
          : `${MAP_RULE_VIOLET}22`,
      }}
    >
      <span className="flex items-center gap-2 min-w-0">
        <TriangleAlert
          className={announcing ? 'w-5 h-5 flex-shrink-0' : 'w-3.5 h-3.5 flex-shrink-0'}
          style={{ color: MAP_RULE_VIOLET }}
          aria-hidden
        />
        <span
          className={
            announcing
              ? 'font-display text-base sm:text-lg font-black uppercase tracking-widest'
              : 'font-display text-[11px] font-bold uppercase tracking-wider truncate'
          }
          style={{
            color: MAP_RULE_VIOLET,
            textShadow: announcing ? `0 0 14px ${MAP_RULE_VIOLET}aa` : 'none',
          }}
        >
          {name}
        </span>
      </span>
      {/* Only while announcing, and WRAPPING rather than truncating. What it
          does is the clause that stops bent trajectories reading as a bug, so a
          version of it ending in an ellipsis is worse than none: it says there
          was an explanation and withholds it. */}
      {announcing && detail && (
        <span
          className="text-xs sm:text-sm font-semibold leading-snug text-center"
          style={{ color: '#d9c9ff', opacity: 0.9, textWrap: 'balance' }}
        >
          {detail}
        </span>
      )}
    </motion.button>
  );
}
