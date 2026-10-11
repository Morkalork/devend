/**
 * The balls' light falling down through the floor onto the code beneath
 * (codeUnderlay.ts): "the light in the balls could be used to spread a light
 * downwards as well to light up the code beneath the background. Make it come
 * through the opaque a bit more" - every ball, the code drawn inside the board.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CODE_SNIPPETS } from "@/lib/crtCode";
import { DEFAULT_LIGHT_LOOK, underReach } from "@/lib/lightLook";
import type { MoteLight } from "@/lib/rendering/motes";
import {
  MAX_UNDER_LIGHTS, UNDER_GAIN, UNDER_MAX, UNDER_MAX_REACH, UNDER_FRAG_EMISSIVE, UNDER_FRAG_MAP,
  codeLines, createUnderlayUniforms, pickUnderLights, syncUnderlay,
} from "@/lib/rendering/three/codeUnderlay";

const read = (p: string) => readFileSync(p, "utf8");
const light = (over: Partial<MoteLight> = {}): MoteLight =>
  ({ x: 450, y: 450, reach: 100, intensity: 0.25, color: 0xff3344, ballId: "b1", ...over });

describe("which lights reach the code", () => {
  it("takes every ball's light, not only the bright ones", () => {
    const lights = [light({ ballId: "a", intensity: 0.05 }), light({ ballId: "b", intensity: 0.9 }), light({ ballId: "c" })];
    expect(pickUnderLights(lights)).toHaveLength(3);
  });

  it("keeps the brightest when a board has more lights than the floor sums", () => {
    const many = Array.from({ length: MAX_UNDER_LIGHTS + 5 }, (_, i) => light({ ballId: `b${i}`, intensity: (i + 1) / 100 }));
    const picked = pickUnderLights(many);
    expect(picked).toHaveLength(MAX_UNDER_LIGHTS);
    expect(Math.min(...picked.map(l => l.intensity))).toBeCloseTo(6 / 100);
  });

  it("drops a light that has gone out", () => {
    expect(pickUnderLights([light({ intensity: 0 }), light({ reach: 0 })])).toEqual([]);
  });
});

describe("what the floor is told each frame", () => {
  it("loads each light's place, reach, strength and colour", () => {
    const u = createUnderlayUniforms();
    syncUnderlay(u, [light({ x: 120, y: 340 })], 0.8, 0.5, 0);
    expect(u.uUnderCount.value).toBe(1);
    const l = u.uUnderLights.value[0];
    expect([l.x, l.y, l.z]).toEqual([120, 340, 100]);
    expect(l.w).toBeCloseTo(0.25 * UNDER_GAIN);
    // The ball's colour, red-dominant, in linear light.
    const c = u.uUnderColors.value[0];
    expect(c.x).toBeGreaterThan(c.y);
    expect(c.x).toBeGreaterThan(c.z);
    expect(u.uUnderStrength.value).toBe(0.8);
    expect(u.uUnderReach.value).toBeCloseTo(underReach(0.5));
  });

  it("does not let a lamp light every line of code at once", () => {
    const u = createUnderlayUniforms();
    syncUnderlay(u, [light({ reach: 3000, intensity: 1 })], 1, 1, 0);
    expect(u.uUnderLights.value[0].z).toBe(UNDER_MAX_REACH);
    expect(u.uUnderLights.value[0].w).toBe(UNDER_MAX);
  });

  it("is off at 0, the solid floor it was", () => {
    const u = createUnderlayUniforms();
    syncUnderlay(u, [light()], 0, 0.5, 0);
    expect(u.uUnderCount.value).toBe(0);
    expect(u.uUnderStrength.value).toBe(0);
  });

  it("scrolls the code with time, and wraps", () => {
    const u = createUnderlayUniforms();
    syncUnderlay(u, [], 1, 0.5, 0);
    const a = u.uCodeScroll.value;
    syncUnderlay(u, [], 1, 0.5, 10_000);
    expect(u.uCodeScroll.value).toBeGreaterThan(a);
    syncUnderlay(u, [], 1, 0.5, 1e9);
    expect(u.uCodeScroll.value).toBeGreaterThanOrEqual(0);
    expect(u.uCodeScroll.value).toBeLessThan(1);
  });
});

describe("the dials", () => {
  it("are on by default, and reach a little past the ball's own pool", () => {
    expect(DEFAULT_LIGHT_LOOK.underglow).toBeGreaterThan(0);
    expect(underReach(DEFAULT_LIGHT_LOOK.underglowReach)).toBeGreaterThan(1);
    expect(underReach(0)).toBeLessThan(underReach(1));
  });
});

describe("the code under the board", () => {
  it("is the same code the page scrolls", () => {
    const lines = codeLines();
    expect(lines.length).toBeGreaterThan(40);
    for (const snippet of CODE_SNIPPETS) expect(lines.join("\n")).toContain(snippet);
    expect(read("src/components/game/CRTBackground.tsx")).toContain("import { CODE_SNIPPETS } from '@/lib/crtCode';");
  });

  it("is in the same order every map", () => {
    expect(codeLines()).toEqual(codeLines());
  });

  it("reads the right way up", () => {
    // A canvas texture is flipped by default, which turned the code upside down.
    expect(read("src/lib/rendering/three/codeUnderlay.ts")).toContain("tex.flipY = false;");
  });
});

describe("the floor, and only the floor", () => {
  it("thins the sheet and turns it opaque inside a pool, so the page's code does not double", () => {
    expect(UNDER_FRAG_MAP).toMatch(/diffuseColor\.rgb \*= 1\.0 - underK/);
    expect(UNDER_FRAG_MAP).toMatch(/diffuseColor\.a = mix\(diffuseColor\.a, 1\.0, underK\)/);
  });

  it("lights the glyphs in the pool's colour", () => {
    expect(UNDER_FRAG_EMISSIVE).toContain("texture2D(uCode");
    expect(UNDER_FRAG_EMISSIVE).toContain("totalEmissiveRadiance += underL");
  });

  it("is given to the floor material alone, and fed every frame", () => {
    const r = read("src/lib/rendering/three/ThreeRenderer.ts");
    expect(r).toMatch(/translucent: true, roughness: 0\.9, preview: this\.previewUniforms, underlay: this\.underlay/);
    expect((r.match(/underlay: this\.underlay/g) ?? []).length).toBe(1);
    expect(r).toContain("syncUnderlay(this.underlay, frame.lights, look.underglow, look.underglowReach, now);");
  });
});
