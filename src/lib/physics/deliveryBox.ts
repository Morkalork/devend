/**
 * Delivery boxes: four walls, one membrane, and a ball that goes in stays in.
 *
 * The box is the goal the one-way membrane never had. Herding was a tool with
 * nothing to herd toward; this is the thing you herd INTO, and it asks for a
 * verb the rest of the game never tests - every lock in Dev/End is "seal a ball
 * where it happens to be", and a delivery is "take a ball somewhere".
 *
 * ── Delivered, not locked ──────────────────────────────────────────────────
 *
 * Kept out of the lock economy entirely, and the reason is a rule the game
 * teaches from map one: a ball locks only in a genuinely sealed pocket, never
 * in one closed off by a gap too narrow for it. Nobody sealed a delivered ball.
 * Calling it a lock would quietly contradict the lesson and let a box pay on a
 * curve the lock economy was never balanced for, so it gets its own word and
 * its own counter.
 */
import { restoreCells } from "@/lib/spaceGrid";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

/** The four bearings a mouth can face, as inward-pointing normals. */
export type Mouth = "up" | "down" | "left" | "right";

/**
 * The mouth faces OUT of the box, and a ball crossing it travels IN - so the
 * membrane a mouth needs is the one that passes balls moving the opposite way.
 * A box whose mouth is on top admits balls moving DOWN.
 */
export const INWARD_FROM_MOUTH: Record<Mouth, Mouth> = {
  up: "down", down: "up", left: "right", right: "left",
};

export interface DeliveryBoxState {
  id: string;
  /** Interior, in world units: the space a ball must reach. */
  inner: { x: number; y: number; width: number; height: number };
  mouth: Mouth;
  capacity: number;
  delivered: number;
  /**
   * Grid cells held off the board until the box is satisfied. Empty when the
   * box does not reserve.
   */
  reservedCells: number[];
}

/** True once the box has everything it asked for. */
export function boxSatisfied(box: DeliveryBoxState): boolean {
  return box.delivered >= box.capacity;
}

/** Every box on the board is full. Vacuously true on a map with no boxes. */
export function allBoxesSatisfied(game: CanvasGameState): boolean {
  return (game.deliveryBoxes ?? []).every(boxSatisfied);
}

/** Total deliveries this map, across every box. */
export function deliveredCount(game: CanvasGameState): number {
  return (game.deliveryBoxes ?? []).reduce((n, b) => n + b.delivered, 0);
}

const inside = (b: DeliveryBoxState, p: { x: number; y: number }): boolean =>
  p.x >= b.inner.x && p.x <= b.inner.x + b.inner.width
  && p.y >= b.inner.y && p.y <= b.inner.y + b.inner.height;

export interface DeliveryEvent {
  box: DeliveryBoxState;
  ball: Ball;
  /** True when this delivery is the one that filled the box. */
  satisfied: boolean;
}

/**
 * Take any ball that has arrived inside a box.
 *
 * Runs once per physics step. Returns what happened so the caller can play the
 * sound, flash the counter and re-open reserved space - this module deliberately
 * does none of that itself, so it stays testable without a renderer.
 *
 * A FULL box takes nothing. A ball that finds its way into a satisfied box just
 * bounces around in there, which is a fair outcome for a player who over-fed it
 * and much better than silently swallowing a ball the map still needs.
 */
export function collectDeliveries(game: CanvasGameState): DeliveryEvent[] {
  const boxes = game.deliveryBoxes;
  if (!boxes?.length) return [];

  const events: DeliveryEvent[] = [];
  for (const ball of game.balls) {
    if (ball.state !== "active") continue;
    for (const box of boxes) {
      if (boxSatisfied(box)) continue;
      if (!inside(box, ball.position)) continue;

      box.delivered += 1;
      // Taking the ball out of play is ALSO what stops it being counted again:
      // the loop above skips anything that is not active, so a ball sitting in
      // the box is counted on the frame it arrives and never after. A separate
      // list of taken ids was here first and no mutation could kill it, which
      // is how it was spotted as dead.
      ball.state = "won";
      events.push({ box, ball, satisfied: boxSatisfied(box) });
      break;
    }
  }
  return events;
}

/**
 * Hand back the space a satisfied box was holding.
 *
 * Mirrors what a breakable's gate does when it comes down: restore the cells and
 * raise initialActiveCount with them, or the freed ground counts against the
 * player as space they failed to clear and remaining% climbs past 100.
 */
export function releaseReservedSpace(game: CanvasGameState, box: DeliveryBoxState): number {
  const grid = game.spaceGrid;
  if (!grid || box.reservedCells.length === 0) return 0;
  restoreCells(grid, box.reservedCells);
  grid.initialActiveCount += box.reservedCells.length;
  const n = box.reservedCells.length;
  box.reservedCells = [];
  return n;
}
