/**
 * Upgrade icon registry: the glyph each upgrade PACKAGE (a family of tiers
 * sharing a name) wears in its type square on the store ticket, in the detail
 * modal and in the Specs panel.
 *
 * THE RULES (pinned by src/test/upgradeIcons.test.ts; the Admin gallery's
 * "UpgradeIcons" sheet shows every package beside its glyph):
 *
 *  1. ONE GLYPH PER PACKAGE, and no two packages share one. The glyph says
 *     WHICH upgrade this is; the tier is already said twice beside it (the
 *     colour, the priority glyph), so the tiers of a package share its glyph.
 *     It is set on the package's first tier in upgrades.yml (`icon`); higher
 *     tiers inherit by name.
 *  2. UNIQUE ACROSS THE SHELF, not just across upgrades: an ability ticket's
 *     square shows its effect kind's glyph (bottomModel.ts, abilityGlyph) and
 *     a tier's priority glyph sits two words to the right, so neither may be
 *     an upgrade's glyph either. Snowflake is the freeze ability's, shield the
 *     fence shield's, flame the Wizard priority's.
 *  3. THE GLYPH SHOWS WHAT THE UPGRADE DOES on the board, not the pun in its
 *     name: a slower fastest ball is a gauge, ground captured at map start is
 *     a plot of land. The name is allowed to win only when it IS the picture
 *     (Ghost Protocol, Chaos Engineering).
 *  4. A FENCE-TYPE GRANT shows the fence, not the mechanic: the thing the
 *     player gets is a slot on the fence bar, and the glyph is how they will
 *     know it there. (The bar shows the fence's colour and name; its glyph
 *     is the natural next step, and it must then be this one.)
 *  5. PACKAGES IN A LINE share a motif and differ at a glance: Multithreading
 *     is a split, Ultrathreading is layers; Feature Freeze is the tap,
 *     Cascade Freeze the cloud of snow it sets off.
 *  6. LUCIDE ONLY, LEGIBLE AT 14 PX: one object, no lettering, no inner
 *     detail finer than a stroke. The key is lucide's own kebab-case name, so
 *     a reader can look it up.
 *  7. THE COLOUR IS THE SCHOOL'S, never the glyph's own. The type square and
 *     the ticket's stripe take the package's first tag (shopModel.schoolColor:
 *     lock green, freeze cyan, bank yellow, tempo orange, risk red, safety
 *     blue), so a shelf sorts by school at a glance; the tier keeps its colour
 *     on the priority glyph and the tier word. A glyph is a shape only.
 *
 * To add a package: pick a glyph by the rules, import it here under its
 * lucide name, and set `icon` on the package's first tier. The test fails on
 * a missing, unregistered or shared key.
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
  Bug,
  CloudSnow,
  CalendarClock,
  Banknote,
  Gem,
  BookOpen,
  Receipt,
  Vault,
  Rocket,
  Infinity as InfinityIcon,
  Dices,
  Megaphone,
  Timer,
  ShoppingCart,
  ClipboardCheck,
  Power,
  Orbit,
  Gift,
  Crown,
  LifeBuoy,
  Hammer,
  Ghost,
  Spline,
  Pause,
  Grab,
  Bomb,
  Ruler,
  Gauge,
  Zap,
  FlameKindling,
  ThermometerSnowflake,
  ArrowDownToDot,
  Binoculars,
  LandPlot,
  Flag,
  Coins,
  Fence,
  LockKeyhole,
  Refrigerator,
  ShieldCheck,
  RotateCcw,
  MousePointerClick,
  Sunrise,
  type LucideIcon,
} from 'lucide-react';
import { UpgradeConfig } from '@/types/upgrade';

/** Maps the `icon` string used in upgrades.yml to a lucide icon component. */
export const UPGRADE_ICONS: Record<string, LucideIcon> = {
  clock: Clock,
  'memory-stick': MemoryStick,
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
  bug: Bug,
  'cloud-snow': CloudSnow,
  'calendar-clock': CalendarClock,
  banknote: Banknote,
  gem: Gem,
  'book-open': BookOpen,
  receipt: Receipt,
  vault: Vault,
  rocket: Rocket,
  infinity: InfinityIcon,
  dices: Dices,
  megaphone: Megaphone,
  timer: Timer,
  'shopping-cart': ShoppingCart,
  'clipboard-check': ClipboardCheck,
  power: Power,
  orbit: Orbit,
  ghost: Ghost,
  gift: Gift,
  crown: Crown,
  'life-buoy': LifeBuoy,
  hammer: Hammer,
  spline: Spline,
  pause: Pause,
  grab: Grab,
  bomb: Bomb,
  ruler: Ruler,
  gauge: Gauge,
  zap: Zap,
  'flame-kindling': FlameKindling,
  'thermometer-snowflake': ThermometerSnowflake,
  'arrow-down-to-dot': ArrowDownToDot,
  binoculars: Binoculars,
  'land-plot': LandPlot,
  flag: Flag,
  coins: Coins,
  fence: Fence,
  'lock-keyhole': LockKeyhole,
  refrigerator: Refrigerator,
  'shield-check': ShieldCheck,
  'rotate-ccw': RotateCcw,
  'mouse-pointer-click': MousePointerClick,
  sunrise: Sunrise,
};

/** The icon key a package carries (on whichever tier declares it). */
export function upgradeIconKey(upgrade: UpgradeConfig, family: UpgradeConfig[]): string | undefined {
  return upgrade.icon ?? family.find(u => u.name === upgrade.name && u.icon)?.icon;
}

/**
 * Resolve the lucide icon for an upgrade. Icons live on the first tier of each
 * family only, so higher tiers inherit the icon from a family sibling (matched
 * by shared `name`) found within `family`. Returns null if no icon is defined.
 */
export function getUpgradeIcon(
  upgrade: UpgradeConfig,
  family: UpgradeConfig[],
): LucideIcon | null {
  const key = upgradeIconKey(upgrade, family);
  return key ? UPGRADE_ICONS[key] ?? null : null;
}
