/**
 * One goal, in the row of goals.
 *
 * Replaces WinGateChip and the three bespoke readouts beside it (cuts against
 * par, space counting down, a bare lock tally), which between them gave a
 * player four notations to decode in answer to one question. Everything here
 * reads the same way: an icon, progress, a target, a name.
 *
 * The tiers are NOT cosmetic (see lib/goalTracker.ts). A requirement is
 * something the map demands and can go at risk; a budget is score, never the
 * map; a tally has nothing to reach. Rendering them identically would say the
 * map wants eight cuts, which no map does.
 */
import { useTranslation } from 'react-i18next';
import {
  Diamond, Crosshair, Palette, Skull, Lock, Scissors, Timer, Hammer,
  PackageCheck, Zap, Waves, Target, Info,
} from 'lucide-react';
import type { Goal } from '@/lib/goalTracker';

/** One glyph per kind, so two goals on a map never look alike. */
const ICONS = {
  space: Target,
  locks: Lock,
  superiorLocks: Diamond,
  area: Palette,
  lockType: Crosshair,
  boss: Skull,
  allLocked: Lock,
  smashed: Hammer,
  delivered: PackageCheck,
  terminals: Zap,
  harvested: Waves,
  underPar: Scissors,
  speedClear: Timer,
  par: Scissors,
} as const;

interface Props {
  goal: Goal;
  accentColor: string;
  /** One ball left and this goal still outstanding: locking it strands the map. */
  atRisk?: boolean;
  /** Tap target: opens the "How to win" text, which carries the full wording. */
  onExplain?: () => void;
  /** Flash key for the count-change animation, if this row animates. */
  flashKey?: number;
  /**
   * Press-and-hold, for a goal that has more to say than a fraction. Only space
   * uses it (exact remaining and cleared numbers, useful mid Push Your Luck
   * when the chip just reads CLEAR), and it brings the project's standard Info
   * hint with it so the chip reads as holdable.
   */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
}

export function GoalChip({
  goal, accentColor, atRisk = false, onExplain, flashKey = 0, onHoldStart, onHoldEnd,
}: Props) {
  const { t } = useTranslation();
  const Icon = ICONS[goal.kind as keyof typeof ICONS] ?? Diamond;

  const label = goal.ballType
    ? t(goal.labelKey, { type: goal.ballType })
    : t(goal.labelKey);

  // Four states, and each answers a different question. Done: banked, stop
  // thinking about it. At risk: one lock from losing this, the only state that
  // costs a life. Over: past par, which costs score and nothing else, so it is
  // warned about in amber rather than in the red reserved for real loss.
  const color = goal.done ? accentColor
    : atRisk ? '#ff6b6b'
    : goal.over ? '#ffb020'
    : 'hsl(var(--foreground))';
  const glow = goal.done ? accentColor : atRisk ? '#ff6b6b' : goal.over ? '#ffb020' : null;

  // A tally has no target, so it shows a bare number: "2 locked" rather than a
  // fraction against a requirement this map does not have.
  const value = goal.target === null
    ? `${goal.current}${goal.unit === 'percent' ? '%' : ''}`
    : goal.unit === 'percent'
      ? `${goal.current}/${goal.target}%`
      : `${goal.current}/${goal.target}`;

  return (
    <button
      type="button"
      onClick={onExplain}
      // Stop the tap reaching the row, which expands the Specs panel: a chip
      // that opened two things at once would be worse than one that opened
      // nothing.
      onPointerDown={e => { e.stopPropagation(); onHoldStart?.(); }}
      onPointerUp={onHoldEnd}
      onPointerLeave={onHoldEnd}
      onPointerCancel={onHoldEnd}
      onContextMenu={e => e.preventDefault()}
      className="flex items-center gap-1.5 min-w-0 bg-transparent border-0 p-0"
      title={atRisk ? t('winGate.atRisk', { label }) : `${label} ${value}`}
      aria-label={`${label} ${value}${atRisk ? ` (${t('winGate.atRisk', { label })})` : ''}`}
    >
      <Icon
        className="w-4 h-4 flex-shrink-0"
        style={{ color, filter: glow ? `drop-shadow(0 0 6px ${glow}aa)` : 'none' }}
      />
      <span
        key={flashKey}
        className={`font-display text-sm font-bold tabular-nums${flashKey > 0 ? ' animate-stat-flash' : ''}`}
        style={{ color, textShadow: glow ? `0 0 10px ${glow}88` : 'none' }}
      >
        {goal.done && goal.kind === 'space' ? t('topBar.clear') : value}
      </span>
      {/* The name is what teaches the rule, so it is not behind a hold.
          Truncated rather than wrapped: this row is one line on a phone. */}
      <span
        className="font-display text-[10px] uppercase tracking-wider truncate hidden sm:inline"
        style={{ color, opacity: 0.85 }}
      >
        {label}
      </span>
      {onHoldStart && (
        <Info className="w-3 h-3 flex-shrink-0 opacity-50" style={{ color: accentColor }} />
      )}
    </button>
  );
}
