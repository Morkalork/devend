/**
 * The non-component half of the kit: text styles, colours with alpha, the
 * text resolution. Split from the components so a hot reload of one does not
 * reload the other.
 */
import { CanvasTextMetrics, TextStyle, type TextStyleFontWeight } from "pixi.js";
import { COLOR, FONT, TEXT, type FontRole } from "../theme";

export interface TextLook {
  size?: number;
  color?: number;
  font?: FontRole;
  weight?: TextStyleFontWeight;
  wrap?: boolean;
  align?: "left" | "center" | "right";
  letterSpacing?: number;
  lineHeight?: number;
  glow?: number;
}

/**
 * Oxanium's default weight. Michroma came in one weight, so most display
 * labels never set one; Oxanium at its lightest bundled weight (500) reads
 * thin at the sizes buttons use, so an unset weight means semibold.
 */
export const DISPLAY_WEIGHT: TextStyleFontWeight = "600";

export const RESOLUTION = typeof window !== "undefined" ? Math.min(3, window.devicePixelRatio || 1) : 1;

export function textStyle(p: TextLook): TextStyle {
  const size = p.size ?? TEXT.sm;
  return new TextStyle({
    fontFamily: FONT[p.font ?? "body"],
    fontSize: size,
    fontWeight: p.weight ?? (p.font === "display" ? DISPLAY_WEIGHT : "400"),
    fill: p.color ?? COLOR.foreground,
    align: p.align ?? "left",
    wordWrap: !!p.wrap,
    wordWrapWidth: 4000,
    breakWords: !!p.wrap,
    letterSpacing: p.letterSpacing ?? 0,
    lineHeight: p.lineHeight ?? Math.round(size * 1.35),
    // The glow is drawn into the text's own texture, which Pixi sizes to the
    // glyphs: without padding to match the blur it is cut off in a hard box.
    ...(p.glow ? { dropShadow: { color: p.color ?? COLOR.foreground, blur: p.glow, distance: 0, alpha: 0.6 }, padding: Math.ceil(p.glow * 1.5) } : {}),
  });
}

/** `text` cut with an ellipsis to fit `width` on one line in `style`. */
export function truncateToWidth(text: string, style: Parameters<typeof CanvasTextMetrics.measureText>[1], width: number): string {
  const fits = (s: string) => CanvasTextMetrics.measureText(s, style).width <= width;
  if (fits(text)) return text;
  // The longest prefix that still fits with the ellipsis after it.
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(text.slice(0, mid).trimEnd() + "\u2026")) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + "\u2026" : "\u2026";
}

// ── Colour helpers ─────────────────────────────────────────────────────────

/** A colour at an opacity, for a background or border (Tailwind's `bg-primary/10`). */
export function tint(color: number, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `#${color.toString(16).padStart(6, "0")}${a.toString(16).padStart(2, "0")}`;
}

/**
 * A colour over the dark card background at an opacity, flattened: Yoga
 * backgrounds take one colour, and Tailwind's `bg-primary/10` was exactly a
 * translucent tint over a near-black surface.
 */
export function withAlpha(color: number, alpha: number, over: number = COLOR.background): number {
  const mixc = (s: number) => {
    const a = (color >> s) & 255, b = (over >> s) & 255;
    return Math.round(b + (a - b) * alpha) & 255;
  };
  return (mixc(16) << 16) | (mixc(8) << 8) | mixc(0);
}

/** The same, for a border (drawn over the card colour). */
export function withAlphaHex(color: number, alpha: number): number {
  return withAlpha(color, alpha, COLOR.card);
}
