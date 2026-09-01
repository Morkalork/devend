/**
 * What a fence does to a mover that walks into it.
 *
 * Movers used to ignore fences completely. A patrol would slide through a
 * finished fence as if it were not there, which reads as the fence being
 * decorative - and testers said so. It also made the one interesting thing
 * about a mover, that it patrols a line you have to cut across, cost nothing to
 * cut across.
 *
 * So a fence in a mover's path DRAGS it. The mover still gets through (a fence
 * that stopped a patrol dead would let a player park a hazard forever, and turn
 * a timing puzzle into a wall-building one), but it labours, and the friction
 * is drawn where the two meet so the slowdown has a visible cause rather than
 * looking like a frame drop.
 *
 * Pure, and separated from updateMovers for the usual reason: the arithmetic is
 * the part that can be wrong quietly. A drag that never reaches its floor, or
 * one that counts the board edge as a fence, looks fine in motion.
 */
import type { MoverState } from "@/lib/physics/moverState";
import { isPlayerFence, type Wall } from "@/lib/wallGeometry";
import { pointToSegmentDistance, closestPointOnSegment, lineSegmentIntersection } from "@/lib/polygon";

/** Where a mover is grinding against a fence, for the renderer to spark. */
export interface FrictionContact {
  x: number;
  y: number;
  /** 0..1: how hard this contact is being worked, for spark density. */
  intensity: number;
}

export interface MoverDrag {
  /** Speed multiplier for this frame: 1 is free, `floor` is the worst it gets. */
  factor: number;
  contacts: FrictionContact[];
}

/** No fences touching: full speed, nothing to draw. */
const FREE: MoverDrag = { factor: 1, contacts: [] };

/**
 * The drag on one mover from every player fence it is currently overlapping.
 *
 * `perFence` is how much of its speed one fence takes (0.45 = down to 55%), and
 * they STACK, because a mover shouldering through three fences at once should
 * be labouring three times as hard - that is the player's work showing. `floor`
 * is what stops the stack reaching zero: a mover that can be halted completely
 * is a mover a player can neutralise with enough cuts, and the hazard would
 * stop being one.
 */
export function moverFenceDrag(
  mover: MoverState,
  walls: Wall[],
  perFence: number,
  floor: number,
): MoverDrag {
  const contacts: FrictionContact[] = [];
  let touching = 0;

  for (const wall of walls) {
    if (!isPlayerFence(wall)) continue;
    const hit = contactWith(mover, wall);
    if (!hit) continue;
    touching++;
    contacts.push(hit);
  }
  if (touching === 0) return FREE;

  const factor = Math.max(floor, 1 - perFence * touching);
  // Intensity rides the drag actually being applied, so a mover already at the
  // floor does not keep escalating its sparks as more fences pile on: what the
  // player sees matches what the mover feels.
  const intensity = Math.min(1, (1 - factor) / Math.max(1e-6, 1 - floor));
  for (const c of contacts) c.intensity = intensity;
  return { factor, contacts };
}

/** Where this mover meets this fence, or null when they do not overlap. */
function contactWith(mover: MoverState, wall: Wall): FrictionContact | null {
  const half = (wall.thickness ?? 6) / 2;

  // A ROTOR's centre is not `home + offset`: offset means nothing for it, and a
  // circular rotor is the one shape whose polygon and whose "centre" disagree
  // about where it is. The polygon is always what the ball and the fence
  // actually meet, so a rotor is measured off that.
  if (mover.motion !== "rotate" && mover.shape === "circle" && mover.radius !== undefined) {
    const cx = mover.homeX + (mover.axis === "horizontal" ? mover.offset : 0);
    const cy = mover.homeY + (mover.axis === "vertical" ? mover.offset : 0);
    const centre = { x: cx, y: cy };
    if (pointToSegmentDistance(centre, wall.start, wall.end) >= mover.radius + half) return null;
    const p = closestPointOnSegment(centre, wall.start, wall.end);
    return { x: p.x, y: p.y, intensity: 1 };
  }

  // Rect (and anything else): the physics-updated polygon is authoritative, so
  // test its edges. An edge crossing the fence is the contact; the crossing
  // point is where the sparks belong.
  const verts = mover.polygon?.vertices ?? [];
  if (verts.length < 2) return null;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (lineSegmentIntersection(a, b, wall.start, wall.end)) {
      // The fence has width; the visible grind is on its centre line, at the
      // point nearest the edge that crossed it.
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = closestPointOnSegment(mid, wall.start, wall.end);
      return { x: p.x, y: p.y, intensity: 1 };
    }
  }
  return null;
}
