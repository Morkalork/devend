/**
 * stateHash — the cheap, continuous answer to "are we still playing the same
 * board?" (TWO_PLAYER_PLAN.md step 4).
 *
 * Lockstep keeps two devices in step by feeding them the same inputs and
 * trusting them to compute the same outputs. The trust is the risky part:
 * different Chrome builds, different CPUs, a stray unseeded roll someone adds
 * next year. So every so often each side hashes what it has and swaps the
 * hash. Agreement costs 16 bytes; disagreement is caught in a quarter of a
 * second rather than being noticed by a player whose ball went through a fence
 * that is not there on the other screen.
 *
 * Two hashes, because they fail differently and want different answers:
 *
 *   - MOTION is where things are. It drifts first, and it is cheap to repair:
 *     the host sends its balls and movers and the guest adopts them.
 *   - TOPOLOGY is the shape of the board: the walls, and which cells are
 *     captured. If these differ the two devices disagree about what the board
 *     IS, which no amount of position-patching fixes; that is a replay, or in
 *     the last resort a restart of the map from the shared seed.
 *
 * Positions are quantised before hashing. Two devices agreeing to within a
 * thousandth of a world unit are playing the same game, and hashing raw
 * doubles would report a desync for a last-bit difference that will never be
 * visible and often washes out again.
 */
import type { CanvasGameState } from "@/types/gameState";
import { captureSimModuleState, restoreSimModuleState } from "@/lib/net/simState";

/** Quantisation: positions to 1/1000 of a world unit, velocities the same. */
const Q = 1000;
const q = (n: number): number => Math.round(n * Q);

/** FNV-1a over a string, as hex. Same hash the run seeds use; fast, and good
 *  enough for "did these two strings differ", which is all this asks. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Where everything is: balls, movers, and the fences still growing.
 *
 * Ball order matters and is not sorted, deliberately: the array order is
 * itself state both devices must agree on (a spawned or removed ball shifts
 * it), and sorting would hide exactly that kind of divergence.
 */
export function motionHash(game: CanvasGameState): string {
  const parts: string[] = [];
  for (const b of game.balls) {
    parts.push(
      `${b.id}|${q(b.position.x)}|${q(b.position.y)}|${q(b.velocity.x)}|${q(b.velocity.y)}` +
      `|${b.state}|${b.regionId}|${q(b.radius)}`,
    );
  }
  for (const m of game.movers ?? []) {
    parts.push(`M${m.id}|${q(m.offset)}|${q(m.angle ?? 0)}|${q(m.driveRate ?? 0)}`);
  }
  for (const w of game.activeWalls) {
    parts.push(
      `G${q(w.startPoint.x)}|${q(w.startPoint.y)}|${q(w.endPoint.x)}|${q(w.endPoint.y)}` +
      `|${w.isComplete ? 1 : 0}|${w.player ?? 0}`,
    );
  }
  return fnv1a(parts.join("\n"));
}

/**
 * What shape the board is: the standing walls, the captured cells, and the
 * counters a map is scored on.
 */
export function topologyHash(game: CanvasGameState): string {
  const parts: string[] = [];
  for (const w of game.walls) {
    parts.push(`${w.id}|${q(w.start.x)}|${q(w.start.y)}|${q(w.end.x)}|${q(w.end.y)}`);
  }
  const grid = game.spaceGrid;
  if (grid) {
    // Every cell, not a sample: a single cell captured on one device and not
    // the other is the divergence this exists to find, and a sample would miss
    // it exactly when it matters.
    let h = 0x811c9dc5;
    for (let i = 0; i < grid.cells.length; i++) {
      h ^= grid.cells[i];
      h = Math.imul(h, 0x01000193);
    }
    parts.push(`grid:${(h >>> 0).toString(16)}`);
  }
  parts.push(`regions:${game.regions.length}`);
  parts.push(`walls:${game.wallCount}`);
  parts.push(`locked:${game.lockedBallsCount ?? 0}`);
  return fnv1a(parts.join("\n"));
}

/**
 * The modifier set both devices must be playing under.
 *
 * Every other hash in this file compares what the two boards DID. This one
 * compares what they were set up to do, and it is the check that catches the
 * one divergence the others only see afterwards: certificate bonuses,
 * achievement bonuses and loadout bonuses all come from each phone's own
 * storage and none of them travel in the run record, so a player with an
 * unlock their partner lacks computes different fence speeds and lock
 * thresholds from the very first tick.
 *
 * Numbers only, and sorted by key, so two devices hash the same set whatever
 * order their objects were built in. Rounded to four places, because these are
 * derived from multiplications and the last bit of a percentage is not a
 * disagreement worth failing a pairing over.
 */
export function modifierHash(modifiers: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(modifiers).sort()) {
    const value = modifiers[key];
    if (typeof value === "number") {
      parts.push(`${key}=${Number.isFinite(value) ? value.toFixed(4) : "nan"}`);
    } else if (typeof value === "boolean" || typeof value === "string") {
      parts.push(`${key}=${String(value)}`);
    }
    // Anything else (arrays, objects, functions) is not a tuning number and is
    // deliberately skipped rather than stringified: a stable hash matters more
    // than a complete one, and the motion hash catches what this misses.
  }
  return fnv1a(parts.join("|"));
}

// ── Resync ──────────────────────────────────────────────────────────────────

/**
 * The smallest thing that puts a drifted guest back on the host's board.
 *
 * Only motion: positions, velocities, states and rail offsets. Not the walls,
 * not the grid, not the regions. If those differ, this is the wrong repair and
 * the session escalates to a replay instead. Keeping the snapshot to motion is
 * what keeps it a kilobyte or two rather than a serialisation of the whole
 * 734-line state, which this plan exists to avoid writing.
 */
export interface MotionSnapshot {
  tick: number;
  /**
   * Everything the simulation keeps OUTSIDE the game state: the clock, the
   * seeded streams' positions and the id counters (see net/simState.ts).
   *
   * Positions alone were the first version of this repair and they did not
   * hold. A guest given the host's balls but left with its own dice parts from
   * it on the very next roll; one left with its own clock has every fence and
   * freeze on the board dated in its own future; one left with its own id
   * counters names the next region something the host has never heard of.
   */
  moduleState: import("@/lib/net/simState").SimModuleState;
  balls: {
    id: string; x: number; y: number; vx: number; vy: number;
    state: string; regionId: string; speed: number;
  }[];
  movers: { id: string; offset: number; angle: number; driveRate: number }[];
}

export function captureMotion(game: CanvasGameState, tick: number): MotionSnapshot {
  return {
    tick,
    moduleState: captureSimModuleState(),
    balls: game.balls.map(b => ({
      id: b.id,
      x: b.position.x, y: b.position.y,
      vx: b.velocity.x, vy: b.velocity.y,
      state: b.state, regionId: b.regionId, speed: b.speed,
    })),
    movers: (game.movers ?? []).map(m => ({
      id: m.id, offset: m.offset, angle: m.angle ?? 0, driveRate: m.driveRate ?? 0,
    })),
  };
}

/**
 * Adopt a host's motion.
 *
 * Balls the guest does not have are NOT created, and ones it has that the host
 * does not are not removed: a difference in the ball LIST is a topology-level
 * disagreement wearing a motion-shaped mask, and papering over it here would
 * turn a caught desync into a silent one. The caller checks the count and
 * escalates.
 */
export function applyMotion(game: CanvasGameState, snap: MotionSnapshot): boolean {
  if (snap.balls.length !== game.balls.length) return false;
  const byId = new Map(game.balls.map(b => [b.id, b]));
  for (const s of snap.balls) {
    const ball = byId.get(s.id);
    if (!ball) return false;
    ball.position.x = s.x; ball.position.y = s.y;
    ball.velocity.x = s.vx; ball.velocity.y = s.vy;
    ball.speed = s.speed;
    ball.regionId = s.regionId;
    ball.state = s.state as typeof ball.state;
    // The interpolation cursor has to go with them, or the first frame after a
    // resync draws the ball streaking from where it used to be.
    ball.prevPosition = { x: s.x, y: s.y };
    ball.renderPosition = { x: s.x, y: s.y };
  }
  for (const s of snap.movers) {
    const mover = game.movers?.find(m => m.id === s.id);
    if (!mover) continue;
    mover.offset = s.offset;
    if (mover.angle !== undefined) mover.angle = s.angle;
    mover.driveRate = s.driveRate;
  }
  if (snap.moduleState) restoreSimModuleState(snap.moduleState);
  return true;
}
