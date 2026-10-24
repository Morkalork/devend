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
import { TIER_ORDER, type QualityTier } from "@/lib/rendering/render3dSettings";

export interface QualityPreset {
  tier: QualityTier;
  /** Max 3D-frame pixels per CSS pixel. The overlay always draws native. */
  maxPixelRatio: number;
  /** MSAA samples on the 3D frame. */
  samples: number;
  /** Whether the monitor (the key light) casts shadows at all. */
  keyShadow: boolean;
  /** The monitor's (key light's) shadow map, square. */
  keyShadowSize: number;
  /** Point lights that cast shadows (balls first, then explosions). */
  shadowedLights: number;
  /** Their cube shadow maps, per face. */
  pointShadowSize: number;
  /** Point lights that light but do not cast. */
  plainLights: number;
  /**
   * Cube shadow maps redrawn per frame, shared out in turn among the shadowed
   * lights (lights3d.ts). Each is six scene renders, and redrawing every one
   * every frame was the single largest cost on a phone: two shadowed lights
   * plus the monitor made 13 scene renders a frame before the board itself.
   */
  shadowRefreshPerFrame: number;
  /** The monitor's shadow is redrawn every this many frames. */
  keyShadowEvery: number;
  /** Explosion shards alive at once. */
  maxShards: number;
  /** Sphere tessellation. */
  sphereSegments: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  high: {
    tier: "high", maxPixelRatio: 2.5, samples: 4, keyShadow: true, keyShadowSize: 2048,
    shadowedLights: 4, pointShadowSize: 512, plainLights: 8, maxShards: 320, sphereSegments: 40,
    shadowRefreshPerFrame: 2, keyShadowEvery: 1,
  },
  medium: {
    // 2x MSAA, not 4x: the frame is half-float, so every sample is 8 bytes,
    // and at a phone's 2x the 4x buffer alone was ~48MB of bandwidth a frame.
    tier: "medium", maxPixelRatio: 2, samples: 2, keyShadow: true, keyShadowSize: 1024,
    shadowedLights: 2, pointShadowSize: 256, plainLights: 6, maxShards: 200, sphereSegments: 32,
    shadowRefreshPerFrame: 1, keyShadowEvery: 2,
  },
  low: {
    tier: "low", maxPixelRatio: 1.5, samples: 2, keyShadow: true, keyShadowSize: 1024,
    shadowedLights: 1, pointShadowSize: 256, plainLights: 4, maxShards: 120, sphereSegments: 24,
    shadowRefreshPerFrame: 1, keyShadowEvery: 2,
  },
  // For a phone that cannot hold "low": no shadow is rendered at all (each
  // shadowed point light is six extra scene passes, the key light one more),
  // no MSAA, the 3D frame at one pixel per CSS pixel, and coarser spheres and
  // fewer shards. The light POOL keeps its five: on a dark map, and in a light
  // syntax area, a light is how the player sees a ball or an area at all, so
  // the balls still light the floor and the code under it. Nothing the game
  // reads goes away, only how rich it looks.
  minimal: {
    tier: "minimal", maxPixelRatio: 1, samples: 0, keyShadow: false, keyShadowSize: 512,
    shadowedLights: 0, pointShadowSize: 256, plainLights: 5, maxShards: 60, sphereSegments: 16,
    shadowRefreshPerFrame: 0, keyShadowEvery: 1,
  },
};

/** One tier cheaper, or null at the bottom. */
export function stepDown(tier: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i > 0 ? TIER_ORDER[i - 1] : null;
}

/** One tier richer, or null at the top. */
export function stepUp(tier: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

/**
 * Under this median frame gap (ms) a tier is being held with room to spare,
 * and after `FAST_WINDOWS` such windows in a row (about twelve seconds of
 * play) the next map may try the tier above (ThreeRenderer). Well under the
 * 16.7ms of 60Hz, so a device that merely keeps up does not climb into a tier
 * it will then have to fall out of.
 */
export const FAST_FRAME_MS = 14;
export const FAST_WINDOWS = 3;

/**
 * Past this median frame gap (ms) the map is not merely over budget but
 * visibly struggling (under ~30 fps), and the renderer drops the 3D frame's
 * resolution at once rather than waiting out the map (ThreeRenderer).
 */
export const SEVERE_FRAME_MS = 34;

/**
 * Watches the gap between presented frames and asks for a cheaper tier when
 * the median stays over budget.
 *
 * Its verdicts are per WINDOW: `frame` is true when the window's median says
 * step down, and `windows` counts the windows judged so the renderer can also
 * read a fast one (`lastMedianMs` under FAST_FRAME_MS) and step up at the next
 * map. Stepping up used to be refused outright, for fear of oscillation: drop
 * a tier, run fast, step back up, run slow. It is allowed now because the
 * guess starts a phone LOW (render3dSettings.autoTier), so climbing is how a
 * capable phone gets its shadows at all; the oscillation is closed from the
 * other side, by the learned limit: a step down caps the device there, and
 * nothing climbs past a cap.
 *
 * A single frame further apart than `maxGapMs` is not a sample: that is a
 * pause (a paused map, a tab in the background, the level-clear hold), and a
 * pause must never count as slowness. But a RUN of them is the device itself:
 * on a phone drawing 5 fps every gap is 200ms, and skipping them all left the
 * slowest devices the only ones never stepped down. So `longRun` long gaps in
 * a row count, each, up to `pauseMs`; a gap past that is always a pause.
 *
 * It judges after `window` frames or `windowMs` of them, whichever comes
 * first (at least `minSamples`), so a slow device is not left waiting through
 * 120 slow frames for a verdict.
 */
export class QualityGovernor {
  private samples: number[] = [];
  private sampledMs = 0;
  private last = 0;
  private settleUntil = 0;
  /** Long gaps in a row, and the ones held back until the run proves real. */
  private longGaps: number[] = [];
  /** The median frame gap (ms) of the last full window, 0 before the first. */
  lastMedianMs = 0;
  /** Windows judged since the last reset. */
  windows = 0;

  constructor(
    private readonly budgetMs = 21,
    private readonly window = 120,
    private readonly maxGapMs = 120,
    private readonly windowMs = 4000,
    private readonly minSamples = 20,
    private readonly longRun = 5,
    private readonly pauseMs = 1500,
  ) {}

  /** Forget everything, and ignore the next `settleMs` (a tier just changed). */
  reset(now: number, settleMs = 1500): void {
    this.samples.length = 0;
    this.sampledMs = 0;
    this.longGaps.length = 0;
    this.last = 0;
    this.windows = 0;
    this.settleUntil = now + settleMs;
  }

  /** Feed one presented frame; true when the median says step down. */
  frame(now: number): boolean {
    const gap = this.last > 0 ? now - this.last : 0;
    this.last = now;
    if (now < this.settleUntil || gap <= 0) return false;
    if (gap > this.pauseMs) {
      this.longGaps.length = 0;
      return false;
    }
    if (gap > this.maxGapMs) {
      // Held back until enough follow in a row to be the device, not a pause.
      this.longGaps.push(gap);
      if (this.longGaps.length < this.longRun) return false;
      for (const g of this.longGaps) this.add(g);
      this.longGaps.length = 0;
    } else {
      this.longGaps.length = 0;
      this.add(gap);
    }
    const enough = this.samples.length >= this.window
      || (this.samples.length >= this.minSamples && this.sampledMs >= this.windowMs);
    if (!enough) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples.length = 0;
    this.sampledMs = 0;
    this.lastMedianMs = median;
    this.windows++;
    return median > this.budgetMs;
  }

  private add(gap: number): void {
    this.samples.push(gap);
    this.sampledMs += gap;
  }
}
