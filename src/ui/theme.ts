/**
 * The canvas interface's colours and type, from the same values the DOM
 * interface used (index.css :root and tailwind.config.ts), so a screen moved
 * onto the canvas looks like the screen it replaced.
 */

/** hsl(h s% l%) as a 0xRRGGBB number, the exact CSS conversion. */
export function hsl(h: number, s: number, l: number): number {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const c = (n: number) => Math.round(f(n) * 255);
  return (c(0) << 16) | (c(8) << 8) | c(4);
}

/** "#rrggbb" or "rrggbb" as a number. */
export function hex(s: string): number {
  return Number.parseInt(s.replace("#", ""), 16);
}

export const COLOR = {
  background: hsl(240, 10, 4),
  foreground: hsl(0, 0, 98),
  card: hsl(240, 10, 6),
  primary: hsl(145, 100, 53),
  primaryDeep: hsl(145, 80, 40),
  primaryForeground: hsl(240, 10, 4),
  secondary: hsl(240, 10, 12),
  muted: hsl(240, 10, 15),
  mutedForeground: hsl(240, 5, 55),
  destructive: hsl(0, 85, 60),
  border: hsl(240, 10, 18),
  amber: 0xfbbf24,
  amberSoft: 0xffb347,
  sky: 0x38bdf8,
  violet: 0xa78bfa,
  emerald: 0x34d399,
  rose: 0xfb7185,
  cyan: 0x22d3ee,
  white: 0xffffff,
  black: 0x000000,
} as const;

export const FONT = {
  /** Headings and the HUD's numbers. */
  display: "Michroma, sans-serif",
  /** Body text. */
  body: "'Space Grotesk', sans-serif",
  /** Code and figures. */
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

export type FontRole = keyof typeof FONT;

/** The radius the DOM interface used (--radius: 0.75rem). */
/** Tailwind's radii with this project's --radius (0.75rem): `rounded` 4, sm 8, md 10, lg 12, xl 12, 2xl 16. */
export const RADIUS = { base: 4, sm: 8, md: 10, lg: 12, xl: 12, "2xl": 16, "3xl": 24, full: 999 } as const;

/** Tailwind's spacing unit, so `p-4` becomes `SPACE * 4`. */
export const SPACE = 4;

/** Tailwind's text sizes in px. */
export const TEXT = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36 } as const;
