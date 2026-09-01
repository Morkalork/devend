/**
 * AbilityIcon — the glyph for an effect kind, wherever one is drawn.
 * lucide covers most; "explosion" (Shockwave) and the "rushing clock" (Fence
 * Overclock, a clock with speed lines) are small inline SVGs in the same
 * stroke style.
 *
 * ONE map, exported, because there were two. The ability bar carried its own
 * and this file carried a switch, and the switch had quietly fallen four kinds
 * behind - magnet, slowArea, descope and rubberBand all resolved to null, so
 * the fire animation drew nothing for them and nobody noticed, because the bar
 * beside it was reading a different list. Typed as a Record over AbilityKind so
 * the next new ability cannot be added without one.
 */
import {
  Snowflake, Snail, RefreshCw, Shield, Eraser, Magnet, Hourglass, Scissors, Spline, Sparkles,
} from 'lucide-react';
import type { AbilityKind } from '@/lib/abilities';

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

/** Every effect kind's glyph. Exhaustive by type: a new kind will not compile
 *  until it is given one. Private, so this module exports components only and
 *  callers all go through AbilityIcon rather than growing a second lookup. */
const ICON_BY_KIND: Record<AbilityKind, (p: { className?: string }) => JSX.Element> = {
  freeze: ({ className }) => <Snowflake className={className} />,
  slow: ({ className }) => <Snail className={className} />,
  slowArea: ({ className }) => <Hourglass className={className} />,
  descope: ({ className }) => <Scissors className={className} />,
  clearFences: ({ className }) => <Eraser className={className} />,
  magnet: ({ className }) => <Magnet className={className} />,
  shockwave: ExplosionIcon,
  rubberBand: ({ className }) => <Spline className={className} />,
  fenceRush: RushClockIcon,
  fenceShield: ({ className }) => <Shield className={className} />,
};

/** The glyph for an effect kind, wherever one is drawn. Falls back to a generic
 *  sparkle rather than nothing: a kind this does not know is a data problem,
 *  and an empty space says less about it than a placeholder does. */
export function AbilityIcon({ kind, className }: { kind: string; className?: string }) {
  const Glyph = ICON_BY_KIND[kind as AbilityKind] ?? Sparkles;
  return <Glyph className={className} />;
}
