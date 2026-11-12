/**
 * The board after a resize (reported from the Playground, 2026-11-12: the
 * board drawn off to one side, its 3D walls and flat marks apart, a slab of
 * frame left behind).
 *
 * Two causes, each pinned here against its source, because both live where a
 * test cannot draw (a shared WebGL context, a ResizeObserver):
 *
 * 1. three.js keeps its own idea of the canvas size from when it was made on
 *    the canvas it shares with Pixi, and restores that viewport whenever it
 *    goes back to the screen (every frame). After any resize, Pixi then drew
 *    the whole board into the old size. A window resize or a phone rotation
 *    was enough, in a run as well as in the Playground.
 * 2. The board was only re-laid out on a WINDOW resize, so its container
 *    changing width (the Playground's sidebar mounting after the map) left it
 *    laid out for the old width while the HUD re-centred.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("the 3D frame after a resize", () => {
  it("tells three the canvas's new size whenever the frame is re-made", () => {
    const src = read("src/lib/rendering/three/ThreeRenderer.ts");
    const body = src.slice(src.indexOf("resizeScene(widthPx: number, heightPx: number)"), src.indexOf("renderScene(frame: HybridFrame)"));
    expect(body).toMatch(/renderer\.setViewport\(0, 0, widthPx \/ pr, heightPx \/ pr\);/);
    expect(body).toMatch(/renderer\.setScissor\(0, 0, widthPx \/ pr, heightPx \/ pr\);/);
  });
});

describe("the board's container changing width", () => {
  it("re-lays the board out, not only a window resize", () => {
    const src = read("src/components/game/GameCanvas.tsx");
    const at = src.indexOf("containerWatch = new ResizeObserver(");
    expect(at, "no observer on the board's container").toBeGreaterThan(-1);
    const body = src.slice(at, at + 900);
    expect(body).toMatch(/Math\.abs\(prev\.w - w\) >= 1\) \{\s*resizeCanvas\(\);/);
    // Not behind the dev-only guard any more.
    expect(src.slice(at - 200, at)).not.toContain('process.env.NODE_ENV === "development"');
  });
});
