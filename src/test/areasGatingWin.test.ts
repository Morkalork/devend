/**
 * Asking for an area lock makes the map's areas gate the win.
 *
 * An `area` clause reads a counter incremented only inside
 * `if (areaGate && ...)` in checkBallWonState, where `areaGate` means "this map
 * has at least one area without `required: false`". So the clause on a map of
 * pure bonus pockets is not a hard win condition, it is an impossible one.
 *
 * Level 5 shipped in that state, and it is worth recording what it looked like,
 * because none of it says "broken": two colored areas on the board, a required
 * area clause in the panel, the map still winnable through its alsoWinIf, and
 * the player told to "lock a ball inside the area for a 1x payout" - 1x because
 * the copy reads the multiplier off gateAreas, which was empty, while the board
 * showed x2 and x1.5.
 *
 * The cause was that setting the clause and setting the flag were two acts in
 * two panels. This makes the second follow from the first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { areasGatingWin } from "@/lib/winSpec";
import { gateAreas } from "@/lib/coloredAreas";
import type { ColoredArea } from "@/types/level";
import type { WinCondition } from "@/types/winSpec";

const bonus = (kind: ColoredArea["kind"] = "var"): ColoredArea =>
  ({ kind, x: 0, y: 0, width: 100, height: 100, required: false });
const gate = (kind: ColoredArea["kind"] = "var"): ColoredArea =>
  ({ kind, x: 0, y: 0, width: 100, height: 100 });

const AREA: WinCondition = { kind: "area", count: 1 };
const LOCKS: WinCondition = { kind: "locks", count: 1 };

describe("when the win starts asking for an area", () => {
  it("turns the map's bonus pockets into gates", () => {
    const out = areasGatingWin([bonus(), bonus("let")], [AREA], []);
    expect(gateAreas(out)).toHaveLength(2);
  });

  it("deletes the key rather than setting it to undefined", () => {
    // `required: undefined` survives an object spread as a PRESENT key, and
    // js-yaml writes it out, so the saved map would grow a `required: null`
    // that reads as neither true nor false.
    const out = areasGatingWin([bonus()], [AREA], []);
    expect("required" in out[0]).toBe(false);
  });

  it("keeps everything else about the area untouched", () => {
    const area: ColoredArea = { kind: "let", x: 600, y: 625, width: 275, height: 250, required: false };
    const [out] = areasGatingWin([area], [AREA], []);
    expect(out).toEqual({ kind: "let", x: 600, y: 625, width: 275, height: 250 });
  });

  it("counts a clause in alsoWinIf too", () => {
    // An area clause there is just as dead - it simply never fires - and
    // winSpecProblems does not even look in that group, so it is the quieter
    // of the two failures.
    expect(gateAreas(areasGatingWin([bonus()], [LOCKS], [AREA]))).toHaveLength(1);
  });
});

describe("when it should leave the map alone", () => {
  it("does nothing without an area clause", () => {
    const areas = [bonus(), bonus("let")];
    const out = areasGatingWin(areas, [LOCKS], []);
    expect(out).toBe(areas);
    expect(gateAreas(out)).toHaveLength(0);
  });

  it("does not flatten a deliberate gate-plus-pocket map", () => {
    // THE case this must not touch. One gate as the target and one pocket as a
    // reward is a real arrangement, and the clause is already satisfiable, so
    // there is nothing here to fix. Promoting everything would quietly rewrite
    // the author's design.
    const areas = [gate(), bonus("let")];
    const out = areasGatingWin(areas, [AREA], []);
    expect(out).toBe(areas);
    expect(gateAreas(out)).toHaveLength(1);
  });

  it("leaves an all-gate map exactly as it is", () => {
    const areas = [gate(), gate("let")];
    expect(areasGatingWin(areas, [AREA], [])).toBe(areas);
  });

  it("has nothing to promote on a map with no areas", () => {
    // The "no gate area" warning still fires here, correctly: the fix is to
    // draw an area, which is not something this can do on the author's behalf.
    expect(areasGatingWin([], [AREA], [])).toEqual([]);
  });
});

describe("the level-5 shape, end to end", () => {
  it("clears the condition that made the map's own clause unreachable", () => {
    // Exactly what was in map.yml: two bonus pockets and a required area lock.
    const areas = [
      { kind: "var", x: 600, y: 625, width: 275, height: 250, required: false },
      { kind: "let", x: 0, y: 625, width: 300, height: 250, required: false },
    ] as ColoredArea[];
    expect(gateAreas(areas), "the starting state was already fine").toHaveLength(0);

    const fixed = areasGatingWin(areas, [AREA], [{ kind: "locks", count: 1 }]);
    expect(gateAreas(fixed).length).toBeGreaterThan(0);
  });
});

describe("the panel actually calls it", () => {
  it("runs every spec edit through the promotion", () => {
    // add, remove and update all funnel through one `write`, which is where
    // this hangs. A source check because the alternative is mounting the panel
    // with a level, a translation context and three callbacks to observe one
    // argument - the same trade the payout check on GameCanvas takes.
    const SRC = readFileSync(
      resolve(process.cwd(), "src/components/admin/WinConditionsPanel.tsx"), "utf8");
    expect(SRC, "spec edits no longer promote the areas")
      .toMatch(/areasGatingWin\(/);
    const write = SRC.slice(SRC.indexOf("const write ="), SRC.indexOf("const editGroup"));
    expect(write, "the promotion is not on the write path").toContain("areasGatingWin");
  });
});
