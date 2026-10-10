/**
 * The Specs panel's look: its fixed colours and the card treatments shared by
 * TopBarDetailsPanel and ModifierBreakdown, as plain values so the components
 * read like the markup they replaced.
 */
import { iconNodeOf, tint, type IconNode, type IconSource, type Layout } from '../kit/ui';

/** The panel's fixed palette (the DOM's inline hex colours). */
export const SPECS = {
  /** The pale green body copy on every card. */
  ink: 0xc8ffd8,
  /** "Nothing here" copy. */
  empty: 0x4a7a5a,
  mutator: 0xc084fc,
  amber: 0xffb347,
  danger: 0xff6b6b,
  capstone: 0xffd54a,
  objective: 0x34d399,
  objectiveBad: 0xf87171,
  /** The panel's near-opaque backdrop: rgba(0, 10, 5, 0.97). */
  backdrop: tint(0x000a05, 0.97),
} as const;

/** `rgba(255,255,255,0.04)`, the plain card fill. */
export const CARD_FILL = tint(0xffffff, 0.04);

/** A plain card, bordered at `${accent}33` unless a border colour is given. */
export function cardLayout(accent: number, border?: string, fill: string = CARD_FILL): Layout {
  return {
    backgroundColor: fill, borderColor: border ?? tint(accent, 0x33 / 255), borderWidth: 1,
    borderRadius: 8, padding: 16,
  };
}

/** The lit card: the accent at 0x0d fill and 0x55 border. */
export function cardHighLayout(accent: number): Layout {
  return cardLayout(accent, tint(accent, 0x55 / 255), tint(accent, 0x0d / 255));
}

const filledCache = new Map<string, IconNode>();

/**
 * A lucide icon drawn filled as well as stroked (the DOM's `fill: accent` on
 * the lives Heart). Cached per icon and colour so the Icon's texture effect
 * sees the same node on every render.
 */
export function filledIcon(icon: IconSource, color: number): IconNode {
  const node = iconNodeOf(icon);
  const key = `${JSON.stringify(node)}|${color}`;
  let filled = filledCache.get(key);
  if (!filled) {
    const fill = `#${color.toString(16).padStart(6, '0')}`;
    filled = node.map(([tag, attrs]) => [tag, { ...attrs, fill }] as [string, Record<string, string | number>]);
    filledCache.set(key, filled);
  }
  return filled;
}
