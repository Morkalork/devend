/**
 * Where the bot cuts.
 *
 * Deliberately not a good player. A strong policy would clear maps quickly and
 * spend most of its frames in states the game handles well, which is the
 * opposite of what a bug hunt wants. This one plays plausibly - it aims at open
 * space and avoids cutting straight through a ball, because a bot that
 * instantly kills itself never reaches frame two - and is otherwise happy to be
 * reckless.
 *
 * Seeded so a violation can be replayed exactly. A fuzzer that cannot reproduce
 * its own finding has produced a rumour, not a bug report.
 */
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import type { CanvasGameState } from "@/types/gameState";
import type { Vector2 } from "@/types/game";
import { isPositionActive } from "@/lib/spaceGrid";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { gateAreas } from "@/lib/coloredAreas";

/** Small deterministic PRNG (mulberry32), so a seed replays a whole run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CutPlan {
  origin: Vector2;
  direction: Vector2;
}

/**
 * How close a candidate may pass to a ball before the bot thinks better of it.
 *
 * Relaxed by `desperation`, and that is not a flourish. Held fixed at 70 the
 * bot refused 135 cuts in a row on level 15 with the board at 1% remaining -
 * one fence from winning - because in a nearly-cleared map every line passes
 * close to something. It then reported the MAP as possibly unfinishable, which
 * was a lie about the game caused entirely by the tester. A player who is one
 * cut from the end takes the risky cut.
 */
const BALL_CLEARANCE = 70;
/** Floor: below this the bot is cutting through balls on purpose, not bravely. */
const MIN_CLEARANCE = 12;

/**
 * Pick somewhere to cut, or null if nothing looked safe this tick.
 *
 * Samples a handful of candidates and takes the one furthest from every live
 * ball. Sampling rather than solving on purpose: an optimal cut would be one
 * behaviour repeated, and the point is to wander into odd corners of the state
 * space, not to find the best line.
 */
export function planCut(
  game: CanvasGameState, rng: () => number, desperation = 0,
  /** The win still needs a ball locked in a gate zone (an unmet `area` clause). */
  wantZone = false,
): CutPlan | null {
  // 0 = pick freely, 1 = take almost anything.
  const required = Math.max(MIN_CLEARANCE, BALL_CLEARANCE * (1 - Math.min(1, desperation)));
  const live = (game.balls ?? []).filter(b => b.state === "active");

  // A ZONE THE WIN NEEDS comes first. Without this the bot was blind to the
  // one objective that says WHERE: it locked balls wherever its random lines
  // happened to close, so every gate map lost to areaUnreachable on most seeds
  // - level 8, which plays well by hand, swept 1 of 8 - and a sweep of a zone
  // map measured the bot rather than the map. So: close the zone when a ball is
  // in it. The other half - not locking the last ball outside it - is the
  // game's own rule now (areaReach refuses that fence), so the bot keeps
  // cutting as a player would and the refusal is exercised, not routed around.
  if (wantZone) {
    const seal = planZoneSeal(game, live);
    if (seal) return seal;
  }

  let best: CutPlan | null = null;
  let bestClearance = -Infinity;

  for (let attempt = 0; attempt < 12; attempt++) {
    const origin = {
      x: 40 + rng() * (BOARD_WIDTH - 80),
      y: 40 + rng() * (BOARD_HEIGHT - 80),
    };
    // Axis-aligned: the game's fences are, and a diagonal would only ever be
    // rejected. Horizontal or vertical, chosen by coin flip.
    const direction = rng() < 0.5 ? { x: 1, y: 0 } : { x: 0, y: 1 };

    // Legal first. Sampling without this wastes most attempts on captured space
    // and the bot ends up cutting once a minute - which looks like a shy policy
    // and is really a policy proposing moves the game was always going to
    // refuse.
    if (!game.spaceGrid || !isPositionActive(game.spaceGrid, origin)) continue;
    if (!findRegionContainingPoint(game.regions, origin.x, origin.y)) continue;

    // Distance from the nearest ball to the LINE this cut would draw, which is
    // what actually kills you, rather than to the point it starts from.
    let clearance = Infinity;
    for (const b of live) {
      const d = direction.x !== 0
        ? Math.abs(b.position.y - origin.y)
        : Math.abs(b.position.x - origin.x);
      clearance = Math.min(clearance, d);
    }
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = { origin, direction };
    }
  }

  // Everything on offer ran right through a ball: wait a beat and look again
  // rather than cutting into one. Returning null is a real move.
  if (bestClearance < required) return null;
  return best;
}

/** Keep this far from a line the bot is about to draw across a zone's door. */
const ZONE_SEAL_CLEARANCE = 30;

/**
 * A cut along one side of a gate zone that holds a live ball, if one is safe
 * right now: every other ball clear of the line, and no mover on it. The cut
 * grows until it meets a wall, so along a side the map has left open it closes
 * the zone's door, and along a side that is already wall or board edge the
 * origin is not open ground and the side is skipped.
 */
function planZoneSeal(
  game: CanvasGameState, live: CanvasGameState["balls"],
): CutPlan | null {
  const zones = gateAreas(game.coloredAreas ?? []);
  for (const z of zones) {
    const inside = live.find(b => b.position.x > z.x && b.position.x < z.x + z.width
      && b.position.y > z.y && b.position.y < z.y + z.height);
    if (!inside) continue;
    const sides: CutPlan[] = [
      { origin: { x: z.x, y: inside.position.y }, direction: { x: 0, y: 1 } },
      { origin: { x: z.x + z.width, y: inside.position.y }, direction: { x: 0, y: 1 } },
      { origin: { x: inside.position.x, y: z.y }, direction: { x: 1, y: 0 } },
      { origin: { x: inside.position.x, y: z.y + z.height }, direction: { x: 1, y: 0 } },
    ];
    for (const side of sides) {
      if (!game.spaceGrid || !isPositionActive(game.spaceGrid, side.origin)) continue;
      if (!findRegionContainingPoint(game.regions, side.origin.x, side.origin.y)) continue;
      const vertical = side.direction.y !== 0;
      const at = vertical ? side.origin.x : side.origin.y;
      const clear = live.every(b =>
        Math.abs((vertical ? b.position.x : b.position.y) - at) >= ZONE_SEAL_CLEARANCE);
      if (!clear) continue;
      // Wait for a mover to leave the line: a fence grown into one costs a life.
      const lo = vertical ? z.y : z.x;
      const hi = vertical ? z.y + z.height : z.x + z.width;
      const blocked = (game.movers ?? []).some(m => {
        const vs = m.polygon?.vertices ?? [];
        if (vs.length === 0) return false;
        const across = vs.map(v => (vertical ? v.x : v.y));
        const along = vs.map(v => (vertical ? v.y : v.x));
        return Math.min(...across) - ZONE_SEAL_CLEARANCE <= at
          && Math.max(...across) + ZONE_SEAL_CLEARANCE >= at
          && Math.max(...along) >= lo && Math.min(...along) <= hi;
      });
      if (blocked) continue;
      return side;
    }
  }
  return null;
}
