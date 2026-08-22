import { CanvasGameState } from "@/types/gameState";
import { updateMoverPolygon } from "./moverState";
import { mutatorSpeedFactor } from "@/lib/mapMutators";
import { moverSpeedAt } from "./moverEase";

export function updateMoversFn(dt: number, game: CanvasGameState): void {
  // Crunch/Overclock mutators (issue #54) speed movers too ("everything speeds
  // up"). Movers stay independent of Scope Creep (raw step), only the mutator.
  const speedFactor = mutatorSpeedFactor(game.mapMutator, game.lockedBallsCount);
  for (const mover of game.movers) {
    const half = mover.range / 2;
    // Ease into the turn without re-timing the map: the curve is normalised so
    // a full traverse takes exactly as long as the constant-speed one it
    // replaces (see moverEase). Eleven shipped maps time their necks against
    // these patrols, so the shape may change and the schedule may not.
    const ease = moverSpeedAt(mover.offset, half);
    mover.offset += mover.direction * mover.speed * ease * dt * speedFactor;
    if (mover.offset >= half) {
      mover.offset    = half;
      mover.direction = -1;
    } else if (mover.offset <= -half) {
      mover.offset    = -half;
      mover.direction = 1;
    }
    updateMoverPolygon(mover);
  }
}
