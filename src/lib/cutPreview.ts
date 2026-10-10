/**
 * The cut the player is dragging, before they let go: where it will run, and
 * what it will take.
 *
 * WHERE. The preview path is cast off the same drawn path the cut will follow
 * (bent fences, #66) and the same reflecting ray the input handler uses, so the
 * line the 2D fx layer draws and the wall the 3D board stands up for it can
 * never disagree with the fence that lands.
 *
 * WHAT. The 3D board answers "which side do I get?" with light: every ball
 * lights its own side of the would-be fence, and ground no ball can reach goes
 * dark, because that is the ground the cut captures. The dark side is worked
 * out by SIMULATING the cut on a copy of the grid - rasterise the preview,
 * run the real captureUnreachableCells - exactly as smashReach and areaReach
 * already do for their refusals. Working it out by geometry instead would be
 * a second implementation of reachability, free to disagree with the first,
 * and a preview that disagrees with the cut is worse than none.
 */
import type { CanvasGameState } from "@/types/gameState";
import { castRayWithReflections, WALL_THICKNESS } from "@/lib/wallGeometry";
import { cutAnchorsBreakable } from "@/lib/physics/destructibles";
import { bentDrawnPath, joinProjection, outgoingDirection, incomingDirection } from "@/lib/physics/bentCut";
import { captureUnreachableCells, rasterizeCutToGrid, CellState, type SpaceGrid } from "@/lib/spaceGrid";
import { vec2Sub, vec2Length, vec2Normalize, type Vector2 } from "@/lib/polygon";

export interface CutPreview {
  /** The forward leg and the backward leg, each a waypoint polyline. */
  paths: Vector2[][];
  /** The cut would anchor on something breakable and come to nothing. */
  dud: boolean;
}

/** The cut being dragged, or null when there is none (or it is still noise). */
export function previewCutPaths(game: CanvasGameState): CutPreview | null {
  const { swipeStart, currentSwipePos, swipeRegionId } = game;
  if (!swipeStart || !currentSwipePos || !swipeRegionId) return null;

  const delta = vec2Sub(currentSwipePos, swipeStart);
  // Below this the direction is noise, and a preview that flails around while
  // the finger settles is worse than none.
  if (vec2Length(delta) < 5) return null;

  const bent = bentDrawnPath(game);
  const dir = bent ? outgoingDirection(bent) : vec2Normalize(delta);
  const backDir = bent ? incomingDirection(bent) : { x: -dir.x, y: -dir.y };
  const fwd = castRayWithReflections(bent ? bent[bent.length - 1] : swipeStart, dir, game.walls);
  const bwd = castRayWithReflections(bent ? bent[0] : swipeStart, backDir, game.walls);
  if (!fwd || !bwd) return null;

  const forwardPath = bent ? joinProjection(bent, fwd.waypoints) : fwd.waypoints;
  const fEnd = forwardPath[forwardPath.length - 1];
  const bEnd = bwd.waypoints[bwd.waypoints.length - 1];
  return {
    paths: [forwardPath, bwd.waypoints],
    dud: cutAnchorsBreakable(game, fEnd, bEnd, WALL_THICKNESS + 6),
  };
}

/** A preview's straight runs, for rasterising and for standing up in 3D. */
export function previewSegments(preview: CutPreview): { start: Vector2; end: Vector2 }[] {
  const out: { start: Vector2; end: Vector2 }[] = [];
  for (const wps of preview.paths) {
    for (let i = 0; i < wps.length - 1; i++) out.push({ start: wps[i], end: wps[i + 1] });
  }
  return out;
}

/**
 * The cells the cut would capture: 1 for ground that is live now and would be
 * claimed, 0 elsewhere - including the fence's own line, which is not "the
 * other side" of anything. Null when there is no grid, or the cut is a dud and
 * would capture nothing.
 */
export function predictCapture(game: CanvasGameState, preview: CutPreview): Uint8Array | null {
  const grid = game.spaceGrid;
  if (!grid || preview.dud) return null;
  const segments = previewSegments(preview);
  if (segments.length === 0) return null;

  const after: SpaceGrid = {
    ...grid,
    cells: Uint8Array.from(grid.cells),
    cellRegionIds: [...grid.cellRegionIds],
  };
  const line = new Set<number>();
  for (const seg of segments) {
    for (const i of rasterizeCutToGrid(after, seg.start, seg.end, WALL_THICKNESS)) line.add(i);
  }
  captureUnreachableCells(after, game.balls, [...game.walls, ...segments]);

  const mask = new Uint8Array(grid.cells.length);
  for (let i = 0; i < mask.length; i++) {
    if (grid.cells[i] === CellState.ACTIVE && after.cells[i] !== CellState.ACTIVE && !line.has(i)) mask[i] = 1;
  }
  return mask;
}

/** A cheap key for a preview, so the simulation runs only when it changes. */
export function previewKey(preview: CutPreview): string {
  return preview.paths
    .map(p => p.map(v => `${Math.round(v.x * 2)},${Math.round(v.y * 2)}`).join(";"))
    .join("|") + (preview.dud ? "!" : "");
}
