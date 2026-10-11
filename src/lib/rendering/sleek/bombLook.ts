/**
 * How the bomb inside a box looks at a given wear (lib/bombCore.ts has the
 * rule; objectLayer draws it). Pure, so the stages can be tested.
 *
 *   untouched   the box as it always was: no hole, no bomb
 *   chipped     a ragged hole opens in the hull's middle, wider with each
 *               hit, and the bomb's dark casing fills it
 *   exposed     the hole is past the casing: the whole bomb shows, its fuse
 *               light blinking red with a soft glow, and a white flash the
 *               moment it came into view - the box is now one hit from going
 */
import { BOMB_BLINK_MS, BOMB_SIZE } from "@/lib/bombCore";

export interface BombLook {
  /** The hole's radius, screen px; 0 = no hole yet. */
  holeR: number;
  /** The casing's radius, screen px: what of the bomb the hole lets show. */
  casingR: number;
  /** 0..1, the fuse light (0 until most of the bomb shows). */
  light: number;
  /** 0..1, the glow round an exposed bomb. */
  glow: number;
  /** 0..1, the flash as it comes into view. */
  flash: number;
}

/** The bomb's full radius in a box whose smaller half-extent is `halfExtent` px. */
export function bombRadius(halfExtent: number): number {
  return Math.max(4, halfExtent * BOMB_SIZE);
}

export function bombLook(
  reveal: number, exposed: boolean, halfExtent: number, now: number, exposedAt: number | undefined,
): BombLook {
  const R = bombRadius(halfExtent);
  if (reveal <= 0 && !exposed) return { holeR: 0, casingR: 0, light: 0, glow: 0, flash: 0 };
  // The hole starts as a real bite (a third of the bomb) and runs past the
  // casing at exposure, so the last ring of hull is visibly gone.
  const holeR = R * (exposed ? 1.22 : 0.5 + 0.6 * reveal);
  const casingR = Math.min(R, holeR * 0.92);
  if (!exposed) {
    return { holeR, casingR, light: reveal > 0.6 ? 0.35 * (reveal - 0.6) / 0.4 : 0, glow: 0, flash: 0 };
  }
  const phase = (now % BOMB_BLINK_MS) / BOMB_BLINK_MS;
  const blink = phase < 0.5 ? 1 : 0.25;
  const since = exposedAt == null ? Infinity : now - exposedAt;
  const flash = since < 280 ? 1 - since / 280 : 0;
  return { holeR, casingR, light: blink, glow: 0.35 + 0.35 * blink, flash };
}

/**
 * The hole's outline: ragged, the same every frame for a given box (seeded),
 * so it grows rather than crawls.
 */
export function bombHoleOutline(cx: number, cy: number, r: number, seed: number, points = 14): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < points; i++) {
    const h = Math.sin(seed * 0.0013 + i * 12.9898) * 43758.5453;
    const jag = 0.78 + 0.34 * (h - Math.floor(h));
    const a = (i / points) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r * jag, y: cy + Math.sin(a) * r * jag });
  }
  return out;
}

/** A stable seed from a box's id. */
export function bombSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return Math.abs(h);
}
