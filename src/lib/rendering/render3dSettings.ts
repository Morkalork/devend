/**
 * Which board renderer runs, and the 3D renderer's tuning knobs.
 *
 * Device preferences, persisted, and every one of them has an Admin control
 * (CLAUDE.md: a dev switch that only a URL or a console can reach is a switch
 * nobody flips). Nothing here imports three.js: the Admin screen reads these,
 * and it must not pull the 3D chunk in to draw a toggle.
 *
 * THE RENDERER. `three` (the default) is the 3D board: a three.js scene for the
 * floor, walls, objects, balls and lights, with the sleek Pixi renderer still
 * drawing the board's flat marks into it and its effects over it, on one shared
 * WebGL context (RENDER_3D_PLAN.md). `sleek` is the 2D renderer on its own, kept
 * as the fallback for a device the 3D one cannot start on, and as a switch for
 * comparing the two. Either one falls back to the emergency 2D board when
 * WebGL itself fails.
 *
 * Read at call time rather than cached at import, so a toggle in Admin takes
 * effect on the next board without a reload.
 */

export type RendererChoice = "three" | "sleek";
export type QualityTier = "low" | "medium" | "high";
export type QualitySetting = QualityTier | "auto";

export const RENDERER_KEY = "devend:renderer";
export const QUALITY_KEY = "devend:render3d:quality";
export const FOV_KEY = "devend:render3d:fov";
export const HEIGHT_KEY = "devend:render3d:height";

export const QUALITY_SETTINGS: readonly QualitySetting[] = ["auto", "low", "medium", "high"];

/** Field of view across the board's height, degrees (floorCamera.ts). */
export const DEFAULT_FOV = 26;
export const FOV_RANGE: readonly [number, number] = [8, 50];

/**
 * How tall everything standing on the board is, as a multiple of the
 * authored heights (heights3d.ts). 1 is the slab height the 2D light model was
 * tuned around, and under real lights it throws shadows too short to read
 * from above: the lamp hangs over a ball, so a fence a typical distance away
 * casts only a few units. 1.4 is where a fence's shadow reads at a glance
 * without the frame's lean hiding the floor at the edges.
 */
export const DEFAULT_HEIGHT_SCALE = 1.4;
export const HEIGHT_RANGE: readonly [number, number] = [0.4, 2.5];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode, embedded webview)
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the setting lasts as long as nothing re-reads it */
  }
}

/** The renderer the next board starts with. Anything unknown is the default. */
export function getRendererChoice(): RendererChoice {
  return read(RENDERER_KEY) === "sleek" ? "sleek" : "three";
}

export function setRendererChoice(choice: RendererChoice): void {
  // The default is stored as no key at all, so a total reset and a fresh
  // install agree on what "default" means.
  write(RENDERER_KEY, choice === "three" ? null : choice);
}

export function getQualitySetting(): QualitySetting {
  const v = read(QUALITY_KEY);
  return (QUALITY_SETTINGS as readonly string[]).includes(v ?? "") ? v as QualitySetting : "auto";
}

export function setQualitySetting(q: QualitySetting): void {
  write(QUALITY_KEY, q === "auto" ? null : q);
}

function readNumber(key: string, fallback: number, [lo, hi]: readonly [number, number]): number {
  const v = Number(read(key));
  return read(key) !== null && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function getFov(): number {
  return readNumber(FOV_KEY, DEFAULT_FOV, FOV_RANGE);
}

export function setFov(deg: number): void {
  const v = Math.min(FOV_RANGE[1], Math.max(FOV_RANGE[0], deg));
  write(FOV_KEY, v === DEFAULT_FOV ? null : String(v));
}

export function getHeightScale(): number {
  return readNumber(HEIGHT_KEY, DEFAULT_HEIGHT_SCALE, HEIGHT_RANGE);
}

export function setHeightScale(k: number): void {
  const v = Math.min(HEIGHT_RANGE[1], Math.max(HEIGHT_RANGE[0], k));
  write(HEIGHT_KEY, v === DEFAULT_HEIGHT_SCALE ? null : String(v));
}

/**
 * The tier `auto` starts at.
 *
 * A guess from what the device says about itself, refined by the renderer's
 * own frame timing (qualityGovernor.ts), which can only step DOWN: a phone
 * that guessed high and cannot hold it drops a tier, and one that guessed low
 * stays put rather than oscillating. Coarse pointer (a touch screen) is the
 * honest proxy for "a phone GPU at 2-3x DPR"; a desktop gets high.
 */
export function autoTier(env: { coarsePointer: boolean; dpr: number; cores: number }): QualityTier {
  if (!env.coarsePointer) return "high";
  if (env.cores > 0 && env.cores <= 4) return "low";
  return "medium";
}
