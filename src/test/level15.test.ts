/**
 * Level 15 "Standup": the room turns, and every wall throws you back.
 *
 * Asked for as "normal gravity, four bouncy sides, and a recurring tilt, and
 * the first map with it has no obstacles at all". The design premise that came
 * with it was that a tilt would endanger what you had already fenced, and it
 * cannot: a completed fence is a permanent wall and captured space never comes
 * back, so a turn moves the balls to a different side of the same pocket and
 * takes nothing. Measured, gravity makes a board EASIER rather than harder (it
 * pools the balls, and a pooled ball is one that is not near your fence), and
 * tipping is indistinguishable from steady.
 *
 * So what this map actually is: a MEET map for a mechanic that reads as
 * disorientation rather than danger, plus the one thing four live walls really
 * do on an engine where gravity never takes speed off - a long accelerando.
 *
 * What is pinned here is the three decisions that make it hold, each of which
 * has a measured number behind it and would be silently undone by a plausible
 * edit.
 */
import { describe, it, expect } from "vitest";
import { mutatorById } from "@/lib/mapMutators";
import { pickMapRotation } from "@/lib/mapRotation";
import { BOUNCER_MAX_SPEED_SCALE } from "@/lib/physics/bouncer";
import { edgeLook } from "@/lib/rendering/sleek/edgeCue";
import { BOARD_SIDES } from "@/lib/physics/boardEdges";
import { LADDER } from "./fixtures/maps";

const l15 = LADDER.find(l => l.level === 15)!;

describe("level 15 holds together", () => {
  it("makes all four walls do exactly the same thing", () => {
    // The load-bearing decision. boardEdges are WORLD space and do not turn
    // with the pull, so on a map whose pull turns, any asymmetry is correct one
    // phase in four (see section 7.3b). Symmetry is what makes a tipping map
    // honest without a line of engine code.
    const e = l15.boardEdges!;
    expect(Object.keys(e).sort()).toEqual(["bottom", "left", "right", "top"]);
    const kicks = BOARD_SIDES.map(s => e[s]?.kick);
    expect(new Set(kicks).size, `the four sides disagree: ${JSON.stringify(kicks)}`).toBe(1);
    for (const s of BOARD_SIDES) {
      expect(e[s]?.bearing, `${s} aims, which breaks the symmetry`).toBeUndefined();
    }
  });

  it("may be dealt in any orientation, which is what the symmetry buys", () => {
    // Level 14 must pin neverRotates because its floor is special. This one has
    // no preferred direction to lose, so taking the pin off is not an oversight.
    expect(l15.neverRotates ?? false, "level 15 does not need to be pinned upright").toBe(false);
    const seen = new Set(["a","b","c","d","e","f","g","h"].map(s => pickMapRotation(`${l15.id}:${s}`, 15)));
    expect(seen.size, "the deal never varies, so the symmetry is buying nothing").toBeGreaterThan(1);
  });

  it("keeps the kick under the value that saturates the map", () => {
    // Gravity here only steers, so nothing ever takes speed off a ball and a
    // bouncy wall can only ADD. Measured on this board with nothing else to
    // hit: 1.12 pins every ball at BOUNCER_MAX_SPEED_SCALE from 27s and 1.25
    // from 18s, and a map whose back half sits at a flat maximum has stopped
    // saying anything. 1.05 climbs 1.00x to 1.48x over 30s and never arrives.
    const kick = l15.boardEdges!.bottom!.kick!;
    expect(kick).toBeGreaterThan(1);
    expect(kick, "this kick saturates the map before it ends").toBeLessThanOrEqual(1.05);
    // A sanity floor on the pair: even compounding every second for the whole
    // map, the ramp must have somewhere left to go.
    expect(kick ** 45, "45 bounces of this would hit the ceiling")
      .toBeGreaterThan(BOUNCER_MAX_SPEED_SCALE);
  });

  it("pins a mutator that turns rather than one that rests", () => {
    const m = mutatorById(l15.mutator);
    expect(m, `level 15 pins "${l15.mutator}", which is not in the catalogue`).toBeTruthy();
    expect(m!.behavior).toBe("gravity");
    // Four directions and no "none": the point is a pull that never stops and
    // only ever changes which wall it points at.
    expect(m!.gravity?.sequence).toEqual(["down", "right", "up", "left"]);
    expect(m!.gravity?.sequence).not.toContain("none");
    expect(m!.gravity?.period, "the settled stretch is what the player plans in").toBe(10);
  });

  it("is a bare board, because that is what makes the idea legible", () => {
    expect(l15.entities ?? [], "level 15 grew furniture").toHaveLength(0);
    expect(l15.coloredAreas ?? []).toHaveLength(0);
    expect(l15.beats ?? []).toHaveLength(0);
  });

  it("asks what a map with nothing operable may honestly ask", () => {
    // `space + locks`, the house convention for a terrain-only board, which is
    // what act I's four teaching maps use and what ladderWins' own note spells
    // out. The lock is also the one thing on this board a turn can genuinely
    // spoil: a fence in progress is the only thing here that is not already
    // permanent.
    const kinds = (l15.win!.require ?? []).map(c => c.kind).sort();
    expect(kinds).toEqual(["locks", "space"]);
  });

  it("closes act II with the second of two bare boards", () => {
    // 11 through 13 all require `space + smashed`, because `smashed` was the
    // only clause available that a lock cannot produce. The last two get out of
    // that by having nothing to smash rather than by being given a mechanic
    // they do not need.
    //
    // 14 joined this pair when it was stripped: it is the MEET map for real
    // gravity and could not teach it with five obstacles in the way. So the act
    // ends on two empty boards that differ by exactly one idea, which is the
    // point - 14 is "things fall", 15 is the same board with the room turning
    // under it.
    const actII = LADDER.filter(l => (l.level ?? 0) >= 11 && (l.level ?? 0) <= 15);
    const noSmash = actII.filter(l => !(l.win?.require ?? []).some(c => c.kind === "smashed"));
    expect(noSmash.map(l => l.level)).toEqual([14, 15]);
    // And they are not the same map twice: only one of them turns.
    const l14 = LADDER.find(l => l.level === 14)!;
    expect(l14.mutator).toBe("steady_gravity");
    expect(l15.mutator).toBe("tipping");
  });

  it("draws all four walls as the same live wall", () => {
    // The cue is what sells the premise before the first ball moves: four
    // matching rails with chevrons pointing at the middle.
    const looks = BOARD_SIDES.map(s => edgeLook(s, l15.boardEdges![s]));
    expect(looks.every(l => l !== null), "a live wall on this map draws nothing").toBe(true);
    expect(new Set(looks.map(l => l!.colour)).size, "the four walls read as different walls").toBe(1);
    expect(looks[0]!.kind).toBe("faster");
    // Each arrow points straight in off its own wall, so the board reads as
    // "everything is thrown back to the middle" from any orientation.
    expect(looks.map(l => l!.direction)).toEqual([
      { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 },
    ]);
  });
});
