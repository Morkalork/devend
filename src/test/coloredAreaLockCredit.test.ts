/**
 * Which colored area a lock counts as landing in.
 *
 * Reported from level 3: a ball fenced into the `let` zone in the upper right
 * paid no multiplier and did not light the zone. Both verdicts hung on a single
 * POINT falling inside the area rect - the zone lighting up used the ball's
 * position on the frame the lock fired (an arbitrary bounce position, discarded
 * moments later for exactly that reason), and the payout used the region
 * centroid. A pocket fenced around a zone routinely spills past it, which drags
 * both points outside the rect while the zone is plainly captured.
 *
 * One rule now decides both, and it is the same forgiving test the win gate
 * already used: a lock good enough to WIN a gate map is good enough to pay.
 */
import { describe, it, expect } from "vitest";
import { areaForLock } from "@/lib/coloredAreas";
import { createSpaceGrid, worldToGridIndex } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { ColoredArea } from "@/types/level";

const COVER = 0.7;
const grid = createSpaceGrid(createRectPolygon(45, 45, 855, 855), [], 15);

// Level 3's actual zone: 170x170 at (670, 60).
const LET: ColoredArea = { kind: "let", x: 670, y: 60, width: 170, height: 170, required: false } as ColoredArea;

/** Every cell whose centre is inside the given world rect. */
function cellsIn(x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0 + 7; y < y1; y += 15) {
    for (let x = x0 + 7; x < x1; x += 15) out.push(worldToGridIndex(grid, x, y));
  }
  return [...new Set(out)];
}

describe("colored area lock credit", () => {
  it("credits a pocket that captures the zone but extends well past it", () => {
    // The reported shape: the zone plus a big tail reaching left and down, so
    // the pocket's centroid lands OUTSIDE the rect entirely.
    const pocket = [...cellsIn(670, 60, 840, 230), ...cellsIn(400, 60, 670, 400)];
    const cx = 500, cy = 250; // roughly the pocket's centre: outside the zone
    expect(areaForLock(grid, pocket, cx, cy, [LET], COVER)).toBeTruthy();
  });

  it("credits a small pocket sitting entirely inside the zone", () => {
    const pocket = cellsIn(700, 90, 760, 150);
    expect(areaForLock(grid, pocket, 730, 120, [LET], COVER)).toBeTruthy();
  });

  it("credits a lock whose settled position is in the zone", () => {
    const pocket = cellsIn(600, 60, 760, 300);
    expect(areaForLock(grid, pocket, 700, 100, [LET], COVER)).toBeTruthy();
  });

  // The zone still has to mean something: clipping a corner is not capturing it.
  it("refuses a pocket that merely clips the zone and settles outside", () => {
    // Genuinely overlaps the zone's bottom-left corner (x 670-700, y 150-230),
    // about 8% of it, and settles well outside. Clipping is not capturing.
    const pocket = cellsIn(400, 150, 700, 400);
    expect(areaForLock(grid, pocket, 550, 275, [LET], COVER)).toBeNull();
  });

  it("refuses a pocket nowhere near the zone", () => {
    const pocket = cellsIn(100, 500, 300, 700);
    expect(areaForLock(grid, pocket, 200, 600, [LET], COVER)).toBeNull();
  });

  it("breaks ties toward the richer zone when both qualify", () => {
    const cheap: ColoredArea = { kind: "var", x: 670, y: 60, width: 170, height: 170 } as ColoredArea;
    const rich: ColoredArea = { kind: "const", x: 670, y: 60, width: 170, height: 170 } as ColoredArea;
    const pocket = cellsIn(670, 60, 840, 230);
    expect(areaForLock(grid, pocket, 750, 140, [cheap, rich], COVER)?.kind).toBe("const");
  });
});
