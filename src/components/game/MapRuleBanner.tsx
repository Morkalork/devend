/**
 * MapRuleBanner — the strip that says this map is not playing by normal rules.
 *
 * A mutator changes how a whole map behaves. Its name first lived only inside
 * the collapsed Specs panel, and Technical Gravity - which bends every path on
 * the board - was reported three times as a malfunction. A chip in the top
 * bar's stats row was the first attempt and was reported straight back: "the
 * technical gravity sign isn't working up there, it has to be clearer, like a
 * warning sign."
 *
 * It was competing for attention with six numbers the player reads constantly
 * (level, lives, cuts, space, locks), in the same size and weight as all of
 * them. A rule that changes the physics is not a stat, and rendering it as one
 * is what made it disappear.
 *
 * So: its own strip between the top bar and the board, in the slack a square
 * board leaves in a taller frame, shaped like a caution notice - hazard rule,
 * alert glyph, the rule NAMED in caps, and what it does in plain words beside
 * it. It is persistent because the condition is: a mutator applies for the
 * whole map, and forgetting it is precisely the reported failure.
 *
 * Pressing it opens Specs, where the longer hold-to-clarify text lives. Naming
 * a thing the player cannot then ask about is half a fix.
 */
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { contentText } from '@/i18n/content';
import { MAP_RULE_VIOLET } from './mapRuleTheme';
import type { ActiveMapMutator } from '@/types/mapMutator';

interface MapRuleBannerProps {
  /** The map's mutator. Nothing renders without one, which is most maps. */
  mutator?: ActiveMapMutator | null;
  /** Opens the Specs panel, which carries the full explanation. */
  onExplain?: () => void;
}

export function MapRuleBanner({ mutator, onExplain }: MapRuleBannerProps) {
  const { t } = useTranslation();
  if (!mutator) return null;

  const name = contentText.mutatorName(t, mutator);
  const detail = contentText.mutatorDesc(t, mutator);

  return (
    <button
      onClick={onExplain}
      aria-label={t('topBar.mutatorTitle', { name })}
      className="w-full flex items-center justify-center gap-2 px-3 py-1.5 focus:outline-none"
      style={{
        // A hazard rule top and bottom rather than a box: it spans the frame,
        // so a border would read as a second bar competing with the top bar.
        borderTop: `1px solid ${MAP_RULE_VIOLET}55`,
        borderBottom: `1px solid ${MAP_RULE_VIOLET}55`,
        background: `linear-gradient(90deg, transparent, ${MAP_RULE_VIOLET}1f 20%, ${MAP_RULE_VIOLET}1f 80%, transparent)`,
      }}
    >
      <TriangleAlert
        className="w-5 h-5 flex-shrink-0"
        style={{ color: MAP_RULE_VIOLET }}
        aria-hidden
      />
      <span
        className="font-display text-base sm:text-lg font-black uppercase tracking-widest flex-shrink-0"
        style={{ color: MAP_RULE_VIOLET, textShadow: `0 0 14px ${MAP_RULE_VIOLET}aa` }}
      >
        {name}
      </span>
      {detail && (
        // What it DOES, not just what it is called. The name alone is a label;
        // "everything is pulled one way" is the thing that stops the bent
        // trajectories reading as a bug.
        <span
          className="text-xs sm:text-sm font-semibold leading-tight truncate min-w-0"
          style={{ color: '#d9c9ff', opacity: 0.85 }}
        >
          {detail}
        </span>
      )}
    </button>
  );
}
