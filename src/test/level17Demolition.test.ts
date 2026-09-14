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

  it("asks for a smash count a side cut cannot bury, with slack", () => {
    const spec = resolveWinSpec(level, NO_RUN_RULES);
    const smash = spec.require.find(c => c.kind === "smashed");
    expect(smash && smash.kind === "smashed" ? smash.count : 0).toBe(16);
    // A vertical cut with every ball on one side buries about half the wall.
    // That has to be survivable, so the count stays under half the wall; the
    // cut that IS fatal is a horizontal one above every ball, which is the
    // map's one rule and is visible at decision time.
    expect(breakables.length).toBeGreaterThanOrEqual(2 * 16 + 1);
    expect(spec.require.some(c => c.kind === "space")).toBe(true);
    expect(spec.alsoWinIf).toEqual([]);
  });

  it("is a wall of glass along the top edge, three rows deep", () => {
    expect(bricks.length).toBeGreaterThanOrEqual(34);
    for (const b of bricks) {
      expect(b.hitsToBreak ?? 3, `${b.id} carries a hit count a brittle brick ignores`).toBe(3);
      expect(b.y + b.height, `${b.id} is not part of the top wall`).toBeLessThanOrEqual(140);
    }
    const rows = new Set(bricks.map(b => b.y));
    expect(rows.size).toBe(3);
  });

  it("hides the vault in the back row, behind the bricks", () => {
    const vault = walls.find(w => w.chest)!;
    expect(vault).toBeTruthy();
    const backRow = Math.min(...bricks.map(b => b.y));
    expect(vault.y).toBe(backRow);
    // Something brittle sits directly under it, so it cannot be hit first.
    const under = bricks.filter(b => b.y > vault.y && b.x < vault.x + vault.width && b.x + b.width > vault.x);
    expect(under.length).toBeGreaterThanOrEqual(2);
  });

  it("serves from the bottom, straight up into the wall", () => {
    const barrel = (level.entities ?? []).find(e => e.kind === "launcher") as { y: number; height: number; facing: string };
    expect(barrel.facing).toBe("up");
    expect(barrel.y + barrel.height).toBeGreaterThan(800);
  });

  it("has no solid divider: the wall lives where the balls are", () => {
    // Measured on two earlier layouts: a wall in a room of its own is buried
    // by the first cut that separates the balls from its neck. Every solid on
    // this map is small furniture.
    const solids = walls.filter(w => !w.breakable && !w.brittle && !w.chest);
    for (const s of solids) {
      expect(s.width * s.height, `${s.id} is big enough to divide the board`).toBeLessThan(120 * 120);
    }
  });

  it("keeps its pocket away from the wall, where the reach guard will let it lock", () => {
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
