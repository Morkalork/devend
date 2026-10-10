/**
 * Small pieces shared by the play screen's overlays and modals that the kit
 * does not have (yet). Each is a candidate for the kit.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Graphics, Texture, TextStyleFontWeight } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import type { FontRole } from "../theme";
import {
  COLOR, Icon, Label, Pressable, RADIUS, RESOLUTION, View, iconTexture, textStyle, tint,
  type IconSource, type Layout,
} from "../kit/ui";
import { useSpin } from "./modalMotion";

// ── WrapText ───────────────────────────────────────────────────────────────

export interface WrapTextProps {
  text: string;
  size?: number;
  color?: number;
  font?: FontRole;
  weight?: TextStyleFontWeight;
  align?: "left" | "center" | "right";
  letterSpacing?: number;
  lineHeight?: number;
  upper?: boolean;
  glow?: number;
  alpha?: number;
  layout?: Layout;
}

/**
 * A wrapping paragraph that honours `align` inside its box.
 *
 * The kit's `<Label wrap align="center">` centres lines against the longest
 * line and then pins the whole block to the box's top-left, so a short title
 * meant to be centred sits flush left. This is the same two-step measure
 * (lay the box out, read its width back, wrap to it) with the block placed
 * at the top-left, top-centre or top-right of the box to match `align`.
 */
export function WrapText(p: WrapTextProps) {
  const [wrapWidth, setWrapWidth] = useState(0);
  const align = p.align ?? "left";
  const style = useMemo(() => {
    const st = textStyle({ ...p, wrap: true, align });
    st.wordWrapWidth = wrapWidth > 0 ? wrapWidth : 4000;
    return st;
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.size, p.color, p.font, p.weight, align, p.letterSpacing, p.lineHeight, p.glow, wrapWidth]);
  const boxRef = useRef<LayoutContainer | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onLayout = (l: { computedLayout: { width: number } }) => {
      const w = Math.floor(l.computedLayout.width);
      setWrapWidth(prev => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    box.on("layout", onLayout);
    const done = box.layout?.computedLayout;
    if (done && done.width > 0) onLayout({ computedLayout: done });
    return () => { box.off("layout", onLayout); };
  }, []);
  const text = p.upper ? p.text.toUpperCase() : p.text;
  return (
    <layoutContainer ref={boxRef} layout={{ alignSelf: "stretch", ...(p.layout ?? {}) }} alpha={p.alpha ?? 1}>
      {wrapWidth > 0 && (
        <uiText text={text} style={style} resolution={RESOLUTION}
          layout={{ width: wrapWidth, objectFit: "none", objectPosition: `top ${align}` }} />
      )}
    </layoutContainer>
  );
}

// ── SpinIcon ───────────────────────────────────────────────────────────────

/** A lucide icon turning once a second: `<Loader2 className="animate-spin" />`. */
export function SpinIcon({ icon, size = 16, color = COLOR.foreground }: { icon: IconSource; size?: number; color?: number }) {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let live = true;
    iconTexture(icon, color, size).then(t => { if (live) setTexture(t); });
    return () => { live = false; };
  }, [icon, color, size]);
  const angle = useSpin(1000);
  return (
    <View layout={{ width: size, height: size }}>
      {texture && (
        <pixiSprite texture={texture} anchor={0.5} x={size / 2} y={size / 2}
          width={size} height={size} rotation={angle} layout={false} />
      )}
    </View>
  );
}

// ── ArcadeButton ───────────────────────────────────────────────────────────

export interface ArcadeButtonProps {
  text: string;
  onTap: () => void;
  icon?: IconSource;
  /** Overrides for the `arcade-button` defaults (padding, size, weight). */
  size?: number;
  weight?: TextStyleFontWeight;
  paddingX?: number;
  paddingY?: number;
  layout?: Layout;
}

/**
 * The `arcade-button-primary` look: a faint primary fill, a 2px primary
 * border, primary Michroma caps with wide tracking. Its glow box-shadow is
 * carried by a slightly brighter fill.
 */
export function ArcadeButton({ text, onTap, icon, size = 15, weight = "600", paddingX = 27, paddingY = 14, layout }: ArcadeButtonProps) {
  return (
    <Pressable
      onTap={onTap}
      label={text}
      layout={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        paddingLeft: paddingX, paddingRight: paddingX, paddingTop: paddingY, paddingBottom: paddingY,
        borderRadius: RADIUS.lg, borderWidth: 2, borderColor: COLOR.primary,
        backgroundColor: tint(COLOR.primary, 0.14),
        ...(layout ?? {}),
      }}
    >
      {icon && <Icon icon={icon} size={size + 4} color={COLOR.primary} />}
      <Label text={text} size={size} weight={weight} font="display" color={COLOR.primary} upper letterSpacing={size * 0.1} />
    </Pressable>
  );
}

// ── TouchBlocker ───────────────────────────────────────────────────────────

/**
 * A full-screen layer that swallows every touch and does nothing with it: the
 * DOM's backdrop that sits between the player and the board (or the screen
 * underneath) without a click handler. A Pressable, so the board's hit gate
 * sees it and never starts a fence under it.
 */
export function TouchBlocker({ screen, color, layout, children }: {
  screen: { width: number; height: number };
  color?: string | number;
  layout?: Layout;
  children?: ReactNode;
}) {
  return (
    <Pressable
      pressedAlpha={1}
      layout={{
        position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height,
        ...(color !== undefined ? { backgroundColor: color } : {}),
        ...(layout ?? {}),
      }}
    >
      {children}
    </Pressable>
  );
}

// ── FilledStar ─────────────────────────────────────────────────────────────

/**
 * A solid five-point star the size of a lucide icon: `<Star style={{ fill }} />`.
 * The kit's Icon rasterises lucide outlines only, so the fill is drawn.
 */
export function FilledStar({ size = 16, color }: { size?: number; color: number }) {
  const draw = useCallback((g: Graphics) => {
    // lucide's star spans about 20 of its 24 units and sits slightly low.
    const r = size * 0.44;
    g.clear();
    g.star(size / 2, size * 0.53, 5, r, r * 0.48).fill(color);
  }, [size, color]);
  return (
    <View layout={{ width: size, height: size }}>
      <pixiGraphics draw={draw} />
    </View>
  );
}
