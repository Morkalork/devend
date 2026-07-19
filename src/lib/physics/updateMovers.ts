import { CanvasGameState } from "@/types/gameState";
import { updateMoverPolygon } from "./moverState";
import { mutatorSpeedFactor } from "@/lib/mapMutators";

export function updateMoversFn(dt: number, game: CanvasGameState): void {
  // Crunch/Overclock mutators (issue #54) speed movers too ("everything speeds
  // up"). Movers stay independent of Scope Creep (raw step), only the mutator.
  const speedFactor = mutatorSpeedFactor(game.mapMutator, game.lockedBallsCount);
  for (const mover of game.movers) {
    const half = mover.range / 2;
    mover.offset += mover.direction * mover.speed * dt * speedFactor;
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
