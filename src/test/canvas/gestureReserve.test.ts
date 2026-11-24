/**
 * A touch on the tree map is the map's (ui/kit/gesture.ts reservePointer).
 *
 * Reported from play: the ball tree was very hard to pan, worst when dragging
 * down. The map is a pan view inside the between-map screen's scroll view, and
 * both heard the same finger. A vertical drag went to whichever listener heard
 * the first big move, and a page pulled at its top then caught the next touch
 * as well. The pan view now reserves every touch that lands on it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beginPointer, claimPointer, claimedByOther, releasePointer, reservePointer } from "@/ui/kit/gesture";

const pan = Symbol("pan");
const page = Symbol("page");

describe("a reserved touch", () => {
  it("cannot be claimed by anyone else, not even to catch a fling", () => {
    const down = {};
    beginPointer(1, down);
    reservePointer(1, pan);
    // The scroll view hears the same touch-down after the pan view.
    beginPointer(1, down);
    expect(claimPointer(1, page)).toBe(false);
    expect(claimPointer(1, pan)).toBe(true);
    expect(claimedByOther(1, page)).toBe(true);
    releasePointer(1, pan);
  });

  it("is not a claim, so a tap under the finger still fires until the drag is taken", () => {
    beginPointer(2, {});
    reservePointer(2, pan);
    // What a Pressable asks before it fires.
    expect(claimedByOther(2)).toBe(false);
    claimPointer(2, pan);
    expect(claimedByOther(2)).toBe(true);
    releasePointer(2, pan);
  });

  it("ends with the touch: a new one starts unreserved, and so does a released one", () => {
    beginPointer(3, {});
    reservePointer(3, pan);
    beginPointer(3, {});
    expect(claimPointer(3, page)).toBe(true);
    releasePointer(3, page);

    beginPointer(4, {});
    reservePointer(4, pan);
    releasePointer(4, pan);
    expect(claimPointer(4, page)).toBe(true);
    releasePointer(4, page);
  });

  it("is the first reserver's: a second reserver of the same touch does not take it over", () => {
    beginPointer(5, {});
    reservePointer(5, pan);
    reservePointer(5, page);
    expect(claimPointer(5, page)).toBe(false);
    expect(claimPointer(5, pan)).toBe(true);
    releasePointer(5, pan);
  });
});

describe("the pan view", () => {
  it("reserves every touch that lands on it, on the touch-down", () => {
    const src = readFileSync(resolve(__dirname, "../../ui/kit/pan.tsx"), "utf8");
    const down = src.slice(src.indexOf("const onPointerDown"), src.indexOf("const onGlobalPointerMove"));
    expect(down).toMatch(/beginPointer\(e\.pointerId, e\.nativeEvent\);\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*reservePointer\(e\.pointerId, owner\.current\);/);
  });
});
