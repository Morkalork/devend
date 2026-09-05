/**
 * The unusual thing this map wants, and how far along you are.
 *
 * Three of the forty authored maps ask for something beyond space and locks,
 * and the only place that said so was an item in the hamburger menu. This sits
 * in the top bar's objective row beside the cuts, space and lock readouts,
 * because that row is already the place a player looks to find out where they
 * stand.
 *
 * A count rather than a symbol: "0/1 SUPERIOR" is the part a coloured border
 * could never carry, and progress is exactly what is wanted mid-map. It follows
 * the lock chip's existing three states - dim when there is nothing to do, plain
 * foreground while outstanding, accent with a glow the moment it is satisfied -
 * so it reads as a member of that row rather than as a new kind of thing.
 */
import { useTranslation } from 'react-i18next';
import { Diamond, Crosshair, Palette, Skull, Lock, Scissors, Timer, Hammer, PackageCheck, Zap, Waves } from 'lucide-react';
import { gateSatisfied, gateLabelKey } from '@/lib/winHud';
import type { WinConditionProgress } from '@/types/winSpec';

/** One glyph per requirement kind, so two gates on a map never look alike. */
const ICONS = {
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
} as const;

interface Props {
  gate: WinConditionProgress;
  accentColor: string;
  /** One ball left and this gate still outstanding: locking it strands the map. */
  atRisk?: boolean;
  /** Opens the "How to win" text, which carries the full wording. */
  onExplain?: () => void;
}

export function WinGateChip({ gate, accentColor, atRisk = false, onExplain }: Props) {
  const { t } = useTranslation();
  const done = gateSatisfied(gate);
  const Icon = ICONS[gate.condition.kind as keyof typeof ICONS] ?? Diamond;

  // A lockType gate names the ball, which is the whole requirement: "seal a
  // ball" and "seal a LODESTONE" are different maps.
  const label = gate.condition.kind === 'lockType'
    ? t(gateLabelKey(gate.condition), { type: gate.condition.ballType })
    : t(gateLabelKey(gate.condition));

  // Three states, not two. Dim/plain/accent was "where you stand"; the warning
  // is "you are one lock away from losing this", which is a different question
  // and the only one that costs a life.
  const color = done ? accentColor : atRisk ? '#ff6b6b' : 'hsl(var(--foreground))';

  return (
    <button
      type="button"
      onClick={onExplain}
      // Stop the tap reaching the row, which expands the Specs panel: a chip
      // that opened two things at once would be worse than one that opened
      // nothing.
      onPointerDown={e => e.stopPropagation()}
      className="flex items-center gap-1.5 min-w-0 bg-transparent"
      title={atRisk ? t('winGate.atRisk', { label }) : label}
      aria-label={`${label} ${gate.current}/${gate.target}${atRisk ? ` (${t('winGate.atRisk', { label })})` : ''}`}
    >
      <Icon
        className="w-4 h-4 flex-shrink-0"
        style={{
          color,
          filter: done ? `drop-shadow(0 0 6px ${accentColor}aa)`
            : atRisk ? 'drop-shadow(0 0 6px #ff6b6baa)' : 'none',
        }}
      />
      <span
        className="font-display text-sm font-bold tabular-nums"
        style={{ color, textShadow: done ? `0 0 10px ${accentColor}88` : 'none' }}
      >
        {gate.current}/{gate.target}
      </span>
      {/* The name is what teaches the rule, so it is not hidden behind a hold.
          Truncated rather than wrapped: this row is one line on a phone. */}
      <span
        className="font-display text-[10px] uppercase tracking-wider truncate hidden sm:inline"
        style={{ color, opacity: 0.85 }}
      >
        {label}
      </span>
    </button>
  );
}
