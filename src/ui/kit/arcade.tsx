/**
 * The game's main button: the menus, the between-map screens and the in-game
 * modals are built around it. UI redo (UI_REDO_PLAN.md, direction B): a flat
 * fill, no glow, sentence case. The primary button is the one solid thing on
 * a screen (the next action); secondary is a dark panel with an edge. It used
 * to be upper case with wide tracking, a 2px outline and a glow on every
 * primary button, which left nothing more important than anything else.
 * The kit's Button is the plain
 * app button; this is the one the menus, the between-map screens and the
 * in-game modals are built around, kept in one place so they cannot drift
 * apart (they had three copies, each with a different subset of the look).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TextStyleFontWeight } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { COLOR, RADIUS, ROLE } from "../theme";
import { Icon, Label, Pressable, View, type Layout } from "./core";
import { tint } from "./style";
import type { IconSource } from "./icons";
import { ARCADE, ARCADE_TRACKING, GOLD, arcadeInk, fitTextWidth, type ArcadeVariant } from "./arcadeStyle";

// ── Arcade button ──────────────────────────────────────────────────────────

export interface ArcadeButtonProps {
  /** The label (display face, sentence case); omit to pass children. */
  text?: string;
  /** An icon before the label. */
  icon?: IconSource;
  /** An icon after the label (the store's Buy chevron). */
  iconAfter?: IconSource;
  /** Both icons' size (the DOM's `w-5 h-5` unless said otherwise). */
  iconSize?: number;
  /** The leading icon's own colour, when it differs from the label (a success tick). */
  iconColor?: number;
  /** Overrides the size's own text size (a custom `text-sm`). */
  textSize?: number;
  /** The label's weight (the class's 600 unless said otherwise). */
  weight?: TextStyleFontWeight;
  children?: ReactNode;
  variant?: ArcadeVariant;
  size?: "sm" | "md";
  onTap?: () => void;
  disabled?: boolean;
  /** The first-time highlight: a gold border. */
  ring?: boolean;
  /**
   * The recommended action. Drawn as the primary fill: in the redo the
   * recommended button is the filled one, so a secondary button marked
   * `glow` or `shimmer` is promoted to primary rather than given a halo.
   */
  glow?: boolean;
  /** Accepted for the callers that set it; nothing on these screens breathes now. */
  pulse?: boolean;
  /** As `glow`: the recommended action. */
  shimmer?: boolean;
  /** Tappable but greyed and dimmed (a feature not yet unlocked). */
  locked?: boolean;
  /** Lay the content out in a column (a label with a second line under it). */
  column?: boolean;
  /** Where the button sits (margins, flex, minWidth): the outer box. */
  layout?: Layout;
  /** Overrides the button's own box (a custom padding). */
  contentLayout?: Layout;
  /** Extra dimming (the admin button's `opacity-70`). */
  alpha?: number;
  label?: string;
}

/**
 * A `text` label too long for the button wraps onto a second line, centred;
 * it is measured against the button's laid-out width, because a wrapping label
 * in a centred row has no width of its own to wrap to.
 */
export function ArcadeButton({
  text, icon, iconAfter, iconSize = 20, iconColor, textSize, weight = "600", children, variant: asked = "primary", size = "md", onTap, disabled,
  ring, glow, shimmer, locked, column, layout, contentLayout, alpha = 1, label,
}: ArcadeButtonProps) {
  const variant: ArcadeVariant = asked === "secondary" && (glow || shimmer) ? "primary" : asked;
  const m = ARCADE[size];
  const ink = arcadeInk(variant, locked);
  const fontSize = textSize ?? m.text;
  const fill = locked ? ROLE.raised
    : variant === "primary" ? COLOR.primary
    : variant === "danger" ? tint(ROLE.cost, 0.08)
    : ROLE.raised;
  // The border keeps the box the size the 2px outline made it, so no layout
  // moved when the outline went; it is the fill colour unless it says
  // something (the gold first-time ring, a danger edge, a secondary edge).
  const border = ring ? GOLD
    : locked ? ROLE.edge
    : variant === "primary" ? COLOR.primary
    : variant === "danger" ? tint(ROLE.cost, 0.6)
    : ROLE.edge;
  const box: Layout = {
    flexDirection: column ? "column" : "row", alignItems: "center", justifyContent: "center", gap: column ? 4 : 8,
    paddingTop: m.py, paddingBottom: m.py, paddingLeft: m.px, paddingRight: m.px,
    borderRadius: RADIUS.sm, borderWidth: 2, borderColor: border, backgroundColor: fill,
    ...(contentLayout ?? {}),
  };

  // The button's size, read back from layout (for the label's wrap width).
  const outerRef = useRef<LayoutContainer | null>(null);
  const [outer, setOuter] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = outerRef.current;
    if (!node) return;
    const onLayout = (l: { computedLayout: { width: number; height: number } }) => {
      const width = Math.round(l.computedLayout.width), height = Math.round(l.computedLayout.height);
      setOuter(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    node.on("layout", onLayout);
    const done = node.layout?.computedLayout;
    if (done && done.width > 0) onLayout({ computedLayout: done });
    return () => { node.off("layout", onLayout); };
  }, []);
  const outerWidth = outer.width;
  // What follows the label in a row (a badge, a chip, a check) takes room too.
  const tailRef = useRef<LayoutContainer | null>(null);
  const [tailWidth, setTailWidth] = useState(0);
  const hasTail = !column && children !== undefined && children !== null && children !== false;
  useEffect(() => {
    const node = tailRef.current;
    if (!node) { setTailWidth(0); return; }
    const onLayout = (l: { computedLayout: { width: number } }) => setTailWidth(Math.round(l.computedLayout.width));
    node.on("layout", onLayout);
    const done = node.layout?.computedLayout;
    if (done) onLayout({ computedLayout: done });
    return () => { node.off("layout", onLayout); };
  }, [hasTail]);
  const textWidth = useMemo(() => (text === undefined ? 0
    : fitTextWidth(text, { size: fontSize, font: "display", weight, letterSpacing: fontSize * ARCADE_TRACKING })),
  [text, fontSize, weight]);
  const pad = (n: unknown, fallback: number) => (typeof n === "number" ? n : fallback);
  const gap = pad(box.gap, 8);
  const room = outerWidth - 4 - pad(box.paddingLeft, m.px) - pad(box.paddingRight, m.px)
    - (icon ? iconSize + gap : 0) - (iconAfter ? iconSize + gap : 0) - (hasTail && tailWidth > 0 ? tailWidth + gap : 0);
  // A couple of px of slack: a button sized by its own label measures the same
  // label, and rounding must not tip it into wrapping.
  const wraps = text !== undefined && outerWidth > 0 && textWidth > room + 2;

  return (
    // A raw container for the ref; passive like a View, so only the Pressable
    // inside it is a touch target.
    <layoutContainer ref={outerRef} layout={layout ?? {}} alpha={(locked ? 0.5 : 1) * alpha} eventMode="passive">
      <Pressable onTap={onTap} disabled={disabled} label={label ?? text} layout={box}>
        {icon && <Icon icon={icon} size={iconSize} color={iconColor ?? ink} />}
        {text !== undefined && (wraps ? (
          <View layout={{ width: Math.max(0, room) }}>
            <Label text={text} size={fontSize} font="display" weight={weight} letterSpacing={fontSize * ARCADE_TRACKING} color={ink} align="center" wrap />
          </View>
        ) : (
          <Label text={text} size={fontSize} font="display" weight={weight} letterSpacing={fontSize * ARCADE_TRACKING} color={ink} />
        ))}
        {iconAfter && text !== undefined && <Icon icon={iconAfter} size={iconSize} color={ink} />}
        {hasTail ? (
          <layoutContainer ref={tailRef} layout={{ flexDirection: "row", alignItems: "center", gap }} eventMode="passive">
            {children}
          </layoutContainer>
        ) : children}
        {/* With custom content in place of a label, the trailing icon trails that. */}
        {iconAfter && text === undefined && <Icon icon={iconAfter} size={iconSize} color={ink} />}
      </Pressable>
    </layoutContainer>
  );
}

/** The arcade buttons' type, for custom button content: the display face, sentence case. */
export function ArcadeText({ text, color, size = 15 }: { text: string; color: number; size?: number }) {
  return <Label text={text} size={size} font="display" weight="600" letterSpacing={size * ARCADE_TRACKING} color={color} />;
}
