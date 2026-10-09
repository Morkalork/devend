/**
 * Handing GPU textures between Pixi and three.js on their shared context.
 *
 * The two libraries share ONE WebGL context (the PixiJS guide "Mixing PixiJS
 * and Three.js"), but neither knows the other's textures. The guide stops at
 * drawing one over the other; this renderer needs both directions:
 *
 *   PIXI -> THREE  the board's flat marks (regions, areas, props, the tops of
 *                  walls and slabs) are drawn by the sleek layers into a Pixi
 *                  RenderTexture, and the 3D floor and object tops sample it.
 *   THREE -> PIXI  the lit 3D frame is a three render target, shown by Pixi as
 *                  an ordinary Sprite, so every whole-frame effect the sleek
 *                  renderer already has (the level-clear sweep, the shatter,
 *                  the first-frame snapshot) works on the 3D board unchanged.
 *
 * Both are the same WebGLTexture handle seen through the other library's
 * wrapper; nothing is copied. Each side is told never to upload into or delete
 * the other's texture, which is the one way this goes wrong.
 */
import { ExternalTexture, LinearFilter, ClampToEdgeWrapping, SRGBColorSpace } from "three";
import { Texture as PixiTexture, TextureSource, type WebGLRenderer as PixiWebGLRenderer } from "pixi.js";
import type { RenderTexture } from "pixi.js";

/** The WebGLTexture behind a Pixi texture source (created if it is not yet). */
export function pixiGlTexture(renderer: PixiWebGLRenderer, source: TextureSource): WebGLTexture {
  return renderer.texture.getGlSource(source).texture;
}

/**
 * A three.js view of a Pixi RenderTexture. Rewrap after the Pixi texture is
 * resized: a resize allocates a new GL texture behind the same source.
 */
export function threeViewOf(renderer: PixiWebGLRenderer, rt: RenderTexture): ExternalTexture {
  const tex = new ExternalTexture(pixiGlTexture(renderer, rt.source));
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  // Pixi stores display colours; the surface material decodes them itself
  // (surfaceMaterial.ts), because an external texture cannot be given an
  // sRGB internal format after the fact.
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * A Pixi texture over a GL texture three.js owns.
 *
 * Pixi allocates a placeholder when it first sees the source; that is deleted
 * and replaced by three's handle. The source is never `update()`d, so Pixi never
 * uploads into it, and garbage collection is off, so Pixi never frees it. To
 * release it, call `releasePixiWrap` BEFORE destroying three's target, so
 * Pixi's own teardown deletes nothing that is not its.
 */
export function wrapForPixi(
  renderer: PixiWebGLRenderer, glTexture: WebGLTexture, width: number, height: number,
): PixiTexture {
  const source = new TextureSource({
    width, height, resolution: 1,
    autoGenerateMipmaps: false,
    autoGarbageCollect: false,
    scaleMode: "linear",
    alphaMode: "premultiplied-alpha",
  });
  const glSource = renderer.texture.getGlSource(source);
  renderer.gl.deleteTexture(glSource.texture);
  glSource.texture = glTexture;
  // Pixi caches the binding per unit; it was last bound to the deleted handle.
  renderer.texture.bindSource(PixiTexture.EMPTY.source, 0);
  return new PixiTexture({ source });
}

/** Detach three's handle so destroying the Pixi texture frees only Pixi's. */
export function releasePixiWrap(renderer: PixiWebGLRenderer, texture: PixiTexture): void {
  try {
    const glSource = renderer.texture.getGlSource(texture.source);
    glSource.texture = renderer.gl.createTexture() as WebGLTexture;
  } catch {
    /* context already gone: nothing of ours to protect */
  }
  texture.destroy(true);
}
