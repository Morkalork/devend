/**
 * Level 15: MEET the gravity well, on a board where nothing else pulls.
 *
 * Chosen over a third launcher map (the launcher is already met on 11 and used
 * on 12) because the well was the one unplaced mechanic with something to say
 * next to what 14 teaches.
 *
 * It shipped for a day with 14's global pull still on it, on the reasoning that
 * a fixed local pull is best read against a global one that turns. Played, that
 * reads as TWO GRAVITIES rather than as one new idea: the board is already
 * dragging everything one way, so a patch that drags things another is a second
 * helping. The well's own design argument is that it is local - "a ball flies
 * normally, bends while it is inside, and resumes ordinary motion on the way
 * out" (gravityWells.ts) - and not one of those three phases exists on a board
 * that pulls everywhere. So the global pull came off, and 14 and 15 now
 * contrast instead of stacking: 14 is the pull you cannot escape, 15 is the
 * pull you can walk around and choose not to.
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

  it("is strong enough to read on a still board, and no stronger", () => {
    // This number has been wrong in both directions in two days, which is why
    // it is pinned as a RANGE with the reason attached rather than as a value.
    //
    // While the map still carried a global pull, the well had to out-turn that
    // pull to be visible at all: 2.6 measured 0.98x the ambient bend, which is
    // indistinguishable, so it went to 3.8. With the global pull gone there is
    // nothing to compete with, and the value the mechanic was designed for is
    // right again - the retired ladder's four wells ran 2.8 to 3.2.
    //
    // So: at or above the engine default, because this is a bare board and the
    // well is the only thing on it to read; and not up in gravity-board
    // territory, because there is no longer a background to beat.
    for (const w of wells()) {
      expect(w.turnRate ?? DEFAULT_WELL_TURN_RATE,
        "gentler than the default on a board with nothing else to read")
        .toBeGreaterThanOrEqual(DEFAULT_WELL_TURN_RATE);
      expect(w.turnRate ?? DEFAULT_WELL_TURN_RATE,
        "tuned for a board that pulls, on a board that does not")
        .toBeLessThanOrEqual(3.2);
    }
  });

  it("pins no mutator, so the wells are the only pull on the board", () => {
    // The load-bearing decision, and the one a plausible edit undoes by
    // "putting 14's weather back". A global pull here does not frame the well,
    // it drowns it: a mechanic defined by bending a ball that was otherwise
    // flying straight has nothing to bend if nothing flies straight.
    expect(l15.mutator, "a global pull here reads as a second gravity").toBeUndefined();
    expect(mutatorById(l15.mutator as unknown as string)).toBeFalsy();
  });

  it("keeps the symmetric live walls, which need no gravity to earn their keep", () => {
    // These came from 14 and stay: with no pull at all, a bouncer per side is
    // what keeps the board's energy up, and the symmetry is what lets the map
    // be dealt in any orientation.
    const e = l15.boardEdges!;
    expect(Object.keys(e).sort()).toEqual(["bottom", "left", "right", "top"]);
    const kicks = BOARD_SIDES.map(s => e[s]?.kick);
    expect(new Set(kicks).size, `the four sides disagree: ${kicks.join(", ")}`).toBe(1);
  });

  it("may be dealt in any orientation, which the symmetry buys", () => {
    // 14 pins neverRotates because global gravity is screen-relative and does
    // not turn with the deal. There is no global gravity here, and
    // rotateGravityWell turns a well's position AND its bearing together, so a
    // rotated deal stays self-consistent and the pin would buy nothing.
    expect(l15.neverRotates ?? false).toBe(false);
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
