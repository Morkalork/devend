/**
 * Live outer walls, as something the player can see.
 *
 * Level 14 gives each of the four board edges a behaviour of its own (see
 * physics/boardEdges.ts): a floor that kicks, a lid that damps, two side walls
 * that fire a ball back across. It shipped with none of that on screen. The
 * perimeter rendered as the same green hairline every other map has, so the
 * only way to learn that the floor is a trampoline was to watch a ball leave it
 * faster and infer why - which is the same failure gravityCue.ts was written
 * for, one mechanic later: a condition that bends every path on the board, with
 * no expression on the board.
 *
 * The arithmetic lives here rather than in the drawing for that file's reason
 * too: what a side looks like, which way it throws a ball and how close a ball
 * is to it are the parts worth pinning, and a renderer that cannot compute is a
 * renderer that cannot be wrong about it.
 *
 * ── What the picture has to say, in order of importance ────────────────────
 *
 *   1. THIS WALL IS NOT ORDINARY. Colour and a band, visible at a glance and
 *      from across the board.
 *   2. WHAT IT DOES TO SPEED. Warm orange gives speed, cold frost takes it,
 *      cyan leaves it alone and only aims. The bumper already owns warm-sprung
 *      orange for "this made the ball faster", so a live floor borrows it
 *      rather than inventing a second word for the same thing.
 *   3. WHICH WAY IT THROWS. Chevrons along the direction the ball leaves: the
 *      bearing if the side fires one, otherwise straight in off the wall. On a
 *      square board the band alone cannot say this, which is the same reason
 *      the gravity cue has chevrons and not just an edge stripe.
 *
 * An edge whose spec does nothing (no bearing, no kick, or `kick: 1`) gets
 * NOTHING drawn. Advertising a wall as live when it behaves exactly like the
 * other three is worse than saying nothing: it teaches a rule the map does not
 * have.
 */
import type { Ball } from "@/types/game";
import { BEARING_VECTOR } from "@/lib/physics/obstacleRules";
import type { BoardEdgeSpec, BoardSide } from "@/lib/physics/boardEdges";
import { PALETTE } from "./palette";

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Vec { x: number; y: number }

/** A side of the board, in world space: its two ends and the way in. */
export interface EdgeGeometry {
  start: Vec;
  end: Vec;
  /** Unit vector pointing from the wall into the play area. */
  inward: Vec;
}

/**
 * Where a side is. Taken from the PLAY AREA's bounds rather than the board
 * rect, because the two are not the same: the arena is inset from the board by
 * a margin, and the Equity Grant certificate shrinks it further. A band drawn
 * on the board rect would float a visible distance off the wall it is
 * describing, on exactly the run where the player has most reason to trust it.
 */
export function edgeGeometry(side: BoardSide, b: Bounds): EdgeGeometry {
  switch (side) {
    case "top":    return { start: { x: b.minX, y: b.minY }, end: { x: b.maxX, y: b.minY }, inward: { x: 0, y: 1 } };
    case "bottom": return { start: { x: b.minX, y: b.maxY }, end: { x: b.maxX, y: b.maxY }, inward: { x: 0, y: -1 } };
    case "left":   return { start: { x: b.minX, y: b.minY }, end: { x: b.minX, y: b.maxY }, inward: { x: 1, y: 0 } };
    case "right":  return { start: { x: b.maxX, y: b.minY }, end: { x: b.maxX, y: b.maxY }, inward: { x: -1, y: 0 } };
  }
}

/** What a live side does, reduced to the one word the colour has to carry. */
export type EdgeKind = "faster" | "slower" | "aim";

export interface EdgeLook {
  kind: EdgeKind;
  colour: number;
  /** Chevrons per mark: two nested says "and it speeds you up". */
  arrows: 1 | 2;
  /** 0.5 (barely off neutral) to 1 (as loud as this cue gets). */
  strength: number;
  /** Unit vector, in WORLD space, that a ball leaves this side along. */
  direction: Vec;
}

/**
 * A kick this far from 1 is drawn as loudly as the cue goes.
 *
 * A quarter, because that is what a BUMPER does (BOUNCER_KICK is 1.25) and a
 * whole wall that hits as hard as a bumper is as loud a statement as this board
 * has. Set at 0.4 first, which drew level 14's 1.15 floor - the trampoline the
 * map is built around - dimmer than its own side walls.
 */
const KICK_FULL = 0.25;

/**
 * How a side should read, or null when it behaves like an ordinary wall.
 *
 * A side that both aims and changes speed takes its COLOUR from the speed and
 * its ARROWS from the bearing: speed is the thing a player cannot see happening
 * (the ball just carries on, slightly wrong), and direction is the thing the
 * arrows are already shaped to say.
 */
export function edgeLook(side: BoardSide, spec: BoardEdgeSpec | undefined): EdgeLook | null {
  if (!spec) return null;
  const kick = spec.kick ?? 1;
  const kicks = kick !== 1;
  if (!spec.bearing && !kicks) return null;

  const kind: EdgeKind = kicks ? (kick > 1 ? "faster" : "slower") : "aim";
  // Three hues that are already words in this board's vocabulary: the bumper's
  // warm sprung orange for "you left faster", the deformable slab's cool grey
  // for "this drank your speed", and the mirror's cyan for "this redirected
  // you". Frost was tried for the damping side and sat a step from the mirror
  // cyan on screen - two live walls that do opposite things must not be
  // separable only by which way their arrows point.
  const colour = kind === "faster" ? PALETTE.bouncer
    : kind === "slower" ? PALETTE.deformableWorn
    : PALETTE.mirror;

  const direction = spec.bearing
    ? { x: BEARING_VECTOR[spec.bearing][0], y: BEARING_VECTOR[spec.bearing][1] }
    : edgeGeometry(side, { minX: 0, minY: 0, maxX: 1, maxY: 1 }).inward;

  const off = kicks ? Math.min(1, Math.abs(kick - 1) / KICK_FULL) : 1;
  return { kind, colour, arrows: kind === "faster" ? 2 : 1, strength: 0.5 + 0.5 * off, direction };
}

/** How near a ball has to be (world units) before a side starts waking up. */
export const EDGE_WAKE_REACH = 110;

/**
 * 0 when nothing is near this side, 1 at the moment of contact.
 *
 * The band alone says a wall is live; this is what says WHICH wall just did
 * something to the ball you are watching. Cause and effect, on the frame the
 * player is looking at the ball anyway, is the cheapest teaching this game has
 * - and it costs four distance checks per ball.
 */
export function edgeWake(
  side: BoardSide, b: Bounds, balls: readonly Ball[], reach = EDGE_WAKE_REACH,
): number {
  if (reach <= 0) return 0;
  let best = 0;
  for (const ball of balls) {
    const p = ball.position;
    if (!p) continue;
    const d = side === "top" ? p.y - b.minY
      : side === "bottom" ? b.maxY - p.y
      : side === "left" ? p.x - b.minX
      : b.maxX - p.x;
    const t = 1 - Math.max(0, d) / reach;
    if (t > best) best = t;
  }
  return Math.max(0, Math.min(1, best));
}
