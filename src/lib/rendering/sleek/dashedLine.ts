/**
 * Dashed segment helper.
 *
 * Pixi's Graphics has no dash support, so a dashed run is emitted as a series of
 * short moveTo/lineTo pairs and stroked in one call by the caller. Batching the
 * whole dashed path into a single stroke matters: stroking each dash separately
 * would make every overlap double-blend at partial alpha.
 *
 * Lives in the sleek layer (rather than being imported from the old Pixi
 * effects module) so this renderer owns all of its own drawing primitives.
 */

import type { Graphics } from "pixi.js";

export function dashedLine(
  g: Graphics,
  ax: number, ay: number, bx: number, by: number,
  dash: number, gap: number,
): void {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const ux = dx / len, uy = dy / len;
  let d = 0;
  while (d < len) {
    const e = Math.min(d + dash, len);
    g.moveTo(ax + ux * d, ay + uy * d).lineTo(ax + ux * e, ay + uy * e);
    d = e + gap;
  }
}
