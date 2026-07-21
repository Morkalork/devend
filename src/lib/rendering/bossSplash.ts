/**
 * Boss birth splash (issue #56): a wet, membrane-rupture burst at the point a
 * minion buds out of the boss. Stateless - fully determined by the split clock
 * and a per-emergence seed, so both renderers (Pixi + Canvas2D) can draw it
 * without storing any particles. All coordinates are RELATIVE to the ball centre
 * in screen pixels; each renderer offsets them by the boss's screen position.
 */

/** How long the splash plays, from the moment the split began (ms). */
export const SPLASH_MS = 650;
const DROPLETS = 12;

export interface SplashDroplet {
  x: number; y: number;   // offset from the ball centre
  r: number;              // droplet radius
  alpha: number;
  hx: number; hy: number; // glossy highlight offset within the droplet
}

export interface SplashFrame {
  active: boolean;
  droplets: SplashDroplet[];
  ringX: number; ringY: number;   // rupture-ring centre (the emergence point)
  ringR: number; ringAlpha: number; ringWidth: number;
}

/** Small deterministic PRNG so the droplet set is stable across frames. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INACTIVE: SplashFrame = {
  active: false, droplets: [], ringX: 0, ringY: 0, ringR: 0, ringAlpha: 0, ringWidth: 0,
};

/**
 * Build the splash for this frame. `dirX,dirY` is the unit birth direction (the
 * side the bud emerges from); `seed` should be stable per emergence (the split
 * timestamp works). Returns `{active:false}` outside the splash window.
 */
export function bossSplashFrame(
  screenRadius: number,
  dirX: number,
  dirY: number,
  splitAnimAt: number,
  now: number,
  scale: number,
  seed: number,
): SplashFrame {
  const t = (now - splitAnimAt) / SPLASH_MS;
  if (t < 0 || t >= 1) return INACTIVE;

  const ease = 1 - (1 - t) * (1 - t); // easeOutQuad for the outward throw
  const fade = Math.pow(1 - t, 1.3);  // overall fade-out
  // Emergence point: on the boss rim along the birth direction.
  const ex = dirX * screenRadius, ey = dirY * screenRadius;
  const baseAng = Math.atan2(dirY, dirX);
  const rng = mulberry(seed);

  const droplets: SplashDroplet[] = [];
  for (let i = 0; i < DROPLETS; i++) {
    const spread = (rng() - 0.5) * 1.4;   // lateral cone around the birth axis
    const speed = 0.5 + rng() * 1.7;      // how far this droplet is flung
    const sz = 0.1 + rng() * 0.14;        // size as a fraction of the ball radius
    const wob = 0.3 + rng() * 0.7;        // per-droplet alpha variation
    const ang = baseAng + spread;
    const reach = screenRadius * speed * ease;
    const droop = t * t * screenRadius * 0.5; // a little gravity as it sprays
    const r = Math.max(0.5, screenRadius * sz * (1 - t * 0.6));
    droplets.push({
      x: ex + Math.cos(ang) * reach,
      y: ey + Math.sin(ang) * reach + droop,
      r,
      alpha: fade * wob,
      hx: -r * 0.3,
      hy: -r * 0.3,
    });
  }

  return {
    active: true,
    droplets,
    ringX: ex,
    ringY: ey,
    ringR: screenRadius * (0.25 + ease * 0.9),
    ringAlpha: (1 - t) * (1 - t) * 0.55,
    ringWidth: Math.max(1.5, 3 * scale) * (1 - t),
  };
}
