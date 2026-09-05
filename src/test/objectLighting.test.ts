/**
 * A destructible is lit like the wall beside it.
 *
 * Reported after the board's wash gained a floor: destructibles needed
 * "light/shadow as well, so they match in style". They already had a cast
 * shadow, an ambient-tinted body and a per-edge rim, so the mismatch was not
 * structural. It was two things a screenshot shows and a code read does not:
 *
 *   THE BODY was `mix(obstacle, amber, 0.18)`, which shifts the hue and takes
 *     the brightness up 20% with it. On a board that had just been darkened,
 *     the breakable became the brightest thing on it and stopped reading as an
 *     object standing in the light.
 *   NO CONTACT BAND. Balls, movers and props all get the short dense shadow
 *     that seats an object on the surface. The slabs - solid AND breakable -
 *     never did, so both floated.
 */
import { describe, it, expect } from "vitest";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import { contactFor, shadowFor, lightScope, slabHeight } from "@/lib/rendering/sleek/light";

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const RECT = { left: 0, top: 0, width: 900, height: 900, scale: 1 };

describe("a breakable is the same material as a wall", () => {
  it("stands at the same brightness as a solid obstacle", () => {
    // Brightness here means "how much light is falling on this". A breakable is
    // made of the same stuff standing in the same room, so it cannot be the
    // brightest thing on the board just for being breakable.
    const solid = luma(rgb(PALETTE.obstacle));
    const breakable = luma(rgb(PALETTE.breakable));
    expect(breakable / solid, "a breakable outshines the wall beside it")
      .toBeGreaterThan(0.95);
    expect(breakable / solid).toBeLessThan(1.05);
  });

  const share = (c: number[]) => [c[0] / (c[0] + c[1] + c[2]), c[2] / (c[0] + c[1] + c[2])];

  it("is still warmer, so it is not pixel-identical to that wall", () => {
    // Warmth carries the identity now that brightness does not. Losing it
    // entirely would put us back to a breakable being invisible until hit.
    const [solidR, solidB] = share(rgb(PALETTE.obstacle));
    const [brkR, brkB] = share(rgb(PALETTE.breakable));
    expect(brkR, "the breakable lost its warm shift").toBeGreaterThan(solidR + 0.02);
    expect(brkB).toBeLessThan(solidB);
  });

  /**
   * A warm SHIFT was not enough, and that is a report rather than a theory: a
   * breakable slab was read as scenery on a phone. The shift was two steps of
   * olive off the wall, which survives the test above and still loses at a
   * glance. So the hue goes all the way to gold and the brightness stays put -
   * the discipline the tests above protect is exactly what makes that safe.
   */
  it("reads as gold rather than as a slightly warm wall", () => {
    const [wallR] = share(rgb(PALETTE.obstacle));
    const [brkR] = share(rgb(PALETTE.breakable));
    // Not "warmer than the wall" - decisively warmer, and red-dominant, which
    // an olive is not.
    expect(brkR, "the gold went back to being a warm olive")
      .toBeGreaterThan(wallR + 0.12);
    const [r, g, b] = rgb(PALETTE.breakable);
    expect(r, "gold means red leads").toBeGreaterThan(g);
    expect(g, "gold means blue trails").toBeGreaterThan(b);
  });

  it("is outlined in its own colour, not the wall's", () => {
    // The silhouette is what the eye reads first, and breakables were outlined
    // in obstacleEdge - the SAME edge as the wall beside them. The one part
    // doing the identifying was drawing them as ordinary walls.
    expect(PALETTE.breakableEdge, "breakables are wearing the wall's outline again")
      .not.toBe(PALETTE.obstacleEdge);
    // Same light on different material: the rim carries hue, not extra glare.
    const wall = luma(rgb(PALETTE.obstacleEdge));
    const brk = luma(rgb(PALETTE.breakableEdge));
    expect(brk / wall, "the breakable rim became a highlight instead of an edge")
      .toBeLessThan(1.1);
    expect(brk / wall).toBeGreaterThan(0.9);
  });

  it("belongs to the same family as the chest and its own debris", () => {
    // The board said "this comes apart" in three languages: an olive body, an
    // amber chest, and #ffb454 shatter debris. One family, so the lesson from
    // the chest carries to the slab.
    const hue = (c: number[]) => (c[0] - c[2]) / (c[0] + c[1] + c[2]);
    for (const [name, colour] of [
      ["breakable", PALETTE.breakable],
      ["breakableEdge", PALETTE.breakableEdge],
      ["chest", PALETTE.amber],
      ["debris", 0xffb454],
    ] as const) {
      expect(hue(rgb(colour)), `${name} is not in the warm family`).toBeGreaterThan(0.2);
    }
  });
});

describe("the contact band that seats an object", () => {
  const light = lightScope(RECT, 0);
  const at = (x: number, y: number) => ({
    cast: shadowFor(light, x, y, slabHeight(RECT.scale)),
    contact: contactFor(light, x, y, slabHeight(RECT.scale)),
  });

  it("is much shorter than the cast shadow", () => {
    // The whole point: a tight dark band hard against the body, not a second
    // copy of the cast shadow.
    const { cast, contact } = at(450, 450);
    expect(contact.length).toBeLessThan(cast.length * 0.5);
    expect(contact.length).toBeGreaterThan(0);
  });

  it("falls the same way as the cast shadow", () => {
    // Two shadows from one object pointing different ways is the flat-board
    // failure this renderer opened by naming.
    const { cast, contact } = at(200, 700);
    expect(contact.dx).toBeCloseTo(cast.dx, 6);
    expect(contact.dy).toBeCloseTo(cast.dy, 6);
  });

  it("is dense enough to read against the board", () => {
    expect(at(450, 450).contact.alpha).toBeGreaterThan(0.2);
  });
});
