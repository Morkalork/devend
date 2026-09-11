/**
 * Level 15: MEET the gravity well, USE the turning room and the live walls.
 *
 * Chosen over a third launcher map (the launcher is already met on 11 and used
 * on 12) because the well is the one unplaced mechanic that TALKS to what 14
 * teaches rather than sitting beside it. A well's pull is fixed and absolute;
 * this map's global pull turns a quarter every ten seconds. So one well is a
 * funnel when the two agree, a brake when they oppose and a sideways current
 * between, and which it is depends on when a ball arrives rather than where it
 * is. The renderer had already worked this out: "after a turn the box is
 * somewhere new and the arrow still points down, which is the whole reason the
 * turn matters" (areaLayer).
 *
 * It also settles what 14 left owing. A pinned mutator and live outer walls
 * were each on exactly one map, which the spread rule counts as introduced and
 * dropped; using both here is what takes them off that list.
 */
import { describe, it, expect } from "vitest";
import { LADDER } from "./fixtures/maps";
import { mutatorById } from "@/lib/mapMutators";
import { DEFAULT_WELL_TURN_RATE } from "@/lib/physics/gravityWells";
import { BOARD_SIDES } from "@/lib/physics/boardEdges";
import { createInitialGameData } from "@/lib/initGame";
import { plainModifiers } from "@/lib/bot/headlessGame";

const l15 = LADDER.find(l => l.level === 15)!;
const wells = () => l15.gravityWells ?? [];

describe("level 15 holds together", () => {
  it("places wells at all, which is the whole point of the rung", () => {
    expect(wells().length, "level 15 lost its wells").toBeGreaterThan(0);
    for (const w of wells()) {
      // Inside the play area with room around them: a well flush to a wall is
      // a wall, because a ball cannot enter it from the far side.
      expect(w.x).toBeGreaterThan(45);
      expect(w.y).toBeGreaterThan(45);
      expect(w.x + w.width).toBeLessThan(855);
      expect(w.y + w.height).toBeLessThan(855);
    }
  });

  it("gives every well the same bearing, so the board says one thing at a time", () => {
    // Different bearings was the tempting version and it is one idea too many
    // for a MEET: the player reads two relationships at once and cannot tell
    // which well did what. Same bearing means the whole board changes meaning
    // together, every ten seconds.
    const pulls = new Set(wells().map(w => w.pull ?? "down"));
    expect(pulls.size, `the wells disagree: ${[...pulls].join(", ")}`).toBe(1);
  });

  it("out-turns the ambient pull, which the engine default does not", () => {
    // The load-bearing number, and the one a plausible edit would undo by
    // "restoring the default". The retired ladder's wells ran 2.8 to 3.2 and
    // the engine default is 2.6, all of them set on STILL boards. Here the
    // global pull is already bending every path, so a well has to beat the
    // background to be seen: measured as heading change per frame inside a well
    // against outside one, 2.6 comes out at 0.98x - indistinguishable - where
    // 3.2 is 1.35x and 3.8 is 1.61x, and past that it plateaus.
    for (const w of wells()) {
      expect(w.turnRate, "a well this gentle is invisible on a gravity map")
        .toBeGreaterThan(DEFAULT_WELL_TURN_RATE);
      expect(w.turnRate).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("keeps the turning room and the symmetric walls it inherited", () => {
    // Not decoration: this is what makes the wells mean anything, and it is
    // what pays off 14's single-use debt on both mechanics.
    const m = mutatorById(l15.mutator);
    expect(m, `level 15 pins "${l15.mutator}", which is not in the catalogue`).toBeTruthy();
    expect(m!.behavior).toBe("gravity");
    expect(new Set(m!.gravity?.sequence ?? []).size, "the room has to TURN").toBeGreaterThan(1);
    expect(m!.gravity?.accelerate, "and things have to actually fall").toBe(true);

    const e = l15.boardEdges!;
    expect(Object.keys(e).sort()).toEqual(["bottom", "left", "right", "top"]);
    const kicks = BOARD_SIDES.map(s => e[s]?.kick);
    expect(new Set(kicks).size, `the four sides disagree: ${kicks.join(", ")}`).toBe(1);
  });

  it("asks what a terrain-only board may honestly ask", () => {
    // A well is terrain: there is no state saying whether you "engaged" with
    // one, so there is no clause for it and `space + locks` is the honest ask.
    // Two locks rather than 14's one is the ramp.
    const kinds = (l15.win!.require ?? []).map(c => c.kind).sort();
    expect(kinds).toEqual(["locks", "space"]);
    const locks = (l15.win!.require ?? []).find(c => c.kind === "locks");
    expect(locks?.kind === "locks" && locks.count).toBe(2);
  });

  it("stays bare apart from the wells", () => {
    // 14's lesson, which cost a round trip: a board full of furniture hides the
    // mechanic it was built to teach.
    expect(l15.entities ?? []).toHaveLength(0);
    expect(l15.coloredAreas ?? []).toHaveLength(0);
    expect(l15.beats ?? []).toHaveLength(0);
  });
});

describe("the wells reach the board the player gets", () => {
  it("is built by createInitialGameData, not by the renderer", () => {
    // The bug this rung found. game.gravityWells was assembled only in
    // GameCanvas, so wells existed in the browser and nowhere else: the first
    // bot sweep of this map reported a clean 12/12 on a board whose two wells
    // were not there. Colored areas and pickup anchors had the same hole.
    //
    // Fourth instance of one shape of bug - map beats, the end-of-frame passes,
    // the map deadline - and the same cure: build it where BOTH callers look.
    const data = createInitialGameData(l15, 15, plainModifiers());
    expect(data.gravityWells).toHaveLength(wells().length);
    expect(data.coloredAreas).toEqual([]);
    expect(data.pickupSpots).toEqual([]);
  });

  it("hands every map's areas and anchors over the same way", () => {
    // Not just this map: the hole was in the shared builder, so the check is
    // that any map's authored sets arrive rather than that level 15's do.
    for (const level of LADDER) {
      const data = createInitialGameData(level, level.level ?? 1, plainModifiers());
      expect(data.gravityWells.length, `level ${level.level} wells`)
        .toBe((level.gravityWells ?? []).length);
      expect(data.coloredAreas.length, `level ${level.level} colored areas`)
        .toBe((level.coloredAreas ?? []).length);
      expect(data.pickupSpots.length, `level ${level.level} pickup spots`)
        .toBe((level.pickupSpots ?? []).length);
    }
  });
});
