/**
 * A lucide icon with its shapes filled as well as stroked: the DOM's
 * `fill: accentColor` on the lives heart. The kit's Icon strokes only, but it
 * takes a raw icon node, so the fill goes onto the node's own elements.
 */
import type { LucideIcon } from "lucide-react";
import { iconNodeOf, type IconNode } from "../kit/icons";

// Per icon, per colour: the same node object back each render, so the Icon's
// texture effect does not re-run on every frame of the heart's pulse.
const cache = new WeakMap<LucideIcon, Map<number, IconNode>>();

export function filledIcon(icon: LucideIcon, color: number): IconNode {
  let byColor = cache.get(icon);
  if (!byColor) { byColor = new Map(); cache.set(icon, byColor); }
  let node = byColor.get(color);
  if (!node) {
    const fill = `#${color.toString(16).padStart(6, "0")}`;
    node = iconNodeOf(icon).map(([tag, attrs]) => [tag, { ...attrs, fill }] as [string, Record<string, string | number>]);
    byColor.set(color, node);
  }
  return node;
}
