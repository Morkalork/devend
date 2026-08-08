/**
 * The board surface: captured territory, live space, the lattice, and the
 * monitor's wash across all of it.
 *
 * WHY THIS LOOKS DIFFERENT FROM THE OLD BOARD. The classic renderer stamped the
 * lattice as one `Math.round`ed rect per 15-unit grid cell (thousands of them),
 * so every boundary was a staircase of independently-rounded squares - adjacent
 * cells rounding opposite ways is precisely the "diagonal line with clear pixel
 * breaks" this rewrite exists to kill. Here the boundary is ONE traced contour
 * (smooth, antialiased, never quantised) and the lattice is a set of continuous
 * pixel-snapped lines masked by it. Straight runs come out razor sharp; the
 * diagonal boundary comes out as a single clean edge.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import { traceActiveContours, snapContoursToWalls } from "@/lib/rendering/regionContour";
import { PALETTE, withAlpha } from "./palette";
import { ambientAt, type LightScope } from "./light";
import { snapStroke, type Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** Lattice lines are drawn every N grid cells, whichever N keeps them ≥ this. */
const MIN_LATTICE_PX = 26;

export class BoardLayer {
  readonly container = new Container();

  private captured = new Graphics();  // fenced-off territory (the substrate)
  private active = new Graphics();    // still-playable space, punched on top
  private lattice = new Graphics();   // the faint grid inside live space
  private latticeMask = new Graphics();
  private wash: Sprite | null = null; // baked ambient falloff, multiplied over

  private geometryKey = "";
  private washKey = "";

  constructor() {
    this.lattice.mask = this.latticeMask;
    this.container.addChild(this.captured, this.active, this.lattice, this.latticeMask);
  }

  /**
   * `dirty` comes from the same signal GameCanvas already raises when it
   * repaints its region canvases (i.e. after a cut), so the expensive contour
   * trace only runs when the board's shape actually changed.
   */
  sync(game: CanvasGameState, light: LightScope, w2s: W2S, dirty: boolean): void {
    this.syncGeometry(game, w2s, dirty);
    this.syncWash(game, light);
  }

  private syncGeometry(game: CanvasGameState, w2s: W2S, dirty: boolean): void {
    const { boardRect, spaceGrid } = game;
    const key = `${boardRect.left},${boardRect.top},${boardRect.width},${boardRect.height}`;
    if (!dirty && key === this.geometryKey) return;
    this.geometryKey = key;

    // ── Captured territory: the whole board, which live space is punched out of.
    this.captured.clear();
    this.captured
      .rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height)
      .fill({ color: PALETTE.captured, alpha: 1 });

    this.active.clear();
    this.latticeMask.clear();
    this.lattice.clear();
    if (!spaceGrid) return;

    // ── Live space: one traced contour set, drawn OPAQUE over the captured fill.
    // Drawing on top (rather than compositing a hole) keeps the edge a single
    // antialiased path instead of two edges fighting over the same pixels.
    //
    // NEVER pixel-snap these loops. They are already Chaikin-smoothed by
    // traceContours, and that smoothing is what turns a 15px cell lattice into
    // one continuous edge - snapping the result quantises every micro-segment
    // straight back into the staircase this renderer exists to eliminate.
    // Snapping is for AUTHORED axis-aligned geometry only (lattice, area rects,
    // board edges), never for an organic boundary.
    const raw = traceActiveContours(spaceGrid);
    if (raw.length === 0) return;

    // Project points that land near a wall onto that wall, so the fill stops
    // flush against the fence instead of wobbling along the lattice beside it.
    //
    // The reach must exceed the lattice's own diagonal, not just its pitch. A
    // contour tracking a diagonal fence steps through cell CORNERS, which sit up
    // to half a cell diagonal (~0.7 cells) off the line; a reach of ~1 cell left
    // those corners unsnapped and they showed as a comb of teeth along every
    // diagonal cut. 1.8 cells clears them with margin.
    const loops = snapContoursToWalls(raw, game.walls, spaceGrid.cellSize * 1.8);

    const screenLoops: Pt[][] = loops.map(loop => loop.map(p => w2s(p.x, p.y)));

    for (const loop of screenLoops) {
      if (loop.length < 3) continue;
      this.active.poly(loop);
      this.latticeMask.poly(loop);
    }
    // Even-odd so an obstacle enclosed by live space stays captured-coloured
    // rather than being flooded by the outer loop.
    this.active.fill({ color: PALETTE.active, alpha: 1 });
    this.latticeMask.fill({ color: 0xffffff, alpha: 1 });

    // A hairline along the live/captured boundary. This is the edge the player
    // actually reads when judging a cut, so it gets the one crisp accent line.
    for (const loop of screenLoops) {
      if (loop.length < 3) continue;
      this.active.poly(loop);
    }
    this.active.stroke({ width: 1, color: PALETTE.accentDim, alpha: 0.55 });

    this.drawLattice(game, w2s);
  }

  /**
   * The lattice: continuous lines spanning live space, snapped to whole device
   * pixels so each is exactly one pixel wide with no grey doubling. Masked by
   * the active contour, so it stops dead at the boundary without any per-cell
   * stamping.
   */
  private drawLattice(game: CanvasGameState, w2s: W2S): void {
    const { spaceGrid, boardRect } = game;
    if (!spaceGrid) return;

    const cellPx = spaceGrid.cellSize * boardRect.scale;
    const step = Math.max(1, Math.ceil(MIN_LATTICE_PX / Math.max(1, cellPx)));
    const worldStep = spaceGrid.cellSize * step;

    const g = this.lattice;
    const originX = spaceGrid.originX;
    const originY = spaceGrid.originY;
    const spanX = spaceGrid.width * spaceGrid.cellSize;
    const spanY = spaceGrid.height * spaceGrid.cellSize;

    const top = w2s(originX, originY);
    const bottom = w2s(originX + spanX, originY + spanY);

    for (let wx = originX; wx <= originX + spanX + 0.001; wx += worldStep) {
      const x = snapStroke(w2s(wx, originY).x, 1);
      g.moveTo(x, top.y).lineTo(x, bottom.y);
    }
    for (let wy = originY; wy <= originY + spanY + 0.001; wy += worldStep) {
      const y = snapStroke(w2s(originX, wy).y, 1);
      g.moveTo(top.x, y).lineTo(bottom.x, y);
    }
    g.stroke({ width: 1, color: PALETTE.grid, alpha: 0.6 });
  }

  /**
   * The monitor's wash: a baked radial falloff multiplied over the board, so
   * the bottom-right corner sits nearest the light and the top-left falls into
   * shadow. Baked once per board size; the per-frame flicker only rides on the
   * sprite's alpha, which costs nothing.
   */
  private syncWash(game: CanvasGameState, light: LightScope): void {
    const { boardRect } = game;
    const key = `${boardRect.width}x${boardRect.height}|${Math.round(light.x)},${Math.round(light.y)}`;
    if (key !== this.washKey) {
      this.washKey = key;
      this.wash?.destroy();
      this.wash = this.bakeWash(game, light);
      if (this.wash) this.container.addChild(this.wash);
    }
    if (!this.wash) return;
    // Brighter monitor = less darkening. Inverted because the wash is a
    // multiply layer: its job is to REMOVE light from the far corner.
    this.wash.alpha = Math.max(0, Math.min(1, 1.25 - light.level));
  }

  private bakeWash(game: CanvasGameState, light: LightScope): Sprite | null {
    const { boardRect } = game;
    const w = Math.max(1, Math.round(boardRect.width));
    const h = Math.max(1, Math.round(boardRect.height));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Gradient centred on the (off-canvas) light, so the falloff is genuinely
    // radial about the monitor rather than a fake corner-to-corner ramp.
    const lx = light.x - boardRect.left;
    const ly = light.y - boardRect.top;
    const far = Math.hypot(Math.max(lx, w - lx), Math.max(ly, h - ly));
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, far);
    grad.addColorStop(0, withAlpha(PALETTE.monitor, 0.0));
    grad.addColorStop(0.45, withAlpha(PALETTE.shadow, 0.16));
    grad.addColorStop(1, withAlpha(PALETTE.shadow, 0.62));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const sprite = new Sprite(Texture.from(canvas));
    sprite.position.set(boardRect.left, boardRect.top);
    // Ambient occlusion of the whole surface: strictly subtractive.
    sprite.blendMode = "multiply";
    return sprite;
  }

  /** Ambient level under an object, for layers that tint themselves by it. */
  static ambient(light: LightScope, x: number, y: number): number {
    return ambientAt(light, x, y);
  }

  destroy(): void {
    this.wash?.destroy();
    this.container.destroy({ children: true });
  }
}
