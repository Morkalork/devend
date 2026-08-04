/**
 * "Data Stream" (dataStream.ts): a seam harvested by a fence that runs ALONG it
 * (not merely crosses it), paying scaled overtime. This pins the along-vs-cross
 * rule, coverage scaling, once-per-span payment, the freeze-charge variant, and
 * config + rotation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { tickDataStreamOnCut } from "@/lib/physics/dataStream";
import { rotateDataStream } from "@/lib/mapRotation";
import type { CanvasGameState, DataStreamRuntime } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { LevelData } from "@/types/level";

// A fence whose ONE grown half is the polyline `pts` (the other half is empty).
function fence(...pts: Vector2[]): GrowingWall {
  return { startWaypoints: pts, endWaypoints: [pts[pts.length - 1]] } as unknown as GrowingWall;
}

function makeStream(over: Partial<DataStreamRuntime> = {}): DataStreamRuntime {
  return {
    // A straight horizontal seam of two spans along y=160, x 300..600.
    path: [{ x: 300, y: 160 }, { x: 450, y: 160 }, { x: 600, y: 160 }],
    width: 40,
    reward: { kind: "overtime", value: 30 },
    harvested: [false, false],
    freezeProgress: 0,
    ...over,
  };
}

function makeGame(ds: DataStreamRuntime | null, over: Partial<CanvasGameState> = {}): CanvasGameState {
  return { dataStream: ds, pickupOvertime: 0, freezeCharges: 0, freezeChargeSeconds: 0, ...over } as unknown as CanvasGameState;
}

const cbs = (onStreamHarvested?: GameCallbacks["onStreamHarvested"]) =>
  ({ onStreamHarvested }) as unknown as GameCallbacks;

describe("harvesting along vs crossing", () => {
  it("a fence running ALONG the whole seam harvests every span and pays full value", () => {
    const ds = makeStream();
    const game = makeGame(ds);
    let paid = 0;
    // A horizontal fence right on the seam (y=160) spanning its full width.
    tickDataStreamOnCut(game, fence({ x: 280, y: 160 }, { x: 620, y: 160 }), cbs(h => { paid += h; }));
    expect(ds.harvested).toEqual([true, true]);
    expect(game.pickupOvertime).toBe(30); // full coverage -> full value
    expect(paid).toBe(30);
  });

  it("a fence CROSSING the seam perpendicularly harvests nothing", () => {
    const ds = makeStream();
    const game = makeGame(ds);
    // A vertical fence through x=450 only touches the seam near one point.
    tickDataStreamOnCut(game, fence({ x: 450, y: 0 }, { x: 450, y: 400 }), cbs());
    expect(ds.harvested).toEqual([false, false]);
    expect(game.pickupOvertime).toBe(0);
  });

  it("partial coverage pays proportionally and marks only the covered span", () => {
    const ds = makeStream();
    const game = makeGame(ds);
    // A fence along only the LEFT span (x 300..450).
    tickDataStreamOnCut(game, fence({ x: 290, y: 160 }, { x: 450, y: 160 }), cbs());
    expect(ds.harvested).toEqual([true, false]);
    expect(game.pickupOvertime).toBe(15); // 1 of 2 spans -> half of 30
  });

  it("re-tracing an already-harvested span banks nothing more", () => {
    const ds = makeStream({ harvested: [true, false] });
    const game = makeGame(ds, { pickupOvertime: 15 });
    tickDataStreamOnCut(game, fence({ x: 290, y: 160 }, { x: 450, y: 160 }), cbs());
    expect(game.pickupOvertime).toBe(15); // unchanged: that span already paid
  });

  it("is a no-op with no seam or once fully harvested", () => {
    expect(() => tickDataStreamOnCut(makeGame(null), fence({ x: 0, y: 0 }, { x: 100, y: 0 }), cbs())).not.toThrow();
    const ds = makeStream({ harvested: [true, true] });
    const game = makeGame(ds);
    tickDataStreamOnCut(game, fence({ x: 280, y: 160 }, { x: 620, y: 160 }), cbs());
    expect(game.pickupOvertime).toBe(0);
  });
});

describe("freeze-charge reward", () => {
  it("accumulates coverage and grants a whole charge each time it crosses 1.0", () => {
    const ds = makeStream({ reward: { kind: "freezeCharge", value: 2 } }); // full seam = 2 charges
    const game = makeGame(ds);
    // Full coverage -> fraction 1.0 * value 2 = 2 charges.
    tickDataStreamOnCut(game, fence({ x: 280, y: 160 }, { x: 620, y: 160 }), cbs());
    expect(game.freezeCharges).toBe(2);
  });
});

describe("config + rotation", () => {
  it("the pilot map ships a well-formed data stream", () => {
    const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
    const withStream = doc.levels.find(l => l.dataStream);
    expect(withStream, "a map should author a data stream").toBeDefined();
    const ds = withStream!.dataStream!;
    expect(ds.path.length).toBeGreaterThanOrEqual(2);
    expect(ds.width).toBeGreaterThan(0);
    expect(ds.reward.value).toBeGreaterThan(0);
    expect(["overtime", "freezeCharge"]).toContain(ds.reward.kind);
  });

  it("rotateDataStream turns the seam polyline into the orientation", () => {
    const base = { path: [{ x: 100, y: 0 }, { x: 200, y: 0 }], width: 40, reward: { kind: "overtime" as const, value: 30 } };
    expect(rotateDataStream(base, 0)).toBe(base); // no-op at 0
    const r = rotateDataStream(base, 1);          // 90 left
    expect(r.path[0]).not.toEqual(base.path[0]);
    expect(r.path.length).toBe(2);
  });
});
