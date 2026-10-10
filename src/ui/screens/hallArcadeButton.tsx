/**
 * The DOM's `arcade-button-primary` / `arcade-button-secondary` (index.css):
 * the Michroma, upper-case, 2px-bordered button the meta screens use for Back,
 * Continue and Buy. Shared by the Performance Review, certificate store and
 * loadout gallery ports; it belongs in the kit once a second area needs it.
 */
import type { ReactNode } from "react";
import { COLOR, Icon, Label, Pressable, RADIUS, tint, type IconSource, type Layout } from "../kit/ui";

interface ArcadeButtonProps {
  text: string;
  /** An icon before the text. */
  icon?: IconSource;
  /** An icon after the text (the store's Buy chevron). */
  iconAfter?: IconSource;
  iconSize?: number;
  variant?: "primary" | "secondary";
  /** `arcade-button-sm`. */
  small?: boolean;
  /** Overrides the size's own text size (a custom `text-sm`). */
  textSize?: number;
  onTap?: () => void;
  disabled?: boolean;
  layout?: Layout;
  children?: ReactNode;
}

export function ArcadeButton({
  text, icon, iconAfter, iconSize = 20, variant = "secondary", small = false, textSize, onTap, disabled, layout,
}: ArcadeButtonProps) {
  const primary = variant === "primary";
  const fg = primary ? COLOR.primary : COLOR.mutedForeground;
  const size = textSize ?? (small ? 11.5 : 15);
  return (
    <Pressable
      onTap={onTap}
      disabled={disabled}
      label={text}
      layout={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        paddingLeft: small ? 23 : 27, paddingRight: small ? 23 : 27, paddingTop: small ? 11.5 : 13.5, paddingBottom: small ? 11.5 : 13.5,
        borderRadius: RADIUS.lg, borderWidth: 2,
        backgroundColor: primary ? tint(COLOR.primary, 0.1) : tint(COLOR.secondary, 0.5),
        borderColor: primary ? COLOR.primary : tint(COLOR.mutedForeground, 0.3),
        ...(layout ?? {}),
      }}
    >
      {icon && <Icon icon={icon} size={iconSize} color={fg} />}
      <Label text={text} size={size} font="display" weight="600" upper letterSpacing={size * 0.1} color={fg} />
      {iconAfter && <Icon icon={iconAfter} size={iconSize} color={fg} />}
    </Pressable>
  );
}
