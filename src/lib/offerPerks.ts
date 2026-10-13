/**
 * The Sprint Planning Specialisations' signature rules (offers.yml,
 * SPRINT_PLANNING_PLAN.md section 3.2): one rule per archetype that the tag's
 * upgrades do not sell. The numbers and the pure parts live here so each rule
 * is testable without a board; the physics and the session call in.
 */
import type { Ball } from "@/types/game";

/** Reliability: the share of their speed balls keep during the opening slow. */
export const OPENING_SLOW_FACTOR = 0.7;

/** Displacement factor for a ball this far into a map's active play. */
export function openingSlowFactor(activePlaySeconds: number, openingSlowSeconds: number): number {
  return openingSlowSeconds > 0 && activePlaySeconds < openingSlowSeconds ? OPENING_SLOW_FACTOR : 1;
}

/** Platform: the head start never builds the whole fence (that is an instant fence). */
export const MAX_FENCE_HEAD_START = 0.9;

/**
 * Where on the build's ease curve a fence with this head start begins: the
 * time fraction t at which easeInOut(t) equals the head start. The growth
 * curve is easeInOut over elapsed time, so starting there both places the tips
 * a fraction of the way out AND keeps the curve continuous from that point.
 */
export function headStartTime(headStart: number): number {
  const h = Math.max(0, Math.min(MAX_FENCE_HEAD_START, headStart));
  return h <= 0.5 ? Math.sqrt(h / 2) : 1 - Math.sqrt((1 - h) / 2);
}

/** Procurement: the most interest one store visit can pay. */
export const STORE_INTEREST_CAP = 10;

/** Hours of interest a store pays on this bank. Floored: an hour is paid once earned. */
export function storeInterest(banked: number, percent: number): number {
  if (!(percent > 0) || !(banked > 0)) return 0;
  return Math.min(STORE_INTEREST_CAP, Math.floor((banked * percent) / 100));
}

/**
 * Containment: the free ball nearest a lock, which the lock then holds still.
 * Active, unlocked and not already held; null when there is none.
 */
export function nearestFreeBall(balls: readonly Ball[], at: { x: number; y: number }, now: number): Ball | null {
  let best: Ball | null = null;
  let bestD = Infinity;
  for (const b of balls) {
    if (b.state !== "active") continue;
    if (b.frozenUntil !== undefined && now < b.frozenUntil) continue;
    const d = (b.position.x - at.x) ** 2 + (b.position.y - at.y) ** 2;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

/** Cold Storage: how long the opening freeze holds. */
export const START_FROZEN_SECONDS = 12;

/** Cold Storage: the balls that start frozen, fastest first. */
export function startFrozenPicks(balls: readonly Ball[], count: number): Ball[] {
  if (count <= 0) return [];
  return balls
    .filter(b => b.state === "active")
    .sort((a, b) => (b.speed || b.baseSpeed || 0) - (a.speed || a.baseSpeed || 0))
    .slice(0, Math.round(count));
}

/** Growth: the lives a run starts with, below which each missing one pays. */
export const DESPERATION_BASE_LIVES = 3;

/** Growth: the score multiplier for a map started on this many lives. */
export function desperationMultiplier(livesAtMapStart: number, perMissingLife: number): number {
  if (!(perMissingLife > 0)) return 1;
  const missing = Math.max(0, DESPERATION_BASE_LIVES - livesAtMapStart);
  return 1 + missing * perMissingLife;
}
