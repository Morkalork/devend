/**
 * What the band does when it is let go.
 *
 * rubberBand.test.ts pins the geometry and the numbers; this file pins the
 * effect against the real game state, which is where the design promise lives:
 *
 *  - a full pull breaks ANY destructible, however tough the author made it,
 *  - a light pull only chips it, so the power is a real choice and not a
 *    formality,
 *  - the balls it throws keep that speed afterwards, which is the wager the
 *    ability is built around (easy to fling, hard to fence in again),
 *  - and a band that catches nothing reports so, so the caller can decline to
 *    spend the charge.
 */
import { describe, it, expect } from 'vitest';
import { fireRubberBand } from '@/lib/abilityEffects';
import { bandShape, BAND_FULL_PULL, BAND_MAX_POWER } from '@/lib/rubberBand';
import type { DestructibleState, Ball } from '@/types/game';
import type { CanvasGameState } from '@/types/gameState';

/**
 * A band strung at (BAND_X, 400) and aimed LEFT, made by pressing `len` to its
 * right and dragging back onto it.
 *
 * Note what the geometry forces: the sweep reaches only BAND_REACH behind the
 * band, so a hard pull has to START far from what it means to catch. Power
 * costs positioning, which is the trade the ability is built on, so the
 * fixtures place their targets relative to the BAND rather than to the press.
 */
const BAND_X = 580;
const CAUGHT_X = BAND_X - 30;   // inside the sweep, whatever the pull length

function band(len: number) {
  const shape = bandShape({ x: BAND_X - len, y: 400 }, { x: BAND_X, y: 400 });
  if (!shape) throw new Error('pull too short to make a band');
  return shape;
}

/** A square destructible centred at (x,y), so its centroid is exactly (x,y). */
function block(x: number, y: number, maxHits: number): DestructibleState {
  return {
    id: `d-${x}-${y}`,
    hits: 0,
    maxHits,
    destroyed: false,
    lastHitAt: 0,
    obstaclePolygon: {
      vertices: [
        { x: x - 20, y: y - 20 }, { x: x + 20, y: y - 20 },
        { x: x + 20, y: y + 20 }, { x: x - 20, y: y + 20 },
      ],
    },
  } as unknown as DestructibleState;
}

function ball(x: number, y: number, baseSpeed = 250): Ball {
  return {
    id: `b-${x}`,
    state: 'active',
    position: { x, y },
    velocity: { x: 0, y: baseSpeed },
    speed: baseSpeed,
    baseSpeed,
    radius: 18,
  } as unknown as Ball;
}

function state(balls: Ball[], destructibles: DestructibleState[]): CanvasGameState {
  return { balls, destructibles, pendingDestroys: [] } as unknown as CanvasGameState;
}

describe('fireRubberBand', () => {
  it('breaks a destructible outright at full pull, whatever its budget', () => {
    for (const budget of [1, 2, 3, 5, 9, 40]) {
      const d = block(CAUGHT_X, 400, budget);
      const game = state([], [d]);
      fireRubberBand(game, band(BAND_FULL_PULL + 60), 1000);
      expect(d.destroyed, `budget ${budget}`).toBe(true);
      expect(game.pendingDestroys, `budget ${budget}`).toContain(d);
    }
  });

  it('only chips a tough object at a light pull', () => {
    const d = block(CAUGHT_X, 400, 5);
    const game = state([], [d]);
    fireRubberBand(game, band(40), 1000);
    expect(d.destroyed).toBe(false);
    expect(d.hits).toBeGreaterThan(0);
    expect(d.hits).toBeLessThan(d.maxHits);
  });

  it('leaves the balls it throws genuinely fast, which is the whole wager', () => {
    const b = ball(CAUGHT_X, 400, 250);
    const game = state([b], []);
    fireRubberBand(game, band(BAND_FULL_PULL + 60), 1000);
    // Thrown back towards the press point, at the full multiplier.
    expect(b.velocity.x).toBeCloseTo(-250 * BAND_MAX_POWER, 4);
    expect(b.velocity.y).toBeCloseTo(0, 6);
    expect(b.speed).toBeCloseTo(250 * BAND_MAX_POWER, 4);
  });

  it('never queues an object a descope already queued this frame', () => {
    // The reachable double-queue: descope pushes onto pendingDestroys while
    // leaving `destroyed` false until processDestroys runs, so an object can be
    // on its way out and still look intact to the band.
    const d = block(CAUGHT_X, 400, 3);
    const game = state([], [d]);
    game.pendingDestroys.push(d);
    fireRubberBand(game, band(BAND_FULL_PULL + 60), 1000);
    expect(d.destroyed).toBe(true);
    expect(game.pendingDestroys.filter(x => x === d).length).toBe(1);
  });

  it('reports an empty release, so the caller can keep the charge', () => {
    // Both behind the band: nothing is in the sweep.
    const game = state([ball(BAND_X + 40, 400)], [block(BAND_X + 60, 400, 3)]);
    expect(fireRubberBand(game, band(200), 1000)).toBe(false);
    expect(game.pendingDestroys).toHaveLength(0);
  });

  it('leaves parked and captured balls alone', () => {
    const b = ball(CAUGHT_X, 400);
    (b as unknown as { state: string }).state = 'captured';
    const before = { ...b.velocity };
    const game = state([b], []);
    expect(fireRubberBand(game, band(BAND_FULL_PULL), 1000)).toBe(false);
    expect(b.velocity).toEqual(before);
  });

  it('does not re-break something already destroyed', () => {
    const d = block(CAUGHT_X, 400, 3);
    d.destroyed = true;
    d.hits = 3;
    const game = state([], [d]);
    expect(fireRubberBand(game, band(BAND_FULL_PULL), 1000)).toBe(false);
    expect(game.pendingDestroys).toHaveLength(0);
  });
});
