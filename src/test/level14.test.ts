/**
 * Level 14 "Standup": the room turns, and every wall throws you back.
 *
 * Asked for, in one sentence, as "normal gravity, four bouncy sides, and a
 * recurring tilt, and the first map with it has no obstacles at all". It got
 * built as two maps - 14 without the turn, 15 with it - which was a split
 * nobody requested, and the report that followed was simply "level 14 isn't
 * tilting every 10 seconds". These tests were level 15's; the map they describe
 * is 14 now, and 15 is out of the ladder until it has an idea of its own.
 *
 * The design premise that came with it was that a tilt would endanger what you
 * had already fenced, and it cannot: a completed fence is a permanent wall and
 * captured space never comes back, so a turn moves the balls to a different
 * side of the same pocket and takes nothing. What a turn really costs is your
 * PLAN, and the one thing on the board it can still spoil is a fence in
 * progress.
 *
 * What is pinned here is the decisions that make it hold, each with a measured
 * number behind it and each silently undoable by a plausible edit.
 */
import { describe, it, expect } from "vitest";
import { mutatorById } from "@/lib/mapMutators";
import { pickMapRotation } from "@/lib/mapRotation";
import { BOUNCER_MAX_SPEED_SCALE } from "@/lib/physics/bouncer";
import { edgeLook } from "@/lib/rendering/sleek/edgeCue";
import { BOARD_SIDES } from "@/lib/physics/boardEdges";
import { LADDER } from "./fixtures/maps";

const l14 = LADDER.find(l => l.level === 14)!;

describe("level 14 holds together", () => {
  it("makes all four walls do exactly the same thing", () => {
    // The load-bearing decision. boardEdges are WORLD space and do not turn
    // with the pull, so on a map whose pull turns, any asymmetry is correct one
    // phase in four (see section 7.3b). Symmetry is what makes a tipping map
    // honest without a line of engine code.
    const e = l14.boardEdges!;
    expect(Object.keys(e).sort()).toEqual(["bottom", "left", "right", "top"]);
    const kicks = BOARD_SIDES.map(s => e[s]?.kick);
    expect(new Set(kicks).size, `the four sides disagree: ${JSON.stringify(kicks)}`).toBe(1);
    for (const s of BOARD_SIDES) {
      expect(e[s]?.bearing, `${s} aims, which breaks the symmetry`).toBeUndefined();
    }
  });

  it("is pinned upright, even though the symmetry means it need not be", () => {
    // Gravity is screen-relative: it starts pulling screen-down whatever
    // orientation the map was dealt in. On THIS board a deal rotation changes
    // nothing you can see - no entities, four identical walls - so the pin buys
    // nothing today and costs nothing either. It is kept because it is true,
    // and because the first entity anyone adds here would need it.
    expect(l14.neverRotates, "gravity does not turn with the deal").toBe(true);
    for (const seed of ["a","b","c","d","e","f","g","h"]) {
      expect(pickMapRotation(`${l14.id}:${seed}`, 14, l14.neverRotates)).toBe(0);
    }
  });

  it("keeps the kick under the value that saturates the map", () => {
    // Measured when gravity here only steered: 1.12 pinned every ball at
    // BOUNCER_MAX_SPEED_SCALE from 27s and 1.25 from 18s, and a map whose back
    // half sits at a flat maximum has stopped saying anything. 1.05 climbed
    // 1.00x to 1.48x over 30s and never arrived.
    //
    // The pull ACCELERATES now, which only sharpens the rule: the fall puts
    // speed in as well, so a wall that adds much of its own is a pump with two
    // sources and one drain. Measured again on the accelerating board, 1.05
    // holds about 10% of samples near the ceiling; the old floor value of 1.15
    // held 43-57%.
    const kick = l14.boardEdges!.bottom!.kick!;
    expect(kick).toBeGreaterThan(1);
    expect(kick, "this kick saturates the map before it ends").toBeLessThanOrEqual(1.05);
    // A sanity floor on the pair: even compounding every second for the whole
    // map, the ramp must have somewhere left to go.
    expect(kick ** 45, "45 bounces of this would hit the ceiling")
      .toBeGreaterThan(BOUNCER_MAX_SPEED_SCALE);
  });

  it("pins a mutator that turns rather than one that rests", () => {
    const m = mutatorById(l14.mutator);
    expect(m, `level 14 pins "${l14.mutator}", which is not in the catalogue`).toBeTruthy();
    expect(m!.behavior).toBe("gravity");
    // Four directions and no "none": the point is a pull that never stops and
    // only ever changes which wall it points at.
    expect(m!.gravity?.sequence).toEqual(["down", "right", "up", "left"]);
    expect(m!.gravity?.sequence).not.toContain("none");
    expect(m!.gravity?.period, "the settled stretch is what the player plans in").toBe(10);
    // And it FALLS. The map was reported as not reading like gravity while this
    // was a heading steered at constant speed, so a turning room that quietly
    // went back to that would undo the fix without failing anything else.
    expect(m!.gravity?.accelerate, "the pull steers instead of falling").toBe(true);
  });

  it("is a bare board, because that is what makes the idea legible", () => {
    expect(l14.entities ?? [], "level 14 grew furniture").toHaveLength(0);
    expect(l14.coloredAreas ?? []).toHaveLength(0);
    expect(l14.beats ?? []).toHaveLength(0);
  });

  it("asks what a map with nothing operable may honestly ask", () => {
    // `space + locks`, the house convention for a terrain-only board, which is
    // what act I's four teaching maps use and what ladderWins' own note spells
    // out. The lock is also the one thing on this board a turn can genuinely
    // spoil: a fence in progress is the only thing here that is not already
    // permanent.
    const kinds = (l14.win!.require ?? []).map(c => c.kind).sort();
    expect(kinds).toEqual(["locks", "space"]);
  });

  it("is the global pull, where 15 is the local one", () => {
    // 11 through 13 require `space + smashed`, because `smashed` was the only
    // clause available that a lock cannot produce. 14 and 15 get out of that by
    // having nothing to smash rather than by being handed a mechanic they do
    // not need.
    const band = LADDER.filter(l => (l.level ?? 0) >= 11);
    const noSmash = band.filter(l => !(l.win?.require ?? []).some(c => c.kind === "smashed"));
    expect(noSmash.map(l => l.level)).toEqual([14, 15]);

    // And they CONTRAST rather than stack, which took a revision to get right:
    // 15 first shipped carrying this map's weather as well as its own wells,
    // and played as two gravities at once. 14 is the pull you cannot escape;
    // 15 is the pull you can walk around. Exactly one of them pulls globally.
    const l15 = LADDER.find(l => l.level === 15)!;
    expect(l14.mutator, "14 is the map with the global pull").toBeTruthy();
    expect(l15.mutator, "15 must not carry a second gravity").toBeUndefined();
    expect(l14.gravityWells ?? [], "the local pull belongs to 15").toHaveLength(0);
    expect((l15.gravityWells ?? []).length).toBeGreaterThan(0);
  });
});
