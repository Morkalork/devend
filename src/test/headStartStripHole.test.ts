/**
 * The head-start strip is a ring, not a slab.
 *
 * Onboarding and the Equity Grant start a map with the arena's edge already
 * captured: the strip is the arena with the live board cut out of it. The 2D
 * layer drew the arena and the board as two poly() calls before one fill(),
 * which Pixi 8 fills as two shapes rather than a shape with a hole, so the
 * whole board was painted as captured ground. Reported from play on level 2
 * ("it covers the whole map with lock-color background"); the balls bounced
 * off edges nobody could see.
 *
 * A source pin, like the other renderer pins: drawing needs a WebGL context.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../lib/rendering/sleek/boardLayer.ts"), "utf8");

describe("the head-start strip", () => {
  it("is filled, then has each live-board hole cut out of it", () => {
    const at = SRC.indexOf("if (ground.strip) {");
    expect(at, "the strip fill has moved").toBeGreaterThan(0);
    const block = SRC.slice(at, SRC.indexOf("const loops =", at));
    const fill = block.indexOf(".fill(");
    const cut = block.indexOf(".cut()");
    expect(fill, "the strip is not filled").toBeGreaterThan(0);
    expect(cut, "the live board is not cut out of the strip").toBeGreaterThan(fill);
    expect(block).toMatch(/for \(const hole of ground\.strip\.holes\)/);
  });
});
