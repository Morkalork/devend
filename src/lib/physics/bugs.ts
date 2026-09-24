/**
 * Bugs on the board: where they appear, how they fly, and what squashes them.
 *
 * ── Why they fly, and why they fly like this ────────────────────────────────
 *
 * Arkanoid drops its power-ups and you catch them with the paddle. This game
 * has no paddle and, on most of the ladder, no gravity either - a drop would
 * hang in the air on three quarters of the maps and sink into a corner on the
 * rest. So a bug moves under its own power.
 *
 * It does not fly in a straight line, and that is the mechanic rather than
 * decoration. A bug crossing the board at a constant heading is a slow bullet:
 * you either happen to have a ball on that line or you do not, and nothing you
 * do changes it. A bug that darts, slows, turns and doubles back is something
 * you can WAIT for - you put a ball into the chamber it is loitering in and let
 * the two find each other, which is the same verb the whole game runs on (you
 * do not aim a ball here, you decide where it is allowed to be).
 *
 * The skitter is a pure function of one advancing phase, so it is deterministic
 * per bug: a seeded Daily Stand-up run and both halves of a lockstep pair fly
 * the same bug along the same path.
 *
 * ── The one thing this file will not do ─────────────────────────────────────
 *
 * A bug never flees a ball. It was the obvious next step and it is wrong: the
 * board's whole tension is that you cannot steer a ball directly, so a target
 * that dodges would make the reward turn on the one thing the player has no
 * control over. A bug wanders where it wants and is indifferent to the ball
 * arriving, which keeps the squash a consequence of the player's fencing.
 *
 * Catalogue: lib/bugs.ts + public/bugs.yml. Effects: physics/bugEffects.ts.
 */
import type { Ball, Vector2 } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { BugConfig, BugSplat, BugState } from "@/types/bugs";
import { drawBug, getBug, bugMagnitude } from "@/lib/bugs";
import { applyBugEffect, expireBugBuffs, type BugEffectContext } from "./bugEffects";
import { isPositionActive } from "@/lib/spaceGrid";
import { pointToSegmentDistance } from "@/lib/polygon";
import { getRunRng } from "@/lib/runRng";
import { simNow } from "@/lib/simClock";
import { debugBugId } from "@/lib/devFlags";

/** Collision and draw radius, world units. Small: a bug is a detail, not a slab. */
export const BUG_RADIUS = 9;

/** How long a splat stays on the board, ms (wall clock - it is presentation). */
export const BUG_SPLAT_MS = 1300;

/** A bug starts blinking this many active-play seconds before it expires. */
export const BUG_EXPIRY_WARN_SECONDS = 3;

/**
 * Touch slop added to a bug's radius when tapping it, in world units.
 *
 * The same 22 a ball tap gets (FREEZE_TAP_SLOP), and a bug needs it more: it is
 * half a ball's size and it is moving, so by the time a finger lands the target
 * has left. Press-and-hold was tried here first and was unusable for exactly
 * this reason, plus a 12-unit move slop that a resting thumb drifts past inside
 * 450ms.
 */
export const BUG_TAP_SLOP = 22;

/** Clearances for a spawn spot, world units. */
const MIN_WALL_CLEARANCE = BUG_RADIUS + 10;
const MIN_BALL_CLEARANCE = 80;
const MIN_BUG_SPACING = 90;
const SPAWN_ATTEMPTS = 40;

/** Radians per second the wander phase advances. */
const WANDER_RATE = 2.3;
/** Peak heading drift, radians per second, at the top of the wander. */
const TURN_AMPLITUDE = 3.4;
/** Slowest and fastest points of the speed pulse, as fractions of cruise. */
const CRAWL = 0.35;
const DART = 1.75;

let _bugCounter = 0;
let _splatCounter = 0;

/**
 * A spawn asked for from outside the loop, waiting for the next frame.
 *
 * The Playground's "Spawn a bug now" button, and nothing else. A latch rather
 * than a ref threaded down through GameScreen and GameCanvas because the admin
 * screen has no handle on the live game and giving it one - a mutable game ref
 * crossing two component boundaries - would be a far bigger opening than the
 * button is worth. The tick drains it, so the spawn still happens inside the
 * simulation, on the simulation's own clock, where every other spawn happens.
 *
 * `undefined` means nothing pending; a string or null is a pending request
 * (null = draw from the pool as usual).
 */
let _pendingSpawn: string | null | undefined = undefined;

/**
 * Ask for a bug on the next live frame, of `effect` kind when given.
 *
 * Returns nothing and guarantees nothing: a board with no room, or one with
 * bugs switched off, simply will not produce one. That is deliberate - a button
 * that could conjure a bug onto a map configured without them would be testing
 * something the game cannot do.
 */
export function requestBugSpawn(effect?: string | null): void {
  _pendingSpawn = effect ?? null;
}

/** Test seam: drop any pending request. */
export function clearPendingBugSpawn(): void {
  _pendingSpawn = undefined;
}

/** Test seam: makes ids reproducible across test files. */
export function resetBugCounters(): void {
  _bugCounter = 0;
  _splatCounter = 0;
}

/**
 * The effective spawn chance for a map: the map's own `bugChance` (which also
 * bypasses the start-level gate), else the global chance once the gate passes.
 * Returns 0 when bugs are off for this map.
 *
 * Deliberately has no upgrade bonus term. `pickupChanceBonus` exists because
 * tokens are a reward lane the player can invest in; bugs are board furniture
 * belonging to the map, and an upgrade that made them commoner would be an
 * upgrade that made Big Bang Release commoner too.
 */
export function effectiveBugChance(
  cfg: BugConfig,
  levelNumber: number,
  levelChanceOverride: number | undefined,
): number {
  const base = levelChanceOverride ?? (levelNumber >= cfg.startLevel ? cfg.spawnChance : 0);
  return Math.max(0, Math.min(1, base));
}

/** True when a bug can sit at `p`: open space, clear of walls, balls and bugs. */
function isSpotFree(game: CanvasGameState, p: Vector2): boolean {
  const grid = game.spaceGrid;
  if (!grid) return false;
  const c = grid.cellSize;
  // The spot and a one-cell ring around it, so a bug never starts life
  // straddling a fence's raster band or a captured edge.
  for (const [dx, dy] of [[0, 0], [c, 0], [-c, 0], [0, c], [0, -c]]) {
    if (!isPositionActive(grid, { x: p.x + dx, y: p.y + dy })) return false;
  }
  for (const w of game.walls) {
    if (pointToSegmentDistance(p, w.start, w.end) < MIN_WALL_CLEARANCE) return false;
  }
  for (const b of game.balls) {
    if (b.state === "won") continue;
    if (Math.hypot(b.position.x - p.x, b.position.y - p.y) < MIN_BALL_CLEARANCE) return false;
  }
  // Not on top of another bug: a bug spawned under one already there is a
  // power-up the player cannot see and cannot choose between.
  for (const other of game.bugs ?? []) {
    if (Math.hypot(other.position.x - p.x, other.position.y - p.y) < MIN_BUG_SPACING) return false;
  }
  return true;
}

/** A free spot in live space, or null when the board has no room. */
function findSpawnSpot(game: CanvasGameState, rng: () => number): Vector2 | null {
  const grid = game.spaceGrid;
  if (!grid) return null;
  const width = grid.width * grid.cellSize;
  const height = grid.height * grid.cellSize;
  for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
    const p = {
      x: grid.originX + rng() * width,
      y: grid.originY + rng() * height,
    };
    if (isSpotFree(game, p)) return p;
  }
  return null;
}

/**
 * Put one bug on the board, of `forced` kind when given.
 *
 * Exported because admin needs it: a chance-based mechanic that can only be
 * observed by waiting is one where "did not fire" and "does not work" are the
 * same observation (CLAUDE.md), and Big Bang Release at weight 1 is a long
 * wait. The Playground spawns one directly.
 *
 * Returns the bug, or null when the catalogue is empty or the board is full.
 */
export function spawnBug(
  game: CanvasGameState,
  rng: () => number,
  forced?: string,
): BugState | null {
  const def = forced ? getBug(forced) : drawBug(rng);
  if (!def) return null;
  const spot = findSpawnSpot(game, rng);
  if (!spot) return null;

  const cfg = game.bugConfig;
  const lifetime = cfg?.lifetimeSeconds ?? 20;
  const speed = cfg?.speed ?? 95;
  const heading = rng() * Math.PI * 2;
  const bug: BugState = {
    id: `bug-${++_bugCounter}`,
    effect: def.id,
    position: { x: spot.x, y: spot.y },
    velocity: { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed },
    wander: rng() * Math.PI * 2,
    // Offset per bug, so two bugs alive at once never skitter in step - which
    // they otherwise would, the phase being a pure function of one clock.
    wanderSeed: rng() * Math.PI * 2,
    spawnedAtSeconds: game.activePlaySeconds,
    expiresAtSeconds: game.activePlaySeconds + lifetime,
  };
  (game.bugs ??= []).push(bug);
  return bug;
}

/** Is this heading clear for `distance` from `from`? */
function headingIsClear(game: CanvasGameState, from: Vector2, heading: Vector2, distance: number): boolean {
  const grid = game.spaceGrid;
  if (!grid) return false;
  const p = { x: from.x + heading.x * distance, y: from.y + heading.y * distance };
  if (!isPositionActive(grid, p)) return false;
  for (const w of game.walls) {
    if (pointToSegmentDistance(p, w.start, w.end) < BUG_RADIUS + 2) return false;
  }
  return true;
}

/**
 * Move one bug for `dt` seconds.
 *
 * Turning away from a wall rather than reflecting off it: a bug is not a ball,
 * and a mirror bounce at these speeds reads as a second, tiny ball, which is
 * precisely the confusion this mechanic cannot afford on a board already full
 * of round things that bounce. It tries progressively harder turns and, if the
 * board has closed in around it entirely, simply holds still - a cornered bug
 * sitting and twitching is a target, and a bug that tunnelled out through a
 * fence would be a power-up escaping into captured space.
 */
function flyBug(game: CanvasGameState, bug: BugState, dt: number, cruise: number): void {
  bug.wander += dt * WANDER_RATE;

  // Two incommensurable terms, so the path never settles into a circle.
  const drift =
    Math.sin(bug.wander + bug.wanderSeed) * TURN_AMPLITUDE
    + Math.sin(bug.wander * 0.41 + bug.wanderSeed * 1.7) * TURN_AMPLITUDE * 0.5;

  let heading = Math.atan2(bug.velocity.y, bug.velocity.x) + drift * dt;
  const pulse = CRAWL + (DART - CRAWL) * (0.5 + 0.5 * Math.sin(bug.wander * 2.1 + bug.wanderSeed));
  const speed = cruise * pulse;

  const probe = Math.max(BUG_RADIUS + 4, speed * dt * 3);
  const dir = { x: Math.cos(heading), y: Math.sin(heading) };
  if (!headingIsClear(game, bug.position, dir, probe)) {
    // Sharpest turn that clears, in both directions, nearest first.
    const turns = [0.8, -0.8, 1.6, -1.6, 2.4, -2.4, Math.PI];
    let found = false;
    for (const t of turns) {
      const candidate = heading + t;
      const cd = { x: Math.cos(candidate), y: Math.sin(candidate) };
      if (headingIsClear(game, bug.position, cd, probe)) {
        heading = candidate;
        found = true;
        break;
      }
    }
    if (!found) {
      // Boxed in. Keep the phase advancing so it still twitches in place and
      // flies off the moment the board reopens.
      bug.velocity.x = 0;
      bug.velocity.y = 0;
      return;
    }
  }

  bug.velocity.x = Math.cos(heading) * speed;
  bug.velocity.y = Math.sin(heading) * speed;
  bug.position.x += bug.velocity.x * dt;
  bug.position.y += bug.velocity.y * dt;
}

/**
 * Record a squash where it happened.
 *
 * `ball` is null for a tap: nothing hit the bug, so there is no heading and the
 * splat bursts radially. See BugSplat.direction.
 */
function pushSplat(
  game: CanvasGameState,
  bug: BugState,
  ball: Ball | null,
  outcome: BugSplat["outcome"],
): void {
  const vx = ball?.velocity.x ?? 0;
  const vy = ball?.velocity.y ?? 0;
  const len = Math.hypot(vx, vy);
  (game.bugSplats ??= []).push({
    id: `splat-${++_splatCounter}`,
    effect: bug.effect,
    position: { x: bug.position.x, y: bug.position.y },
    direction: len > 0 ? { x: vx / len, y: vy / len } : { x: 0, y: 0 },
    startTime: simNow(),
    outcome,
  });
}

/**
 * The player squashed a bug with a finger. It dies and pays nothing.
 *
 * ── Why a tap kills rather than claims ──────────────────────────────────────
 *
 * Because the power belongs to the ball that earns it. A tap that paid out
 * would make every bug free, and "which ball do I let reach this, and where"
 * - the decision the whole mechanic exists to ask - would stop being a
 * question anybody had to answer.
 *
 * So a tap is the other half of that decision: REFUSAL. You can see the warning
 * ring on Big Bang Release, and now you can do something about it other than
 * hope. It is the same shape as the white ball, which taps away for no points
 * as a relief valve, and it costs the same thing that costs: the finger doing
 * it is the finger that draws fences.
 *
 * Returns whether a bug was actually there, so the caller can tell a hit from a
 * tap on empty board.
 */
export function tapSquashBug(game: CanvasGameState, bugId: string): boolean {
  const bugs = game.bugs;
  if (!bugs) return false;
  const i = bugs.findIndex(b => b.id === bugId);
  if (i < 0) return false;
  const bug = bugs[i];
  bugs.splice(i, 1);
  // The splat still NAMES it. Refusing a bug is how a player learns what it
  // was, and charging them a denied bug for that lesson is the cheapest
  // teaching this board does.
  pushSplat(game, bug, null, "denied");
  (game.bugsSquashedLog ??= []).push({ effect: bug.effect, outcome: "denied" });
  return true;
}

/**
 * The bug nearest a tap, or null.
 *
 * Generous, and it has to be: a bug is nine world units across and moving, so
 * a slop the size of the thing itself would make this unusable in exactly the
 * way press-and-hold turned out to be. Same allowance a ball tap gets.
 */
export function bugAtTap(game: CanvasGameState, at: Vector2): BugState | null {
  let best: BugState | null = null;
  let bestDist = Infinity;
  for (const bug of game.bugs ?? []) {
    const d = Math.hypot(bug.position.x - at.x, bug.position.y - at.y);
    if (d <= BUG_RADIUS + BUG_TAP_SLOP && d < bestDist) {
      best = bug;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Squash every bug a ball is currently on top of.
 *
 * Runs with the ball pass rather than once per frame: a fast ball crosses more
 * than a bug's diameter in a single 120Hz step, so a per-frame check would miss
 * exactly the balls that are most fun to squash one with. Called from the
 * physics step, after the balls have moved.
 */
export function squashBugs(game: CanvasGameState, ctx: BugEffectContext): void {
  const bugs = game.bugs;
  if (!bugs || bugs.length === 0) return;

  for (let i = bugs.length - 1; i >= 0; i--) {
    const bug = bugs[i];
    let squasher: Ball | null = null;
    for (const ball of game.balls) {
      if (ball.state !== "active") continue;
      const d = Math.hypot(ball.position.x - bug.position.x, ball.position.y - bug.position.y);
      if (d <= ball.radius + BUG_RADIUS) {
        squasher = ball;
        break;
      }
    }
    if (!squasher) continue;

    const def = getBug(bug.effect);
    // Remove it BEFORE the effect runs. Big Bang Release rebuilds every region
    // on the board from inside applyBugEffect, and a bug still sitting in the
    // list at that moment is one the same ball can squash again on the next
    // step from inside the pocket that just closed around it.
    bugs.splice(i, 1);
    if (!def) {
      pushSplat(game, bug, squasher, "declined");
      continue;
    }
    // Seeded by the bug's own id, so the magnitude is the same on both halves
    // of a lockstep pair and in a replayed Daily run.
    const magnitude = bugMagnitude(def, getRunRng(`bug:${bug.id}`));
    const applied = applyBugEffect(game, squasher, def, magnitude, ctx);
    pushSplat(game, bug, squasher, applied ? "paid" : "declined");
    (game.bugsSquashedLog ??= []).push({ effect: def.id, outcome: applied ? "paid" : "declined" });
  }
}

/**
 * Per-frame tick: expire buffs and splats, fly what is alive, retire what is
 * not, and roll a spawn on the config's cadence.
 *
 * Only on live-play frames. Every lifetime here keys off activePlaySeconds, so
 * a pause, a prompt or a menu never eats a bug's life - the same arrangement
 * the pickup tick uses, for the same reason.
 */
export function updateBugs(game: CanvasGameState, dt: number): void {
  expireBugBuffs(game);

  if (game.bugSplats && game.bugSplats.length > 0) {
    const now = simNow();
    game.bugSplats = game.bugSplats.filter(s => now - s.startTime < BUG_SPLAT_MS);
  }

  const cfg = game.bugConfig;
  if (!cfg) return;
  game.bugs ??= [];

  const nowS = game.activePlaySeconds;
  if (game.bugs.length > 0) {
    game.bugs = game.bugs.filter(b => nowS < b.expiresAtSeconds);
    // `dt` is the frame's own elapsed seconds, clamped: a tab returning from
    // the background hands out a huge dt, and a bug integrated across it would
    // teleport through a fence into captured space.
    const step = Math.min(dt, 0.05);
    for (const bug of game.bugs) flyBug(game, bug, step, cfg.speed);
  }

  // An admin request jumps the cadence and the chance both. It still has to
  // find a free spot, so what it proves is the real spawn path working.
  if (_pendingSpawn !== undefined) {
    const asked = _pendingSpawn;
    _pendingSpawn = undefined;
    spawnBug(game, getRunRng(`bugs:forced:${game.bugRollIndex ?? 0}:${nowS}`), asked ?? undefined);
    return;
  }

  if (nowS - (game.lastBugRollAt ?? 0) < cfg.spawnCheckSeconds) return;
  game.lastBugRollAt = nowS;
  if (game.bugs.length >= cfg.maxSimultaneous) return;

  // Seeded per roll index, like the pickup roll: board state diverges between
  // devices but the roll cadence and the draw must not.
  const rollIndex = (game.bugRollIndex = (game.bugRollIndex ?? 0) + 1);
  const rng = getRunRng(`${game.bugRollContext ?? "bugs"}:roll:${rollIndex}`);
  // `cfg.spawnChance` is ALREADY the effective chance: the level gate and the
  // map's override are resolved once, where the config is seeded, exactly as
  // the pickup tick expects of its own. Re-deriving it here would need a level
  // number the loop does not have, and would be a second place for the gate to
  // be wrong in.
  if (rng() >= cfg.spawnChance) return;
  // The map's own forcing first, then the session/URL flag. Either way this is
  // WHICH bug, never whether: the chance above has already decided that.
  spawnBug(game, rng, game.forcedBugEffect ?? debugBugId() ?? undefined);
}
