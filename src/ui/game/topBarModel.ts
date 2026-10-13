/**
 * The arithmetic behind the canvas GameTopBar, kept out of the component so it
 * can be tested without a renderer.
 */
export interface SpaceDetail {
  remaining: number;
  cleared: number;
  goalMet: boolean;
  toGo: number;
}

/** The exact numbers behind the space chip's CLEAR / "% to go" (its hold-detail). */
export function spaceDetail(spaceRemaining: number, spaceRequired: number): SpaceDetail {
  const remaining = Math.max(0, Math.min(100, Math.round(spaceRemaining)));
  return {
    remaining,
    cleared: 100 - remaining,
    goalMet: spaceRemaining <= spaceRequired,
    toGo: Math.max(0, Math.round(spaceRemaining - spaceRequired)),
  };
}

// ── The stat flash ─────────────────────────────────────────────────────────

/** index.css `animate-stat-flash`: 380ms, 1.3x and very bright, settling back. */
export const STAT_FLASH_MS = 380;

export interface FlashFrame { scale: number; brightness: number }
export const FLASH_REST: FlashFrame = { scale: 1, brightness: 1 };

const KEYS: [number, FlashFrame][] = [
  [0, { scale: 1.3, brightness: 3.5 }],
  [0.55, { scale: 1.06, brightness: 1.6 }],
  [1, FLASH_REST],
];

/** The flash at progress p (0..1), ease-out within each keyframe segment like CSS. */
export function statFlashAt(p: number): FlashFrame {
  const t = Math.max(0, Math.min(1, p));
  for (let i = 1; i < KEYS.length; i++) {
    const [p1, b] = KEYS[i];
    if (t <= p1) {
      const [p0, a] = KEYS[i - 1];
      const u = (t - p0) / (p1 - p0);
      const e = 1 - (1 - u) * (1 - u);
      return { scale: a.scale + (b.scale - a.scale) * e, brightness: a.brightness + (b.brightness - a.brightness) * e };
    }
  }
  return FLASH_REST;
}

/** index.css `animate-pulse-heart`: 1.15x and 85% opacity at the top of a 1.2s breath. */
export const HEART_PULSE_MS = 1200;
export function heartPulse(p: number): { scale: number; alpha: number } {
  return { scale: 1 + 0.15 * p, alpha: 1 - 0.15 * p };
}
