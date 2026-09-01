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
    // ROTORS turn; shuttles slide. Handled first and separately rather than
    // folded into the offset maths below, because almost nothing carries over:
    // `range` is an arc rather than a distance, the easing curve is calibrated
    // to a linear traverse, and a rotor that spins all the way round has no
    // turning points to ease into at all.
    if (mover.motion === "rotate") {
      // A rotor grinding through a fence labours exactly as a patrol does.
      // Measured before the step, so the frame it is slowed on is the frame it
      // is touching something.
      const rDrag = perFence > 0
        ? moverFenceDrag(mover, game.walls, perFence, floor)
        : null;
      if (rDrag) friction.push(...rDrag.contacts);
      // `speed` is degrees per second here, which is the one field whose units
      // change with the motion; the schema says so where it is authored.
      const rate = (mover.speed * Math.PI) / 180;
      mover.angle = (mover.angle ?? 0)
        + mover.direction * rate * dt * speedFactor * (rDrag?.factor ?? 1);
      if (mover.halfSweep !== undefined) {
        // A limited sweep reverses at its ends, like a windscreen wiper.
        if (mover.angle >= mover.halfSweep) {
          mover.angle = mover.halfSweep;
          mover.direction = -1;
        } else if (mover.angle <= -mover.halfSweep) {
          mover.angle = -mover.halfSweep;
          mover.direction = 1;
        }
      } else {
        // A full-circle rotor wraps instead, so the angle cannot grow without
        // bound over a long map and lose precision.
        const TAU = Math.PI * 2;
        mover.angle = ((mover.angle % TAU) + TAU) % TAU;
      }
      updateMoverPolygon(mover);
      continue;
    }

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
