/**
 * The arcade button (index.css `.arcade-button-primary` / `-secondary`) that
 * the end-of-map and end-of-run screens are built around: the display face,
 * upper case, wide tracking, a 2px border. The kit's Button is the plain app
 * button; this is the game's loud one.
 */
import type { IconSource, Layout } from "../kit/ui";
import { COLOR, Icon, Label, Pressable, RADIUS, tint } from "../kit/ui";

export interface ArcadeButtonProps {
  text: string;
  icon?: IconSource;
  /** The icon's own colour, when it differs from the text (a success tick). */
  iconColor?: number;
  variant?: "primary" | "secondary";
  onTap?: () => void;
  disabled?: boolean;
  /** Text size; the class default is 15px. */
  size?: number;
  iconSize?: number;
  /** Vertical padding; the class default is 0.85rem. */
  paddingY?: number;
  /** Which side the icon sits (the DOM put it after the text on some buttons). */
  iconAfter?: boolean;
  layout?: Layout;
  label?: string;
}

export function ArcadeButton({
  text, icon, iconColor, variant = "primary", onTap, disabled, size = 15, iconSize = 20, paddingY = 14, iconAfter = false, layout, label,
}: ArcadeButtonProps) {
  const primary = variant === "primary";
  const fg = primary ? COLOR.primary : COLOR.mutedForeground;
  const iconEl = icon ? <Icon icon={icon} size={iconSize} color={iconColor ?? fg} /> : null;
  return (
    <Pressable
      onTap={onTap}
      disabled={disabled}
      label={label ?? text}
      layout={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        paddingTop: paddingY, paddingBottom: paddingY, paddingLeft: 27, paddingRight: 27,
        borderRadius: RADIUS.lg, borderWidth: 2,
        borderColor: primary ? COLOR.primary : tint(COLOR.mutedForeground, 0.3),
        backgroundColor: primary ? tint(COLOR.primary, 0.1) : tint(COLOR.secondary, 0.5),
        ...(layout ?? {}),
      }}
    >
      {!iconAfter && iconEl}
      <Label text={text} size={size} color={fg} font="display" weight="600" upper letterSpacing={size * 0.1} />
      {iconAfter && iconEl}
    </Pressable>
  );
}
