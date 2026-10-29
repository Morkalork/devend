/**
 * A room whose only way in is something a ball can go THROUGH is not
 * unreachable.
 *
 * captureUnreachableCells floods from the balls and captures every cell the
 * flood does not reach. A membrane, a ball-type gate and a portal mouth are
 * obstacles in the space grid, so to the flood they were walls: a ward behind a
 * membrane with no ball in it yet was captured on the first cut, and the ball
 * that crossed into it a moment later landed in captured ground and was thrown
 * back ("[OWNERSHIP] escaped, recovered"). The membrane looked solid, the gate
 * looked solid, and a portal whose far side held no ball led nowhere. All
 * three were found building act IV, where the drain on level 31 did nothing
 * after the first cut on any seed.
 *
 * The flood now crosses them (spaceGrid.ts, GridLink): a membrane in its own
 * direction only, a gate for the types it names, a portal both ways. And a
 * ball-free room the capture kept stays a region after the cut, so a ball that
 * comes through has somewhere to belong.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, installClock, releaseClock, plainModifiers, stepBot, tryCut } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { CellState, worldToGridIndex, linkedReach } from "@/lib/spaceGrid";
import { anyGateTargetCanReach } from "@/lib/coloredAreas";
import type { LevelConfig, LevelEntity } from "@/types/level";

/** A wall down x = 380..406, solid but for a 240-unit piece in the middle. */
function divided(middle: Partial<LevelEntity>, extra: LevelEntity[] = [], ballTypeIds = ["red", "blue"]): LevelConfig {
  return {
    id: "pass-test", level: 12, sizeThreshold: 10, expectedCuts: 6, points: 5,
    variety: 0, randomShapes: 0, maxBalls: ballTypeIds.length, ballTypeIds, neverRotates: true,
    pickupChance: 0, bugChance: 0,
    entities: [
      { id: "top", kind: "wall", shape: "rect", x: 380, y: 45, width: 26, height: 285 },
      { id: "mid", kind: "wall", shape: "rect", x: 380, y: 330, width: 26, height: 240, ...middle } as LevelEntity,
      { id: "bottom", kind: "wall", shape: "rect", x: 380, y: 570, width: 26, height: 285 },
      ...extra,
    ],
  } as unknown as LevelConfig;
}

/** Deal the map, put every ball on the right, cut once on the right, and watch. */
function play(level: LevelConfig, seconds: number) {
  setRunSeedText("pass-1");
  installClock();
  try {
    const ctx = createBotGame(level, level.level, plainModifiers(), { mutator: null });
    ctx.game.balls.forEach((b, i) => { b.position = { x: 640, y: 250 + i * 150 }; });
    const g = ctx.game.spaceGrid!;
    const leftOpen = () => g.cells[worldToGridIndex(g, 200, 450)] === CellState.ACTIVE;
    const cut = tryCut(ctx, { x: 640, y: 800 }, { x: 1, y: 0 });
    for (let f = 0; f < Math.round(seconds / PHYSICS_STEP); f++) stepBot(ctx, PHYSICS_STEP);
    const left = ctx.game.balls.filter(b => b.state !== "won" && b.position.x < 380);
    return { cut, leftOpen: leftOpen(), left, game: ctx.game };
  } finally {
    releaseClock();
  }
}

describe("the capture flood crosses what a ball can cross", () => {
  it("keeps a ward behind a membrane while a ball can still fall in", () => {
    const r = play(divided({ oneWay: "left" }), 1);
    expect(r.cut).toBe(true);
    expect(r.leftOpen, "the empty ward was captured on the first cut").toBe(true);
  });

  it("still captures it when the membrane only lets balls OUT of it", () => {
    // Facing right, nothing on the right can ever get left: genuinely unreachable.
    const r = play(divided({ oneWay: "right" }), 1);
    expect(r.leftOpen).toBe(false);
  });

  it("lets a ball that crosses after the cut stay where it landed", () => {
    // The ownership check used to throw it back, because the room it entered
    // had been dropped from the regions list along with its cells.
    const r = play(divided({ oneWay: "left" }), 40);
    expect(r.left.length, "no ball ever made it through the membrane").toBeGreaterThan(0);
    for (const b of r.left) {
      const region = r.game.regions.find(x => x.id === b.regionId);
      expect(region, `${b.id} crossed into no region`).toBeTruthy();
    }
  });

  it("opens a gate only for the types it names", () => {
    expect(play(divided({ passTypes: ["blue"] }), 1).leftOpen).toBe(true);
    expect(play(divided({ passTypes: ["compass"] }), 1).leftOpen, "no ball on the board may pass").toBe(false);
  });

  it("follows a portal to its other mouth", () => {
    const portals = [
      { id: "near", kind: "wall", shape: "circle", cx: 640, cy: 150, radius: 34, portal: "p" },
      { id: "far", kind: "wall", shape: "circle", cx: 200, cy: 150, radius: 34, portal: "p" },
    ] as unknown as LevelEntity[];
    // A solid divider: only the portal joins the halves.
    expect(play(divided({}, portals), 1).leftOpen).toBe(true);
    expect(play(divided({}), 1).leftOpen, "without the portal the left is cut off").toBe(false);
  });
});

describe("the stranding checks see through the same links", () => {
  /**
   * They used to read "can a ball reach this ground" as "does its region hold
   * this ground", on the rule that a ball never leaves its region. Level 33's
   * box sits below a gate only the compass crosses, so every first cut ended
   * the map as areaUnreachable with the compass standing a door away.
   */
  it("finds a zone behind a gate reachable for the ball that may cross it", () => {
    const level = { ...divided({ passTypes: ["blue"] }), coloredAreas: [{ kind: "dark", x: 100, y: 380, width: 160, height: 160 }] } as LevelConfig;
    setRunSeedText("pass-1");
    installClock();
    try {
      const ctx = createBotGame(level, level.level, plainModifiers(), { mutator: null });
      ctx.game.balls.forEach((b, i) => { b.position = { x: 640, y: 250 + i * 150 }; });
      const g = ctx.game.spaceGrid!;
      const blue = ctx.game.balls.find(b => b.typeId === "blue")!;
      const red = ctx.game.balls.find(b => b.typeId === "red")!;
      const zoneCell = worldToGridIndex(g, 180, 460);
      expect(linkedReach(g, blue.position, "blue")![zoneCell], "blue cannot get through its own gate").toBe(1);
      expect(linkedReach(g, red.position, "red")![zoneCell], "red walked through a gate that does not name it").toBe(0);
      expect(anyGateTargetCanReach(g, ctx.game.balls, ctx.game.coloredAreas ?? [])).toBe(true);
    } finally {
      releaseClock();
    }
  });
});
