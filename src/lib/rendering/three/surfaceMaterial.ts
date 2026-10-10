/**
 * The material every 3D surface on the board is made of: lit by the scene's
 * real lights, coloured by what the 2D renderer drew at that spot.
 *
 * The sleek layers still draw the board's flat look - captured and live
 * ground, the lattice, coloured areas, props, the top faces of fences and
 * slabs - into one surface texture laid out exactly like the screen
 * (textureBridge.ts). Each 3D surface samples that texture at its own WORLD
 * (x, y), not at where it happens to land on screen. A fence top 13 units up
 * appears a few pixels further from the board centre than its footprint does,
 * but it still shows the colours drawn for its footprint, so a slab's top
 * carries its own markings rather than the floor beside it.
 *
 * What changes is the light. The 2D drawing is made under a flat scope (no
 * baked falloff, no baked shadows), and the 3D lights and shadow maps do that
 * work for real. Two adjustments keep it reading as the same board:
 *
 *   SIDES  sample the texture slightly inside the edge (`sampleSquash` for the
 *          instanced walls, an inset attribute for extruded slabs) so a side
 *          takes its object's colour rather than the antialiased fringe, and
 *          are a shade darker than tops as a material, before any lighting.
 *   SELF   a little of each surface's own colour is added unlit, so no part of
 *          the board can be lit to black and the accent marks the player reads
 *          (a fence's core, a growing tip) keep some glow of their own.
 */
import {
  MeshLambertMaterial, MeshStandardMaterial, ShaderChunk, Vector2, Vector3, Vector4,
  type Material, type Texture, type WebGLProgramParametersWithUniforms,
} from "three";
import type { QualityTier } from "@/lib/rendering/render3dSettings";
import { PREVIEW_DARK, type PreviewUniforms } from "./cutPreview3d";

/** Uniforms every surface material shares, updated once per frame. */
export interface SurfaceShared {
  uSurface: { value: Texture | null };
  /** (boardRect.left, boardRect.top, boardRect.scale, flipY) in surface px. */
  uSurfRect: { value: Vector4 };
  /** The surface texture's size in pixels. */
  uSurfSize: { value: Vector2 };
  /** How much of each surface's colour shows unlit (0 = fully lit only). */
  uSelfLit: { value: number };
  /** Linear albedo floor point lights see (the pool sheen, see POOL_LIGHTING). */
  uPoolFloor: { value: number };
  /** 0..1: how far a point light's grazing angle is ignored on the floor. */
  uPoolWrap: { value: number };
  /** 1 while point light 0 is the lamp, which lights like the room, not a pool. */
  uLampSlot: { value: number };
}

export function createSurfaceShared(): SurfaceShared {
  return {
    uSurface: { value: null },
    uSurfRect: { value: new Vector4(0, 0, 1, 0) },
    uSurfSize: { value: new Vector2(1, 1) },
    uSelfLit: { value: 0.16 },
    uPoolFloor: { value: 0.13 },
    uPoolWrap: { value: 0.8 },
    uLampSlot: { value: 0 },
  };
}

export interface SurfaceMaterialOptions {
  tier: QualityTier;
  /** Take alpha from the surface (the floor, which is translucent over the page). */
  translucent?: boolean;
  /** Scale applied to LOCAL position before sampling (instanced walls). */
  sampleSquash?: [number, number, number];
  /** Read a per-vertex `aSampleInset` (vec2, world units) added before sampling. */
  inset?: boolean;
  /** Multiplier on side faces' colour, as a material. */
  sideShade?: number;
  roughness?: number;
  /** The cut preview's darkness mask (cutPreview3d.ts): the floor only. */
  preview?: PreviewUniforms;
}

const VERT_PARS = /* glsl */`
uniform vec4 uSurfRect;
uniform vec2 uSurfSize;
uniform vec3 uSampleSquash;
varying vec2 vSurfUv;
varying float vSurfSide;
#ifdef SURF_PREVIEW
varying vec2 vPrevXZ;
#endif
#ifdef SURF_INSET
attribute vec2 aSampleInset;
#endif
`;

const VERT_MAIN = /* glsl */`
#include <begin_vertex>
{
  vec3 surfLocal = transformed * uSampleSquash;
  #ifdef SURF_INSET
  surfLocal.xz += aSampleInset;
  #endif
  vec4 surfWp = vec4(surfLocal, 1.0);
  #ifdef USE_INSTANCING
  surfWp = instanceMatrix * surfWp;
  #endif
  surfWp = modelMatrix * surfWp;
  vSurfUv = vec2(
    (uSurfRect.x + surfWp.x * uSurfRect.z) / uSurfSize.x,
    (uSurfRect.y + surfWp.z * uSurfRect.z) / uSurfSize.y
  );
  if (uSurfRect.w > 0.5) vSurfUv.y = 1.0 - vSurfUv.y;
  vSurfSide = 1.0 - abs(normalize(objectNormal).y);
  #ifdef SURF_PREVIEW
  // Untilted world units: the floor lives in the board group, so its LOCAL
  // position is the world point the grid is laid out in.
  vPrevXZ = transformed.xz;
  #endif
}
`;

const FRAG_PARS = /* glsl */`
uniform float uPoolFloor;
uniform float uPoolWrap;
uniform float uLampSlot;
uniform sampler2D uSurface;
uniform float uSelfLit;
uniform float uSideShade;
varying vec2 vSurfUv;
varying float vSurfSide;
#ifdef SURF_PREVIEW
uniform sampler2D uPreviewMask;
uniform vec4 uPreviewRect;
uniform float uPreviewStrength;
varying vec2 vPrevXZ;
#endif
vec3 surfDecode(vec3 c) {
  // Display colour to linear, the exact sRGB curve.
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec4 surfSample() {
  vec4 s = texture2D(uSurface, vSurfUv);
  // Pixi renders premultiplied.
  vec3 rgb = s.a > 0.0001 ? s.rgb / s.a : vec3(0.0);
  return vec4(surfDecode(clamp(rgb, 0.0, 1.0)), s.a);
}
`;

const FRAG_MAP = /* glsl */`
vec4 surfColor = surfSample();
float surfShade = mix(1.0, uSideShade, vSurfSide);
#ifdef SURF_PREVIEW
{
  vec2 puv = (vPrevXZ - uPreviewRect.xy) / uPreviewRect.zw;
  surfShade *= 1.0 - texture2D(uPreviewMask, puv).r * uPreviewStrength * ${PREVIEW_DARK.toFixed(3)};
}
#endif
diffuseColor.rgb *= surfColor.rgb * surfShade;
#ifdef SURF_TRANSLUCENT
diffuseColor.a *= surfColor.a;
#endif
`;

const FRAG_EMISSIVE = /* glsl */`
#include <emissivemap_fragment>
totalEmissiveRadiance += surfColor.rgb * surfShade * uSelfLit;
`;

/**
 * POOL LIGHTING: how a ball's light, a flash or an explosion lights the board.
 *
 * In 2D a ball's pool of light was ADDED to the picture, so it showed on any
 * ground, and on this board's near-black live space that is the only way a
 * pool shows at all. A physical light multiplies the surface instead, and a
 * dark green floor multiplied by a lamp is still a dark green floor. Two
 * departures from physics put the pools back while keeping what only real
 * lights give - walls that block them and throw shadows away from them:
 *
 *   SHEEN  point lights see each surface as no darker than `uPoolFloor`, as if
 *          the board had a faint grey sheen only they catch. The monitor and
 *          the room fill see the true colour, so the palette is unchanged
 *          wherever no point light reaches.
 *   WRAP   a light at ball height meets the floor at a grazing angle, so a
 *          physical pool is a hot spot under the ball and nothing a ball's
 *          width away. `uPoolWrap` takes most of the angle back out, leaving
 *          the falloff to distance, which is the pool the 2D board drew.
 *
 * The sheen skips point light 0 while it is the lamp (lights3d.ts): the lamp
 * stands in for the monitor and lights like a room light, not a pool. The
 * wrap applies to it too, which is what lets one light from over a ball lay
 * an even light across the whole board, as the 2D lamp scope did.
 */
const POINT_RE = "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
const POOL_RE = /* glsl */`{
  float poolK = ( uLampSlot > 0.5 && UNROLLED_LOOP_INDEX == 0 ) ? 0.0 : 1.0;
  float poolNl = saturate( dot( geometryNormal, directLight.direction ) );
  directLight.color *= mix( 1.0, 1.0 / max( poolNl, 0.2 ), uPoolWrap );
  vec3 poolKeep = material.diffuseColor;
  material.diffuseColor = mix( poolKeep, max( poolKeep, vec3( uPoolFloor ) ), poolK );
  ${POINT_RE}
  material.diffuseColor = poolKeep;
}`;

/** three's light loop with the point-light step swapped for the pool step. */
export function poolLightsChunk(): string {
  const chunk = ShaderChunk.lights_fragment_begin;
  const start = chunk.indexOf("#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )");
  const end = chunk.indexOf("#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )");
  if (start < 0 || end < start) return chunk;
  const point = chunk.slice(start, end);
  if (!point.includes(POINT_RE)) return chunk;
  return chunk.slice(0, start) + point.replace(POINT_RE, POOL_RE) + chunk.slice(end);
}

/**
 * A lit material that takes its colour from the shared surface texture.
 * Standard (PBR) on medium and high; Lambert on low, which is a fraction of
 * the per-light cost and the difference is hard to see on a matte board.
 */
export function makeSurfaceMaterial(shared: SurfaceShared, opts: SurfaceMaterialOptions): Material {
  const squash = new Vector3(...(opts.sampleSquash ?? [1, 1, 1]));
  const sideShade = opts.sideShade ?? 0.78;
  const base = opts.tier === "low"
    ? new MeshLambertMaterial({ color: 0xffffff })
    : new MeshStandardMaterial({ color: 0xffffff, roughness: opts.roughness ?? 0.82, metalness: 0 });
  if (opts.translucent) {
    base.transparent = true;
    base.depthWrite = false;
  }
  base.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSurface = shared.uSurface;
    shader.uniforms.uSurfRect = shared.uSurfRect;
    shader.uniforms.uSurfSize = shared.uSurfSize;
    shader.uniforms.uSelfLit = shared.uSelfLit;
    shader.uniforms.uPoolFloor = shared.uPoolFloor;
    shader.uniforms.uPoolWrap = shared.uPoolWrap;
    shader.uniforms.uLampSlot = shared.uLampSlot;
    if (opts.preview) Object.assign(shader.uniforms, opts.preview);
    shader.uniforms.uSampleSquash = { value: squash };
    shader.uniforms.uSideShade = { value: sideShade };
    const defines = (opts.inset ? "#define SURF_INSET\n" : "")
      + (opts.translucent ? "#define SURF_TRANSLUCENT\n" : "")
      + (opts.preview ? "#define SURF_PREVIEW\n" : "");
    shader.vertexShader = defines + VERT_PARS + shader.vertexShader
      .replace("#include <begin_vertex>", VERT_MAIN);
    shader.fragmentShader = defines + FRAG_PARS + shader.fragmentShader
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <emissivemap_fragment>", FRAG_EMISSIVE)
      .replace("#include <lights_fragment_begin>", poolLightsChunk());
  };
  // One program per variant, not one per material instance.
  base.customProgramCacheKey = () =>
    `surface:${opts.tier}:${opts.inset ? 1 : 0}:${opts.translucent ? 1 : 0}:${opts.preview ? 1 : 0}:${squash.toArray().join(",")}:${sideShade}`;
  return base;
}
