/**
 * The sleek board's single source of colour truth.
 *
 * The old renderers scatter hex literals across ~2700 + ~1400 lines; every one
 * of them is collected here so the board can be retuned in one place. Hues are
 * unchanged from the classic look (the game still reads as Dev/End) - what is
 * retuned is VALUE and SATURATION: structural elements (grid, captured space,
 * obstacle bodies) drop back so they read as a quiet substrate, and only the
 * things the player acts on (fences, balls, areas, hazards) keep full chroma.
 *
 * Everything is a 0xRRGGBB number: Pixi's native form, so no per-frame string
 * parsing. `withAlpha` is for the few places that still need a CSS string (the
 * baked OffscreenCanvas layers).
 */

/** 0xRRGGBB -> "#rrggbb". */
export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

/** 0xRRGGBB + alpha -> "rgba(r,g,b,a)", for the 2D-baked layers. */
export function withAlpha(c: number, alpha: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${alpha})`;
}

/** Linear blend between two packed colours (t = 0 -> a, 1 -> b). */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    ((ar + (br - ar) * k) & 255) << 16 |
    ((ag + (bg - ag) * k) & 255) << 8 |
    ((ab + (bb - ab) * k) & 255)
  );
}

/** Scale a colour's brightness (t > 1 lightens toward white, < 1 darkens). */
export function shade(c: number, t: number): number {
  if (t <= 1) return mix(0x000000, c, t);
  return mix(c, 0xffffff, Math.min(1, t - 1));
}

export const PALETTE = {
  // ── Substrate ────────────────────────────────────────────────────────────
  /** Deep console black-green the whole board sits on. */
  boardVoid: 0x060b08,
  /**
   * Uncut, still-playable space. Deliberately NOT near-black: this is the
   * surface every shadow in the game falls on, and a shadow cast onto black is
   * no shadow at all. It has to sit far enough above the shadow colour for the
   * light model to exist, which is the one place this renderer must depart from
   * the classic board's pure-black live area.
   */
  active: 0x111e19,
  /** Captured/fenced-off territory. The classic #1a3020, lifted to match. */
  captured: 0x1e3529,
  /** The faint lattice over uncut space. Barely there by design. */
  grid: 0x244434,
  /** Territory where a ball was locked: captured, plus an accent wash. */
  locked: 0x1c3b2a,

  // ── The accent (fences, the player's own marks) ───────────────────────────
  accent: 0x00ff88,
  accentDim: 0x0a8a4e,
  accentGlow: 0x6bffbc,
  /**
   * Superior locks. The same gold the lock flash already uses, so the moment of
   * the tight seal and the mark it leaves behind are recognisably one thing.
   */
  superior: 0xffd54a,

  // ── Structure ─────────────────────────────────────────────────────────────
  /**
   * Static obstacle bodies.
   *
   * These must sit CLEARLY above `captured` in value. The first version used
   * 0x263b33, which after the ambient mix landed around 0x1d2f28-0x233729 -
   * essentially identical to the captured fill at 0x1e3529 - so obstacles had no
   * silhouette against the territory they stood on and simply vanished. The job
   * here is value separation from the substrate, not chroma: these are furniture
   * and must never compete with the accent for attention.
   */
  obstacle: 0x51705f,
  /** Lit obstacle edge: bright enough to draw the silhouette on its own. */
  obstacleEdge: 0x9fd0b6,
  /** Board perimeter. */
  edge: 0x5c8172,

  // ── Hazards + special objects (full chroma, these must pop) ───────────────
  mover: 0xff8800,
  mirror: 0x88ddff,
  danger: 0xff2244,
  amber: 0xffd76b,
  frost: 0xbfefff,

  // ── Colored areas (var / let / const) ─────────────────────────────────────
  areaVar: 0xff9ebf,
  areaLet: 0xffbf80,
  areaConst: 0x7fe3d4,

  // ── Light ─────────────────────────────────────────────────────────────────
  /** The off-screen monitor's colour: a cold CRT white-blue. */
  monitor: 0xbfe6ff,
  /** What unlit surfaces fall toward. Near-black, but never pure: a true 0x000000
   *  shadow reads as a hole punched in the board rather than an absence of light. */
  shadow: 0x020506,
} as const;

/** Ball body colours are authored per ball type; this is the fallback. */
export const BALL_FALLBACK = 0xffffff;
