import { describe, it, expect } from "vitest";
import { isRegionTrulySealed, CellState, SpaceGrid } from "@/lib/spaceGrid";

// isRegionTrulySealed decides whether a ball may lock: its region must be
// enclosed by REAL barriers, not "sealed" by a capture severing a gap the ball
// can't fit through. It reads only width/height/cells; build a bare grid.
function grid(width: number, height: number, post: number[]): SpaceGrid {
  return {
    cellSize: 15, width, height, originX: 0, originY: 0,
    cells: Uint8Array.from(post),
    initialActiveCount: 0, activeCount: 0, cellRegionIds: [],
  } as unknown as SpaceGrid;
}

const A = CellState.ACTIVE, R = CellState.REMOVED;

// 10x3 grid. The "pocket" is the single active cell at (row 1, col 1) = index 11.
// A snapshot corridor runs right along row 1 (cols 2..8) to a far cell.
const W = 10, H = 3;
const POCKET = [11];

function snapshotWithCorridor(): Uint8Array {
  const s = new Uint8Array(W * H).fill(R);
  for (let c = 1; c <= 8; c++) s[1 * W + c] = A; // pocket + corridor + far cell
  return s;
}

describe("isRegionTrulySealed (locking requires a real seal)", () => {
  it("sealed: pocket walled off in the snapshot -> true", () => {
    const snapshot = new Uint8Array(W * H).fill(R);
    snapshot[11] = A; // only the pocket is active, nothing adjacent
    const g = grid(W, H, Array.from(snapshot));
    expect(isRegionTrulySealed(g, snapshot, POCKET)).toBe(true);
  });

  it("open: the gap still leads to living space post-capture -> false", () => {
    const snapshot = snapshotWithCorridor();
    // Post-capture the corridor + far cell stay ACTIVE (the ball just can't fit
    // through, but the opening is real): must NOT be considered sealed.
    const g = grid(W, H, Array.from(snapshot));
    expect(isRegionTrulySealed(g, snapshot, POCKET)).toBe(false);
  });

  it("dead end: the gap leads only to cells this cut captured -> true", () => {
    const snapshot = snapshotWithCorridor();
    // Post-capture everything beyond the pocket was REMOVED (captured). The
    // plain flood walks through that dead space and never reaches living space.
    const post = Array.from(snapshot).map((v, i) => (i === 11 ? A : R));
    const g = grid(W, H, post);
    expect(isRegionTrulySealed(g, snapshot, POCKET)).toBe(true);
  });
});
