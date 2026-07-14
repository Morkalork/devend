/**
 * Texture plumbing for the Pixi renderer.
 *
 * Two ideas keep the port cheap:
 * 1. Every existing Canvas-2D bake (ballRenderCache, ballSphereCache, the
 *    board/region OffscreenCanvases) is wrapped as a Pixi texture keyed by the
 *    canvas object itself, so the bake logic is shared verbatim with the 2D
 *    renderer and a fresh bake (new canvas identity) naturally yields a fresh
 *    texture.
 * 2. Glows use a small set of WHITE radial-gradient profile textures that are
 *    tinted per use (sprite.tint), replacing the per-colour gradient bakes of
 *    the 2D path.
 */
import { CanvasSource, Texture } from "pixi.js";

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

interface CanvasTexEntry {
  tex: Texture;
  /** sweepCanvasTextures() frame counter at the last textureFor() fetch. */
  lastUsed: number;
}

const _canvasTextures = new Map<AnyCanvas, CanvasTexEntry>();
let _sweepFrame = 0;

/**
 * Texture wrapping a (baked) canvas; cached by canvas identity.
 *
 * Deliberately NOT Texture.from(): that registers the texture in Pixi's global
 * source cache, so after clearCanvasTextures() destroys it, a later
 * Texture.from(same canvas) would return the already-destroyed texture
 * (null source → batcher crash on the next frame). Constructing the
 * CanvasSource explicitly keeps this map as the only cache.
 */
export function textureFor(canvas: AnyCanvas): Texture {
  let entry = _canvasTextures.get(canvas);
  if (!entry) {
    entry = {
      tex: new Texture({ source: new CanvasSource({ resource: canvas as unknown as HTMLCanvasElement }) }),
      lastUsed: 0,
    };
    _canvasTextures.set(canvas, entry);
  }
  entry.lastUsed = _sweepFrame;
  return entry.tex;
}

// The bake caches (ballRenderCache, ballSphereCache, rainGlyphCache) are
// cleared on every level re-init, and GameCanvas creates FRESH board-grid /
// region OffscreenCanvases per level. This map is keyed by canvas identity, so
// without eviction every stale entry pins its GPU texture (the grid/region
// pair alone is two full-screen textures) and the dead canvas itself, forever:
// ~20 MB leaked per level, freezing long sessions.
const SWEEP_EVERY = 120;     // amortize the map walk (~2 s at 60 fps)
const MAX_IDLE_FRAMES = 600; // ~10 s unused → dead bake; re-wrapping a live one is cheap

/**
 * Advance the texture clock and (amortized) destroy entries whose canvas
 * hasn't been fetched for MAX_IDLE_FRAMES. Call once per rendered frame,
 * BEFORE the sync passes: every live consumer re-fetches via textureFor()
 * each frame, so anything evicted here is either dead or trivially re-wrapped.
 */
// Free a canvas texture's GPU memory. unload() on the source, NOT destroy():
// destroying a TextureSource that a cached Pixi batch still references makes
// the next batch validation read .alphaMode of null - the batcher crash (or a
// silently blank scene). unload() drops the GPU copy while keeping the JS
// object valid; the texture object itself is destroyed (nothing holds it -
// every consumer re-fetches via textureFor each frame).
function releaseEntry(entry: CanvasTexEntry): void {
  const source = entry.tex.source;
  entry.tex.destroy();
  source?.unload();
}

export function sweepCanvasTextures(): void {
  _sweepFrame++;
  if (_sweepFrame % SWEEP_EVERY !== 0) return;
  for (const [canvas, entry] of _canvasTextures) {
    if (_sweepFrame - entry.lastUsed > MAX_IDLE_FRAMES) {
      releaseEntry(entry);
      _canvasTextures.delete(canvas);
    }
  }
}

/** Drop every canvas-backed texture (GPU side); the canvases stay untouched. */
export function clearCanvasTextures(): void {
  for (const entry of _canvasTextures.values()) releaseEntry(entry);
  _canvasTextures.clear();
}

// ── White radial glow profiles (tinted per use) ─────────────────────────────

export type GlowProfile = "soft" | "tip" | "burst" | "pulse";

const PROFILE_STOPS: Record<GlowProfile, [number, number][]> = {
  // [offset, alpha] — mirrors the 2D gradient recipes (flame puff / fence tip
  // bloom / lock burst / baseline ball pulse) closely enough to read
  // identically after tinting.
  soft:  [[0, 1], [0.45, 0.55], [1, 0]],
  tip:   [[0, 0.73], [0.3, 0.27], [1, 0]],
  burst: [[0, 1], [0.5, 0.4], [1, 0]],
  pulse: [[0, 0.6], [0.4, 0.4], [0.7, 0.15], [1, 0]],
};

const GLOW_R = 64;
const _glowTextures = new Map<GlowProfile, Texture>();

/** A white radial gradient disc; tint + alpha it at the call site. */
export function glowTexture(profile: GlowProfile): Texture {
  let tex = _glowTextures.get(profile);
  if (!tex) {
    const oc = new OffscreenCanvas(GLOW_R * 2, GLOW_R * 2);
    const c = oc.getContext("2d")!;
    const grad = c.createRadialGradient(GLOW_R, GLOW_R, 0, GLOW_R, GLOW_R, GLOW_R);
    for (const [off, alpha] of PROFILE_STOPS[profile]) {
      grad.addColorStop(off, `rgba(255,255,255,${alpha})`);
    }
    c.fillStyle = grad;
    c.fillRect(0, 0, GLOW_R * 2, GLOW_R * 2);
    tex = new Texture({ source: new CanvasSource({ resource: oc as unknown as HTMLCanvasElement }) });
    _glowTextures.set(profile, tex);
  }
  return tex;
}

export function clearGlowTextures(): void {
  for (const tex of _glowTextures.values()) tex.destroy(true);
  _glowTextures.clear();
}

// ── Small shared helpers ─────────────────────────────────────────────────────

/** Seeded RNG + string hash (copied from renderFrame — module-private there). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
