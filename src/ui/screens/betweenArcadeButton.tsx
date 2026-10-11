/**
 * The arcade button (index.css `.arcade-button-primary` / `-secondary`) that
 * the between-map screens are built around: the display face, upper case,
 * tracking-widest, a 2px border. The kit's Button is the plain app button;
 * this is the game's loud one. One copy for the end-of-map overlay, the
 * end-of-run screen, the revive prompt, the shop and the drafts, so they
 * cannot drift apart the way their DOM markup did.
 */
import type { ReactNode } from "react";
import type { IconSource, Layout } from "../kit/ui";
import { COLOR, Icon, Label, Pressable, RADIUS, tint } from "../kit/ui";

export interface ArcadeButtonProps {
  text?: string;
  icon?: IconSource;
  /** The icon's own colour, when it differs from the text (a success tick). */
  iconColor?: number;
  /** An icon after the text (the shop's and the overlay's trailing arrow). */
  trailingIcon?: IconSource;
  variant?: "primary" | "secondary";
  onTap?: () => void;
  disabled?: boolean;
  /** Text size; the class default is 15px (0.9375rem). */
  size?: number;
  iconSize?: number;
  /** Vertical padding; the class default is 0.85rem. */
  paddingY?: number;
  /** Extra content after the text (the shop's cost chip). */
  children?: ReactNode;
  layout?: Layout;
  /** The press target's name; defaults to the text. */
  label?: string;
}

export function ArcadeButton({
  text, icon, iconColor, trailingIcon, variant = "primary", onTap, disabled, size = 15, iconSize = 20, paddingY = 13.6,
  children, layout, label,
}: ArcadeButtonProps) {
  const primary = variant === "primary";
  // Primary ink on a primary tint; muted ink on a muted one.
  const ink = primary ? COLOR.primary : COLOR.mutedForeground;
  return (
    <Pressable
      onTap={onTap}
      disabled={disabled}
      label={label ?? text}
      pressedAlpha={0.8}
      layout={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        paddingTop: paddingY, paddingBottom: paddingY, paddingLeft: 27.2, paddingRight: 27.2,
        borderRadius: RADIUS.lg, borderWidth: 2,
        borderColor: primary ? COLOR.primary : tint(COLOR.mutedForeground, 0.3),
        backgroundColor: primary ? tint(COLOR.primary, 0.1) : tint(COLOR.secondary, 0.5),
        ...(layout ?? {}),
      }}
    >
      {icon && <Icon icon={icon} size={iconSize} color={iconColor ?? ink} />}
      {text !== undefined && <ArcadeText text={text} color={ink} size={size} />}
      {children}
      {trailingIcon && <Icon icon={trailingIcon} size={iconSize} color={ink} />}
    </Pressable>
  );
}

/** The arcade buttons' type: Michroma, uppercase, tracking-widest (0.1em). */
export function ArcadeText({ text, color, size = 15 }: { text: string; color: number; size?: number }) {
  return <Label text={text} size={size} font="display" weight="600" upper letterSpacing={size * 0.1} color={color} />;
}
