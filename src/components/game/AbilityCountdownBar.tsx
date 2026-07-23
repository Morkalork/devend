/**
 * AbilityCountdownBar — a draining bar per active time-based ability (#38),
 * shown beneath the Ship Early ("space/time left") bar. One row per running
 * ability (Slow All / Fence Overclock / Fence Shield / Freeze All), tinted by
 * the ability colour, showing how long is left. One-shot abilities (Magnet /
 * Shockwave / Clear Fences) have no duration, so they never appear here.
 *
 * It self-animates against the timer's wall-clock end (performance.now), running
 * its own rAF loop only while a timer is active, so the bar drains to exactly
 * zero the instant the effect ends - it never lingers a second past it. A row is
 * dropped the moment its remaining time hits zero.
 */
import { useState, useEffect } from 'react';
import type { AbilityTimer } from './GameCanvas';

interface AbilityCountdownBarProps {
  timers: AbilityTimer[];
  visible: boolean;
}

export function AbilityCountdownBar({ timers, visible }: AbilityCountdownBarProps) {
  const active = visible && timers.length > 0;
  // A frame counter to re-render each rAF while any timer runs (self-contained;
  // does not re-render the rest of the game).
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => { tick(n => (n + 1) & 0xffff); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  const now = performance.now();
  const live = timers.filter(tmr => tmr.endMs - now > 0);
  if (live.length === 0) return null;

  return (
    <div style={{ backgroundColor: 'rgba(0, 0, 0, 0.80)' }}>
      <div className="mx-auto max-w-4xl px-3 py-1 flex flex-col gap-1">
        {live.map(tmr => {
          const remainingMs = tmr.endMs - now;
          const frac = Math.max(0, Math.min(1, remainingMs / tmr.durationMs));
          const secsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
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
                      width: `${frac * 100}%`,
                      background: tmr.color,
                      boxShadow: `0 0 8px ${tmr.color}aa`,
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
