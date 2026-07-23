/**
 * AbilityIcon — the glyph shown when an ability fires (#38), by effect kind.
 * lucide covers most; "explosion" (Shockwave) and the "rushing clock" (Fence
 * Overclock, a clock with speed lines) are small inline SVGs in the same
 * stroke style.
 */
import { Snowflake, Snail, RefreshCw, Shield } from 'lucide-react';

const SVG_BASE = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** An 8-spike starburst = explosion. */
function ExplosionIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_BASE} className={className}>
      <path d="M12 2 L13.5 8.3 L19.1 4.9 L15.7 10.5 L22 12 L15.7 13.5 L19.1 19.1 L13.5 15.7 L12 22 L10.5 15.7 L4.9 19.1 L8.3 13.5 L2 12 L8.3 10.5 L4.9 4.9 L10.5 8.3 Z" />
    </svg>
  );
}

/** A clock shifted right with three speed lines to its left (rushing clock). */
function RushClockIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_BASE} className={className}>
      <circle cx="15" cy="12" r="6.5" />
      <path d="M15 8.5 L15 12 L17.5 13.5" />
      <line x1="2" y1="8" x2="6" y2="8" />
      <line x1="1" y1="12" x2="6" y2="12" />
      <line x1="2" y1="16" x2="6" y2="16" />
    </svg>
  );
}

/** Resolve a fired ability's icon by its effect kind (null for the unknown). */
export function AbilityIcon({ kind, className }: { kind: string; className?: string }) {
  switch (kind) {
    case 'freeze': return <Snowflake className={className} />;
    case 'slow': return <Snail className={className} />;
    case 'clearFences': return <RefreshCw className={className} />;
    case 'fenceShield': return <Shield className={className} />;
    case 'shockwave': return <ExplosionIcon className={className} />;
    case 'fenceRush': return <RushClockIcon className={className} />;
    default: return null;
  }
}
