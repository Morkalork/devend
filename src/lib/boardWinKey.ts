/**
 * A cheap fingerprint of everything the win evaluation can read, so the
 * per-frame safety-net check (GameCanvas checkWinCondition) runs the real
 * evaluation only when the board has changed.
 *
 * Numbers only, no per-object strings: this is read every frame. What moves a
 * clause: the live cell count (a cut, a break, a blast), the walls (a fence
 * landing or breaking), a ball's state or region (a lock, a portal), what has
 * been smashed, lit, harvested, delivered, and which areas are satisfied.
 * Positions are deliberately NOT in it: a ball moving inside its region
 * changes nothing a clause reads.
 */
import type { CanvasGameState } from "@/types/gameState";

export function boardWinKey(game: CanvasGameState): string {
  let balls = 0;
  for (const b of game.balls) {
    // State and region, folded to a number: 'won' / dormant / active differ,
    // and a region id is a string the fold hashes cheaply.
    let h = b.state === "won" ? 1 : b.state === "dormant" ? 2 : 3;
    const r = b.regionId ?? "";
    for (let i = 0; i < r.length; i++) {
      h = (h * 31 + r.charCodeAt(i)) | 0;
    }
    balls = (balls * 31 + h + Math.round(b.radius)) | 0;
  }
  let destroyed = 0;
  for (const d of game.destructibles ?? []) {
    if (d.destroyed) destroyed++;
  }
  let areas = 0;
  for (const a of game.coloredAreas ?? []) {
    if (a.satisfied) areas++;
  }
  let lit = 0;
  for (const t of game.circuit?.terminals ?? []) {
    if (t.lit) lit++;
  }
  let harvested = 0;
  for (const h of game.dataStream?.harvested ?? []) {
    if (h) harvested++;
  }
  let delivered = 0;
  for (const b of game.deliveryBoxes ?? []) {
    delivered += b.delivered;
  }
  return `${game.spaceGrid?.activeCount ?? -1}|${game.walls.length}|${game.wallCount}|${game.balls.length}|${balls}`
    // Cells still behind an unbroken reveal follow the destructibles, which
    // the destroyed count already covers.
    + `|${destroyed}|${areas}|${lit}|${harvested}|${delivered}|${game.lockedBallsCount ?? 0}`;
}
