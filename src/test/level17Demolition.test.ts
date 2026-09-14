/**
 * Level 17 "Deprecation" stays the map DEMOLITION_PLAN.md describes.
 *
 * The structural guards (gap rule, overlap, launcher runway, win spec) cover
 * it like any map. What they cannot know is what the map is FOR, and these
 * are the properties that make it a Demolition map rather than a launcher map
 * with furniture: a wall of one-touch bricks, a clause large enough to force
 * aiming, slack wide enough that no single cut is fatal, and a way in that
 * keeps the moat from being captured at load (section 7.6).
 */
import { describe, it, expect } from "vitest";
import { LADDER, byLevel } from "./fixtures/maps";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import type { WallRectEntity } from "@/types/level";

const level = byLevel(LADDER, 17)!;
const walls = (level.entities ?? []).filter(e => e.kind === "wall") as WallRectEntity[];
const bricks = walls.filter(e => e.brittle);
const breakables = walls.filter(e => e.breakable || e.chest || e.brittle);

describe("level 17 is a Demolition map", () => {
  it("exists and is authored", () => {
    expect(level).toBeTruthy();
    expect(level.variety ?? 0).toBe(0);
    expect(level.randomShapes ?? 0).toBe(0);
  });

  it("asks for a smash count that accidents alone will not deliver, with slack", () => {
    const spec = resolveWinSpec(level, NO_RUN_RULES);
    const smash = spec.require.find(c => c.kind === "smashed");
    expect(smash && smash.kind === "smashed" ? smash.count : 0).toBe(10);
    // The slack rule: more objects than the clause counts, and here a lot more,
    // because the wall IS the map's slack.
    expect(breakables.length).toBeGreaterThanOrEqual(10 + 5);
    expect(spec.require.some(c => c.kind === "space")).toBe(true);
    expect(spec.alsoWinIf).toEqual([]);
  });

  it("is a wall of glass, not a slab drawn in pieces", () => {
    expect(bricks.length).toBeGreaterThanOrEqual(14);
    for (const b of bricks) {
      expect(b.hitsToBreak ?? 3, `${b.id} carries a hit count a brittle brick ignores`).toBe(3);
    }
  });

  it("leaves a legal doorway in the wall", () => {
    // Left column: the middle brick is omitted, so the gap between the two
    // that remain is a neck (60 or more), never the forbidden in-between band.
    // A ring with no legal way in encloses the moat, and section 7.6 says an
    // enclosed space is captured at load.
    const l1 = bricks.find(b => b.id === "brick-l1")!;
    const l3 = bricks.find(b => b.id === "brick-l3")!;
    const doorway = l3.y - (l1.y + l1.height);
    expect(doorway).toBeGreaterThanOrEqual(60);
  });

  it("keeps the wall in the traffic, not behind a neck", () => {
    // Measured, twice: a wall in a room of its own is buried by the first cut
    // that separates the balls from the neck (the bot lost 7 of 8 that way,
    // most at over 50% remaining), because the launcher gathers the whole
    // roster in the other room. The wall lives where the balls are, per
    // section 9's rule, and the smash is a tempo lever rather than a gate.
    const solids = walls.filter(w => !w.breakable && !w.brittle && !w.chest);
    for (const s of solids) {
      expect(s.width * s.height, `${s.id} is big enough to divide the board`).toBeLessThan(120 * 120);
    }
  });

  it("keeps its pocket away from the wall, where the reach guard will let it lock", () => {
    // Every brick's strike box (a ball radius plus two cells, generously 60)
    // must miss the pockets under both shelves, or the map's superior pockets
    // would be refused as locks until the clause is met.
    for (const id of ["corner-shelf"]) {
      const shelf = walls.find(w => w.id === id)!;
      const pocket = { x0: shelf.x, x1: shelf.x + shelf.width, y0: shelf.y + shelf.height, y1: 855 };
      for (const b of breakables) {
        const reach = 60;
        const overlaps =
          b.x - reach < pocket.x1 && b.x + b.width + reach > pocket.x0 &&
          b.y - reach < pocket.y1 && b.y + b.height + reach > pocket.y0;
        expect(overlaps, `${b.id} reaches into the ${id} pocket`).toBe(false);
      }
    }
  });

  it("pins its roster, because density is the hammer", () => {
    expect(level.ballTypeIds).toEqual(["red", "grey", "blue"]);
  });
});
