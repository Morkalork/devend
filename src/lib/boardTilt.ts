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
  gravityPhaseIndex, type GravityConfig, type GravityDirection,
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
  const n = cfg.sequence.length;
  for (let back = 0; back < n; back++) {
    const dir = cfg.sequence[((index - back) % n + n) % n];
    if (dir !== "none") return ANGLE[dir];
  }
  return 0; // a sequence of nothing but "none" never turns
}

/** Shortest signed angle from `a` to `b`, so a turn never takes the long way. */
function shortestDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Smoothstep, so the board eases out of one rest angle and into the next. */
const ease = (u: number) => u * u * (3 - 2 * u);

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
  const index = gravityPhaseIndex(t, cfg);
  const to = phaseAngle(index, cfg);
  const from = phaseAngle(index - 1, cfg);
  const into = t % cfg.period;                       // seconds into this phase
  if (into >= TILT_SECONDS) return to;               // settled
  const u = ease(into / TILT_SECONDS);
  return from + shortestDelta(from, to) * u;
}


