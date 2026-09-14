/**
 * The launcher shell dematerializes once its last ball has left.
 *
 * A barrel is three slabs, and until the shot has emptied it those slabs are
 * doing a job: they are the tube the roster is stacked in and the reason a
 * fence across the interior is refused (physics/launcher.ts, `armed`). The
 * frame the barrel arms, that job is over. Leaving the shell standing made
 * every launcher map carry a dead three-sided box for the rest of the level,
 * sitting exactly where the player had just been told not to cut.
 *
 * So the shell goes. Two halves, deliberately separate:
 *
 *   THE MODEL loses the shell at once, the frame the barrel arms. Its slabs
 *     leave game.obstaclePolygons, its walls leave game.walls, and the ground
 *     it stood on is reopened and settled exactly as a smashed breakable's is.
 *     One step, so the physics never has a half-removed barrel to reason about.
 *
 *   THE PICTURE takes its time. The shell is cut into sections, muzzle end
 *     first and the back wall last, and each section holds its shape until its
 *     own beat, then breaks into tiles that fly off and fall, the way the board
 *     itself shatters on a clear. The renderer draws a section not yet released
 *     as the slab it was, so the only thing the player sees change is the
 *     dematerialization running down the barrel.
 *
 * The beats are short on purpose. For the length of the run-down a section
 * that is still drawn is already gone from the model, and a ball passing
 * through a slab that is visibly there would be a lie; under half a second,
 * with every ball just fired AWAY from the barrel, it is not one anyone can
 * catch.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Vector2, ShellSection, ShellShatterState, ShellTile } from "@/types/game";
import type { Polygon } from "@/lib/polygon";
import type { LauncherState } from "@/lib/physics/launcher";
import { bearingVector } from "@/lib/launcher";
import { BOX_WALL_THICKNESS } from "@/lib/gameConstants";
import {
  floodSealedShadow, reopenCells, removedCellsUnder, settleReopenedGround,
  type DestroyCallbacks,
} from "@/lib/physics/destructibles";

/** Target length of one section along a side, in world units. */
export const SHELL_SECTION_LENGTH = 40;
/** Beat between one section letting go and the next, in ms. */
export const SHELL_SECTION_STEP_MS = 60;
/** How long a released section's tiles fly before they are gone, in ms. */
export const SHELL_TILE_FLIGHT_MS = 700;
/** Target edge of one tile, in world units. */
const SHELL_TILE_SIZE = 9;

/** Total time from the first section's release to the last tile's fade. */
export function shellShatterDurationMs(s: ShellShatterState): number {
  let last = 0;
  for (const sec of s.sections) {
    if (sec.delay > last) {
      last = sec.delay;
    }
  }
  return last + s.flightMs;
}

/**
 * Tiny deterministic stream for the cosmetic scatter. Seeded from the barrel's
 * id so two runs of the same map dematerialize the same way; the run's own rng
 * is not used because a picture must never consume a number the game needs.
 */
function scatterRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rect {
  x: number; y: number; width: number; height: number;
}

/**
 * Cut the three closed sides of a barrel into sections, in the barrel's own
 * un-turned frame, ordered muzzle end first.
 *
 * Each side is split along its length into pieces of about
 * SHELL_SECTION_LENGTH. A piece's beat is its rank by distance from the
 * muzzle, so the two long sides run down together and the back wall, whose
 * pieces are all furthest from the muzzle, goes last as one.
 */
export function shellSections(launcher: Pick<LauncherState, "inner" | "facing">): Array<{
  rect: Rect;
  /** Unit vector, in the barrel's frame, pointing away from the barrel's axis. */
  outward: Vector2;
  beat: number;
}> {
  const T = BOX_WALL_THICKNESS;
  const { inner, facing } = launcher;
  const x0 = inner.x - T;
  const y0 = inner.y - T;
  const w = inner.width + 2 * T;
  const h = inner.height + 2 * T;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const sides: Array<{ side: LauncherState["facing"]; rect: Rect; outward: Vector2 }> = [
    { side: "up",    rect: { x: x0,         y: y0,         width: w, height: T }, outward: { x: 0,  y: -1 } },
    { side: "down",  rect: { x: x0,         y: y0 + h - T, width: w, height: T }, outward: { x: 0,  y: 1 } },
    { side: "left",  rect: { x: x0,         y: y0,         width: T, height: h }, outward: { x: -1, y: 0 } },
    { side: "right", rect: { x: x0 + w - T, y: y0,         width: T, height: h }, outward: { x: 1,  y: 0 } },
  ];
  const bearing = bearingVector(facing);

  const pieces: Array<{ rect: Rect; outward: Vector2; key: number }> = [];
  for (const { side, rect, outward } of sides) {
    if (side === facing) {
      continue; // the muzzle
    }
    const along = rect.width >= rect.height ? "x" : "y";
    const length = along === "x" ? rect.width : rect.height;
    const count = Math.max(1, Math.round(length / SHELL_SECTION_LENGTH));
    const step = length / count;
    for (let i = 0; i < count; i++) {
      const piece: Rect = along === "x"
        ? { x: rect.x + i * step, y: rect.y, width: step, height: rect.height }
        : { x: rect.x, y: rect.y + i * step, width: rect.width, height: step };
      const pcx = piece.x + piece.width / 2 - cx;
      const pcy = piece.y + piece.height / 2 - cy;
      // How far toward the muzzle this piece sits. Rounded so the mirrored
      // pieces of the two long sides share a beat exactly.
      const key = Math.round(pcx * bearing.x + pcy * bearing.y);
      pieces.push({ rect: piece, outward, key });
    }
  }

  const keys = [...new Set(pieces.map(p => p.key))].sort((a, b) => b - a);
  const beatOf = new Map<number, number>();
  keys.forEach((k, i) => beatOf.set(k, i));
  return pieces
    .sort((a, b) => b.key - a.key || a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .map(p => ({ rect: p.rect, outward: p.outward, beat: beatOf.get(p.key) ?? 0 }));
}

/**
 * The picture of a barrel's shell going, built while the model still has it.
 *
 * Everything is laid out in the barrel's own frame and turned by the barrel's
 * angle about its centre, the same pivot initGame turns the slabs about, so a
 * section sits exactly on the slab it stands in for.
 */
export function shellShatter(launcher: LauncherState, now: number): ShellShatterState {
  const { inner, angle } = launcher;
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  const rad = angle ? (angle * Math.PI) / 180 : 0;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const turnPoint = (p: Vector2): Vector2 => {
    if (!rad) {
      return { x: p.x, y: p.y };
    }
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  const turnDir = (v: Vector2): Vector2 => {
    if (!rad) {
      return { x: v.x, y: v.y };
    }
    return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
  };
  const rng = scatterRng(launcher.id);

  const sections: ShellSection[] = shellSections(launcher).map(({ rect, outward, beat }) => {
    const vertices = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map(turnPoint);

    const cols = Math.max(1, Math.round(rect.width / SHELL_TILE_SIZE));
    const rows = Math.max(1, Math.round(rect.height / SHELL_TILE_SIZE));
    const tw = rect.width / cols;
    const th = rect.height / rows;
    const tiles: ShellTile[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const centre = turnPoint({ x: rect.x + (c + 0.5) * tw, y: rect.y + (r + 0.5) * th });
        // Out from the barrel's axis, with a little drift along it and a small
        // pop upward that the renderer's gravity reclaims.
        const out = 50 + rng() * 110;
        const along = (rng() - 0.5) * 60;
        const v = turnDir({
          x: outward.x * out - outward.y * along,
          y: outward.y * out + outward.x * along,
        });
        tiles.push({
          x: centre.x, y: centre.y, w: tw, h: th,
          vx: v.x, vy: v.y - 20 - rng() * 40,
          rotation: rad,
          rotSpeed: (rng() - 0.5) * 10,
        });
      }
    }
    return { vertices, delay: beat * SHELL_SECTION_STEP_MS, tiles };
  });

  return { startTime: now, flightMs: SHELL_TILE_FLIGHT_MS, sections };
}

/**
 * Take the shell of every newly-armed barrel out of the world, and queue its
 * going for the renderer. Once per active frame, straight after
 * updateLauncherArming, in both the game loop and the headless harness.
 *
 * Idempotent through `dematerialized`, which latches like `armed` does: a
 * barrel is torn down exactly once, and one with no shell recorded (a
 * hand-built state in a test) simply latches with nothing to remove.
 *
 * Also culls finished shatters, so the array never grows across a long map.
 */
export function dematerializeArmedLaunchers(
  game: CanvasGameState, callbacks: DestroyCallbacks, now: number,
): void {
  game.shellShatters ??= [];
  if (game.shellShatters.length > 0) {
    game.shellShatters = game.shellShatters.filter(s => now < s.startTime + shellShatterDurationMs(s));
  }

  for (const launcher of game.launchers ?? []) {
    if (!launcher.armed || launcher.dematerialized) {
      continue;
    }
    launcher.dematerialized = true;
    const shell: Polygon[] = launcher.shell ?? [];
    if (shell.length === 0) {
      continue;
    }

    game.shellShatters.push(shellShatter(launcher, now));

    // The whole shell leaves before any footprint is measured: the seal ring
    // around one slab touches its neighbours at the corners, and a sibling
    // still in game.walls would hold those cells shut (heldByOther) and leave
    // a REMOVED speck in each corner of where the barrel stood.
    const gone = new Set<Polygon>(shell);
    game.obstaclePolygons = game.obstaclePolygons.filter(p => !gone.has(p));
    const prefix = `launcher-${launcher.id}-`;
    game.walls = game.walls.filter(w => !w.id.startsWith(prefix));

    let opened = 0;
    const grid = game.spaceGrid;
    if (grid) {
      const footprint = new Set<number>();
      for (const poly of shell) {
        for (const cell of removedCellsUnder(game, poly)) {
          footprint.add(cell);
        }
      }
      const seed = [...footprint];
      const cells = seed.concat(floodSealedShadow(game, grid, seed));
      if (cells.length > 0) {
        reopenCells(game, cells);
        opened = cells.length;
      }
    }
    callbacks.repaintRegionCanvas();
    settleReopenedGround(game, callbacks, opened);
  }
}
