/**
 * BossBanner (issue #56) — the persistent boss nameplate. Sits over the top of
 * the board on a boss map: the boss name, the deadline counting down (red and
 * pulsing in the final seconds), and a health bar of HP pips that empty as the
 * boss is trapped. Pure presentation; all state is threaded from GameScreen.
 */
import { Skull } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BossBannerProps {
  name: string;
  timeLimit: number | null;
  activeSeconds: number;
  hp: number;
  maxHp: number;
  defeated: boolean;
  accentColor?: string;
}

export function BossBanner({ name, timeLimit, activeSeconds, hp, maxHp, defeated, accentColor = '#ff2d55' }: BossBannerProps) {
  const { t } = useTranslation();
  const remaining = timeLimit != null ? Math.max(0, Math.ceil(timeLimit - activeSeconds)) : null;
  const urgent = remaining != null && remaining <= 10;

  return (
    <div className="pointer-events-none absolute left-1/2 top-[70px] z-30 flex -translate-x-1/2 flex-col items-center gap-1">
      <div
        className="flex items-center gap-2 rounded-md px-3 py-1"
        style={{
          background: 'rgba(28, 0, 6, 0.82)',
          border: `1px solid ${accentColor}aa`,
          boxShadow: `0 0 18px ${accentColor}55`,
        }}
      >
        <Skull className="h-4 w-4 flex-shrink-0" style={{ color: accentColor }} />
        <span
          className="font-display text-sm font-bold uppercase tracking-wider"
          style={{ color: accentColor, textShadow: `0 0 10px ${accentColor}` }}
        >
          {name}
        </span>
        {remaining != null && (
          <span
            className={`font-display text-sm font-bold tabular-nums${urgent ? ' animate-pulse' : ''}`}
            style={{ color: urgent ? '#ff5a5a' : '#ffd0d8', textShadow: urgent ? '0 0 10px #ff5a5a' : 'none' }}
          >
            {remaining}s
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {defeated ? (
          <span
            className="font-display text-xs font-bold uppercase tracking-wider"
            style={{ color: '#4ade80', textShadow: '0 0 8px #4ade80' }}
          >
            {t('boss.defeated')}
          </span>
        ) : (
          Array.from({ length: Math.max(0, maxHp) }).map((_, i) => (
            <span
              key={i}
              className="h-2 w-4 rounded-sm transition-all duration-200"
              style={{
                background: i < hp ? accentColor : 'rgba(255,255,255,0.15)',
                boxShadow: i < hp ? `0 0 6px ${accentColor}` : 'none',
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
