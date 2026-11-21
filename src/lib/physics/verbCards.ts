/**
 * The verb cards (CARDS_PLAN.md, phase 9): the cards that give the hands
 * something new to do, rather than a number to carry.
 *
 * Most of the catalogue is a modifier: balls slower, fences faster, locks
 * paying more. Five cards changed what a finger does on the board (the freeze
 * tap, the mover hold, the Redeploy fling, the drawn path, the pocket that
 * counts), and this file adds the next five. Each is a small rule over state
 * the engine already has, and each is reached through a COMMAND
 * (net/commands.ts), so a pair plays them in lockstep and a replay carries
 * them like any other action.
 *
 *   BREAKPOINT    tap an empty spot to set a trap; the first ball across it
 *                 freezes there. A prediction verb: the player stops reacting
 *                 to a ball and starts reading where it will be.
 *   STASH         press the ability button to remember where every ball is;
 *                 the next ball that would cost a life puts them all back
 *                 there instead. A timing verb: save after the good cut,
 *                 before the risky one.
 *   REFACTOR      hold a finished fence to delete it, re-opening the lanes it
 *                 closed. The one card that takes something back.
 *   MERGE         two plain balls that collide fuse into one bigger, slower
 *                 ball. Passive, but it makes herding a goal.
 *   RATE LIMITER  tap a wall to make a stretch of it sticky; the next ball to
 *                 hit it stops dead. An aiming verb for a surface.
 *
 * Every per-map ration is dealt in applyMapStartBoons, read here, and shown
 * on the ticket; nothing here keeps a meter of its own.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Ball, Vector2 } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import { isPlayerFence } from "@/lib/wallGeometry";
import { closestPointOnSegment, pointToSegmentDistance } from "@/lib/polygon";
import { isPositionActive } from "@/lib/spaceGrid";
import { isTappableBall } from "@/lib/ballTypes";
import { BASE_BALL_RADIUS, FREEZE_COOLDOWN_MULTIPLIER, FREEZE_TAP_SLOP } from "@/lib/gameConstants";
import { triggerBallHit } from "@/lib/ballEffects";
import { reassignBallsToRegions } from "@/lib/regionOwnership";
import { isLoadedSling } from "@/lib/physics/slingFence";

// ── Breakpoint ──────────────────────────────────────────────────────────────

/** How far from the trap's centre a ball's centre must come to trip it, in world units. */
export const BREAKPOINT_RADIUS = 16;
/** How long a tripped ball holds. The freeze tap's three seconds, so the two read as one thing. */
export const BREAKPOINT_FREEZE_MS = 3000;

export interface Breakpoint {
  id: string;
  x: number;
  y: number;
  /** Sim ms it was set, for the renderer's settle-in. */
  setAt: number;
}

/** A trap this map can still take, at this point: open space, no ball under the finger. */
export function canSetBreakpoint(game: CanvasGameState, at: Vector2): boolean {
  if ((game.breakpointsRemaining ?? 0) <= 0) {
    return false;
  }
  if (game.spaceGrid && !isPositionActive(game.spaceGrid, at)) {
    return false;
  }
  for (const ball of game.balls) {
    if (ball.state !== "active") {
      continue;
    }
    const d = Math.hypot(ball.position.x - at.x, ball.position.y - at.y);
    if (d <= ball.radius + FREEZE_TAP_SLOP) {
      return false;
    }
  }
  return true;
}

/** Set a trap. Returns false, spending nothing, where canSetBreakpoint says no. */
export function setBreakpoint(game: CanvasGameState, at: Vector2, now: number): boolean {
  if (!canSetBreakpoint(game, at)) {
    return false;
  }
  game.breakpointsRemaining = (game.breakpointsRemaining ?? 0) - 1;
  const list = (game.breakpoints ??= []);
  list.push({ id: `bp-${now}-${list.length}`, x: at.x, y: at.y, setAt: now });
  return true;
}

/**
 * Trip any trap a ball has reached: the ball freezes where it is, by the same
 * path as a freeze tap, and the trap is spent. One ball per trap.
 */
export function tickBreakpoints(game: CanvasGameState, now: number, freezeNoCooldown: number): void {
  const traps = game.breakpoints;
  if (!traps || traps.length === 0) {
    return;
  }
  for (let i = traps.length - 1; i >= 0; i--) {
    const trap = traps[i];
    for (const ball of game.balls) {
      if (ball.state !== "active" || isTappableBall(ball.ability)) {
        continue;
      }
      if (ball.frozenUntil !== undefined && now < ball.frozenUntil) {
        continue;
      }
      const d = Math.hypot(ball.position.x - trap.x, ball.position.y - trap.y);
      if (d > BREAKPOINT_RADIUS + ball.radius * 0.5) {
        continue;
      }
      ball.frozenUntil = now + BREAKPOINT_FREEZE_MS;
      ball.freezeReadyAt = freezeNoCooldown > 0
        ? now + BREAKPOINT_FREEZE_MS
        : now + BREAKPOINT_FREEZE_MS * (1 + FREEZE_COOLDOWN_MULTIPLIER);
      triggerBallHit(ball.effects, now);
      game.breakpointTrips = [...(game.breakpointTrips ?? []), { x: trap.x, y: trap.y, startTime: now }];
      traps.splice(i, 1);
      break;
    }
  }
}

// ── Stash ───────────────────────────────────────────────────────────────────

export interface StashedBall {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

export interface BoardStash {
  takenAt: number;
  balls: StashedBall[];
  movers: { id: string; offset: number; angle: number }[];
}

/** Remember where every ball is. The board's fences and captured space are not part of it. */
export function takeStash(game: CanvasGameState, now: number): BoardStash {
  const stash: BoardStash = {
    takenAt: now,
    balls: game.balls.filter(b => b.state === "active").map(b => ({
      id: b.id, x: b.position.x, y: b.position.y, vx: b.velocity.x, vy: b.velocity.y, speed: b.speed,
    })),
    movers: (game.movers ?? []).map(m => ({ id: m.id, offset: m.offset, angle: m.angle ?? 0 })),
  };
  game.stash = stash;
  return stash;
}

/**
 * Put the balls back where the stash remembers them, and spend it.
 *
 * Only the balls (and the movers) go back; a fence drawn since stays, and so
 * does space captured since. A remembered spot that has been captured in the
 * meantime is no longer a place a ball can be, so that ball keeps where it is.
 * Returns false when there is no stash to restore.
 */
export function restoreStash(game: CanvasGameState, now: number): boolean {
  const stash = game.stash;
  if (!stash) {
    return false;
  }
  game.stash = null;
  const byId = new Map(game.balls.map(b => [b.id, b]));
  for (const s of stash.balls) {
    const ball = byId.get(s.id);
    if (!ball || ball.state !== "active") {
      continue;
    }
    if (game.spaceGrid && !isPositionActive(game.spaceGrid, { x: s.x, y: s.y })) {
      continue;
    }
    ball.position = { x: s.x, y: s.y };
    ball.velocity = { x: s.vx, y: s.vy };
    ball.speed = s.speed;
    ball.prevPosition = { x: s.x, y: s.y };
    ball.renderPosition = { x: s.x, y: s.y };
    ball.frozenUntil = undefined;
    triggerBallHit(ball.effects, now);
  }
  for (const s of stash.movers) {
    const mover = game.movers?.find(m => m.id === s.id);
    if (!mover) {
      continue;
    }
    mover.offset = s.offset;
    if (mover.angle !== undefined) {
      mover.angle = s.angle;
    }
  }
  if (game.regions.length > 0) {
    reassignBallsToRegions(game.balls, game.regions, game.walls, game.spaceGrid ?? null);
  }
  game.stashRestoredAt = now;
  return true;
}

// ── Refactor ────────────────────────────────────────────────────────────────

/** How far from a finished fence a press still counts as holding it. The Redeploy grab's reach. */
export const REFACTOR_GRAB_SLOP = BASE_BALL_RADIUS + FREEZE_TAP_SLOP + 8;

/**
 * The finished player fence under a press, for a hold to delete, or null.
 *
 * A loaded Redeploy fence is skipped: a press on one is a grab, and the two
 * gestures must not fight over the same fence. Nearest wins.
 */
export function refactorTargetAt(game: CanvasGameState, at: Vector2): Wall | null {
  if ((game.refactorsRemaining ?? 0) <= 0) {
    return null;
  }
  let best: Wall | null = null;
  let bestDist = Infinity;
  for (const wall of game.walls) {
    if (!isPlayerFence(wall) || isLoadedSling(wall)) {
      continue;
    }
    const d = pointToSegmentDistance(at, wall.start, wall.end);
    if (d <= wall.thickness / 2 + REFACTOR_GRAB_SLOP && d < bestDist) {
      bestDist = d;
      best = wall;
    }
  }
  return best;
}

/** Every segment of the cut this wall belongs to: a bounced cut is several walls and one fence. */
export function cutSegmentsOf(game: CanvasGameState, wall: Wall): Wall[] {
  const cut = wall.cutId;
  return game.walls.filter(w => w === wall || (cut != null && w.cutId === cut));
}

// ── Merge Conflict ──────────────────────────────────────────────────────────

/** A merged ball never grows past this many base radii: a wall of a ball is not a ball. */
export const MERGE_MAX_RADIUS_FACTOR = 2.2;
/** What merging takes off the pair's momentum-weighted speed: bigger, and slower. */
export const MERGE_SLOW_FACTOR = 0.85;

/** A plain ball: nothing special rides on it, so losing its identity loses nothing the map promised. */
export function isMergeable(ball: Ball, now: number): boolean {
  if (ball.state !== "active" || ball.isBoss || ball.isMinion) {
    return false;
  }
  if (ball.ability !== "none") {
    return false;
  }
  if (ball.frozenUntil !== undefined && now < ball.frozenUntil) {
    return false;
  }
  return ball.birthParentId === undefined && ball.bossLeapAt === undefined;
}

/**
 * Fuse `other` into `survivor`: area adds, momentum is shared, and the pair's
 * lock bonus travels with the one ball. Returns false when the result would be
 * too big, and then the two bounce as they always did.
 */
export function mergeBalls(game: CanvasGameState, survivor: Ball, other: Ball, now: number): boolean {
  const r = Math.hypot(survivor.radius, other.radius);
  if (r > BASE_BALL_RADIUS * MERGE_MAX_RADIUS_FACTOR) {
    return false;
  }
  const m1 = survivor.radius * survivor.radius;
  const m2 = other.radius * other.radius;
  const vx = (survivor.velocity.x * m1 + other.velocity.x * m2) / (m1 + m2);
  const vy = (survivor.velocity.y * m1 + other.velocity.y * m2) / (m1 + m2);
  let speed = Math.hypot(vx, vy) * MERGE_SLOW_FACTOR;
  const floor = Math.min(survivor.minimumSpeed, other.minimumSpeed) * MERGE_SLOW_FACTOR;
  // Head-on, the momenta cancel and the merged ball would sit still: give it
  // the slower ball's heading at the floor instead, so it keeps playing.
  if (speed < floor) {
    const slow = survivor.speed <= other.speed ? survivor : other;
    const len = Math.hypot(slow.velocity.x, slow.velocity.y) || 1;
    survivor.velocity = { x: (slow.velocity.x / len) * floor, y: (slow.velocity.y / len) * floor };
    speed = floor;
  } else {
    const len = Math.hypot(vx, vy);
    survivor.velocity = { x: (vx / len) * speed, y: (vy / len) * speed };
  }
  survivor.position = {
    x: (survivor.position.x * m1 + other.position.x * m2) / (m1 + m2),
    y: (survivor.position.y * m1 + other.position.y * m2) / (m1 + m2),
  };
  survivor.radius = r;
  survivor.speed = speed;
  survivor.baseSpeed = Math.min(survivor.baseSpeed, other.baseSpeed) * MERGE_SLOW_FACTOR;
  survivor.minimumSpeed = floor;
  survivor.topSpeed = Math.max(survivor.topSpeed, other.topSpeed) * MERGE_SLOW_FACTOR;
  survivor.lockMultiplier = survivor.lockMultiplier + other.lockMultiplier;
  game.balls = game.balls.filter(b => b !== other);
  triggerBallHit(survivor.effects, now);
  game.mergeFlashes = [...(game.mergeFlashes ?? []), { x: survivor.position.x, y: survivor.position.y, startTime: now }];
  return true;
}

// ── Rate Limiter ────────────────────────────────────────────────────────────

/** Half the sticky stretch, along the wall, in world units. */
export const STICKY_HALF_LENGTH = 34;
/** How long a tapped stretch stays sticky. */
export const STICKY_PATCH_MS = 2000;
/** How long a ball that hits it stays stuck. */
export const STICKY_HOLD_MS = 3000;
/** How far from a wall a tap still counts as tapping it. */
export const STICKY_TAP_SLOP = FREEZE_TAP_SLOP + 6;

export interface StickyPatch {
  id: string;
  wallId: string;
  x: number;
  y: number;
  /** Unit direction along the wall, for the renderer. */
  dx: number;
  dy: number;
  setAt: number;
  until: number;
}

/** The wall a tap would make sticky, or null: the nearest within reach, a finished fence or the board. */
export function stickyTargetAt(game: CanvasGameState, at: Vector2): Wall | null {
  if ((game.stickyTapsRemaining ?? 0) <= 0) {
    return null;
  }
  let best: Wall | null = null;
  let bestDist = Infinity;
  for (const wall of game.walls) {
    if (wall.portal) {
      continue;
    }
    const d = pointToSegmentDistance(at, wall.start, wall.end);
    if (d <= wall.thickness / 2 + STICKY_TAP_SLOP && d < bestDist) {
      bestDist = d;
      best = wall;
    }
  }
  return best;
}

/** Make a stretch of `wall` sticky around the point nearest `at`. */
export function setStickyPatch(game: CanvasGameState, wall: Wall, at: Vector2, now: number): StickyPatch | null {
  if ((game.stickyTapsRemaining ?? 0) <= 0) {
    return null;
  }
  game.stickyTapsRemaining = (game.stickyTapsRemaining ?? 0) - 1;
  const p = closestPointOnSegment(at, wall.start, wall.end);
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
  const patch: StickyPatch = {
    id: `sticky-${now}-${(game.stickyPatches?.length ?? 0)}`,
    wallId: wall.id,
    x: p.x, y: p.y,
    dx: (wall.end.x - wall.start.x) / len, dy: (wall.end.y - wall.start.y) / len,
    setAt: now, until: now + STICKY_PATCH_MS,
  };
  (game.stickyPatches ??= []).push(patch);
  return patch;
}

/** Drop patches that have timed out. Called once a step, before the balls move. */
export function tickStickyPatches(game: CanvasGameState, now: number): void {
  const patches = game.stickyPatches;
  if (!patches || patches.length === 0) {
    return;
  }
  game.stickyPatches = patches.filter(p => now < p.until);
}

/**
 * A ball hit a wall at `point`: if a live patch covers that spot, the ball
 * stops dead there (the freeze hold, so everything that knows a frozen ball
 * knows this one) and the patch is spent. Returns true when it stuck.
 */
export function applyStickyHit(game: CanvasGameState, ball: Ball, point: Vector2, now: number): boolean {
  const patches = game.stickyPatches;
  if (!patches || patches.length === 0) {
    return false;
  }
  if (isTappableBall(ball.ability) || (ball.frozenUntil !== undefined && now < ball.frozenUntil)) {
    return false;
  }
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (now >= p.until) {
      continue;
    }
    const along = Math.abs((point.x - p.x) * p.dx + (point.y - p.y) * p.dy);
    const across = Math.abs((point.x - p.x) * -p.dy + (point.y - p.y) * p.dx);
    if (along > STICKY_HALF_LENGTH || across > ball.radius + 8) {
      continue;
    }
    ball.velocity = { x: 0, y: 0 };
    ball.frozenUntil = now + STICKY_HOLD_MS;
    ball.freezeReadyAt = now + STICKY_HOLD_MS * (1 + FREEZE_COOLDOWN_MULTIPLIER);
    triggerBallHit(ball.effects, now);
    patches.splice(i, 1);
    return true;
  }
  return false;
}
