/**
 * The two map sets, and the trap that sits between them.
 *
 * `LADDER` is public/map.yml (the maps people play) and `RETIRED` is the 25
 * maps deleted for the rebuild, kept so the engine tests that exercised them
 * keep exercising something. `ENGINE_MAPS` is both, ladder first.
 *
 * THE TRAP: a rebuilt map takes the level number, and therefore the id, of the
 * retired map it replaces. So `ENGINE_MAPS.find(l => l.id === "level-15")`
 * silently changes which map it returns the day level 15 is reauthored, and a
 * test written about the retired map carries on passing about a different one
 * until the two disagree - which is how circuit.test.ts came to assert that a
 * bare tipping board ships terminals.
 *
 * The rule that follows: address a map by the SET you mean (LADDER for the
 * ladder, RETIRED for a deleted one) and use ENGINE_MAPS only to sweep
 * everything. This pins the collision so the next rebuilt map fails here, with
 * the reason, rather than in whichever unrelated file happened to name it.
 */
import { describe, it, expect } from "vitest";
import { LADDER, RETIRED, ENGINE_MAPS, LADDER_END } from "./fixtures/maps";

describe("the map fixtures", () => {
  it("keeps the ladder and the retired set both non-empty", () => {
    expect(LADDER.length).toBeGreaterThan(0);
    expect(RETIRED.length).toBeGreaterThan(0);
    expect(ENGINE_MAPS.length).toBe(LADDER.length + RETIRED.length);
  });

  it("has no duplicate id INSIDE either set", () => {
    for (const [name, set] of [["LADDER", LADDER], ["RETIRED", RETIRED]] as const) {
      const ids = set.map(l => l.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `${name} has two maps with the same id`).toEqual([]);
    }
  });

  it("names the ids a rebuilt map has taken back from a retired one", () => {
    // Not an error: reusing the id is correct, the maps ARE the same rung. What
    // is an error is looking one up by id across both sets, so the overlap is
    // written down here and every one of these is a name that must be resolved
    // against a set rather than against ENGINE_MAPS.
    const retiredIds = new Set(RETIRED.map(l => l.id));
    const shared = LADDER.filter(l => retiredIds.has(l.id)).map(l => l.id).sort();
    // level-15 left this list when the ladder stopped at 14: the rebuilt 15 was
    // the same board as 14 without its turn, so the two were merged rather than
    // both kept. The RETIRED level-15 is still there and still the wrong map to
    // find by id, which is exactly why the trap is written down rather than
    // assumed to have gone away with the overlap.
    expect(shared).toEqual(["level-11", "level-12", "level-13", "level-14"]);
  });

  it("keeps LADDER_END pointing at the last map that actually exists", () => {
    // Half the ledger's checks switch on this: a mechanic scheduled at or below
    // it must be ON its map, and above it must be on no map at all.
    expect(LADDER_END).toBe(Math.max(...LADDER.map(l => l.level ?? 0)));
    expect(LADDER.some(l => l.level === LADDER_END)).toBe(true);
    expect(LADDER.some(l => (l.level ?? 0) === LADDER_END + 1)).toBe(false);
  });
});
