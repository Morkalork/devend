/**
 * ShipEarlyBar — thin countdown bar for the Ship Early bonus, rendered as the
 * top row of GameBottomBar's fixed wrapper (a plain sibling in the layout
 * column would sit underneath the fixed bar and be covered by it).
 *
 * Drains as time passes across the ladder's full window (scoring-config.yml
 * shipEarly; per-ball windows, so busy maps get proportionally more time),
 * with divider ticks where the payout steps down and a value chip
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
  /** Balls spawned on this map: the windows are per ball (15s/ball etc.). */
  ballCount: number;
  /** Deadline Extension: extra seconds per ball added to every window. */
  extraSecondsPerBall?: number;
  /** False hides the bar (win condition met, prompt open). */
  visible: boolean;
}

/** Bar colour by attainable bonus: hot while the top rung is live, cooling down. */
const BONUS_COLORS: Record<number, string> = {
  3: '#2dd4bf', // teal, matches the Ship Early breakdown row
  2: '#ffd54a',
  1: '#ffb020',
};

export function ShipEarlyBar({ seconds, ballCount, extraSecondsPerBall = 0, visible }: ShipEarlyBarProps) {
  const { t } = useTranslation();
  const thresholds = getShipEarlyThresholds();
  if (!visible || thresholds.length === 0) return null;

  // Windows scale with the map's workload: (withinSecondsPerBall + Deadline
  // Extension) x ball count.
  const balls = ballCount > 0 ? ballCount : 1;
  const extra = extraSecondsPerBall > 0 ? extraSecondsPerBall : 0;
  const windowFor = (perBall: number) => (perBall + extra) * balls;
  const maxWindow = Math.max(...thresholds.map(s => windowFor(s.withinSecondsPerBall)));
  const bonus = getShipEarlyBonus(seconds, balls, extra);
  // Every window passed: nothing left to chase, get out of the way.
  if (bonus <= 0 || seconds >= maxWindow) return null;

  const remaining = Math.max(0, 1 - seconds / maxWindow);
  const color = BONUS_COLORS[bonus] ?? '#2dd4bf';

  return (
    <div
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.80)', borderTop: `1px solid ${color}55` }}
      title={t('shipEarlyBar.title')}
    >
      <div className="mx-auto max-w-4xl px-3 py-1.5 flex items-center gap-2">
        <Timer className="w-3.5 h-3.5 flex-shrink-0" style={{ color, filter: `drop-shadow(0 0 4px ${color}aa)` }} />
        <div className="flex-1 relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${remaining * 100}%`,
              background: color,
              boxShadow: `0 0 8px ${color}aa`,
              transition: 'width 1s linear, background-color 0.3s',
            }}
          />
          {/* Divider ticks where the payout steps down. */}
          {thresholds.filter(s => windowFor(s.withinSecondsPerBall) < maxWindow).map(s => (
            <div
              key={s.withinSecondsPerBall}
              className="absolute top-0 h-full w-px"
              style={{ left: `${(1 - windowFor(s.withinSecondsPerBall) / maxWindow) * 100}%`, background: 'rgba(255,255,255,0.35)' }}
            />
          ))}
        </div>
        <span className="font-display text-xs font-bold tabular-nums flex-shrink-0" style={{ color, textShadow: `0 0 8px ${color}66` }}>
          {t('shipEarlyBar.bonus', { hours: bonus })}
        </span>
      </div>
    </div>
  );
}
