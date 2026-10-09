/**
 * What each quality tier spends, and the governor that steps down a tier when
 * the device cannot hold it.
 *
 * The expensive things on this board are all FILL: the floor covers most of
 * the canvas and every light is evaluated for every one of its pixels, and
 * every shadowed point light renders the scene six more times. So the tiers
 * trade, in order of how little they are missed: the resolution the 3D frame
 * is drawn at (the flat marks and effects drawn over it stay native), how many
 * lights get shadows, the shadow maps' size, and finally the shading model.
 *
 * The light COUNTS are fixed per tier on purpose. three.js compiles a shader
 * per number of lights, so a light pool that grew and shrank with the board
 * would recompile mid-play - a visible hitch exactly when an explosion goes off.
 * Unused lights sit in the pool at zero intensity, and an idle shadowed light
 * stops re-rendering its shadow map (lights3d.ts).
 */
import type { QualityTier } from "@/lib/rendering/render3dSettings";

export interface QualityPreset {
  tier: QualityTier;
  /** Max 3D-frame pixels per CSS pixel. The overlay always draws native. */
  maxPixelRatio: number;
  /** MSAA samples on the 3D frame. */
  samples: number;
  /** The monitor's (key light's) shadow map, square. */
  keyShadowSize: number;
  /** Point lights that cast shadows (balls first, then explosions). */
  shadowedLights: number;
  /** Their cube shadow maps, per face. */
  pointShadowSize: number;
  /** Point lights that light but do not cast. */
  plainLights: number;
  /** Explosion shards alive at once. */
  maxShards: number;
  /** Sphere tessellation. */
  sphereSegments: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  high: {
    tier: "high", maxPixelRatio: 2.5, samples: 4, keyShadowSize: 2048,
    shadowedLights: 4, pointShadowSize: 512, plainLights: 8, maxShards: 320, sphereSegments: 40,
  },
  medium: {
    tier: "medium", maxPixelRatio: 2, samples: 4, keyShadowSize: 1024,
    shadowedLights: 2, pointShadowSize: 256, plainLights: 6, maxShards: 200, sphereSegments: 32,
  },
  low: {
    tier: "low", maxPixelRatio: 1.5, samples: 2, keyShadowSize: 1024,
    shadowedLights: 1, pointShadowSize: 256, plainLights: 4, maxShards: 120, sphereSegments: 24,
  },
};

const ORDER: readonly QualityTier[] = ["low", "medium", "high"];

/** One tier cheaper, or null at the bottom. */
export function stepDown(tier: QualityTier): QualityTier | null {
  const i = ORDER.indexOf(tier);
  return i > 0 ? ORDER[i - 1] : null;
}

/**
 * Watches the gap between presented frames and asks for a cheaper tier when
 * the median stays over budget.
 *
 * Down only. A governor that also stepped up would oscillate: drop a tier, run
 * fast, step back up, run slow. A device that was guessed too low simply stays
 * a little plainer than it could be, which nobody files a bug about; one that
 * stutters, everybody does.
 *
 * Frames further apart than `maxGapMs` are not samples (a paused map, a tab in
 * the background, the level-clear hold) and are skipped, so a pause never
 * counts as slowness.
 */
export class QualityGovernor {
  private samples: number[] = [];
  private last = 0;
  private settleUntil = 0;

  constructor(
    private readonly budgetMs = 21,
    private readonly window = 120,
    private readonly maxGapMs = 120,
  ) {}

  /** Forget everything, and ignore the next `settleMs` (a tier just changed). */
  reset(now: number, settleMs = 1500): void {
    this.samples.length = 0;
    this.last = 0;
    this.settleUntil = now + settleMs;
  }

  /** Feed one presented frame; true when the median says step down. */
  frame(now: number): boolean {
    const gap = this.last > 0 ? now - this.last : 0;
    this.last = now;
    if (now < this.settleUntil || gap <= 0 || gap > this.maxGapMs) return false;
    this.samples.push(gap);
    if (this.samples.length < this.window) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples.length = 0;
    return median > this.budgetMs;
  }
}
