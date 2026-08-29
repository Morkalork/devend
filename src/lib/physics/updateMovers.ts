import { CanvasGameState } from "@/types/gameState";
import { updateMoverPolygon } from "./moverState";
import { mutatorSpeedFactor } from "@/lib/mapMutators";
import { moverSpeedAt } from "./moverEase";
import { moverFenceDrag, type FrictionContact } from "./moverFriction";

export function updateMoversFn(dt: number, game: CanvasGameState): void {
  // Crunch/Overclock mutators (issue #54) speed movers too ("everything speeds
  // up"). Movers stay independent of Scope Creep (raw step), only the mutator.
  const speedFactor = mutatorSpeedFactor(game.mapMutator, game.lockedBallsCount);
  // Fence friction (#): rebuilt every step rather than accumulated, because a
  // contact is only true for the frame it is measured on - a mover that has
  // cleared a fence must stop sparking on the very next frame.
  const friction: FrictionContact[] = [];
  const perFence = game.moverFenceDragPerFence ?? 0;
  const floor = game.moverFenceDragFloor ?? 1;

  for (const mover of game.movers) {
    const half = mover.range / 2;
    // Ease into the turn without re-timing the map: the curve is normalised so
    // a full traverse takes exactly as long as the constant-speed one it
    // replaces (see moverEase). Eleven shipped maps time their necks against
    // these patrols, so the shape may change and the schedule may not.
    const ease = moverSpeedAt(mover.offset, half);
    // A fence in the way drags the patrol. Measured from where the mover IS,
    // before it steps, so the frame it is slowed on is the frame it is touching
    // something - and the sparks land on the fence it is actually grinding.
    const drag = perFence > 0
      ? moverFenceDrag(mover, game.walls, perFence, floor)
      : null;
    if (drag) friction.push(...drag.contacts);
    mover.offset += mover.direction * mover.speed * ease * dt * speedFactor * (drag?.factor ?? 1);
    if (mover.offset >= half) {
      mover.offset    = half;
      mover.direction = -1;
    } else if (mover.offset <= -half) {
      mover.offset    = -half;
      mover.direction = 1;
    }
    updateMoverPolygon(mover);
  }
  game.moverFriction = friction;
}
