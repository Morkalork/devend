/**
 * Control Freak: driving a mover by hand, along the rail it already runs on.
 *
 * ── Why this is small, and why it has to stay that way ─────────────────────
 *
 * A mover's whole position is ONE NUMBER. A shuttle is `offset`, clamped to
 * ±range/2; a rotor is `angle`, clamped to ±halfSweep. Everything downstream -
 * the polygon rebuilt in place, ball collision, fence friction, the renderer -
 * reads that number and derives from it. So a player-driven mover is not a new
 * kind of object. It is the same object with a different author for one scalar,
 * and nothing downstream can tell the difference.
 *
 * That is also the whole answer to "it must not go through walls". The
 * reachable set under the finger is EXACTLY the patrol the level author already
 * had to keep clear, because it is the same interval. A hand-driven mover
 * physically cannot occupy a cell its automatic self does not sweep through
 * every few seconds anyway, so every clearance the map guaranteed still holds,
 * with no collision code and no new way for a map to be authored wrong.
 *
 * Letting it leave the rail would undo all of that at once: it would need real
 * collision against static obstacles, other movers, breakables and the board
 * edge, plus a rule for what happens when a player shoves it into a corner.
 * That is a physics feature. This is not. Keep it on the rail.
 *
 * ── The one case the rail does not cover ───────────────────────────────────
 *
 * The player's own fence, which did not exist when the map was authored.
 * moverFriction is explicit that a patrol only ever DRAGS through a fence,
 * because "a fence that stopped a patrol dead would let a player park a hazard
 * forever, and turn a timing puzzle into a wall-building one".
 *
 * That reasoning inverts under manual control. Parking it is the entire point
 * of the upgrade, and the fence in the way is the player's own wall limiting
 * their own tool - nobody is being cheated. So a HELD mover stops dead at a
 * fence and a RELEASED one drags exactly as it always did. The eleven maps
 * timed against these patrols keep their timings, and the tool gains an honest
 * cost: fence across your own rail and you have shortened your own paddle.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Vector2 } from "@/lib/polygon";
import { pointInPolygon, closestPointOnSegment } from "@/lib/polygon";
import { updateMoverPolygon, moverBoundRadius, moverBoundCentre, type MoverState } from "@/lib/physics/moverState";
import { touchesPlayerFence } from "@/lib/physics/moverFriction";
import { descopeRefusal, queueDescope, type DescopeTarget } from "@/lib/physics/descope";
import { findMoverDestructible } from "@/lib/physics/destructibles";
import { BASE_BALL_RADIUS, PHYSICS_STEP } from "@/lib/gameConstants";
import { bandPower, bandStretch } from "@/lib/rubberBand";

const TAU = Math.PI * 2;

/**
 * How far outside a mover a press still counts as grabbing it.
 *
 * DELIBERATELY much smaller than the Redeploy sling's, and the reasoning is the
 * sling's own turned round. The sling argues that a fence is six units thick and
 * "brings almost nothing of its own", so the slop has to be the whole target,
 * and that a grab which should have been a cut is cheap while a cut which should
 * have been a grab costs a fence.
 *
 * A mover brings the entire target itself: it is one of the largest objects on
 * the board. Wrapping it in the sling's 40-unit halo would not make it easier to
 * grab, it would make a wide ring of ordinary board unusable for starting a cut,
 * and stealing cuts is the expensive half of that trade. So this is about a
 * finger's worth of imprecision at the body's edge and nothing more - enough
 * that a thin rotor arm can still be caught, not enough to shadow the board
 * around it.
 */
export const MOVER_GRAB_SLOP = 12;

/**
 * How long a mover must be driven against its own end stop before it derails.
 *
 * Long enough to be a decision and not a slip of the finger, short enough that
 * you are not pinned there while the board runs away from you. It costs the
 * walk to the end of the rail first, which is the real price.
 */
export const DERAIL_HOLD_MS = 600;

/** A rotor's `speed` is degrees per second; a shuttle's is world units. */
export function nativeRailRate(m: MoverState): number {
  return m.motion === "rotate" ? (m.speed * Math.PI) / 180 : m.speed;
}

/** The scalar that is this mover's entire position on its rail. */
export function railParam(m: MoverState): number {
  return m.motion === "rotate" ? (m.angle ?? 0) : m.offset;
}

/**
 * The rail's limit either side of rest, or null for a rotor that spins all the
 * way round and therefore has no ends to stop at (and nothing to derail into).
 */
export function railLimit(m: MoverState): number | null {
  if (m.motion === "rotate") return m.halfSweep ?? null;
  return m.range / 2;
}

/** Write the rail parameter and rebuild the polygon from it. */
export function setRailParam(m: MoverState, v: number): void {
  if (m.motion === "rotate") m.angle = v; else m.offset = v;
  updateMoverPolygon(m);
}

/**
 * What a finger at this world point reads on the rail: an angle about the pivot
 * for a rotor, a distance along the axis for a shuttle.
 *
 * Absolute, not relative to the grab. The caller subtracts the reading it took
 * when the grab started, so the part of the mover under the finger stays under
 * the finger instead of the body snapping its centre to the touch point.
 */
export function railReading(m: MoverState, x: number, y: number): number {
  if (m.motion === "rotate") return Math.atan2(y - m.homeY, x - m.homeX);
  return m.axis === "horizontal" ? x - m.homeX : y - m.homeY;
}

/**
 * Bring `target` into the same turn as `near`, so a rotor can be cranked round
 * instead of snapping at the seam where atan2 wraps from +pi to -pi.
 */
export function unwrapAngle(target: number, near: number): number {
  return target + TAU * Math.round((near - target) / TAU);
}

export interface DriveResult {
  /** The rail parameter actually reached this step. */
  param: number;
  /** True when the drive is being held against an end of the rail. */
  atLimit: boolean;
  /** True when a player fence stopped it short of where the finger asked. */
  blocked: boolean;
}

/**
 * Step a mover toward `target` on its rail, rate-capped and limit-clamped, and
 * stopped by any player fence in the way.
 *
 * The fence test is done by trying the candidate position and looking, rather
 * than by intersecting the rail with the walls analytically: the mover's real
 * polygon is what a fence actually meets (a bent mover and a rotor both have
 * outlines that no closed form about the axis would describe), and the step per
 * frame is small because the rate is capped, so "stop as soon as the next
 * position would touch" is exactly the right granularity.
 *
 * A mover that is ALREADY touching when the grab starts - a fence built across
 * it while it patrolled - is allowed to move anyway. Otherwise it would be
 * welded in place by a wall it is standing in, which reads as a broken tool
 * rather than as a rule.
 */
export function driveToward(
  m: MoverState,
  target: number,
  maxRate: number,
  dt: number,
  walls: CanvasGameState["walls"],
): DriveResult {
  const from = railParam(m);
  const limit = railLimit(m);

  let want = target;
  if (limit !== null) want = Math.max(-limit, Math.min(limit, want));

  const step = Math.max(0, maxRate) * dt;
  const delta = want - from;
  const moved = Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
  const candidate = from + moved;

  const atLimit = limit !== null
    && Math.abs(candidate) >= limit - 1e-6
    && Math.abs(target) >= limit;

  if (moved === 0) {
    return { param: from, atLimit, blocked: false };
  }

  const wasTouching = touchesPlayerFence(m, walls);
  setRailParam(m, candidate);
  if (!wasTouching && touchesPlayerFence(m, walls)) {
    setRailParam(m, from);
    return { param: from, atLimit: false, blocked: true };
  }
  return { param: candidate, atLimit, blocked: false };
}

/**
 * How fast this mover's SURFACE is travelling at a world point, in units/sec.
 *
 * For a rotor this is omega x r, so the tip throws far harder than the hub -
 * which is the rotor's whole authored premise ("its tip travels much faster
 * than its hub, so which part of it you cross matters") finally being cashed in
 * by something.
 *
 * Zero unless the mover is under player control. An ordinary patrol imparts
 * nothing, exactly as it always has: a mover has been static geometry at the
 * instant of contact for the whole life of the game, and five shipped maps are
 * balanced on balls leaving one at their own speed. Confining the new physics
 * to the new feature keeps every one of those maps bit-identical.
 */
export function moverSurfaceVelocity(m: MoverState, x: number, y: number): Vector2 {
  const rate = m.driveRate ?? 0;
  if (rate === 0) return ZERO;
  if (m.motion === "rotate") {
    const rx = x - m.homeX, ry = y - m.homeY;
    return { x: -ry * rate, y: rx * rate };
  }
  return m.axis === "horizontal" ? { x: rate, y: 0 } : { x: 0, y: rate };
}

const ZERO: Vector2 = { x: 0, y: 0 };

/**
 * The mover under a world point, or null.
 *
 * Inside the polygon first, then within `slop` of one of its edges, so a press
 * that lands just off a thin arm still grabs it. Movers are tested in order and
 * the first hit wins; they do not overlap one another on any authored map.
 */
export function moverAt(
  game: CanvasGameState,
  x: number,
  y: number,
  slop = MOVER_GRAB_SLOP,
): MoverState | null {
  const p = { x, y };
  for (const m of game.movers ?? []) {
    const verts = m.polygon?.vertices;
    if (!verts || verts.length < 3) continue;
    // Broad phase on the same circle the ball uses, so a press can never be
    // said to have hit something the physics says is somewhere else.
    const c = moverBoundCentre(m);
    const reach = moverBoundRadius(m) + slop;
    const dx = x - c.x, dy = y - c.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    if (pointInPolygon(p, m.polygon)) return m;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const q = closestPointOnSegment(p, a, b);
      if (Math.hypot(p.x - q.x, p.y - q.y) <= slop) return m;
    }
  }
  return null;
}

/** Arc length a rotor's tip travels for one radian; 1 for a shuttle. */
export function railArm(m: MoverState): number {
  return m.motion === "rotate" ? Math.max(1, moverBoundRadius(m)) : 1;
}

/**
 * How far this mover has been pulled off rest, in WORLD units.
 *
 * Converted through the arm for a rotor, so the band's dead zone and full-pull
 * length mean the same distance whichever kind of rail they are measured on. A
 * quarter turn of a long arm is a big pull; the same quarter turn of a stubby
 * one is not, and the throw should say so.
 */
export function railPull(m: MoverState): number {
  return Math.abs(railParam(m)) * railArm(m);
}

/**
 * The fastest a bumper may snap, in rail units per second.
 *
 * Collision is discrete, so a tip that crosses more than a fraction of a ball in
 * one physics step can pass through one untested. The band's own power cap sits
 * far below this for every mover any map has authored - a 55 deg/s wiper at
 * full stretch moves its tip about five units a step against a ball radius of
 * eighteen - so this is not a balance dial. It is the guard that keeps a future
 * map from authoring a patrol fast enough to break the collision by tripling it.
 */
export function maxSnapRate(m: MoverState): number {
  return (BASE_BALL_RADIUS * 0.5) / (railArm(m) * PHYSICS_STEP);
}

/**
 * Start a bumper snapping home, or return false when the pull was not a band.
 *
 * The anchor is the RAIL, not the finger: you pull the mover away from its rest
 * position along its own track and let go, and it snaps back. That is what
 * makes a bumper a real commitment rather than a strictly better crank - once
 * the band is fitted you can no longer park the mover anywhere, because letting
 * go always fires it. Choosing between that and the derail is the Principal
 * fork doing its job.
 *
 * The rate is the mover's OWN native rate multiplied by the band's power curve,
 * which is the recipe slingFence.ts sets out: take the band's dead zone, full
 * pull and curve, and supply only what is genuinely yours. A brisk patrol
 * therefore makes a hard bumper and a lazy one makes a gentle one, so how hard
 * a map's bumper hits is something the map already authored.
 */
export function beginSnap(m: MoverState): boolean {
  const stretch = bandStretch(railPull(m));
  if (stretch <= 0) return false;
  const rate = Math.min(bandPower(stretch) * nativeRailRate(m), maxSnapRate(m));
  m.snap = { to: 0, rate, powerT: stretch };
  return true;
}

/**
 * One physics step of everything the player is doing to a mover.
 *
 * Runs BEFORE updateMoversFn, which skips whatever this touched: a mover cannot
 * be patrolling and being driven at the same time, and letting both write the
 * rail parameter in one step is how you get a hazard that stutters under the
 * finger.
 */
export function updateMoverControlFn(dt: number, game: CanvasGameState, nowMs: number): void {
  const drag = game.moverDrag;
  for (const m of game.movers ?? []) {
    if (m.snap) { stepSnap(m, dt, game); continue; }
    if (drag && drag.moverId === m.id) { stepHeld(m, dt, game, drag, nowMs); continue; }
    m.driveRate = 0;
  }
}

/** True while this mover is the player's rather than the map's. */
export function isPlayerControlled(game: CanvasGameState, m: MoverState): boolean {
  return !!m.snap || game.moverDrag?.moverId === m.id;
}

function stepSnap(m: MoverState, dt: number, game: CanvasGameState): void {
  const snap = m.snap!;
  const before = railParam(m);
  const r = driveToward(m, snap.to, snap.rate, dt, game.walls);
  m.driveRate = dt > 0 ? (r.param - before) / dt : 0;
  // Home, or stopped by a fence on the way. A bumper is as solid as the mover
  // it is: it does not snap THROUGH the player's own wall just because it is
  // moving quickly, which is the same rule the held drive obeys.
  if (r.blocked || Math.abs(r.param - snap.to) < 1e-4) {
    setRailParam(m, r.blocked ? r.param : snap.to);
    m.snap = undefined;
    m.driveRate = 0;
  }
}

function stepHeld(
  m: MoverState,
  dt: number,
  game: CanvasGameState,
  drag: NonNullable<CanvasGameState["moverDrag"]>,
  nowMs: number,
): void {
  const before = railParam(m);

  // A brake is a crank with a rate of zero: the finger is on it, so the map no
  // longer moves it, and without the drive tier it goes nowhere else either.
  // One code path rather than a special case, which is why Junior costs almost
  // nothing to add on top of Senior's machinery.
  const maxRate = drag.driveMultiplier > 0 ? nativeRailRate(m) * drag.driveMultiplier : 0;

  let target = before;
  if (maxRate > 0) {
    const reading = railReading(m, drag.pointer.x, drag.pointer.y);
    target = reading - drag.ref;
    // Unwrapped toward where the rotor actually is, so cranking past the atan2
    // seam keeps turning the same way instead of whipping round the long way.
    if (m.motion === "rotate") target = unwrapAngle(target, before);
  }

  const r = driveToward(m, target, maxRate, dt, game.walls);
  m.driveRate = dt > 0 ? (r.param - before) / dt : 0;

  // The derail: held against its own end stop, not merely resting there. The
  // mover has to be walked to an end first, which costs time and leaves the
  // player's finger occupied, and that walk is the real price of the removal.
  if (drag.canDerail && r.atLimit && maxRate > 0) {
    drag.stopHoldMs += dt * 1000;
    drag.derailAt = nowMs;
    if (drag.stopHoldMs >= DERAIL_HOLD_MS && derailMover(game, m)) {
      game.moverDrag = null;
      m.driveRate = 0;
    }
  } else {
    drag.stopHoldMs = 0;
  }
}

/**
 * Break a mover that has been driven into its own end stop and held there.
 *
 * Routed through the descope queue rather than splicing game.movers, so it
 * travels the one removal pipeline a black ball and Deploy Charge already use:
 * detach, reopen the footprint as capturable space, topple whatever rested on
 * it, rebuild the regions, repaint. A second removal path with its own opinion
 * about grid cells is exactly how you get an obstacle that is gone and still
 * solid.
 *
 * It inherits descope's refusals for free, which is most of the reason to reuse
 * it: a mover that IS the map's objective, or that carries a chest whose reward
 * comes from smashing it, cannot be quietly deleted by a player leaning on it.
 * A refusal costs no ration, for the same reason a missed descope tap costs no
 * charge.
 */
export function derailMover(game: CanvasGameState, m: MoverState): boolean {
  if ((game.moverDerailsRemaining ?? 0) <= 0) return false;
  const target: DescopeTarget = {
    id: m.id,
    destructible: findMoverDestructible(game, m.id),
    polygon: m.polygon,
    kind: "mover",
  };
  if (descopeRefusal(target) !== null) return false;
  if (!queueDescope(game, target)) return false;
  game.moverDerailsRemaining -= 1;
  return true;
}

/**
 * Let go of a mover. Fires the bumper when one is fitted and a ration is left,
 * and otherwise simply leaves the thing where the player parked it.
 *
 * Returns true when the release fired a snap, so the caller can buzz for it.
 */
export function releaseMover(game: CanvasGameState, m: MoverState): boolean {
  const drag = game.moverDrag;
  game.moverDrag = null;
  m.driveRate = 0;
  if (!drag?.canBand || (game.moverBandsRemaining ?? 0) <= 0) return false;
  if (!beginSnap(m)) return false;
  game.moverBandsRemaining -= 1;
  return true;
}

/** How far through the derail hold this drag is, 0..1, for the renderer. */
export function derailProgress(drag: CanvasGameState["moverDrag"]): number {
  if (!drag || !drag.canDerail) return 0;
  return Math.min(1, drag.stopHoldMs / DERAIL_HOLD_MS);
}
