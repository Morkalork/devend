/**
 * Delivery boxes: four walls, one membrane, and a ball that goes in stays in.
 *
 * Two things are being guarded here and they are different in kind.
 *
 * The COUNTING has to be its own thing. A delivered ball was herded through a
 * membrane, not sealed into a pocket, and the game teaches from map one that a
 * ball only locks in a genuinely sealed pocket. If a delivery quietly counted
 * as a lock it would contradict that lesson and pay on a curve the lock economy
 * was never balanced for.
 *
 * The RESERVED SPACE is what stops the box being a side quest. Every delivered
 * ball is a threat removed, so without it a box map gets calmer each time you
 * do the hard thing and the difficulty curve inverts inside the map. Holding
 * the interior off the board until the box is fed makes the two halves need
 * each other.
 */
import { describe, it, expect } from "vitest";
import {
  collectDeliveries, releaseReservedSpace, boxSatisfied, allBoxesSatisfied,
  deliveredCount, INWARD_FROM_MOUTH, type DeliveryBoxState,
} from "@/lib/physics/deliveryBox";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import { CellState } from "@/lib/spaceGrid";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const box = (over: Partial<DeliveryBoxState> = {}): DeliveryBoxState => ({
  id: "b", inner: { x: 100, y: 100, width: 200, height: 200 },
  mouth: "up", capacity: 2, delivered: 0, reservedCells: [],
  ...over,
});

const ball = (id: string, x: number, y: number): Ball =>
  ({ id, position: { x, y }, state: "active" } as unknown as Ball);

const gameWith = (boxes: DeliveryBoxState[], balls: Ball[]) =>
  ({ deliveryBoxes: boxes, balls } as unknown as CanvasGameState);

describe("which way the mouth faces", () => {
  it("admits balls travelling INTO the box", () => {
    // The mouth names the side it is ON; a ball crossing a lid on top is
    // travelling DOWN. Getting this inverted gives a box that lets balls out
    // and refuses to let them in, which plays as a box that does nothing.
    expect(INWARD_FROM_MOUTH.up).toBe("down");
    expect(INWARD_FROM_MOUTH.down).toBe("up");
    expect(INWARD_FROM_MOUTH.left).toBe("right");
    expect(INWARD_FROM_MOUTH.right).toBe("left");
  });
});

describe("taking a delivery", () => {
  it("takes a ball that has arrived inside, and removes it from play", () => {
    const b = box();
    const g = gameWith([b], [ball("x", 200, 200)]);
    const events = collectDeliveries(g);
    expect(events).toHaveLength(1);
    expect(b.delivered).toBe(1);
    expect(g.balls[0].state).toBe("won");
  });

  it("ignores a ball outside it", () => {
    const b = box();
    const g = gameWith([b], [ball("x", 500, 500)]);
    expect(collectDeliveries(g)).toHaveLength(0);
    expect(b.delivered).toBe(0);
  });

  it("counts a ball once, however many steps it spends inside", () => {
    // collectDeliveries runs every physics step, so a ball sitting in the box
    // must not fill it in three frames. What prevents that is the ball leaving
    // play - the loop skips anything not active. There was a separate list of
    // taken ball ids doing the same job, and deleting it broke nothing, which
    // is how it was found to be dead.
    const b = box({ capacity: 5 });
    const g = gameWith([b], [ball("x", 200, 200)]);
    collectDeliveries(g);
    collectDeliveries(g);
    collectDeliveries(g);
    expect(b.delivered).toBe(1);
  });

  it("stops taking balls once it is full", () => {
    // A satisfied box swallowing more would quietly remove balls the map still
    // needs, which is worse for the player than a ball rattling around in it.
    const b = box({ capacity: 1 });
    const g = gameWith([b], [ball("x", 200, 200), ball("y", 210, 210)]);
    collectDeliveries(g);
    collectDeliveries(g);
    expect(b.delivered).toBe(1);
    expect(g.balls[1].state).toBe("active");
  });

  it("never takes a ball that is already out of play", () => {
    const b = box();
    const dead = { ...ball("x", 200, 200), state: "won" } as Ball;
    expect(collectDeliveries(gameWith([b], [dead]))).toHaveLength(0);
  });

  it("says which delivery filled the box", () => {
    const b = box({ capacity: 2 });
    const g = gameWith([b], [ball("x", 200, 200)]);
    expect(collectDeliveries(g)[0].satisfied).toBe(false);
    g.balls = [ball("y", 210, 210)];
    expect(collectDeliveries(g)[0].satisfied).toBe(true);
  });

  it("does nothing at all on a map with no boxes", () => {
    expect(collectDeliveries(gameWith([], [ball("x", 1, 1)]))).toEqual([]);
    expect(allBoxesSatisfied(gameWith([], []))).toBe(true);
    expect(deliveredCount(gameWith([], []))).toBe(0);
  });
});

describe("counting", () => {
  it("sums across every box on the map", () => {
    const a = box({ id: "a", delivered: 1 });
    const b = box({ id: "b", delivered: 2 });
    expect(deliveredCount(gameWith([a, b], []))).toBe(3);
  });

  it("is satisfied only when EVERY box is", () => {
    const full = box({ id: "a", capacity: 1, delivered: 1 });
    const hungry = box({ id: "b", capacity: 2, delivered: 1 });
    expect(boxSatisfied(full)).toBe(true);
    expect(boxSatisfied(hungry)).toBe(false);
    expect(allBoxesSatisfied(gameWith([full, hungry], []))).toBe(false);
    expect(allBoxesSatisfied(gameWith([full], []))).toBe(true);
  });
});

describe("the space a box holds hostage", () => {
  const build = (reserves: boolean) => {
    setRunSeedText("box-fixture");
    const level = {
      id: "box-test", level: 1, name: "B", sizeThreshold: 30, expectedCuts: 4, points: 100,
      variety: 0, randomShapes: 0, pickupChance: 0,
      balls: [{ id: "b1", type: "red", startX: 100, startY: 100 }],
      entities: [{
        id: "done", kind: "box", shape: "rect",
        x: 400, y: 400, width: 200, height: 200, mouth: "up", capacity: 2, reserves,
      }],
    } as unknown as LevelConfig;
    const data = createInitialGameData(level, 1, DEFAULT_MODIFIERS);
    setRunSeedText(null);
    return data;
  };

  it("builds four walls and exactly one membrane", () => {
    const d = build(false);
    expect(d.deliveryBoxes).toHaveLength(1);
    expect(d.obstaclePolygons.length).toBeGreaterThanOrEqual(4);
    // One side, and only one, lets balls through.
    expect(d.obstacleRules.size).toBe(1);
    expect([...d.obstacleRules.values()][0].oneWay).toBe("down");
  });

  it("holds its interior off the board when it reserves", () => {
    const held = build(true);
    const open = build(false);
    expect(held.deliveryBoxes[0].reservedCells.length).toBeGreaterThan(0);
    expect(open.deliveryBoxes[0].reservedCells).toHaveLength(0);
    // The reserved interior really is unplayable, not merely recorded.
    const grid = held.spaceGrid;
    for (const idx of held.deliveryBoxes[0].reservedCells) {
      expect(grid.cells[idx]).toBe(CellState.REMOVED);
    }
  });

  it("hands the space back when it is satisfied, and keeps remaining% honest", () => {
    const d = build(true);
    const game = { ...d } as unknown as CanvasGameState;
    const b = game.deliveryBoxes![0];
    const held = b.reservedCells.length;
    const before = game.spaceGrid.initialActiveCount;

    const freed = releaseReservedSpace(game, b);

    expect(freed).toBe(held);
    expect(b.reservedCells).toHaveLength(0);
    // initialActiveCount must rise with the freed ground or the player is
    // charged for space that was never theirs to clear, and remaining% climbs
    // past 100. The breakable gates already learned this.
    expect(game.spaceGrid.initialActiveCount).toBe(before + held);
  });

  it("releases nothing twice", () => {
    const d = build(true);
    const game = { ...d } as unknown as CanvasGameState;
    const b = game.deliveryBoxes![0];
    releaseReservedSpace(game, b);
    expect(releaseReservedSpace(game, b)).toBe(0);
  });
});
