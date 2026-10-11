/**
 * The menu screens' shared pieces, on the canvas: the "Dev/End" title, the
 * arcade button (index.css `.arcade-button-*`), the first-time highlight ring
 * and NEW badge, the pill chip, a spinner (`Loader2 animate-spin`) and the
 * spinning ball on the main menu. Used by every menu screen (the main menu,
 * the tap-to-start gate, Options, How to Play, the Jukebox, the Performance
 * Review, the certificate store, the loadout gallery and the pair screens).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FillGradient, TextStyle, type Graphics, type TextStyleFontWeight } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { Sparkles } from "lucide-react";
import {
  COLOR, FONT, Icon, Label, Pressable, RADIUS, RESOLUTION, View, hsl, tint, usePulse,
  type IconSource, type Layout,
} from "../kit/ui";
import { useClock, useLoop } from "./welcomeMotion";
import { ARCADE, GOLD, GREY, arcadeInk, fitTextWidth, type ArcadeVariant } from "./welcomeStyle";

// ── Title ──────────────────────────────────────────────────────────────────

/**
 * `.game-title animate-pulse-glow`: Michroma, a primary-to-deep-green gradient,
 * and a glow that breathes between 15px and 30px. The breathing is a second,
 * blurrier copy behind the title whose opacity pulses, so the text itself is
 * not re-rasterised every frame.
 */
export function GameTitle({ text, size = 48 }: { text: string; size?: number }) {
  const pulse = usePulse(2000);
  const front = useMemo(() => new TextStyle({
    fontFamily: FONT.display, fontSize: size, fontWeight: "900", letterSpacing: size * 0.05,
    fill: new FillGradient({
      type: "linear", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, textureSpace: "local",
      colorStops: [{ offset: 0, color: COLOR.primary }, { offset: 1, color: COLOR.primaryDeep }],
    }),
    dropShadow: { color: COLOR.primary, blur: 15, distance: 0, alpha: 0.4 },
    padding: 32,
  }), [size]);
  const back = useMemo(() => new TextStyle({
    fontFamily: FONT.display, fontSize: size, fontWeight: "900", letterSpacing: size * 0.05,
    fill: COLOR.primary,
    dropShadow: { color: COLOR.primary, blur: 30, distance: 0, alpha: 0.7 },
    padding: 32,
  }), [size]);
  return (
    <View layout={{ alignItems: "center" }}>
      <uiText text={text} style={back} resolution={RESOLUTION} alpha={pulse}
        layout={{ position: "absolute", left: 0, top: 0 }} />
      <uiText text={text} style={front} resolution={RESOLUTION} layout={true} />
    </View>
  );
}

// ── Screen heading ─────────────────────────────────────────────────────────

/**
 * A menu screen's heading: an icon and a Michroma title side by side, centred.
 * A title too long for `maxWidth` (a long translation, a narrow phone) wraps
 * under itself instead of running off the screen, as the DOM's h1 did; a
 * single word that does not fit is scaled down to the room.
 */
export function MenuHeading({ icon, iconColor, text, size, maxWidth, letterSpacing = size * 0.05, weight = "900", iconSize = 32 }: {
  icon: IconSource; iconColor: number; text: string; size: number; maxWidth: number;
  letterSpacing?: number; weight?: TextStyleFontWeight; iconSize?: number;
}) {
  const room = Math.max(0, maxWidth - iconSize - 12);
  const natural = useMemo(() => fitTextWidth(text, { size, font: "display", weight, letterSpacing }), [text, size, weight, letterSpacing]);
  const fits = natural <= room;
  // One word cannot wrap (it would break mid-word), so it is set smaller.
  const oneWord = !/\s/.test(text.trim());
  const k = fits || !oneWord ? 1 : room / natural;
  return (
    <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <Icon icon={icon} size={iconSize} color={iconColor} />
      {fits || oneWord ? (
        <Label text={text} size={size * k} font="display" weight={weight} letterSpacing={letterSpacing * k} />
      ) : (
        <View layout={{ width: room }}>
          <Label text={text} size={size} font="display" weight={weight} letterSpacing={letterSpacing} align="center" wrap />
        </View>
      )}
    </View>
  );
}

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
  /** Overrides the size's own text size (a custom `text-sm`). */
  textSize?: number;
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
  text, icon, iconAfter, iconSize = 20, textSize, children, variant = "primary", size = "md", onTap, disabled,
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
    : fitTextWidth(text.toUpperCase(), { size: fontSize, font: "display", weight: "600", letterSpacing: fontSize * 0.1 })),
  [text, fontSize]);
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
        {icon && <Icon icon={icon} size={iconSize} color={ink} />}
        {text !== undefined && (wraps ? (
          <View layout={{ width: Math.max(0, room) }}>
            <Label text={text} size={fontSize} font="display" weight="600" upper letterSpacing={fontSize * 0.1} color={ink} align="center" wrap />
          </View>
        ) : (
          <Label text={text} size={fontSize} font="display" weight="600" upper letterSpacing={fontSize * 0.1} color={ink} />
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

// ── Badges and chips ───────────────────────────────────────────────────────

/** `.menu-highlight-badge`: a bobbing gold dot with a sparkle. */
export function NewBadge() {
  const bob = usePulse(1200);
  return (
    <View layout={{ marginLeft: 4, top: -3 * bob, padding: 3, borderRadius: RADIUS.full, backgroundColor: GOLD }}>
      <Icon icon={Sparkles} size={12} color={hsl(0, 0, 8)} />
    </View>
  );
}

/** The `bg-white/20 rounded-full` pill after a menu label (streak, hours, count). */
export function MenuChip({ text, icon, iconColor }: { text: string; icon?: Parameters<typeof Icon>[0]["icon"]; iconColor?: number }) {
  return (
    <View layout={{
      flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 4,
      paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
      borderRadius: RADIUS.full, backgroundColor: tint(COLOR.white, 0.2),
    }}>
      {icon && <Icon icon={icon} size={12} color={iconColor ?? COLOR.white} />}
      <Label text={text} size={12} font="display" upper color={COLOR.white} />
    </View>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────

/** `Loader2 animate-spin`: a three-quarter ring turning once a second. */
export function Spinner({ size = 20, color = COLOR.primary }: { size?: number; color?: number }) {
  const t = useClock();
  const r = size * 0.375;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    g.arc(0, 0, r, 0, Math.PI * 1.6).stroke({ width: Math.max(1.5, size / 12), color, cap: "round" });
  }, [r, size, color]);
  return (
    <View layout={{ width: size, height: size, flexShrink: 0 }}>
      <pixiContainer x={size / 2} y={size / 2} rotation={(t % 1) * Math.PI * 2} layout={false}>
        <pixiGraphics draw={draw} layout={false} />
      </pixiContainer>
    </View>
  );
}

// ── The menu ball ──────────────────────────────────────────────────────────

const INK = COLOR.black;

/**
 * The spinning ball preview with its multi-axis illusion: latitude bands that
 * tilt, meridians that spin, a counter-spinning equator with markers, polar
 * caps that sway, under a fixed glare. Each layer is a static drawing in its
 * own container, so a frame only changes rotations and scales. Coordinates
 * are the DOM's 80x80 SVG viewBox, shifted so (0,0) is the centre.
 */
export function MenuBall({ onTap }: { onTap?: () => void }) {
  const t = useClock();
  const wave = (period: number) => Math.sin((t / period) * Math.PI * 2);
  const bob = -8 * (0.5 - 0.5 * Math.cos((t / 3) * Math.PI * 2));
  const tiltX = Math.cos((20 * wave(4) * Math.PI) / 180);
  const tiltY = Math.cos((15 * wave(3) * Math.PI) / 180);

  const body = useCallback((g: Graphics) => {
    g.clear();
    // Outer glow (a radial fade from primary/40 to nothing).
    for (let i = 0; i < 5; i++) g.circle(0, 0, 48 - i * 2).fill({ color: COLOR.primary, alpha: 0.05 });
    // Ball base: the lit side toward the top left, the rim darker.
    g.circle(0, 0, 40).fill({ color: COLOR.primary, alpha: 0.5 });
    g.circle(-3, -3, 34).fill({ color: COLOR.primary, alpha: 0.45 });
    g.circle(-7, -7, 24).fill({ color: COLOR.primary, alpha: 0.6 });
    // Inset shadow on the far side.
    g.arc(0, 0, 38, -Math.PI * 0.1, Math.PI * 0.6).stroke({ width: 4, color: INK, alpha: 0.15 });
  }, []);
  const latitudes = useCallback((g: Graphics) => {
    g.clear();
    g.ellipse(0, -20, 30, 6).stroke({ width: 1.5, color: INK, alpha: 0.2 });
    g.ellipse(0, -5, 36, 8).stroke({ width: 1.5, color: INK, alpha: 0.25 });
    g.ellipse(0, 10, 36, 8).stroke({ width: 1.5, color: INK, alpha: 0.25 });
    g.ellipse(0, 25, 30, 6).stroke({ width: 1.5, color: INK, alpha: 0.2 });
  }, []);
  const meridians = useCallback((g: Graphics) => {
    g.clear();
    g.ellipse(-15, 0, 8, 35).stroke({ width: 1.5, color: INK, alpha: 0.3 });
    g.ellipse(0, 0, 3, 38).stroke({ width: 2, color: INK, alpha: 0.35 });
    g.ellipse(15, 0, 8, 35).stroke({ width: 1.5, color: INK, alpha: 0.3 });
  }, []);
  const equator = useCallback((g: Graphics) => {
    g.clear();
    g.moveTo(-38, 0).lineTo(38, 0).stroke({ width: 2.5, color: INK, alpha: 0.45, cap: "round" });
    g.circle(-28, 0, 3).fill({ color: INK, alpha: 0.35 });
    g.circle(-12, -2, 2.5).fill({ color: INK, alpha: 0.3 });
    g.circle(12, -2, 2.5).fill({ color: INK, alpha: 0.3 });
    g.circle(28, 0, 3).fill({ color: INK, alpha: 0.35 });
  }, []);
  const caps = useCallback((g: Graphics) => {
    g.clear();
    g.ellipse(0, -28, 14, 5).fill({ color: INK, alpha: 0.1 });
    g.ellipse(0, 28, 14, 5).fill({ color: INK, alpha: 0.1 });
  }, []);
  const glare = useCallback((g: Graphics) => {
    g.clear();
    // The soft glare (a radial fade from white/60), then the sharp specular dot.
    g.ellipse(-8, -18, 20, 14).fill({ color: COLOR.white, alpha: 0.08 });
    g.ellipse(-9, -19, 14, 10).fill({ color: COLOR.white, alpha: 0.14 });
    g.ellipse(-10, -20, 8, 6).fill({ color: COLOR.white, alpha: 0.22 });
    g.circle(-17.6, -20.8, 4.8).fill({ color: COLOR.white, alpha: 0.7 });
  }, []);

  return (
    // Doubles as the secret admin unlock (see WelcomeScreen): a plain tap target.
    <Pressable onTap={onTap} pressedAlpha={1} layout={{ width: 80, height: 80, marginTop: 16 }}>
      <pixiContainer x={40} y={40 + bob} layout={false}>
        <pixiGraphics draw={body} layout={false} />
        <pixiContainer scale={{ x: 1, y: tiltX }} layout={false}>
          <pixiGraphics draw={latitudes} layout={false} />
        </pixiContainer>
        <pixiContainer rotation={((t / 2.5) % 1) * Math.PI * 2} layout={false}>
          <pixiGraphics draw={meridians} layout={false} />
        </pixiContainer>
        <pixiContainer rotation={-((t / 1.8) % 1) * Math.PI * 2} layout={false}>
          <pixiGraphics draw={equator} layout={false} />
        </pixiContainer>
        <pixiContainer scale={{ x: tiltY, y: 1 }} layout={false}>
          <pixiGraphics draw={caps} layout={false} />
        </pixiContainer>
        <pixiGraphics draw={glare} layout={false} />
      </pixiContainer>
    </Pressable>
  );
}
