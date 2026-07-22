/**
 * AbilityCountdownBar — a draining bar per active time-based ability (#38),
 * shown beneath the Ship Early ("space/time left") bar. One row per running
 * ability (Slow All / Fence Overclock / Fence Shield / Freeze All), tinted by
 * the ability colour, showing how long is left. One-shot abilities (Magnet /
 * Shockwave / Clear Fences) have no duration, so they never appear here.
 *
 * Ticks arrive at 1Hz via `activeSeconds` (like ShipEarlyBar); a 1s linear width
 * transition keeps each drain smooth between ticks.
 */
import type { AbilityTimer } from './GameCanvas';

interface AbilityCountdownBarProps {
  timers: AbilityTimer[];
  /** Whole active-play seconds this map (1Hz from the loop). */
  activeSeconds: number;
  visible: boolean;
}

export function AbilityCountdownBar({ timers, activeSeconds, visible }: AbilityCountdownBarProps) {
  if (!visible || timers.length === 0) return null;

  return (
    <div style={{ backgroundColor: 'rgba(0, 0, 0, 0.80)' }}>
      <div className="mx-auto max-w-4xl px-3 py-1 flex flex-col gap-1">
        {timers.map(tmr => {
          const total = Math.max(0.001, tmr.endSec - tmr.startSec);
          const remaining = Math.max(0, Math.min(1, (tmr.endSec - activeSeconds) / total));
          const secsLeft = Math.max(0, Math.ceil(tmr.endSec - activeSeconds));
          return (
            <div key={tmr.kind} className="flex items-center gap-2">
              <span
                className="font-display text-[10px] font-bold flex-shrink-0"
                style={{ color: tmr.color, minWidth: 0 }}
              >
                {tmr.name}
              </span>
              <div className="flex-1 relative h-1.5">
                <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${remaining * 100}%`,
                      background: tmr.color,
                      boxShadow: `0 0 8px ${tmr.color}aa`,
                      transition: 'width 1s linear',
                    }}
                  />
                </div>
              </div>
              <span
                className="font-display text-xs font-bold tabular-nums flex-shrink-0"
                style={{ color: tmr.color, textShadow: `0 0 8px ${tmr.color}66` }}
              >
                {secsLeft}s
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
