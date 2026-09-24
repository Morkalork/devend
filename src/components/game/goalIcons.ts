/**
 * The goal row's icons: one glyph per kind, so two goals on a map never look
 * alike. Kept out of GoalChip.tsx so that file exports only its component.
 */
import {
  Diamond, Crosshair, Palette, Skull, Lock, Scissors, Timer, Hammer,
  PackageCheck, Zap, Waves, Target, BrickWall, Cuboid,
  type LucideIcon,
} from 'lucide-react';
import type { Goal } from '@/lib/goalTracker';
import type { SmashClassFilter } from '@/lib/destructibleClass';

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

/**
 * A smash clause draws its class, not its verb. A mixed map shows a shards row
 * and a monoliths row side by side, and with one hammer on both the player
 * had to read the labels to tell which was which: a run of small bricks for
 * the one-touch class, one solid block for the three-hit one. The hammer stays
 * for a clause that counts either.
 */
export const SMASH_ICONS: Record<SmashClassFilter, LucideIcon> = {
  any: Hammer,
  shards: BrickWall,
  monoliths: Cuboid,
};

export function goalIcon(goal: Pick<Goal, 'kind' | 'smashClass'>): LucideIcon {
  if (goal.kind === 'smashed') return SMASH_ICONS[goal.smashClass ?? 'any'];
  return ICONS[goal.kind as keyof typeof ICONS] ?? Diamond;
}
