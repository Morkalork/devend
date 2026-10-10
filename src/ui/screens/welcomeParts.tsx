/**
 * The menu screens' shared pieces, on the canvas: the "Dev/End" title, the
 * arcade button (index.css `.arcade-button-*`), the first-time highlight ring
 * and NEW badge, the pill chip, a spinner (`Loader2 animate-spin`) and the
 * spinning ball on the main menu. Used by WelcomeScreen, TapToStartGate,
 * OptionsScreen, TutorialScreen and JukeboxScreen.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { FillGradient, TextStyle, type Graphics } from "pixi.js";
import { Sparkles } from "lucide-react";
import {
  COLOR, FONT, Icon, Label, Pressable, RADIUS, RESOLUTION, View, hsl, tint, usePulse,
  type Layout,
} from "../kit/ui";
import { useClock, useLoop } from "./welcomeMotion";
import { ARCADE, GOLD, GREY, arcadeInk, type ArcadeVariant } from "./welcomeStyle";

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

// ── Arcade button ──────────────────────────────────────────────────────────

export interface ArcadeButtonProps {
  /** The label (Michroma, upper-case, wide tracking); omit to pass children. */
  text?: string;
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
  layout?: Layout;
  label?: string;
}

export function ArcadeButton({
  text, children, variant = "primary", size = "md", onTap, disabled, ring, glow, pulse, shimmer, locked,
  column, layout, label,
}: ArcadeButtonProps) {
  const m = ARCADE[size];
  const ink = arcadeInk(variant, locked);
  const fill = locked ? tint(GREY, 0.1)
    : variant === "primary" ? tint(COLOR.primary, 0.1)
    : variant === "danger" ? tint(COLOR.destructive, 0.1)
    : tint(COLOR.secondary, 0.5);
  const border = ring ? GOLD
    : locked ? GREY
    : variant === "primary" ? COLOR.primary
    : variant === "danger" ? COLOR.destructive
    : tint(COLOR.mutedForeground, 0.3);
  return (
    <View layout={layout} alpha={locked ? 0.5 : 1}>
      {/* Every primary/danger arcade button carries a soft glow (box-shadow). */}
      {variant !== "secondary" && !ring && <GlowRing color={variant === "danger" ? COLOR.destructive : locked ? GREY : COLOR.primary} strong={!!glow} pulse={!!pulse} />}
      {ring && <PingRing />}
      <Pressable
        onTap={onTap}
        disabled={disabled}
        label={label ?? text}
        layout={{
          flexDirection: column ? "column" : "row", alignItems: "center", justifyContent: "center", gap: column ? 4 : 8,
          paddingTop: m.py, paddingBottom: m.py, paddingLeft: m.px, paddingRight: m.px,
          borderRadius: RADIUS.lg, borderWidth: 2, borderColor: border, backgroundColor: fill,
          overflow: shimmer ? "hidden" : undefined,
        }}
      >
        {shimmer && <Shimmer />}
        {text !== undefined && (
          <Label text={text} size={m.text} font="display" weight="600" upper letterSpacing={m.text * 0.1} color={ink} />
        )}
        {children}
      </Pressable>
    </View>
  );
}

/** A coloured box-shadow glow, as tinted rings just outside the button. */
function GlowRing({ color, strong, pulse }: { color: number; strong: boolean; pulse: boolean }) {
  const p = usePulse(2000, pulse);
  const a = pulse ? 0.6 + 0.4 * p : 1;
  const ring = (inset: number, width: number, alpha: number) => (
    <View layout={{
      position: "absolute", left: -inset, top: -inset, right: -inset, bottom: -inset,
      borderRadius: RADIUS.lg + inset, borderWidth: width, borderColor: tint(color, alpha * a),
    }} />
  );
  return (
    <>
      {ring(2, 2, strong ? 0.45 : 0.22)}
      {strong && ring(6, 4, 0.15)}
    </>
  );
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
