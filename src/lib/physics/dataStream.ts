/**
 * "Data Stream" (a greed hook on fence PLACEMENT). A map's seam is a glowing
 * polyline; a fence drawn ALONG it (running within `width`, not merely crossing)
 * harvests the spans it covers, paying scaled overtime or freeze charges. Run
 * once per committed cut. Each seam segment pays once, so re-tracing a covered
 * span banks nothing.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { GameCallbacks } from "./gameCallbacks";
import { pointToSegmentDistance } from "@/lib/polygon";

/** Fraction of a seam segment's sample points that must hug the fence to count
 *  it as "run along" (vs a perpendicular crossing, which touches only near one
 *  point). Tuned so a glancing cross never harvests but a parallel run does. */
const ALONG_COVERAGE = 0.6;
/** Sample points per seam segment for the along-test. */
const SAMPLES = 6;

/** The line segments of a just-committed cut (both grown halves of the fence). */
function cutSegments(wall: GrowingWall): Array<[Vector2, Vector2]> {
  const segs: Array<[Vector2, Vector2]> = [];
  const add = (wps: Vector2[]) => {
    for (let i = 0; i < wps.length - 1; i++) segs.push([wps[i], wps[i + 1]]);
  };
  add(wall.startWaypoints);
  add(wall.endWaypoints);
  return segs;
}

/** True when the fence runs ALONG seam segment [a,b] (most of it hugged, not a
 *  perpendicular crossing): sample points along the seam and require enough of
 *  them to lie within `width` of some fence segment. */
function fenceRunsAlong(a: Vector2, b: Vector2, fence: Array<[Vector2, Vector2]>, width: number): boolean {
  if (fence.length === 0) return false;
  let near = 0;
  for (let s = 0; s <= SAMPLES; s++) {
    const t = s / SAMPLES;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    for (const [f0, f1] of fence) {
      if (pointToSegmentDistance(p, f0, f1) <= width) { near++; break; }
    }
  }
  return near / (SAMPLES + 1) >= ALONG_COVERAGE;
}

/**
 * Harvest the seam spans this just-committed fence runs along, paying `reward`
 * scaled by the fraction of the whole seam newly covered. No-op on maps without
 * a seam or once every span is harvested.
 */
export function tickDataStreamOnCut(game: CanvasGameState, wall: GrowingWall, callbacks: GameCallbacks): void {
  const ds = game.dataStream;
  if (!ds) return;
  const segCount = ds.path.length - 1;
  if (segCount <= 0 || ds.harvested.every(Boolean)) return;

  const fence = cutSegments(wall);
  if (fence.length === 0) return;

  let harvestedNow = 0;
  for (let i = 0; i < segCount; i++) {
    if (ds.harvested[i]) continue;
    if (fenceRunsAlong(ds.path[i], ds.path[i + 1], fence, ds.width)) {
      ds.harvested[i] = true;
      harvestedNow++;
    }
  }
  if (harvestedNow === 0) return;

  const fraction = harvestedNow / segCount;
  payReward(game, ds, fraction, callbacks);
}

function payReward(game: CanvasGameState, ds: CanvasGameState["dataStream"] & object, fraction: number, callbacks: GameCallbacks): void {
  if (!ds) return;
  if (ds.reward.kind === "overtime") {
    // Overtime scaled by the coverage this cut added (paid after the cap, like
    // the overtime pickup). Trace more of the seam over several cuts -> more.
    const hours = Math.max(1, Math.round(ds.reward.value * fraction));
    game.pickupOvertime = (game.pickupOvertime ?? 0) + hours;
    callbacks.onStreamHarvested?.(hours, ds.announce);
  } else {
    // Freeze charges: accumulate the covered fraction and grant a whole charge
    // each time it crosses 1.0, so the seam pays `value` charges at full cover.
    ds.freezeProgress += fraction * ds.reward.value;
    let granted = 0;
    while (ds.freezeProgress >= 1) {
      ds.freezeProgress -= 1;
      game.freezeCharges = (game.freezeCharges ?? 0) + 1;
      game.freezeChargeSeconds = Math.max(game.freezeChargeSeconds ?? 0, 3);
      granted++;
    }
    if (granted > 0) callbacks.onStreamHarvested?.(0, ds.announce);
  }
}
