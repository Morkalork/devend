/**
 * The rungs' rules (BALL_TREE_PLAN.md phase 2): what a roster ball's rungs do
 * on the board. lib/roster.ts holds the roster and the words; this file holds
 * the numbers, applied once at spawn and read at the hooks named below.
 *
 *   weight  density x2 / x4 / x6 (destructibles.ts, ballMass); from rank 2 the
 *           ball wears mirrors and movers like the black ball and ignores an
 *           Ice fence; at rank 3 a mover it hits is shoved off its patrol for
 *           SHOVE_MS and its lock pays triple.
 *   worth   lock multiplier x2 / x3; at rank 3 it is the money ball: locking
 *           it triples every later lock this map.
 *   frost   rank 1 freezes 2s on every third bounce; rank 2 also freezes the
 *           ball it collides with; rank 3 also freezes 4s on touching Ice.
 *   pace    rank 1 is 20% slower; rank 2 also holds a steady speed (no fence,
 *           bumper or ball changes it); rank 3 also starts every map frozen
 *           for 5s.
 *   sight   its next 1 / 3 / 5 bounces are drawn (fxLayer).
 *   grace   rank 1: a growing fence phases through it for its first quarter
 *           second; rank 2: the first fence it cuts each map costs the fence,
 *           not the life; rank 3: every fence it cuts does.
 */
import type { Ball } from "@/types/game";
import type { RosterBall, RungId, RungRank } from "@/lib/roster";
import { FREEZE_COOLDOWN_MULTIPLIER } from "@/lib/gameConstants";

export const WEIGHT_DENSITY: Record<RungRank, number> = { 1: 2, 2: 4, 3: 6 };
export const WORTH_LOCK: Record<RungRank, number> = { 1: 2, 2: 3, 3: 3 };
export const WEIGHT3_LOCK = 3;
export const PACE_FACTOR = 0.8;
export const PACE3_FROZEN_MS = 5000;
export const FROST_BOUNCE_EVERY = 3;
export const FROST_BOUNCE_MS = 2000;
export const FROST_TOUCH_MS = 2000;
export const FROST_ICE_MS = 4000;
export const SIGHT_BOUNCES: Record<RungRank, number> = { 1: 1, 2: 3, 3: 5 };
export const GRACE_MS = 250;
export const SHOVE_MS = 2000;

type Rungs = Partial<Record<RungId, RungRank>>;

/** Give a freshly spawned roster ball its rungs' standing effects. */
export function applyRungsAtSpawn(ball: Ball, mine: RosterBall, now: number): void {
  const rungs: Rungs = mine.rungs;
  ball.slot = mine.slot;
  ball.rungs = { ...rungs };

  const weight = rungs.weight;
  if (weight) {
    ball.density = WEIGHT_DENSITY[weight];
    ball.heavy = weight >= 2;
    ball.shoves = weight >= 3;
    if (weight >= 3) {
      ball.lockMultiplier *= WEIGHT3_LOCK;
    }
  }

  const worth = rungs.worth;
  if (worth) {
    ball.lockMultiplier *= WORTH_LOCK[worth];
    if (worth >= 3) {
      ball.ability = "moneyBall";
    }
  }

  const pace = rungs.pace;
  if (pace) {
    const f = PACE_FACTOR;
    ball.velocity = { x: ball.velocity.x * f, y: ball.velocity.y * f };
    ball.speed *= f;
    ball.baseSpeed *= f;
    ball.topSpeed *= f;
    ball.minimumSpeed *= f;
    ball.steady = pace >= 2;
    if (pace >= 3) {
      ball.frozenUntil = Math.max(ball.frozenUntil ?? 0, now + PACE3_FROZEN_MS);
    }
  }

  const grace = rungs.grace;
  if (grace) {
    ball.graceMs = GRACE_MS;
    ball.graceLives = grace >= 3 ? Infinity : grace >= 2 ? 1 : 0;
  }
}

/** How many bounces this ball's own sight draws, 0 without the rung. */
export function sightBouncesOf(ball: Ball): number {
  const rank = ball.rungs?.sight;
  return rank ? SIGHT_BOUNCES[rank] : 0;
}

/** Hold a ball still by the freeze path, unless it is frozen or cooling already. */
export function frostFreeze(ball: Ball, now: number, ms: number): boolean {
  if (ball.frozenUntil !== undefined && now < ball.frozenUntil) {
    return false;
  }
  if (ball.freezeReadyAt !== undefined && now < ball.freezeReadyAt) {
    return false;
  }
  ball.frozenUntil = now + ms;
  ball.freezeReadyAt = now + ms * (1 + FREEZE_COOLDOWN_MULTIPLIER);
  return true;
}

/** Frost rank 1: count a surface hit; every FROST_BOUNCE_EVERY-th one freezes the ball. */
export function frostOnBounce(ball: Ball, now: number): boolean {
  if (!(ball.rungs?.frost)) {
    return false;
  }
  ball.frostBounces = (ball.frostBounces ?? 0) + 1;
  if (ball.frostBounces % FROST_BOUNCE_EVERY !== 0) {
    return false;
  }
  return frostFreeze(ball, now, FROST_BOUNCE_MS);
}

/** Frost rank 2: the ball this one collided with freezes. */
export function frostOnCollision(ball: Ball, other: Ball, now: number): boolean {
  if ((ball.rungs?.frost ?? 0) < 2) {
    return false;
  }
  return frostFreeze(other, now, FROST_TOUCH_MS);
}

/** Frost rank 3: touching an Ice fence freezes it. */
export function frostOnIce(ball: Ball, now: number): boolean {
  if ((ball.rungs?.frost ?? 0) < 3) {
    return false;
  }
  return frostFreeze(ball, now, FROST_ICE_MS);
}

/**
 * Grace rank 2 and 3: the fence this ball cut is lost, not the life. Spends a
 * grace when one is left and says so.
 */
export function spendGrace(ball: Ball): boolean {
  if (!(ball.graceLives !== undefined && ball.graceLives > 0)) {
    return false;
  }
  ball.graceLives -= 1;
  return true;
}
