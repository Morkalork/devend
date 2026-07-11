/**
 * ShipEarlyBar — thin countdown bar under the board for the Ship Early bonus.
 *
 * Drains as time passes across the ladder's full window (scoring-config.yml
 * shipEarly), with divider ticks where the payout steps down and a value chip
 * showing the bonus still attainable. Colour cools as the bonus shrinks. It
 * hides the moment the win condition is met (push prompt open) so it never
 * nags during push-your-luck, and once every window has passed (by then the
 * Scope Creep chip has taken over as the time signal). Ticks arrive at 1Hz
 * from the game loop; a 1s linear width transition keeps the drain smooth.
 */
import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import { getShipEarlyThresholds, getShipEarlyBonus } from '@/lib/scoring';

interface ShipEarlyBarProps {
  /** Whole active-play seconds elapsed this map (1Hz from the loop). */
  seconds: number;
  /** False hides the bar (win condition met, prompt open). */
  visible: boolean;
}

/** Bar colour by attainable bonus: hot while the top rung is live, cooling down. */
const BONUS_COLORS: Record<number, string> = {
  3: '#2dd4bf', // teal, matches the Ship Early breakdown row
  2: '#ffd54a',
  1: '#ffb020',
};

export function ShipEarlyBar({ seconds, visible }: ShipEarlyBarProps) {
  const { t } = useTranslation();
  const thresholds = getShipEarlyThresholds();
  if (!visible || thresholds.length === 0) return null;

  const maxWindow = Math.max(...thresholds.map(s => s.withinSeconds));
  const bonus = getShipEarlyBonus(seconds);
  // Every window passed: nothing left to chase, get out of the way.
  if (bonus <= 0 || seconds >= maxWindow) return null;

  const remaining = Math.max(0, 1 - seconds / maxWindow);
  const color = BONUS_COLORS[bonus] ?? '#2dd4bf';

  return (
    <div
      className="flex items-center gap-2 px-3 py-1"
      style={{ backgroundColor: 'rgba(0, 10, 5, 0.9)', borderTop: '1px solid rgba(255,255,255,0.06)' }}
      title={t('shipEarlyBar.title')}
    >
      <Timer className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
      <div className="flex-1 relative h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${remaining * 100}%`, background: color, transition: 'width 1s linear, background-color 0.3s' }}
        />
        {/* Divider ticks where the payout steps down (e.g. 25s and 40s of 60). */}
        {thresholds.filter(s => s.withinSeconds < maxWindow).map(s => (
          <div
            key={s.withinSeconds}
            className="absolute top-0 h-full w-px"
            style={{ left: `${(1 - s.withinSeconds / maxWindow) * 100}%`, background: 'rgba(255,255,255,0.35)' }}
          />
        ))}
      </div>
      <span className="font-display text-xs font-bold tabular-nums flex-shrink-0" style={{ color, textShadow: `0 0 8px ${color}66` }}>
        {t('shipEarlyBar.bonus', { hours: bonus })}
      </span>
    </div>
  );
}
