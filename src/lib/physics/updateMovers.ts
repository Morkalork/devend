import { CanvasGameState } from "@/types/gameState";
import { updateMoverPolygon } from "./moverState";

export function updateMoversFn(dt: number, game: CanvasGameState): void {
  for (const mover of game.movers) {
    const half = mover.range / 2;
    mover.offset += mover.direction * mover.speed * dt;
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
