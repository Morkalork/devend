/**
 * AbilityIcon - the glyph for an effect kind, wherever one is drawn (canvas
 * port of components/game/AbilityIcon.tsx). lucide covers most; "explosion"
 * (Shockwave) and the "rushing clock" (Fence Overclock) are small SVG node
 * lists in the same stroke style. The one map lives in bottomModel.ts
 * (abilityGlyph), typed over every AbilityKind so a new kind cannot ship
 * without a glyph; callers all go through this component.
 */
import { Icon, COLOR, type Layout } from "../kit/ui";
import { abilityGlyph } from "./bottomModel";

interface Props {
  kind: string;
  /** Edge length in px (the DOM's `w-4 h-4` is 16). */
  size?: number;
  color?: number;
  layout?: Layout;
}

export function AbilityIcon({ kind, size = 16, color = COLOR.foreground, layout }: Props) {
  return <Icon icon={abilityGlyph(kind)} size={size} color={color} layout={layout} />;
}
