/**
 * The code under the board, lit from below by the balls.
 *
 * The board's floor is a sheet over the scrolling code the rest of the page
 * shows (CRTBackground), nine-tenths opaque, so that code is only ever a
 * faint texture under play. Here every ball's light also falls DOWN through
 * the sheet: inside its pool the floor thins and the code beneath shows,
 * lit in the ball's own colour, brightest right under the ball. A red ball
 * drags a red-lit patch of code around with it; the lamp of a lamp map lays a
 * wide warm one.
 *
 * The code is drawn into a texture the floor samples rather than lit on the
 * page itself: restyling the page's text every frame would be the per-frame
 * DOM work the canvas interface exists to avoid, and the floor shader already
 * knows every ball's light. It is the same text (lib/crtCode.ts), scrolling
 * the same way, so the code under the board is the code around it.
 *
 * Inside the pools the sheet goes opaque at the same time as it thins its own
 * paint, so the page's code does not show through doubled under the copy.
 */
import {
  CanvasTexture, Color, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, Vector3, Vector4, type Texture,
} from "three";
import { CODE_SNIPPETS } from "@/lib/crtCode";
import type { MoteLight } from "@/lib/rendering/motes";
import { underReach } from "@/lib/lightLook";

/**
 * A pool's intensity is the 2D glow's alpha, about a quarter for an ordinary
 * ball; this lifts it to the strength the light under the floor wants, capped
 * so a lamp or a pile of pools does not wash the code out to a flat colour.
 */
export const UNDER_GAIN = 3;
export const UNDER_MAX = 1.2;
/**
 * The widest a pool may spread under the floor, in world units (the board is
 * 900 across). A lamp's pool is the whole room; under the floor that would
 * light every line of code at once and the patch would stop being a patch.
 */
export const UNDER_MAX_REACH = 420;

/** The most lights the floor sums. A board with more keeps the brightest. */
export const MAX_UNDER_LIGHTS = 12;

/** The code texture: square, a power of two so it can repeat. */
export const CODE_TEX_SIZE = 1024;
/** One line of code in texels, and its glyphs' size. */
const CODE_LINE = 30;
const CODE_FONT_PX = 20;
/**
 * Texture uv per world unit. A line is ~37 world units, about the 16.5 CSS px
 * the page's 11px code takes at a phone's board scale (0.45 CSS px a unit),
 * so the code under the board reads at the same size as the code around it.
 */
export const CODE_UV_PER_UNIT = CODE_LINE / 37 / CODE_TEX_SIZE;
/** How fast the code scrolls up, in uv per second (the page's code also creeps upward). */
export const CODE_SCROLL_UV = 0.006;

export interface UnderlayUniforms {
  uCode: { value: Texture | null };
  uCodeScale: { value: number };
  uCodeScroll: { value: number };
  /** Per light: (x, z, reach, intensity), untilted world units. */
  uUnderLights: { value: Vector4[] };
  /** Per light: its colour, linear. */
  uUnderColors: { value: Vector3[] };
  uUnderCount: { value: number };
  /** The underglow dial (lightLook.underglow): 0 is off. */
  uUnderStrength: { value: number };
  /** Pool reach multiplier (lightLook.underglowReach). */
  uUnderReach: { value: number };
}

export function createUnderlayUniforms(): UnderlayUniforms {
  return {
    uCode: { value: null },
    uCodeScale: { value: CODE_UV_PER_UNIT },
    uCodeScroll: { value: 0 },
    uUnderLights: { value: Array.from({ length: MAX_UNDER_LIGHTS }, () => new Vector4()) },
    uUnderColors: { value: Array.from({ length: MAX_UNDER_LIGHTS }, () => new Vector3()) },
    uUnderCount: { value: 0 },
    uUnderStrength: { value: 0 },
    uUnderReach: { value: 1 },
  };
}

/**
 * The lights the floor sums this frame: every light the 2D pass measured (each
 * ball's own pool, and what mirrors and portals pass on), the brightest first
 * when there are more than it can take.
 */
export function pickUnderLights(lights: readonly MoteLight[], max = MAX_UNDER_LIGHTS): MoteLight[] {
  const live = lights.filter(l => l.intensity > 0.002 && l.reach > 0);
  return live.length <= max ? live : [...live].sort((a, b) => b.intensity - a.intensity).slice(0, max);
}

const scratch = new Color();

/** Load this frame's lights and dials into the floor's uniforms. */
export function syncUnderlay(u: UnderlayUniforms, lights: readonly MoteLight[], strength: number, reachDial: number, nowMs: number): void {
  u.uUnderStrength.value = Math.max(0, Math.min(1, strength));
  u.uUnderReach.value = underReach(reachDial);
  u.uCodeScroll.value = ((nowMs / 1000) * CODE_SCROLL_UV) % 1;
  if (u.uUnderStrength.value <= 0) { u.uUnderCount.value = 0; return; }
  const picked = pickUnderLights(lights);
  picked.forEach((l, i) => {
    u.uUnderLights.value[i].set(l.x, l.y, Math.min(l.reach, UNDER_MAX_REACH), Math.min(UNDER_MAX, l.intensity * UNDER_GAIN));
    scratch.setHex(l.color);
    u.uUnderColors.value[i].set(scratch.r, scratch.g, scratch.b);
  });
  u.uUnderCount.value = picked.length;
}

/** The code's lines, in a fixed order so the texture is the same every map. */
export function codeLines(): string[] {
  // A fixed interleave rather than the page's shuffle: stable, and the
  // texture is drawn once.
  const order = CODE_SNIPPETS.map((s, i) => ({ s, k: (i * 7919) % CODE_SNIPPETS.length }))
    .sort((a, b) => a.k - b.k).map(x => x.s);
  const lines: string[] = [];
  for (const snippet of order) lines.push(...snippet.split("\n"), "");
  return lines;
}

/**
 * Draw the code into a repeating texture: white glyphs on black, read as a
 * mask (the red channel). Redrawn once the page's mono face has loaded, in
 * case the first draw had to use the fallback.
 */
export function createCodeTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = CODE_TEX_SIZE;
  canvas.height = CODE_TEX_SIZE;
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // Canvas top is v = 0, so down the screen (world z) is down the code.
  tex.flipY = false;
  const draw = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CODE_TEX_SIZE, CODE_TEX_SIZE);
    ctx.fillStyle = "#fff";
    ctx.font = `500 ${CODE_FONT_PX}px 'JetBrains Mono', 'Fira Code', monospace`;
    ctx.textBaseline = "middle";
    const lines = codeLines();
    const rows = Math.floor(CODE_TEX_SIZE / CODE_LINE);
    // Two columns, the second further down the listing, so the short lines of
    // code fill the sheet instead of leaving its right half dark.
    const half = CODE_TEX_SIZE / 2;
    for (let r = 0; r < rows; r++) {
      const y = r * CODE_LINE + CODE_LINE / 2;
      ctx.fillText(lines[r % lines.length], 16, y, half - 24);
      ctx.fillText(lines[(r + Math.floor(lines.length / 2)) % lines.length], half + 16, y, half - 24);
    }
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load?.(`500 ${CODE_FONT_PX}px 'JetBrains Mono'`).then(draw, () => {});
  return tex;
}

// ── The floor shader's part ────────────────────────────────────────────────

export const UNDER_VERT_PARS = /* glsl */`
varying vec2 vUnderXZ;
`;

/** In the vertex main: the floor's LOCAL position is the untilted world point. */
export const UNDER_VERT_MAIN = /* glsl */`
vUnderXZ = transformed.xz;
`;

export const UNDER_FRAG_PARS = /* glsl */`
#define MAX_UNDER_LIGHTS ${MAX_UNDER_LIGHTS}
uniform sampler2D uCode;
uniform float uCodeScale;
uniform float uCodeScroll;
uniform vec4 uUnderLights[MAX_UNDER_LIGHTS];
uniform vec3 uUnderColors[MAX_UNDER_LIGHTS];
uniform int uUnderCount;
uniform float uUnderStrength;
uniform float uUnderReach;
varying vec2 vUnderXZ;
vec3 underLight() {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < MAX_UNDER_LIGHTS; i++) {
    if (i >= uUnderCount) break;
    vec4 l = uUnderLights[i];
    float r = clamp(l.z * uUnderReach, 1.0, ${UNDER_MAX_REACH.toFixed(1)});
    float k = clamp(1.0 - length(vUnderXZ - l.xy) / r, 0.0, 1.0);
    // Soft from the edge in, hot in the middle.
    sum += uUnderColors[i] * l.w * k * k;
  }
  return sum * uUnderStrength;
}
`;

/**
 * After the surface colour: inside a pool the sheet's own paint thins (so the
 * code reads) and the sheet goes opaque (so the page's code does not double
 * under the copy).
 */
export const UNDER_FRAG_MAP = /* glsl */`
vec3 underL = underLight();
float underK = clamp(max(underL.r, max(underL.g, underL.b)), 0.0, 1.0);
diffuseColor.rgb *= 1.0 - underK * 0.75;
diffuseColor.a = mix(diffuseColor.a, 1.0, underK);
`;

/** In the emissive step: the code's glyphs lit in the pool's colour, over a faint haze. */
export const UNDER_FRAG_EMISSIVE = /* glsl */`
{
  float glyph = texture2D(uCode, vec2(vUnderXZ.x * uCodeScale, vUnderXZ.y * uCodeScale + uCodeScroll)).r;
  totalEmissiveRadiance += underL * (glyph * 3.5 + 0.06);
}
`;
