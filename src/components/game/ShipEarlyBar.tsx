/**
 * ShipEarlyBar — the map countdown bar, rendered as the top row of
 * GameBottomBar's fixed wrapper (a plain sibling in the layout column would sit
 * underneath the fixed bar and be covered by it).
 *
 * It drains over the map's hard time limit (mapTiming.ts; default 60s active-play
 * seconds) and shades green -> red as it empties, so it doubles as the deadline
 * warning. The Ship Early fast-finish bonus lives in the EARLY part of the same
 * bar: divider ticks mark where each payout rung expires, and a value chip shows
 * the bonus still attainable; once every window has passed the chip switches to a
 * plain seconds-left readout. Hidden entirely on the tutorial band (levels 1-3),
 * which has neither a time limit nor Ship Early. Ticks arrive at 1Hz from the
 * game loop; a 1s linear width transition keeps the drain smooth.
 */
import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import { getShipEarlyThresholds, getShipEarlyBonus } from '@/lib/scoring';

interface ShipEarlyBarProps {
  /** Whole active-play seconds elapsed this map (1Hz from the loop). */
  seconds: number;
  /** Balls spawned on this map: the Ship Early windows are per ball (15s/ball etc.). */
  ballCount: number;
  /** The map's hard time limit in active-play seconds; the bar drains over this. */
  timeLimit: number;
  /** Deadline Extension: extra seconds per ball added to every Ship Early window. */
  extraSecondsPerBall?: number;
  /** Hard Deadline door: scales the payout shown in the value chip. */
  bonusMultiplier?: number;
  /** False hides the bar (win condition met, prompt open, tutorial band). */
  visible: boolean;
}

/** Green (full) -> red (empty) by fraction of time remaining. */
function drainColor(remaining: number): string {
  const hue = Math.max(0, Math.min(120, 120 * remaining)); // 120 green .. 0 red
  return `hsl(${hue}, 85%, 52%)`;
}

export function ShipEarlyBar({ seconds, ballCount, timeLimit, extraSecondsPerBall = 0, bonusMultiplier = 1, visible }: ShipEarlyBarProps) {
  const { t } = useTranslation();
  if (!visible || !(timeLimit > 0)) return null;

  const balls = ballCount > 0 ? ballCount : 1;
  const extra = extraSecondsPerBall > 0 ? extraSecondsPerBall : 0;
  const thresholds = getShipEarlyThresholds();
  // Ship Early windows scale with the map's workload: (withinSecondsPerBall +
  // Deadline Extension) x ball count. They sit in the early part of the limit.
  const windowFor = (perBall: number) => (perBall + extra) * balls;

  const remaining = Math.max(0, 1 - seconds / timeLimit);
  const secondsLeft = Math.max(0, Math.ceil(timeLimit - seconds));
  const payout = getShipEarlyBonus(seconds, balls, extra, bonusMultiplier);
  const color = drainColor(remaining);

  return (
    <div
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.80)', borderTop: `1px solid ${color}55` }}
      title={t('shipEarlyBar.title')}
    >
      <div className="mx-auto max-w-4xl px-3 py-1.5 flex items-center gap-2">
        <Timer className="w-3.5 h-3.5 flex-shrink-0" style={{ color, filter: `drop-shadow(0 0 4px ${color}aa)` }} />
        <div className="flex-1 relative h-1.5">
          {/* Draining fill in its own clipped layer so its rounded corners stay
              tidy without clipping the marker ticks that stand proud of the bar. */}
          <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${remaining * 100}%`,
                background: color,
                boxShadow: `0 0 8px ${color}aa`,
                transition: 'width 1s linear, background-color 1s linear',
              }}
            />
          </div>
          {/* Divider ticks where each Ship Early payout rung expires. White and a
              touch taller than the bar so they read as deliberate marks against
              both the colored fill and the dark track. Only rungs that fall
              inside the time limit are shown. */}
          {thresholds
            .filter(s => windowFor(s.withinSecondsPerBall) < timeLimit)
            .map(s => (
              <div
                key={s.withinSecondsPerBall}
                className="absolute -top-0.5 w-0.5 rounded-full"
                style={{
                  left: `${(1 - windowFor(s.withinSecondsPerBall) / timeLimit) * 100}%`,
                  height: 'calc(100% + 4px)',
                  transform: 'translateX(-50%)',
                  background: 'rgba(255,255,255,0.85)',
                  boxShadow: '0 0 3px rgba(255,255,255,0.7)',
                }}
              />
            ))}
        </div>
        {/* Early on, the chip nudges you toward the fast-finish bonus; once the
            windows pass it becomes a plain seconds-left countdown. */}
        <span className="font-display text-xs font-bold tabular-nums flex-shrink-0" style={{ color, textShadow: `0 0 8px ${color}66` }}>
          {payout > 0 ? t('shipEarlyBar.bonus', { hours: payout }) : t('shipEarlyBar.seconds', { s: secondsLeft })}
        </span>
      </div>
    </div>
  );
}
