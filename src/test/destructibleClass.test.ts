/**
 * Shards and monoliths are two jobs, and the win counts them as two.
 *
 * Reported as a question with the answer inside it: "if you have to smash five
 * objects and there are six small bricks and one large yellow object, why would
 * you ever go for the big one?" You would not. A shard goes on any single
 * contact - a ball on its way somewhere else does it for you - and a monolith
 * takes three deliberate drives. Against one shared counter the monolith is
 * strictly worse, so a map offering both was really a map offering the shards.
 *
 * What this file guards, worst consequence first:
 *
 *   - a clause that names a class is answered ONLY by that class, everywhere it
 *     is read: the win gate, the stranding check, the refusal, the markers
 *   - the cut refusal is per class, because the version that counted them
 *     together would wave through the burial of a map's last monolith while six
 *     shards sat reachable - the exact bug it exists to prevent
 *   - `of` is optional and means what the ladder meant before it existed, so no
 *     shipped map changed meaning on the day this landed
 *   - the authoring gate refuses the ambiguous spec, so the question above can
 *     never be asked of a shipped map again
 */
import { describe, it, expect } from "vitest";
import {
  destructibleClass, matchesSmashClass, classesPresent, smashCounts, noSmashes,
  DEFAULT_SMASH_CLASS,
} from "@/lib/destructibleClass";
import {
  smashDemands, cutWouldBurySmashes, smashRequirementLost,
} from "@/lib/physics/smashReach";
import { winSpecProblems, evaluateWinCondition, baseWinSpec } from "@/lib/winSpec";
import { winHighlightRects } from "@/lib/winHighlight";
import { CellState, type SpaceGrid } from "@/lib/spaceGrid";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import type { WinSpec, WinSnapshot } from "@/types/winSpec";

// ── boards ─────────────────────────────────────────────────────────────────

function openGrid(): SpaceGrid {
  const cells = new Uint8Array(40 * 40).fill(CellState.ACTIVE);
  return {
    cellSize: 15, width: 40, height: 40, originX: 0, originY: 0,
    cells, initialActiveCount: cells.length, activeCount: cells.length,
    cellRegionIds: new Array(cells.length).fill("region-1"),
  } as unknown as SpaceGrid;
}

const piece = (id: string, x: number, y: number, brittle: boolean, destroyed = false) => ({
  id, kind: "breakable" as const, hits: 0, maxHits: brittle ? 1 : 3,
  destroyed, brittle, lastHitAt: 0,
  obstaclePolygon: { vertices: [
    { x, y }, { x: x + 40, y }, { x: x + 40, y: y + 40 }, { x, y: y + 40 },
  ] },
});

const shard = (id: string, x: number, y: number, destroyed = false) =>
  piece(id, x, y, true, destroyed);
const monolith = (id: string, x: number, y: number, destroyed = false) =>
  piece(id, x, y, false, destroyed);

function board(destructibles: unknown[]): CanvasGameState {
  return {
    spaceGrid: openGrid(),
    balls: [{ id: "b1", state: "active", speed: 300, radius: 18, position: { x: 90, y: 90 } }],
    walls: [], destructibles,
  } as unknown as CanvasGameState;
}

const spec = (...require: WinSpec["require"]): WinSpec =>
  ({ require, alsoWinIf: [], authored: true });

/** A fence straight down the board at x. */
const cutAt = (x: number) => [{ start: { x, y: 0 }, end: { x, y: 600 } }];

// ── the rule itself ────────────────────────────────────────────────────────

describe("which class a breakable is", () => {
  it("reads the break cost, not the size", () => {
    // The size correlates perfectly on today's ladder and is still the wrong
    // rule: it would need a threshold to tune and would make the class an
    // accident of authoring. What separates them is what the player has to DO.
    expect(destructibleClass({ brittle: true })).toBe("shards");
    expect(destructibleClass({ brittle: false })).toBe("monoliths");
    expect(destructibleClass({ brittle: undefined })).toBe("monoliths");
  });

  it("answers a clause that names its own class, and no other", () => {
    expect(matchesSmashClass({ brittle: true }, "shards")).toBe(true);
    expect(matchesSmashClass({ brittle: true }, "monoliths")).toBe(false);
    expect(matchesSmashClass({ brittle: false }, "monoliths")).toBe(true);
    expect(matchesSmashClass({ brittle: false }, "shards")).toBe(false);
  });

  it("answers `any` whatever it is, which is what an unsaid `of` means", () => {
    expect(DEFAULT_SMASH_CLASS).toBe("any");
    for (const brittle of [true, false]) {
      expect(matchesSmashClass({ brittle }, "any")).toBe(true);
      expect(matchesSmashClass({ brittle }, undefined)).toBe(true);
    }
  });

  it("reports what a board is made of, rubble included", () => {
    // A mixed map whose last monolith has just been broken is still a mixed
    // map: the question is what the map IS, and a spec that started ambiguous
    // does not stop being ambiguous because the player resolved it.
    const both = classesPresent([shard("s", 0, 0), monolith("m", 0, 0, true)]);
    expect([...both].sort()).toEqual(["monoliths", "shards"]);
    expect([...classesPresent([shard("s", 0, 0)])]).toEqual(["shards"]);
    // Mirrors and movers are destructible scenery, never a smash objective.
    expect([...classesPresent([{ brittle: false, kind: "mirror" }])]).toEqual([]);
  });

  it("counts the broken ones by class, in one pass", () => {
    const counts = smashCounts([
      shard("s1", 0, 0, true), shard("s2", 0, 0, true), shard("s3", 0, 0),
      monolith("m1", 0, 0, true), monolith("m2", 0, 0),
    ]);
    expect(counts).toEqual({ any: 3, shards: 2, monoliths: 1 });
    expect(noSmashes()).toEqual({ any: 0, shards: 0, monoliths: 0 });
  });
});

// ── the win gate ───────────────────────────────────────────────────────────

describe("the win gate", () => {
  const snap = (over: Partial<WinSnapshot>): WinSnapshot =>
    ({ smashed: noSmashes(), ...over } as WinSnapshot);

  it("does not let six shards pay a monolith's bill", () => {
    // THE case in the report, at the gate rather than on the board.
    const s = snap({ smashed: { any: 6, shards: 6, monoliths: 0 } });
    expect(evaluateWinCondition({ kind: "smashed", count: 1, of: "monoliths" }, s).met)
      .toBe(false);
    expect(evaluateWinCondition({ kind: "smashed", count: 5, of: "shards" }, s).met)
      .toBe(true);
  });

  it("reads an unsaid `of` as the total, exactly as before the split", () => {
    const s = snap({ smashed: { any: 3, shards: 2, monoliths: 1 } });
    expect(evaluateWinCondition({ kind: "smashed", count: 3 }, s).met).toBe(true);
  });
});

// ── the demands a spec makes ───────────────────────────────────────────────

describe("what a spec demands", () => {
  it("keeps the two classes apart as two bills", () => {
    expect(smashDemands(spec(
      { kind: "smashed", count: 2, of: "shards" },
      { kind: "smashed", count: 1, of: "monoliths" },
    ))).toEqual([{ of: "shards", count: 2 }, { of: "monoliths", count: 1 }]);
  });

  it("folds two clauses naming the same class into the larger", () => {
    // Meeting the larger meets the smaller, so they are one demand.
    expect(smashDemands(spec(
      { kind: "smashed", count: 2, of: "shards" },
      { kind: "smashed", count: 5, of: "shards" },
    ))).toEqual([{ of: "shards", count: 5 }]);
  });

  it("says nothing about a spec with no smash clause", () => {
    expect(smashDemands(spec({ kind: "space", threshold: 10 }))).toEqual([]);
  });
});

// ── the refusal, which is the correctness fix ──────────────────────────────

describe("a cut that would bury one class", () => {
  /**
   * The bug the class-blind version had, and the reason this was not only a
   * presentation change: a board with six shards on the near side and one
   * monolith on the far side passes a total-based reach check with room to
   * spare, and the monolith clause is dead the moment the fence lands.
   */
  const mixed = () => board([
    shard("s1", 80, 100), shard("s2", 80, 200), shard("s3", 80, 300),
    shard("s4", 140, 100), shard("s5", 140, 200), shard("s6", 140, 300),
    monolith("m1", 480, 300),
  ]);

  it("refuses the cut that orphans the map's last monolith", () => {
    expect(cutWouldBurySmashes(
      mixed(), spec({ kind: "smashed", count: 1, of: "monoliths" }), cutAt(300), 6,
    )).toBe(true);
  });

  it("would have allowed it while the classes were counted together", () => {
    // Not a hypothetical: `of: any` IS the old behaviour, and it says yes,
    // because six reachable shards cover a demand for one of anything. This is
    // the assertion that would have failed to exist before the split.
    expect(cutWouldBurySmashes(
      mixed(), spec({ kind: "smashed", count: 1 }), cutAt(300), 6,
    )).toBe(false);
  });

  it("still allows a cut that buries nothing either class owes", () => {
    expect(cutWouldBurySmashes(
      mixed(),
      spec({ kind: "smashed", count: 2, of: "shards" },
           { kind: "smashed", count: 1, of: "monoliths" }),
      [{ start: { x: 40, y: 0 }, end: { x: 40, y: 200 } }], 6,
    )).toBe(false);
  });

  it("refuses when EITHER class would be buried, not only the first", () => {
    // A cut sealing the shard column away, on a map that owes both.
    const game = mixed();
    expect(cutWouldBurySmashes(
      game,
      spec({ kind: "smashed", count: 6, of: "shards" },
           { kind: "smashed", count: 1, of: "monoliths" }),
      [{ start: { x: 200, y: 0 }, end: { x: 200, y: 600 } }], 6,
    )).toBe(true);
  });

  it("counts a monolith already broken, which nothing can take away", () => {
    const game = board([
      shard("s1", 80, 100), monolith("m1", 480, 300, true),
    ]);
    expect(cutWouldBurySmashes(
      game, spec({ kind: "smashed", count: 1, of: "monoliths" }), cutAt(300), 6,
    )).toBe(false);
  });
});

describe("a map already beyond reach, per class", () => {
  it("is lost when the class it owes is gone, though the other is fine", () => {
    const game = board([shard("s1", 80, 100), monolith("m1", 480, 300)]);
    const grid = game.spaceGrid!;
    for (let i = 0; i < grid.cells.length; i++) {
      if (i % grid.width > 20) grid.cells[i] = CellState.REMOVED;   // monolith buried
    }
    expect(smashRequirementLost(game, spec({ kind: "smashed", count: 1, of: "monoliths" })))
      .toBe(true);
    expect(smashRequirementLost(game, spec({ kind: "smashed", count: 1, of: "shards" })))
      .toBe(false);
  });
});

// ── the markers ────────────────────────────────────────────────────────────

describe("the markers on the board", () => {
  const withBoth = {
    destructibles: [shard("s1", 80, 100), monolith("m1", 480, 300)],
    coloredAreas: [], deliveryBoxes: [],
    spaceGrid: openGrid(),
    balls: [{ id: "b1", state: "active", speed: 300, radius: 18, position: { x: 90, y: 90 } }],
  } as unknown as CanvasGameState;

  it("rings only what the clause would accept", () => {
    // A ring over a monolith on a shards clause is the same wrong instruction
    // as a ring over rubble, and on a mixed map it is the instruction that made
    // the monolith look optional.
    expect(winHighlightRects(spec({ kind: "smashed", count: 1, of: "shards" }), withBoth))
      .toHaveLength(1);
    expect(winHighlightRects(spec({ kind: "smashed", count: 1, of: "monoliths" }), withBoth))
      .toHaveLength(1);
    expect(winHighlightRects(spec({ kind: "smashed", count: 1 }), withBoth))
      .toHaveLength(2);
  });

  it("rings both when the map asks for both", () => {
    expect(winHighlightRects(
      spec({ kind: "smashed", count: 1, of: "shards" },
           { kind: "smashed", count: 1, of: "monoliths" }), withBoth,
    )).toHaveLength(2);
  });
});

// ── the authoring gate ─────────────────────────────────────────────────────

describe("what the authoring gate refuses", () => {
  const level = (entities: unknown[], require: WinSpec["require"]): LevelConfig => ({
    id: "t", level: 5, sizeThreshold: 20, expectedCuts: 5, points: 10, maxBalls: 1,
    entities, win: { require },
  } as unknown as LevelConfig);

  const SHARD = { id: "s", kind: "wall", shape: "rect", x: 0, y: 0, width: 26, height: 28, brittle: true };
  const MONO = { id: "m", kind: "wall", shape: "rect", x: 0, y: 0, width: 200, height: 26, breakable: true };
  const problems = (l: LevelConfig) => winSpecProblems(baseWinSpec(l), l).join(" | ");

  it("refuses an unsaid `of` on a map holding both classes", () => {
    // The whole reason for the change, caught at authoring time so it never has
    // to be balanced around on a board.
    const p = problems(level(
      [SHARD, { ...MONO, id: "m2" }, MONO], [{ kind: "smashed", count: 1 }]));
    expect(p).toContain("without saying of what");
    expect(p, "it does not say how to fix it").toContain("of: monoliths");
  });

  it("allows an unsaid `of` on a map of one class, where it cannot mislead", () => {
    // `any` and that class are the same set, so spelling it out would be noise.
    expect(problems(level([SHARD, { ...SHARD, id: "s2" }], [{ kind: "smashed", count: 1 }])))
      .toBe("");
  });

  it("checks slack against the class the clause names, not the total", () => {
    // The old rule counted every breakable into one number, so a clause asking
    // for two monoliths on a board of thirty shards and one monolith passed a
    // check that was reading thirty-one.
    const p = problems(level(
      [SHARD, { ...SHARD, id: "s2" }, { ...SHARD, id: "s3" }, MONO],
      [{ kind: "smashed", count: 2, of: "monoliths" }]));
    expect(p).toContain("2 monoliths");
    expect(p).toContain("the map has 1");
  });

  it("refuses a class clause with no spare, not only one that overreaches", () => {
    /**
     * The hole the class split opened, and the reason this rule is `>=`.
     *
     * Asked as a design question about level 17: it carries a tonne of shards
     * and one yellow monolith, so would it not make sense to require the
     * monolith? A fair question, and the sweep answered it - 5 wins of 8 fell
     * to 1, and five of the seven losses were objectiveBuried. One object with
     * no spare, sitting in the middle of the wall the launcher fires at.
     *
     * Nothing caught it beforehand. This check only refused a count ABOVE the
     * available, and the YAML slack test that does enforce a spare was not
     * class-aware, so `1 of monoliths` on a one-monolith map passed both.
     */
    const p = problems(level(
      [SHARD, { ...SHARD, id: "s2" }, MONO],
      [{ kind: "smashed", count: 1, of: "monoliths" }]));
    expect(p, "a clause with every object load-bearing was allowed")
      .toContain("no spare");
  });

  it("allows the same clause the moment there is one to spare", () => {
    expect(problems(level(
      [SHARD, { ...SHARD, id: "s2" }, MONO, { ...MONO, id: "m2" }],
      [{ kind: "smashed", count: 1, of: "monoliths" }],
    ))).toBe("");
  });

  it("passes a properly split mixed map", () => {
    expect(problems(level(
      [SHARD, { ...SHARD, id: "s2" }, MONO, { ...MONO, id: "m2" }],
      [{ kind: "smashed", count: 1, of: "shards" },
       { kind: "smashed", count: 1, of: "monoliths" }],
    ))).toBe("");
  });
});
