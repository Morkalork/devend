/**
 * The board points at what the win actually wants.
 *
 * The map-open pulse announced every floor marking and nothing else, which was
 * right while a win was "clear the board" and became misleading the moment a
 * map could ask you to break something. On level 5 the slab the win requires
 * got no announcement, while the bonus zone the win ignores pulsed: the board
 * was pointing at the optional thing and away from the mandatory one.
 *
 * These are about WHICH objects, not about pixels. The set is derived from
 * resolveWinSpec so it cannot promise something the gate disagrees with, and
 * that derivation is the part worth pinning.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { winHighlightRects } from "@/lib/winHighlight";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import type { CanvasGameState } from "@/types/gameState";
import type { WinSpec } from "@/types/winSpec";
import type { LevelConfig, LevelData } from "@/types/level";
import { entityIsDestructible } from "@/lib/physics/destructibles";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

const slab = (id: string, destroyed = false) => ({
  id, kind: "breakable" as const, hits: 0, maxHits: 3, lastHitAt: 0, destroyed,
  obstaclePolygon: {
    vertices: [{ x: 100, y: 200 }, { x: 140, y: 200 }, { x: 140, y: 400 }, { x: 100, y: 400 }],
  },
});

const board = (over: Partial<CanvasGameState> = {}) => ({
  destructibles: [], coloredAreas: [], deliveryBoxes: [], ...over,
}) as unknown as CanvasGameState;

const spec = (require: WinSpec["require"]): WinSpec =>
  ({ require, alsoWinIf: [], authored: true });

describe("which objects the map points at", () => {
  it("announces the breakable a smashed clause counts", () => {
    const rects = winHighlightRects(
      spec([{ kind: "space", threshold: 30 }, { kind: "smashed", count: 1 }]),
      board({ destructibles: [slab("slab")] } as Partial<CanvasGameState>),
    );
    expect(rects, "the slab the win requires is not announced").toHaveLength(1);
    // The polygon's bounds, so a rotated map rings the slab where it IS.
    expect(rects[0]).toEqual({ x: 100, y: 200, width: 40, height: 200 });
  });

  it("says nothing about a breakable the win never mentions", () => {
    // A map can carry a breakable as scenery or as a greed hook. Announcing
    // every one of them would make "required" mean nothing.
    const rects = winHighlightRects(
      spec([{ kind: "space", threshold: 30 }]),
      board({ destructibles: [slab("slab")] } as Partial<CanvasGameState>),
    );
    expect(rects).toEqual([]);
  });

  it("leaves a bonus pocket to its own marking pulse", () => {
    // `required: false` is a zone that pays and can be ignored without cost.
    // Ringing it as loudly as a gate would tell the player they must fill it.
    const rects = winHighlightRects(
      spec([{ kind: "space", threshold: 30 }, { kind: "area", count: 1 }]),
      board({
        coloredAreas: [
          { kind: "var", x: 10, y: 10, width: 100, height: 100, required: false },
          { kind: "let", x: 200, y: 200, width: 80, height: 80 },
        ],
      } as unknown as Partial<CanvasGameState>),
    );
    expect(rects, "a bonus pocket was announced as required").toHaveLength(1);
    expect(rects[0].x).toBe(200);
  });

  it("ignores an alternative route, which is a door and not a job", () => {
    // The same reason the HUD's gate chips read `require` only: pointing at an
    // optional route as though it were the task makes every map look harder
    // than it is.
    const rects = winHighlightRects(
      { require: [{ kind: "space", threshold: 30 }],
        alsoWinIf: [{ kind: "smashed", count: 1 }], authored: true },
      board({ destructibles: [slab("slab")] } as Partial<CanvasGameState>),
    );
    expect(rects).toEqual([]);
  });

  it("skips a breakable that is already gone", () => {
    const rects = winHighlightRects(
      spec([{ kind: "smashed", count: 1 }]),
      board({ destructibles: [slab("slab", true)] } as Partial<CanvasGameState>),
    );
    expect(rects).toEqual([]);
  });

  it("survives a board with none of the three families", () => {
    expect(winHighlightRects(spec([{ kind: "locks", count: 2 }]), board())).toEqual([]);
    expect(winHighlightRects(spec([]), board())).toEqual([]);
  });
});

/**
 * The point of the whole change, checked against the shipped maps rather than
 * against a fixture: every act I map that requires an object has one to point
 * at. A spec that names a thing the board cannot show is worse than silence.
 */
describe("every act I requirement has something to point at", () => {
  const at = (n: number) => LEVELS.find(l => l.level === n)!;

  it.each([5, 6, 7, 8, 9])("level %i announces what its win needs", (n) => {
    const level = at(n);
    const built = winHighlightRects(resolveWinSpec(level, NO_RUN_RULES), board({
      // The runtime shape, standing in for initGame: one breakable per
      // authored destructible, and the map's own areas. Through the engine's
      // own reading of "destructible", not a second copy of it: a fixture that
      // only knew about `breakable` reported act I's brittle bricks as nothing
      // to point at, on the two maps that introduce breaking.
      destructibles: (level.entities ?? [])
        .filter(entityIsDestructible)
        .map(e => slab(String(e.id))),
      coloredAreas: level.coloredAreas ?? [],
    } as unknown as Partial<CanvasGameState>));

    expect(built.length, `level ${n} requires something it never points at`)
      .toBeGreaterThan(0);
  });
});

/**
 * Computed AND read.
 *
 * A field the init block works out and no renderer ever looks at is exactly how
 * the launcher shipped inert - complete everywhere except the path a person
 * uses. Source-level for the same reason launcherWiring is: standing up Pixi to
 * assert a stroke would be a large fragile thing guarding one lookup, and what
 * must not happen is visible in the source.
 */
describe("the highlight is wired in, not just computed", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("is computed when the map is built", () => {
    expect(read("src/components/game/GameCanvas.tsx"), "nothing computes the set")
      // activeModifiers, not NO_RUN_RULES: a run that adds a clause should light
      // up what that clause is about, same as an authored one.
      .toContain("game.winHighlights = winHighlightRects(resolveWinSpec(level, activeModifiers), game)");
  });

  it("is read by the layer that draws the map-open pulse", () => {
    const layer = read("src/lib/rendering/sleek/areaLayer.ts");
    expect(layer, "the set is computed and never drawn").toContain("game.winHighlights");
    // Drawn louder than the floor markings, which is the whole distinction:
    // "you must" has to outrank "worth your time" without inventing a colour.
    expect(layer, "required objects no longer read louder than markings")
      .toMatch(/ring\(r, true\)/);
    expect(layer).toMatch(/ring\(r, false\)/);
  });
});

describe("a marker points only at something the player can act on", () => {
  /**
   * Reported as "blinking maps, after I have fenced off an area with a
   * destructible in it".
   *
   * The marker set only ever dropped a slab when it was DESTROYED, so a slab
   * sealed into claimed ground kept a ring breathing over it for the rest of
   * the map - an instruction to do something that can no longer be done. That
   * was a footnote while a map asked for one brick. Act I now asks for half of
   * twelve, so the clause stays unmet for most of the map, every un-smashed
   * brick carries a ring, and one fence across a run seals several away at
   * once: measured on level 7, a single cut took the set from 12 to 5.
   */
  const grid = () => ({
    cellSize: 10, width: 100, height: 100, originX: 0, originY: 0,
    cells: new Uint8Array(10000).fill(0),      // 0 = ACTIVE
    cellRegionIds: new Array(10000).fill("r1"),
    activeCount: 10000, initialActiveCount: 10000,
  });

  const withGrid = (over: Partial<CanvasGameState> = {}) => board({
    spaceGrid: grid() as never,
    balls: [{ id: "b", state: "active", radius: 18 }] as never,
    ...over,
  });

  const smash = spec([{ kind: "smashed", count: 1 }]);

  it("points at a slab a ball can still reach", () => {
    expect(winHighlightRects(smash, withGrid({
      destructibles: [slab("s")] as never,
    }))).toHaveLength(1);
  });

  it("stops pointing at one sealed into claimed ground", () => {
    // Every cell around the slab taken, which is what a fence across its run
    // leaves behind once the capture has run.
    const g = withGrid({ destructibles: [slab("s")] as never });
    g.spaceGrid!.cells.fill(1);               // 1 = REMOVED
    expect(winHighlightRects(smash, g),
      "a slab nothing can reach is still being pointed at").toHaveLength(0);
  });

  it("keeps pointing when it cannot tell", () => {
    // No grid to read: unknown is not lost, the same direction canStillStrike
    // takes everywhere else. A board that cannot answer keeps the marker.
    expect(winHighlightRects(smash, board({
      destructibles: [slab("s")] as never,
    }))).toHaveLength(1);
  });
});
