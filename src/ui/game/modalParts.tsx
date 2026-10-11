/**
 * Small pieces shared by the play screen's overlays and modals that the kit
 * does not have (yet). Each is a candidate for the kit.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Graphics, Texture } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { X } from "lucide-react";
import {
  COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, iconTexture, tint,
  type IconSource, type LabelProps, type Layout,
} from "../kit/ui";
import { useBoxSize, useSpin } from "./modalMotion";

// ── WrapText ───────────────────────────────────────────────────────────────

/**
 * A wrapping paragraph: now exactly the kit's `<Label wrap />`, which places
 * the wrapped block to match `align` itself. Kept so the files outside the
 * modals that still import it keep working; new code uses `Label wrap`.
 */
export function WrapText(p: Omit<LabelProps, "wrap">) {
  return <Label {...p} wrap />;
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

// ── GlowFrame ──────────────────────────────────────────────────────────────

/**
 * A soft glow around the box it is put in: the DOM's coloured `box-shadow`,
 * as rings whose alpha falls off with distance, so it fades out instead of
 * ending in a hard-edged band. Absolutely positioned against its parent and
 * sized from the parent's laid-out box, so it never moves or resizes anything;
 * make it the parent's first child so it draws underneath. The parent must not
 * clip (`overflow: "hidden"`), or the glow is cut off at its edge.
 */
export function GlowFrame({ color, radius, spread = 20, strength = 0.35, alpha = 1 }: {
  color: number;
  /** The parent's corner radius. */
  radius: number;
  /** How far out the glow reaches, in px (the shadow's blur). */
  spread?: number;
  /** The glow's alpha at the box's edge. */
  strength?: number;
  /** Multiplies the whole glow: a breathing glow animates this, not a redraw. */
  alpha?: number;
}) {
  const ref = useRef<LayoutContainer | null>(null);
  const { w, h } = useBoxSize(ref);
  const draw = useCallback((g: Graphics) => {
    g.clear();
    if (w <= 0 || h <= 0) return;
    // 2px rings from the box's edge outward; the alpha falls off
    // quadratically, close to how a blurred shadow thins out.
    const steps = Math.max(1, Math.round(spread / 2));
    for (let i = 0; i < steps; i++) {
      const d = i * 2 + 1;
      const a = strength * (1 - i / steps) ** 2;
      g.roundRect(spread - d, spread - d, w - 2 * (spread - d), h - 2 * (spread - d), radius + d)
        .stroke({ width: 2, color, alpha: a });
    }
  }, [w, h, spread, strength, radius, color]);
  return (
    <layoutContainer ref={ref} eventMode="none" alpha={alpha}
      layout={{ position: "absolute", left: -spread, top: -spread, right: -spread, bottom: -spread }}>
      <pixiGraphics draw={draw} />
    </layoutContainer>
  );
}

// ── CardShield ─────────────────────────────────────────────────────────────

/**
 * A modal's card that keeps its taps: the DOM card's `stopPropagation`. A
 * plain View takes no touches, so a tap on a card's text or padding would land
 * on the backdrop behind it and close the modal; this is a Pressable with no
 * handlers, so the tap stops here. It does not dim when pressed.
 */
export function CardShield({ layout, children }: { layout?: Layout; children?: ReactNode }) {
  return <Pressable pressedAlpha={1} layout={layout}>{children}</Pressable>;
}

// ── InfoCardModal ──────────────────────────────────────────────────────────

export interface InfoCardModalProps {
  /** The full screen the backdrop covers, in CSS px (`useUiScreen()`). */
  screen: { width: number; height: number };
  onClose: () => void;
  /** The thing's own colour: border, title, X. */
  color: number;
  title: string;
  /** Drawn before the title, e.g. the superior lock's filled star. */
  titleIcon?: ReactNode;
  /** Space between the body's blocks (`space-y-3` by default). */
  gap?: number;
  children?: ReactNode;
}

/**
 * The explainer card the hold-to-explain modals share (superior lock, fence
 * type, ability): a dim backdrop that closes on a tap, a near-black card
 * bordered in the thing's colour, a header with the glowing title and an X
 * over a faint rule, and the body below. Tall content scrolls inside the card.
 */
export function InfoCardModal({ screen, onClose, color, title, titleIcon, gap = 12, children }: InfoCardModalProps) {
  return (
    <View layout={{
      position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height,
      justifyContent: "center", alignItems: "center", padding: 16,
    }} zIndex={80}>
      <Pressable
        onTap={onClose}
        pressedAlpha={1}
        label="backdrop"
        layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.6) }}
      />
      <CardShield layout={{
        width: Math.min(384, screen.width - 32), maxHeight: screen.height - 32, borderRadius: RADIUS.xl, overflow: "hidden",
        backgroundColor: 0x0b0f14, borderColor: color, borderWidth: 1,
      }}>
        <View layout={{
          flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 12, paddingTop: 12, paddingBottom: 12,
        }}>
          {titleIcon}
          <View layout={{ flex: 1 }}>
            <Label text={title} size={TEXT.sm} weight="700" font="display" color={color} glow={8} wrap />
          </View>
          <Pressable onTap={onClose} label="close" layout={{ padding: 4, borderRadius: RADIUS.base }}>
            <Icon icon={X} size={16} color={color} />
          </Pressable>
        </View>
        {/* The header's bottom border at the colour's 0x44. */}
        <View layout={{ height: 1, backgroundColor: tint(color, 0x44 / 255) }} />
        <ScrollView layout={{ flexShrink: 1 }}>
          <View layout={{ padding: 16, gap }}>{children}</View>
        </ScrollView>
      </CardShield>
    </View>
  );
}
