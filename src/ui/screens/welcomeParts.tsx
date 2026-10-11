/**
 * The menu screens' shared pieces, on the canvas: the "Dev/End" title, the
 * screen heading, the NEW badge, the pill chip, a spinner (`Loader2
 * animate-spin`) and the spinning ball on the main menu. Used by every menu screen (the main menu,
 * the tap-to-start gate, Options, How to Play, the Jukebox, the Performance
 * Review, the certificate store, the loadout gallery and the pair screens).
 */
import { useCallback, useMemo } from "react";
import { FillGradient, TextStyle, type Graphics, type TextStyleFontWeight } from "pixi.js";
import { Sparkles } from "lucide-react";
import {
  COLOR, FONT, GOLD, Icon, Label, Pressable, RADIUS, RESOLUTION, ROLE, View, fitTextWidth, hsl, tint, useClock, usePulse,
  type IconSource,
} from "../kit/ui";

// ── Title ──────────────────────────────────────────────────────────────────

/**
 * `.game-title animate-pulse-glow`: Michroma (FONT.logo), a primary-to-deep-green gradient,
 * and a glow that breathes between 15px and 30px. The breathing is a second,
 * blurrier copy behind the title whose opacity pulses, so the text itself is
 * not re-rasterised every frame.
 */
export function GameTitle({ text, size = 48 }: { text: string; size?: number }) {
  const pulse = usePulse(2000);
  const front = useMemo(() => new TextStyle({
    fontFamily: FONT.logo, fontSize: size, fontWeight: "900", letterSpacing: size * 0.05,
    fill: new FillGradient({
      type: "linear", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, textureSpace: "local",
      colorStops: [{ offset: 0, color: COLOR.primary }, { offset: 1, color: COLOR.primaryDeep }],
    }),
    dropShadow: { color: COLOR.primary, blur: 15, distance: 0, alpha: 0.4 },
    padding: 32,
  }), [size]);
  const back = useMemo(() => new TextStyle({
    fontFamily: FONT.logo, fontSize: size, fontWeight: "900", letterSpacing: size * 0.05,
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
 * A menu screen's heading (UI_REDO_PLAN.md, phase 4): the icon and the title
 * side by side, left-aligned across the column, the title in the display face
 * at 700 in ink and the icon carrying the screen's colour. It used to be
 * centred in a 900 weight; one left edge for every screen is what makes the
 * menus read as one interface.
 *
 * A title too long for `maxWidth` (a long translation, a narrow phone) wraps
 * under itself instead of running off the screen; a single word that does
 * not fit is scaled down to the room.
 */
export function MenuHeading({ icon, iconColor, text, size, maxWidth, letterSpacing = size * 0.02, weight = "700", iconSize = 26 }: {
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
    <View layout={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch", gap: 12 }}>
      <Icon icon={icon} size={iconSize} color={iconColor} />
      {fits || oneWord ? (
        <Label text={text} size={size * k} font="display" weight={weight} letterSpacing={letterSpacing * k} color={ROLE.ink} />
      ) : (
        <View layout={{ width: room }}>
          <Label text={text} size={size} font="display" weight={weight} letterSpacing={letterSpacing} color={ROLE.ink} wrap />
        </View>
      )}
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

/** The pill after a menu label (streak, hours, count): a flat edge-coloured lozenge. */
export function MenuChip({ text, icon, iconColor }: { text: string; icon?: Parameters<typeof Icon>[0]["icon"]; iconColor?: number }) {
  return (
    <View layout={{
      flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 4,
      paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
      borderRadius: RADIUS.full, backgroundColor: ROLE.edge,
    }}>
      {icon && <Icon icon={icon} size={12} color={iconColor ?? ROLE.ink} />}
      <Label text={text} size={12} font="display" color={ROLE.ink} />
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
