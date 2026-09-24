/**
 * What a squashed bug does to the ball that squashed it.
 *
 * One function per catalogue id, behind one switch, in the same file, because
 * the pool only works if the entries can be read against each other: every one
 * of them has to be a real gain bought with a real cost, and that is a property
 * of the LIST, not of any single effect. Splitting them across modules would
 * make "is this pool still honest?" a question nobody could answer by reading
 * anything.
 *
 * The rules every effect here obeys:
 *
 *   IT LANDS ON THE SQUASHER   not a random ball, not the fastest, not all of
 *                              them (Big Bang Release is the deliberate
 *                              exception and is marked `danger` for it). Which
 *                              ball you steered into the bug is the decision
 *                              being rewarded, and picking a different ball to
 *                              pay would delete it.
 *   IT CAN DECLINE             every one returns whether it actually did
 *                              something. "Did not fire" and "does not work"
 *                              look identical from the outside, so a decline is
 *                              reported and drawn, never swallowed.
 *   IT IS SEEDED               anything random draws from runStream, so a Daily
 *                              Stand-up run and a lockstep pair agree.
 *
 * Catalogue: public/bugs.yml. Flight and squash detection: physics/bugs.ts.
 */
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { BugDef } from "@/types/bugs";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { GameCallbacks } from "./gameCallbacks";
import type { WinSpec } from "@/types/winSpec";
import { createBallEffectState } from "@/lib/ballEffects";
import { spawnClearOfParent } from "@/lib/physics/spawnPlacement";
import { MAX_LIVE_BALLS } from "@/lib/gameConstants";
import { DEFAULT_ATTRACT_RADIUS, DEFAULT_ATTRACT_TURN_RATE } from "@/lib/physics/lodestone";
import { runStream } from "@/lib/runRng";
import { simNow } from "@/lib/simClock";
import { sealRings } from "./bugRing";

// The predicates live in a leaf module (lib/bugBuffs.ts) because the damage
// model and the lodestone read them and this file imports both.
export { isWrecking, isAttracting } from "@/lib/bugBuffs";

/**
 * How big a ball may get, as a multiple of its starting radius.
 *
 * Feature Bloat is repeatable and compounding, and without a ceiling four of
 * them make a ball that does not fit down its own map's corridors - which is
 * not a hard map, it is a stuck one. At 2.2x a ball is conspicuously huge and
 * still passes everything the ladder's geometry asks a ball to pass.
 */
export const MAX_BLOAT_SCALE = 2.2;

/** Ball ids for split clones, unique within a session. */
let _bugSplitCounter = 0;

/** Test seam: makes clone ids reproducible across test files. */
export function resetBugSplitCounter(): void {
  _bugSplitCounter = 0;
}

export interface BugEffectContext {
  modifiers: GameModifiers;
  cumulativeLockedBalls: number;
  spec: WinSpec;
  callbacks?: Pick<GameCallbacks,
    "setLockedBallsCount" | "onBallTypeLocked" | "onBallCountChanged" | "onBossState">;
}

/**
 * Rescale a ball's speed, keeping its heading and respecting its floor.
 *
 * `speed` and `velocity` must move together: updateBall rewrites velocity from
 * the scalar in several places, so changing one alone is a change that lasts
 * until the next frame and then silently undoes itself.
 */
function rescaleSpeed(ball: Ball, factor: number): void {
  const current = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (current <= 0) {
    // A held or frozen ball still gets the effect, on the scalar alone: its
    // velocity is restored from `speed` when it is released.
    ball.speed = Math.max(ball.minimumSpeed, ball.speed * factor);
    return;
  }
  const target = Math.max(ball.minimumSpeed, current * factor);
  const s = target / current;
  ball.velocity.x *= s;
  ball.velocity.y *= s;
  ball.speed = target;
  // The yellow ball picks a new speed from a range every bounce, so a ball
  // whose range was not moved with it is back to its old speed within seconds.
  if (ball.speedRange) {
    const lo = Math.max(ball.minimumSpeed, ball.speedRange[0] * factor);
    ball.speedRange = [lo, Math.max(lo, ball.speedRange[1] * factor)];
  }
}

/** Bit Rot: the ball keeps `value` of its speed, for good. */
function applyTechDebt(ball: Ball, def: BugDef): boolean {
  const before = ball.speed;
  rescaleSpeed(ball, Math.max(0.05, def.value));
  // At the floor already: the map has slowed this ball as far as it goes, and
  // saying so beats a splat that claims a slow-down that did not happen.
  return ball.speed < before - 0.5;
}

/** Caffeine: faster, and worth the same multiple more when locked. */
function applyCrunchTime(ball: Ball, def: BugDef): boolean {
  const factor = Math.max(1, def.value);
  rescaleSpeed(ball, factor);
  // topSpeed is the ceiling other systems clamp to; a ball sped past it would
  // be pulled back down by the next thing that read it.
  ball.topSpeed = Math.max(ball.topSpeed, ball.speed);
  ball.lockMultiplier *= factor;
  return true;
}

/** Deadlock: held still for `value` seconds, exactly like a tap-freeze. */
function applyDeadlock(ball: Ball, def: BugDef): boolean {
  const until = simNow() + Math.max(0, def.value) * 1000;
  // Never SHORTEN a hold already in flight: a ball frozen by a tap and then
  // running over a Deadlock must not come back to life early.
  ball.frozenUntil = Math.max(ball.frozenUntil ?? 0, until);
  return true;
}

/**
 * Feature Bloat: bigger by `magnitude`, and worth the same fraction more.
 *
 * The lock multiplier moves with the radius on purpose, and by the same
 * number: "it pays as much as it grows" is the whole deal, and a growth that
 * paid a flat bonus would make a small roll strictly better than a big one.
 */
function applyFeatureBloat(ball: Ball, magnitude: number): boolean {
  // Latched on the FIRST bloat rather than at spawn, so every path that makes a
  // ball - initGame, a fork, a rainbow spit, a boss bud, a test fixture - gets
  // a baseline without having to remember one. Reading the current radius each
  // time instead would move the ceiling up with the ball and never bind.
  ball.bugBaseRadius ??= ball.radius;
  const ceiling = ball.bugBaseRadius * MAX_BLOAT_SCALE;
  if (ball.radius >= ceiling - 0.01) return false;
  const wanted = ball.radius * (1 + magnitude);
  const next = Math.min(ceiling, wanted);
  const realised = next / ball.radius - 1;
  ball.radius = next;
  ball.lockMultiplier *= 1 + realised;
  return realised > 0.001;
}

/**
 * Branch: the ball divides into itself plus `value` more.
 *
 * A clone is born a clear gap away along its own heading (spawnClearOfParent),
 * for the reason the fork token's clones are: two identical balls starting
 * coincident read as one ball that duplicated itself, which was reported as a
 * bug more than once.
 */
function applyBranch(game: CanvasGameState, ball: Ball, def: BugDef): boolean {
  const extra = Math.max(1, Math.round(def.value));
  const speed = Math.hypot(ball.velocity.x, ball.velocity.y) || ball.baseSpeed;
  let born = 0;
  for (let i = 0; i < extra; i++) {
    if (game.balls.length >= MAX_LIVE_BALLS) break;
    const spot = spawnClearOfParent(game, ball);
    const clone: Ball = {
      ...ball,
      id: `${ball.typeId}-bug-${++_bugSplitCounter}`,
      position: { x: spot.x, y: spot.y },
      velocity: { x: Math.cos(spot.angle) * speed, y: Math.sin(spot.angle) * speed },
      rotation: runStream("ballSpin")() * Math.PI * 2,
      effects: createBallEffectState(),
      speedRange: ball.speedRange ? [ball.speedRange[0], ball.speedRange[1]] : undefined,
      prevPosition: undefined,
      renderPosition: undefined,
      trailPositions: undefined,
      trailHead: undefined,
      trailCount: undefined,
      frozenUntil: undefined,
      freezeReadyAt: undefined,
      // A clone does NOT inherit a buff in flight. Force Push and All Hands are
      // things that happened to one ball, and a Branch that doubled them would
      // make the pair a combo rather than two separate decisions.
      wreckingUntil: undefined,
      attractUntil: undefined,
      attractTurnRate: undefined,
      attractRadius: undefined,
    };
    game.balls.push(clone);
    born++;
  }
  return born > 0;
}

/** Force Push: triple damage for `value` seconds, and it eats your fences. */
function applyForcePush(ball: Ball, def: BugDef): boolean {
  const until = simNow() + Math.max(0, def.value) * 1000;
  ball.wreckingUntil = Math.max(ball.wreckingUntil ?? 0, until);
  return true;
}

/** All Hands: the ball pulls the others for `value` seconds. */
function applyAllHands(game: CanvasGameState, ball: Ball, def: BugDef): boolean {
  // Nobody to pull. Reported rather than applied, because a lone ball wearing
  // a lodestone ring for six seconds is the game claiming something happened.
  const others = game.balls.filter(b => b.id !== ball.id && b.state === "active");
  if (others.length === 0) return false;
  const until = simNow() + Math.max(0, def.value) * 1000;
  ball.attractUntil = Math.max(ball.attractUntil ?? 0, until);
  ball.attractTurnRate = DEFAULT_ATTRACT_TURN_RATE;
  ball.attractRadius = DEFAULT_ATTRACT_RADIUS;
  return true;
}

/** Auto Merge / Big Bang Release: close a ring and let the lock pass do the rest. */
function applyRing(
  game: CanvasGameState,
  targets: Ball[],
  def: BugDef,
  ctx: BugEffectContext,
): boolean {
  if (!ctx.callbacks) return false;
  const sealed = sealRings(
    game,
    targets,
    ball => ball.radius * Math.max(1.5, def.value),
    {
      callbacks: ctx.callbacks,
      modifiers: ctx.modifiers,
      cumulativeLockedBalls: ctx.cumulativeLockedBalls,
      spec: ctx.spec,
    },
  );
  return sealed.length > 0;
}

/**
 * Apply a squashed bug. Returns false when the effect declined, which the
 * splat reports rather than hiding.
 *
 * `magnitude` comes from the caller (bugMagnitude) rather than being drawn
 * here, so the value shown on the splat and the value applied to the ball are
 * the same number by construction.
 */
export function applyBugEffect(
  game: CanvasGameState,
  ball: Ball,
  def: BugDef,
  magnitude: number,
  ctx: BugEffectContext,
): boolean {
  switch (def.id) {
    case "bitRot":
      return applyTechDebt(ball, def);
    case "caffeine":
      return applyCrunchTime(ball, def);
    case "deadlock":
      return applyDeadlock(ball, def);
    case "featureBloat":
      return applyFeatureBloat(ball, magnitude);
    case "branch":
      return applyBranch(game, ball, def);
    case "forcePush":
      return applyForcePush(ball, def);
    case "allHands":
      return applyAllHands(game, ball, def);
    case "autoMerge":
      return applyRing(game, [ball], def, ctx);
    case "bigBang":
      // Every free ball, the squasher included. The order is the board's, not
      // sorted: a ring is refused on its own merits and one ball's refusal must
      // not depend on which of them the array happened to list first.
      return applyRing(game, game.balls.filter(b => b.state === "active"), def, ctx);
    default:
      // An id in bugs.yml with no implementation here. It spawns, it flies, it
      // squashes and it declines, which is a visible, reportable nothing rather
      // than a crash on someone's phone.
      return false;
  }
}

/**
 * Drop expired buffs.
 *
 * All Hands has to be actively taken away, because it works by borrowing the
 * lodestone ball type's own fields: left set, the ball would go on pulling for
 * the rest of the map and there would be nothing on screen to explain why.
 * Called once per frame from the bug tick.
 */
export function expireBugBuffs(game: CanvasGameState, now: number = simNow()): void {
  for (const ball of game.balls) {
    if (ball.wreckingUntil !== undefined && now >= ball.wreckingUntil) {
      ball.wreckingUntil = undefined;
    }
    if (ball.attractUntil !== undefined && now >= ball.attractUntil) {
      ball.attractUntil = undefined;
      // Only what All Hands lent. A ball whose TYPE is the lodestone keeps its
      // own pull: clearing that here would silently disable a ball type from a
      // timer belonging to something else entirely.
      if (ball.ability !== "attract") {
        ball.attractTurnRate = undefined;
        ball.attractRadius = undefined;
      }
    }
  }
}
