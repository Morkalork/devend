/**
 * Upgrade icon registry.
 *
 * Each upgrade family carries a single icon, defined on its first tier in
 * upgrades.yml (via the `icon` field). Higher tiers omit it and inherit the
 * family's icon by shared `name`. Icons are plain lucide-react glyphs to match
 * the rest of the game's UI.
 */
import {
  Clock,
  MemoryStick,
  FastForward,
  Flame,
  Split,
  Layers,
  Trash2,
  Recycle,
  Heart,
  TrendingUp,
  PiggyBank,
  SlidersHorizontal,
  PackagePlus,
  Building2,
  GraduationCap,
  CreditCard,
  Shield,
  Route,
  Snowflake,
  CloudSnow,
  CalendarClock,
  Banknote,
  Gem,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { UpgradeConfig } from '@/types/upgrade';

/** Maps the `icon` string used in upgrades.yml to a lucide icon component. */
const UPGRADE_ICONS: Record<string, LucideIcon> = {
  clock: Clock,
  memory: MemoryStick,
  'fast-forward': FastForward,
  flame: Flame,
  split: Split,
  layers: Layers,
  trash: Trash2,
  recycle: Recycle,
  heart: Heart,
  'trending-up': TrendingUp,
  'piggy-bank': PiggyBank,
  sliders: SlidersHorizontal,
  'package-plus': PackagePlus,
  building: Building2,
  'graduation-cap': GraduationCap,
  'credit-card': CreditCard,
  shield: Shield,
  route: Route,
  snowflake: Snowflake,
  'cloud-snow': CloudSnow,
  'calendar-clock': CalendarClock,
  banknote: Banknote,
  gem: Gem,
  'book-open': BookOpen,
};

/**
 * Resolve the lucide icon for an upgrade. Icons live on the first tier of each
 * family only, so higher tiers inherit the icon from a family sibling (matched
 * by shared `name`) found within `family`. Returns null if no icon is defined.
 */
export function getUpgradeIcon(
  upgrade: UpgradeConfig,
  family: UpgradeConfig[],
): LucideIcon | null {
  const key = upgrade.icon ?? family.find(u => u.name === upgrade.name && u.icon)?.icon;
  return key ? UPGRADE_ICONS[key] ?? null : null;
}
