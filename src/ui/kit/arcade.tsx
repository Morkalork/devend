/**
 * The game's loud button (index.css `.arcade-button-*`): Michroma, upper case,
 * wide tracking, a 2px border and a soft glow. The kit's Button is the plain
 * app button; this is the one the menus, the between-map screens and the
 * in-game modals are built around, kept in one place so they cannot drift
 * apart (they had three copies, each with a different subset of the look).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Graphics, TextStyleFontWeight } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { COLOR, RADIUS } from "../theme";
import { Icon, Label, Pressable, View, type Layout } from "./core";
import { tint } from "./style";
import { usePulse, useLoop } from "./motion";
import type { IconSource } from "./icons";
import { ARCADE, GOLD, GREY, arcadeInk, fitTextWidth, type ArcadeVariant } from "./arcadeStyle";

// ── Arcade button ──────────────────────────────────────────────────────────

export interface ArcadeButtonProps {
  /** The label (Michroma, upper-case, wide tracking); omit to pass children. */
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
  /** The first-time highlight: gold border and an expanding ping. */
  ring?: boolean;
  /** The strong primary glow of the recommended button. */
  glow?: boolean;
  /** The glow breathes. */
  pulse?: boolean;
  /** A light band sweeps across: the recommended action (`.shimmer`). */
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
 * `.arcade-button-*` (index.css): the menu screens' Michroma, upper-case,
 * 2px-bordered button. A `text` label too long for the button wraps onto a
 * second line, centred, as the DOM's did; it is measured against the button's
 * laid-out width, because a wrapping label in a centred row has no width of
 * its own to wrap to.
 */
export function ArcadeButton({
  text, icon, iconAfter, iconSize = 20, iconColor, textSize, weight = "600", children, variant = "primary", size = "md", onTap, disabled,
  ring, glow, pulse, shimmer, locked, column, layout, contentLayout, alpha = 1, label,
}: ArcadeButtonProps) {
  const m = ARCADE[size];
  const ink = arcadeInk(variant, locked);
  const fontSize = textSize ?? m.text;
  const fill = locked ? tint(GREY, 0.1)
    : variant === "primary" ? tint(COLOR.primary, 0.1)
    : variant === "danger" ? tint(COLOR.destructive, 0.1)
    : tint(COLOR.secondary, 0.5);
  const border = ring ? GOLD
    : locked ? GREY
    : variant === "primary" ? COLOR.primary
    : variant === "danger" ? COLOR.destructive
    : tint(COLOR.mutedForeground, 0.3);
  const box: Layout = {
    flexDirection: column ? "column" : "row", alignItems: "center", justifyContent: "center", gap: column ? 4 : 8,
    paddingTop: m.py, paddingBottom: m.py, paddingLeft: m.px, paddingRight: m.px,
    borderRadius: RADIUS.lg, borderWidth: 2, borderColor: border, backgroundColor: fill,
    overflow: shimmer ? "hidden" : undefined,
    ...(contentLayout ?? {}),
  };

  // The button's size, read back from layout (for the glow and the label).
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
    : fitTextWidth(text.toUpperCase(), { size: fontSize, font: "display", weight, letterSpacing: fontSize * 0.1 })),
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
      {/* Every primary/danger arcade button carries a soft glow (box-shadow),
          dimmed with the button when it is disabled. */}
      <View alpha={disabled ? 0.45 : 1} layout={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        {variant !== "secondary" && !ring && (
          <GlowRing width={outer.width} height={outer.height} color={variant === "danger" ? COLOR.destructive : locked ? GREY : COLOR.primary} strong={!!glow} pulse={!!pulse} />
        )}
        {ring && <PingRing />}
      </View>
      <Pressable onTap={onTap} disabled={disabled} label={label ?? text} layout={box}>
        {shimmer && <Shimmer />}
        {icon && <Icon icon={icon} size={iconSize} color={iconColor ?? ink} />}
        {text !== undefined && (wraps ? (
          <View layout={{ width: Math.max(0, room) }}>
            <Label text={text} size={fontSize} font="display" weight={weight} upper letterSpacing={fontSize * 0.1} color={ink} align="center" wrap />
          </View>
        ) : (
          <Label text={text} size={fontSize} font="display" weight={weight} upper letterSpacing={fontSize * 0.1} color={ink} />
        ))}
        {iconAfter && <Icon icon={iconAfter} size={iconSize} color={ink} />}
        {hasTail ? (
          <layoutContainer ref={tailRef} layout={{ flexDirection: "row", alignItems: "center", gap }} eventMode="passive">
            {children}
          </layoutContainer>
        ) : children}
      </Pressable>
    </layoutContainer>
  );
}

/**
 * A coloured box-shadow glow: thin rings just outside the button, fading out
 * with distance, so the edge is soft rather than one hard tinted box. `strong`
 * is the recommended button's wider, brighter glow. One drawing, sized to the
 * button; the breathing is the drawing's alpha, so it is never redrawn for it.
 */
function GlowRing({ width, height, color, strong, pulse }: { width: number; height: number; color: number; strong: boolean; pulse: boolean }) {
  const p = usePulse(2000, pulse);
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (width <= 0 || height <= 0) return;
    const steps = strong ? 9 : 5;
    const peak = strong ? 0.4 : 0.2;
    for (let k = 0; k < steps; k++) {
      const inset = 1 + 2 * k;
      g.roundRect(-inset, -inset, width + inset * 2, height + inset * 2, RADIUS.lg + inset)
        .stroke({ width: 2, color, alpha: peak * (1 - k / steps) ** 2 });
    }
  }, [width, height, color, strong]);
  return <pixiGraphics draw={draw} alpha={pulse ? 0.6 + 0.4 * p : 1} layout={false} />;
}

/** `.menu-highlight`: a gold ring that expands and fades every 1.6s, plus a steady soft halo. */
function PingRing() {
  const p = useLoop(1600);
  const k = p < 0.7 ? 1 - (1 - p / 0.7) ** 2 : 1;
  const spread = p < 0.7 ? 16 * k : 0;
  const alpha = p < 0.7 ? 0.7 * (1 - k) : 0;
  return (
    <>
      <View layout={{
        position: "absolute", left: -3, top: -3, right: -3, bottom: -3,
        borderRadius: RADIUS.lg + 3, borderWidth: 3, borderColor: tint(GOLD, 0.4),
      }} />
      <View layout={{
        position: "absolute", left: -spread, top: -spread, right: -spread, bottom: -spread,
        borderRadius: RADIUS.lg + spread, borderWidth: 2, borderColor: tint(GOLD, alpha),
      }} />
    </>
  );
}

/** `.shimmer`: a slanted light band crossing the button every 2.8s (it moves during the first 55%). */
function Shimmer() {
  const p = useLoop(2800);
  const k = Math.min(1, p / 0.55);
  const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    // Wide soft band, then a brighter core: the 30%-50%-70% gradient stops.
    g.poly([0, -10, 70, -10, 40, 90, -30, 90]).fill({ color: COLOR.white, alpha: 0.12 });
    g.poly([20, -10, 50, -10, 20, 90, -10, 90]).fill({ color: COLOR.white, alpha: 0.18 });
  }, []);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      {/* Percent of the button's width is unknown here, so it sweeps a fixed
          span that covers any menu button (max-w-xs, 320px). */}
      <pixiContainer x={-80 + eased * 420} layout={false}>
        <pixiGraphics draw={draw} layout={false} />
      </pixiContainer>
    </View>
  );
}

/** The arcade buttons' type, for custom button content: Michroma, upper case, tracking-widest (0.1em). */
export function ArcadeText({ text, color, size = 15 }: { text: string; color: number; size?: number }) {
  return <Label text={text} size={size} font="display" weight="600" upper letterSpacing={size * 0.1} color={color} />;
}
