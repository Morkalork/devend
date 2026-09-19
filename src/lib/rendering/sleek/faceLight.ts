/**
 * Which wall faces a light is actually facing.
 *
 * THE THING THIS FIXES. The ball's pool is a flat additive disc, so it lifts
 * everything at a given distance by the same amount regardless of which way
 * that surface is turned. Real light never does that, and a player building
 * the geometry themselves feels it even without being able to name it: a
 * corridor's two walls light identically as a ball runs between them, a corner
 * does not catch, and the whole thing reads as a bright decal sliding under
 * the board rather than as a lamp moving through a room.
 *
 * The board is top-down, which makes this cheap and exact rather than an
 * approximation. Every wall is a vertical slab, so its face normal is
 * horizontal and lies in the plane the game is already computing in; the
 * lambert term is the plain 2D dot of that normal with the direction to the
 * light. A ball square in front of a fence lights its face fully; the same
 * ball the same distance away but off to the side, looking along the fence
 * rather than at it, lights it barely at all. That difference IS the new
 * information, and it is information the pool cannot carry at any brightness.
 *
 * WHY THIS IS NOT THE LIGHT PASS. The light buffer is composited UNDER the
 * wall layer (SleekRenderer draw order), because walls are meant to occlude
 * the pool. A wall's own face is therefore the one surface in the scene that
 * the buffer cannot reach - it is painted over a moment later by the wall
 * itself. So face light has to be a layer ABOVE the walls, exactly where
 * bounceLayer already puts its bands, and for exactly the same reason.
 *
 * AND WHY IT IS NOT bounceLayer, which also lights walls. The bounce is a
 * CONTACT event: a hairline rim inside about two ball radii, squared so it
 * arrives late and hard, saying "this ball is touching this fence". This is
 * the opposite end of the same phenomenon - a broad wash across the whole
 * pool, graded by FACING rather than by nearness, saying which way the room is
 * lit from. Neither has the other's term: the bounce has no facing at all, and
 * this has no contact spike. They stack, which is what two real effects on one
 * surface do.
 *
 * Pure and in world units, so it is pinned by ordinary tests; faceLightLayer.ts
 * is the only thing that knows about sprites.
 */

import type { CanvasGameState } from "@/types/gameState";
import type { MoteLight } from "@/lib/rendering/motes";
import { closestOnSegment } from "./ballBounce";

/**
 * How much of a light's reach the lit patch spans along a wall.
 *
 * Wider than the reach, because the patch is a soft Gaussian centred on the
 * closest point rather than a hard cut: at one pool wide the falloff is
 * already deep at the ends, and a patch that stops short of where the light
 * still is draws its own edge on the wall.
 */
export const FACE_SPAN_REACH = 1.9;

/** How far the band reaches across the wall's body, in world units. */
export const FACE_DEPTH = 9;

/**
 * Peak alpha of a face band, at full lambert and zero distance.
 *
 * Reads clearly without competing with the bounce's rim, which is the sharper
 * and rarer of the two and should stay the one that wins at contact.
 */
export const FACE_ALPHA = 0.5;

/**
 * How sharply the facing term bites.
 *
 * Raised from a plain lambert, so a wall at forty-five degrees is nearer a
 * third lit than a comfortable two-thirds. Plain lambert is correct for a
 * matte surface and, on a board where most walls are axis-aligned and most
 * balls are somewhere diagonal, it left almost everything half-lit - which
 * is the flat look this exists to break, arrived at by a more expensive
 * route.
 */
export const FACE_SHARPNESS = 1.8;

/**
 * Walls one light may band, most-facing first.
 *
 * A pool is about a tenth of the board wide, so a real board puts a handful
 * inside one; this exists so a fence tangle cannot turn one frame into
 * hundreds of sprites, not as a limit anyone should reach.
 */
export const MAX_FACES_PER_LIGHT = 10;

export interface FaceLight {
  /** Closest point on the wall's CENTRELINE, world units: the patch's centre. */
  x: number;
  y: number;
  /** Unit vector along the wall. */
  ax: number;
  ay: number;
  /** Unit normal of the LIT face: from the wall toward the light. */
  nx: number;
  ny: number;
  /**
   * How far along that normal the face itself is, world units: half the
   * wall's thickness. Carried rather than left to the layer so a thick board
   * edge and a thin fence put their band in the same place relative to the
   * surface a player can see.
   */
  faceOffset: number;
  /** World length of the lit patch along the wall. */
  span: number;
  /** Facing times attenuation times the light's own output, 0..1 and up. */
  strength: number;
  color: number;
}

/**
 * Every wall face lit by every light, this frame.
 *
 * `lights` is the pass's published `worldLights` - the same list the motes
 * read, in world units, already carrying whatever the flicker, the tell and
 * the exposure did to each emitter. Reading it rather than walking the balls
 * again is deliberate: a face that stayed lit while the pool lighting it
 * stuttered would read as two unrelated sources, and a second opinion about
 * where the light is would be a second thing to keep in step.
 */
export function collectFaceLights(
  game: CanvasGameState, lights: readonly MoteLight[], out: FaceLight[] = [],
): FaceLight[] {
  out.length = 0;
  for (const light of lights) {
    if (!(light.reach > 1e-6) || light.intensity <= 0.002) continue;
    let drawn = 0;
    for (const wall of game.walls) {
      if (drawn >= MAX_FACES_PER_LIGHT) break;
      // A portal is a hole, not a surface. Lighting its face would claim a
      // wall exactly where the game is promising there is not one.
      if (wall.portal) continue;
      // The board's own frame is skipped, and it is a MASKING fact rather than
      // a design one: the frame is drawn outside the board mask that the face
      // light layer sits inside, so its band would be sliced off at exactly
      // the line it was lighting. bounceLayer's `onFrame` is what answers
      // light on the frame, and it carries its own mask for this.
      if (wall.isBoardEdge ?? wall.id.startsWith("board-")) continue;

      const c = closestOnSegment(
        light.x, light.y, wall.start.x, wall.start.y, wall.end.x, wall.end.y,
      );
      if (c.dist >= light.reach) continue;

      // The face turned toward the light. Degenerate only when the light's
      // centre is ON the centreline, where there is no face to pick.
      let nx = light.x - c.x, ny = light.y - c.y;
      const nlen = Math.hypot(nx, ny);
      if (nlen < 1e-6) continue;
      nx /= nlen; ny /= nlen;

      let ax = wall.end.x - wall.start.x, ay = wall.end.y - wall.start.y;
      const alen = Math.hypot(ax, ay);
      if (alen < 1e-6) continue;
      ax /= alen; ay /= alen;

      // The facing term: the SINE of the angle between the wall's own
      // direction and the direction to the light. 1 when the light sits
      // square off the face, 0 when it lies along the wall's line and the
      // "face" is an edge seen end-on.
      //
      // Not a dot with the normal, which is the reflex here and is identically
      // 1: `n` was just defined as the direction to the light, so at the
      // CLOSEST point on a wall the light is by construction directly in
      // front. That is not a bug in the geometry, it is the geometry - a wall
      // is lit square-on somewhere along its length whenever the light's
      // perpendicular foot lands on it at all. What is left to say is whether
      // the foot lands on the wall or past its end, and that is exactly what
      // this measures.
      const facing = 1 - Math.abs(nx * ax + ny * ay);
      if (facing <= 0.001) continue;

      // Squared falloff, matching the pools' own: a band that faded linearly
      // would still be visible at the rim where the light that justifies it
      // has effectively gone.
      const t = 1 - c.dist / light.reach;
      const strength = Math.pow(facing, FACE_SHARPNESS) * t * t * light.intensity;
      if (strength <= 0.004) continue;

      out.push({
        x: c.x, y: c.y, ax, ay, nx, ny,
        faceOffset: wall.thickness / 2,
        span: light.reach * FACE_SPAN_REACH,
        strength,
        color: light.color,
      });
      drawn++;
    }
  }
  return out;
}
