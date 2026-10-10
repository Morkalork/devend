/**
 * The canvas interface's building blocks (CANVAS_UI_PLAN.md section 3).
 *
 * Every screen is made of these, so a rule about how the interface looks or
 * behaves lives here once: the type scale, how a press feels, how long a hold
 * takes, how a modal is dismissed. They are thin on purpose - a View is a Yoga
 * flexbox box with a background, a Label is a text run - so a component moved
 * off the DOM reads like the markup it replaced.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Texture, TextStyleFontWeight } from "pixi.js";
import type { LayoutStyles } from "@pixi/layout";
import { COLOR, RADIUS, TEXT, type FontRole } from "../theme";
import { RESOLUTION, textStyle, tint, truncateToWidth } from "./style";
import { iconTexture, type IconSource } from "./icons";
import { usePress, type PressHandlers } from "./press";
import "../elements";
import type { LayoutContainer } from "@pixi/layout/components";

export type Layout = LayoutStyles;

// ── View ───────────────────────────────────────────────────────────────────

export interface ViewProps {
  layout?: Layout;
  children?: ReactNode;
  alpha?: number;
  visible?: boolean;
  /** Draw order among siblings (higher on top). */
  zIndex?: number;
  label?: string;
}

/** A flexbox box: Tailwind's `div`, with backgroundColor, borderColor/Width, borderRadius. */
export function View({ layout, children, alpha, visible, zIndex, label }: ViewProps) {
  return (
    // Passive: a View is never a touch target itself (LayoutContainer defaults
    // to "static", and its background then counts as a hit), so a tinted
    // overlay over the board lets touches through to it. Its Pressable
    // children are still hit-tested.
    <layoutContainer layout={layout ?? {}} alpha={alpha ?? 1} visible={visible ?? true} zIndex={zIndex ?? 0} label={label} eventMode="passive">
      {children}
    </layoutContainer>
  );
}

// ── Label ──────────────────────────────────────────────────────────────────

export interface LabelProps {
  text: string;
  size?: number;
  color?: number;
  font?: FontRole;
  weight?: TextStyleFontWeight;
  /** Wrap at the box's width instead of running on one line. */
  wrap?: boolean;
  /**
   * One line, cut to the box's width with an ellipsis (Tailwind's `truncate`).
   * Like `wrap`, the label fills its parent's width: give it a column or a
   * `flex: 1` box in a row.
   */
  truncate?: boolean;
  align?: "left" | "center" | "right";
  alpha?: number;
  letterSpacing?: number;
  /** Upper-case the string (Tailwind's `uppercase`). */
  upper?: boolean;
  lineHeight?: number;
  layout?: Layout;
  /** A soft glow in the text's colour, like the DOM's text-shadow. */
  glow?: number;
}

/**
 * A run of text. A wrapping label fills its parent's width and wraps to it.
 *
 * Wrapping is measured in two steps, because Yoga sizes a text leaf from the
 * text's own bounds: unwrapped, a paragraph is one very long line, so its box
 * would be one line tall and the wrapped text scaled down into it. So the box
 * is laid out first, its width read back (`onLayout`), and the text wrapped to
 * that width, which gives the leaf its real, multi-line height.
 */
export function Label(p: LabelProps) {
  const fitted = !!(p.wrap || p.truncate);
  const [wrapWidth, setWrapWidth] = useState(0);
  const style = useMemo(() => {
    const st = textStyle(p);
    if (p.wrap) st.wordWrapWidth = wrapWidth > 0 ? wrapWidth : 4000;
    return st;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.size, p.color, p.font, p.weight, p.wrap, p.align, p.letterSpacing, p.lineHeight, p.glow, wrapWidth]);
  const text = p.upper ? p.text.toUpperCase() : p.text;
  // The box's width, read back each time Yoga lays it out ("layout" event).
  const boxRef = useRef<LayoutContainer | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onLayout = (l: { computedLayout: { width: number } }) => {
      const w = Math.floor(l.computedLayout.width);
      setWrapWidth(prev => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    box.on("layout", onLayout);
    // The first layout may already have run before this effect attached.
    const done = box.layout?.computedLayout;
    if (done && done.width > 0) onLayout({ computedLayout: done });
    return () => { box.off("layout", onLayout); };
  }, [fitted]);
  const shown = useMemo(
    () => (p.truncate && !p.wrap && wrapWidth > 0 ? truncateToWidth(text, style, wrapWidth) : text),
    [p.truncate, p.wrap, text, style, wrapWidth]);
  if (!fitted) {
    return (
      <uiText text={text} style={style} resolution={RESOLUTION} alpha={p.alpha ?? 1} layout={p.layout ?? true} />
    );
  }
  return (
    // No percentage width: Yoga resolves `100%` against a parent that is still
    // being sized by flex as the parent's indefinite width, which wraps a title
    // into a sliver. A column's default stretch gives the full width instead;
    // inside a row, give the label (or its box) `flex: 1`.
    <layoutContainer ref={boxRef} layout={{ alignSelf: "stretch", ...(p.layout ?? {}) }} alpha={p.alpha ?? 1}>
      {wrapWidth > 0 && (
        // An explicit width, because @pixi/layout resets a wrapping text's
        // wrap width to its box's width on every pass, and an intrinsic box is
        // the text's own previous bounds: the wrap would ratchet narrower.
        <uiText text={shown} style={style} resolution={RESOLUTION}
          // Pixi centres or right-aligns lines against the longest line; the
          // block itself is placed in the box the same way.
          layout={{ width: wrapWidth, objectFit: "none",
            objectPosition: p.align === "center" ? "top center" : p.align === "right" ? "top right" : "top left" }} />
      )}
    </layoutContainer>
  );
}

// ── Icon ───────────────────────────────────────────────────────────────────

export interface IconProps {
  icon: IconSource;
  size?: number;
  color?: number;
  strokeWidth?: number;
  alpha?: number;
  layout?: Layout;
}

/** A lucide icon (the same set the DOM interface used). */
export function Icon({ icon, size = 16, color = COLOR.foreground, strokeWidth = 2, alpha = 1, layout }: IconProps) {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let live = true;
    iconTexture(icon, color, size, strokeWidth).then(t => { if (live) setTexture(t); });
    return () => { live = false; };
  }, [icon, color, size, strokeWidth]);
  return (
    <layoutContainer layout={{ width: size, height: size, flexShrink: 0, ...(layout ?? {}) }} alpha={alpha}>
      {texture && <pixiSprite texture={texture} width={size} height={size} layout={false} />}
    </layoutContainer>
  );
}

// ── Pressing and holding ───────────────────────────────────────────────────

export interface PressableProps extends PressHandlers {
  layout?: Layout;
  children?: ReactNode;
  /** How far the box dims while pressed. */
  pressedAlpha?: number;
  alpha?: number;
  visible?: boolean;
  label?: string;
}

/** A box that can be tapped and held. */
export function Pressable({ layout, children, pressedAlpha = 0.7, alpha = 1, visible, label, ...press }: PressableProps) {
  const { pressed, props } = usePress(press);
  return (
    <layoutContainer
      layout={layout ?? {}}
      alpha={(press.disabled ? 0.45 : 1) * (pressed ? pressedAlpha : 1) * alpha}
      visible={visible ?? true}
      label={label}
      {...props}
    >
      {children}
    </layoutContainer>
  );
}

// ── Button ─────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "secondary";

export interface ButtonProps extends PressHandlers {
  text?: string;
  icon?: IconSource;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** The colour of an outline or ghost button. */
  tint?: number;
  layout?: Layout;
  children?: ReactNode;
  label?: string;
}

const BUTTON_PAD = { sm: [6, 10], md: [10, 16], lg: [14, 22] } as const;
const BUTTON_TEXT = { sm: TEXT.xs, md: TEXT.sm, lg: TEXT.base } as const;

export function Button({ text, icon, variant = "primary", size = "md", tint: tintColor, layout, children, label, ...press }: ButtonProps) {
  const color = tintColor ?? COLOR.primary;
  const fg = variant === "primary" ? COLOR.primaryForeground
    : variant === "danger" ? COLOR.foreground
    : variant === "secondary" ? COLOR.foreground
    : color;
  const bg = variant === "primary" ? color
    : variant === "danger" ? COLOR.destructive
    : variant === "secondary" ? COLOR.secondary
    : variant === "outline" ? tint(color, 0.08)
    : undefined;
  const [py, px] = BUTTON_PAD[size];
  return (
    <Pressable
      {...press}
      label={label ?? text}
      layout={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        paddingTop: py, paddingBottom: py, paddingLeft: px, paddingRight: px,
        borderRadius: RADIUS.lg,
        ...(bg !== undefined ? { backgroundColor: bg } : {}),
        ...(variant === "outline" ? { borderColor: tint(color, 0.6), borderWidth: 1 } : {}),
        ...(layout ?? {}),
      }}
    >
      {icon && <Icon icon={icon} size={BUTTON_TEXT[size] + 2} color={fg} />}
      {text !== undefined && <Label text={text} size={BUTTON_TEXT[size]} color={fg} weight="600" />}
      {children}
    </Pressable>
  );
}
