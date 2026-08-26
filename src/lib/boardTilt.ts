/**
 * Board tilt: the whole board turns so that "down" is always down (issue #77).
 *
 * Shifting gravity pulls in a rotating world direction. Rather than telling the
 * player which way that is with arrows, the BOARD turns to meet it: the pull is
 * rendered permanently toward the bottom of the screen, and the walls, balls,
 * lock tints and everything else swing round together. The disorientation is
 * the effect. You are not reading an indicator, you are watching the room tip.
 *
 * Two facts make this cheap. The board is SQUARE (mapRotation.ts leans on the
 * same one), so every 90 degree rest position maps it exactly onto itself with
 * no letterboxing and no re-centring. And the world/screen transform lives in
 * exactly two functions, `w2s` in SleekRenderer and `screenToWorld` here in
 * boardConstants' neighbourhood, so rotating one and inverting the other turns
 * every layer at once.
 *
 * The non-obvious part is the middle of a turn. A square rotated 45 degrees has
 * a bounding box 1.41x its side, so its corners would leave the frame. The fit
 * scale below shrinks it by exactly enough to stay inside, reaching about 71%
 * at the halfway point and returning to 100% at every rest angle. The board
 * therefore appears to shrink slightly as it turns and settle as it lands,
 * which reads as a deliberate move rather than a clipping bug.
 */
// Geometry lives in boardConstants beside BOARD_WIDTH and is re-exported here,
// so callers can keep importing "the tilt" from one place. The dependency runs
// one way only: boardConstants imports nothing of ours, which is what stops the
// cycle that briefly stopped the app booting.
import { fitScale, tiltWorldPoint, untiltWorldPoint } from "@/lib/boardConstants";
export { fitScale, tiltWorldPoint, untiltWorldPoint };
import {
  gravityPhaseCount, type GravityConfig, type GravityDirection,
} from "@/lib/physics/gravity";

/** Seconds a turn takes. Long enough to read as a move, short enough to play. */
export const TILT_SECONDS = 0.7;

/**
 * The screen-space rotation that puts a world pull at the bottom of the screen.
 *
 * Rotating a world vector by t maps (x, y) to (x cos t - y sin t, x sin t + y
 * cos t). Solving each cardinal pull to land on screen-down (0, +1):
 *   down  (0, 1)  needs 0
 *   right (1, 0)  needs +90
 *   up    (0, -1) needs 180
 *   left  (-1, 0) needs -90
 */
const ANGLE: Record<Exclude<GravityDirection, "none">, number> = {
  down: 0,
  right: Math.PI / 2,
  up: Math.PI,
  left: -Math.PI / 2,
};

/**
 * The resting angle for a phase.
 *
 * A "none" phase holds the orientation it inherited rather than snapping back
 * to upright: gravity switching off is the board resting, not the board
 * righting itself. Snapping back would double the number of turns and make the
 * gravity-free stretches the busiest part of the map.
 */
export function phaseAngle(index: number, cfg: GravityConfig): number {
  return restAngle(index, cfg, cfg.sequence.length);
}

/**
 * `phaseAngle`, with a limit on how far back the inheritance may reach.
 *
 * The walk-back is the whole of "a none phase holds what it inherited", and it
 * must not reach past the START OF THE MAP. On the first cycle there is nothing
 * behind phase 0 to inherit: wrapping round to the end of the sequence opens the
 * board at whatever angle the map is going to FINISH its first cycle on, which
 * is a rotation the player never saw happen. Same defect as the opening ease
 * this file already fixes, one level down, and it bites any map whose sequence
 * starts with "none".
 *
 * `phase` is counted from the map's start, not modulo the sequence, which is
 * what makes "how many phases are actually behind me" answerable at all.
 */
function restAngle(phase: number, cfg: GravityConfig, maxBack: number): number {
  const n = cfg.sequence.length;
  const limit = Math.max(1, Math.min(n, maxBack));
  for (let back = 0; back < limit; back++) {
    const dir = cfg.sequence[((phase - back) % n + n) % n];
    if (dir !== "none") return ANGLE[dir];
  }
  return 0; // nothing to inherit, or a sequence of nothing but "none"
}

/** Shortest signed angle from `a` to `b`, so a turn never takes the long way. */
function shortestDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Smoothstep, so the board eases out of one rest angle and into the next. */
export const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * The board's rotation at a moment of active play, mid-turn included.
 *
 * Derived from the same activePlaySeconds clock the gravity phases use, so the
 * visual and the physics can never disagree about which phase it is, and a
 * seeded Daily turns identically for every player.
 */
export function tiltAngleAt(activeSeconds: number, cfg: GravityConfig | null): number {
  if (!cfg) return 0;
  const t = Number.isFinite(activeSeconds) && activeSeconds > 0 ? activeSeconds : 0;

  // Counted from the map's start rather than modulo the sequence, because the
  // question this function keeps getting wrong is "what came BEFORE this?", and
  // a modulo index cannot answer it: index 0 at t=0 is indistinguishable from
  // index 0 one full cycle later. Reading `index - 1` off it wrapped to the END
  // of the sequence and started the board part way through a turn that had
  // never happened - a board sitting at 90 degrees on the opening frame and
  // spinning upright over the next 0.7 seconds, every time a gravity map loads.
  // gravity.ts owns this clock; the tilt must never keep its own copy of it.
  const phase = gravityPhaseCount(t, cfg);
  const to = restAngle(phase, cfg, phase + 1);

  // The map's FIRST phase has no predecessor, so it is not a TURN. A later
  // wrap (t=72 with the authored sequence) really is a turn from the phase
  // before it, and still eases.
  if (phase === 0) return to;

  const from = restAngle(phase - 1, cfg, phase);
  const into = t % cfg.period;                       // seconds into this phase
  if (into >= TILT_SECONDS) return to;               // settled
  const u = ease(into / TILT_SECONDS);
  return from + shortestDelta(from, to) * u;
}



// ── Sporadic tilts (issue #77) ──────────────────────────────────────────────

/** A discrete board turn in progress, or settled once the ease has finished. */
export interface TiltState {
  /** Quarter turns applied so far. Signed: negative is counter-clockwise. */
  turns: number;
  /** What it was turning FROM, so a turn can be eased rather than snapped. */
  fromTurns: number;
  /** activePlaySeconds when this turn began. */
  startedAt: number;
}

export const NO_TILT: TiltState = { turns: 0, fromTurns: 0, startedAt: 0 };

/**
 * The board angle for a discrete tilt, mid-turn included.
 *
 * Separate from tiltAngleAt, which reads a gravity mutator's PHASE SCHEDULE.
 * This one is driven by events: a tilt fires, turns is bumped, and the angle
 * eases across from where it was. Both feed the same transform, so a map can
 * only ever be using one of them.
 */
export function discreteTiltAngle(state: TiltState | null | undefined, activeSeconds: number): number {
  if (!state) return 0;
  const to = state.turns * (Math.PI / 2);
  const from = state.fromTurns * (Math.PI / 2);
  if (to === from) return to;
  const t = Number.isFinite(activeSeconds) ? activeSeconds : 0;
  const into = t - state.startedAt;
  if (into >= TILT_SECONDS) return to;
  if (into <= 0) return from;
  return from + (to - from) * ease(into / TILT_SECONDS);
}

/** Begin a turn from wherever the board currently is. */
export function beginTilt(state: TiltState, direction: 1 | -1, activeSeconds: number): TiltState {
  return {
    fromTurns: state.turns,
    turns: state.turns + direction,
    startedAt: Number.isFinite(activeSeconds) ? activeSeconds : 0,
  };
}

/**
 * THE board angle. Both the renderer's w2s and input's screenToWorld read this
 * and nothing else, so they cannot drift apart: a tap is always un-turned by
 * exactly the angle the board was drawn at.
 *
 * A gravity MUTATOR turns the board on a phase schedule; sporadic tilts turn it
 * on events. A map uses one or the other, never both, but the order is fixed
 * here rather than left to whichever caller asks first.
 */
export function boardAngleFor(
  activeSeconds: number,
  gravityCfg: GravityConfig | null | undefined,
  tilt: TiltState | null | undefined,
): number {
  if (gravityCfg) return tiltAngleAt(activeSeconds, gravityCfg);
  return discreteTiltAngle(tilt, activeSeconds);
}
