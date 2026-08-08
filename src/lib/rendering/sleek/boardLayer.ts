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
import { ambientAt, shadowFor, slabHeight, type LightScope } from "./light";
import { snapStroke, type Pt } from "./pixelGrid";

type W2S = (x: number, y: number) => Pt;

/** Lattice lines are drawn every N grid cells, whichever N keeps them ≥ this. */
const MIN_LATTICE_PX = 26;

/**
 * Opacity of the board SURFACE only (captured fill, live fill, lattice).
 *
 * The CRT terminal behind the board is part of the fiction - the game is code
 * running on the same machine - so letting a little of it seep through makes the
 * board feel like a panel laid over a live screen rather than a hole punched in
 * the page. Kept deliberately high: the background is bright scrolling text, and
 * anything much below this starts competing with the balls for attention.
 *
 * Objects on the board (walls, obstacles, balls, props) stay fully opaque. Only
 * the surface they rest on is translucent, so nothing the player must read is
 * ever fighting the background.
 */
const SURFACE_ALPHA = 0.9;

/** The board panel's own height above the page, as a multiple of the furniture. */
const BOARD_HEIGHT_FACTOR = 2.4;
/** Softness of the board's drop shadow, in screen px per unit scale. */
const DROP_BLUR = 22;

export class BoardLayer {
  readonly container = new Container();
  /**
   * The board's own drop shadow. Lives OUTSIDE the board (it falls on the page)
   * and must render beneath everything, so the renderer adds it to a stage-level
   * underlay rather than to `container`.
   */
  readonly underlay = new Container();

  /** Surface fills, held together so one alpha covers the whole surface. */
  private surface = new Container();
  private captured = new Graphics();  // fenced-off territory (the substrate)
  private active = new Graphics();    // still-playable space, punched on top
  private lattice = new Graphics();   // the faint grid inside live space
  private latticeMask = new Graphics();
  private wash: Sprite | null = null; // baked ambient falloff, multiplied over
  private drop: Sprite | null = null; // baked drop shadow under the whole board

  private geometryKey = "";
  private washKey = "";
  private dropKey = "";

  constructor() {
    this.lattice.mask = this.latticeMask;
    this.surface.addChild(this.captured, this.active, this.lattice, this.latticeMask);
    // One alpha on the group, rather than per-fill: the captured and live fills
    // overlap, so per-fill alpha would make the overlap less transparent than
    // the rest and show as a visible seam along every region boundary.
    this.surface.alpha = SURFACE_ALPHA;
    this.container.addChild(this.surface);
  }

  /**
   * `dirty` comes from the same signal GameCanvas already raises when it
   * repaints its region canvases (i.e. after a cut), so the expensive contour
   * trace only runs when the board's shape actually changed.
   */
  sync(game: CanvasGameState, light: LightScope, w2s: W2S, dirty: boolean): void {
    this.syncGeometry(game, w2s, dirty);
    this.syncWash(game, light);
    this.syncDrop(game, light);
  }

  /**
   * The board's drop shadow on the page behind it.
   *
   * Cast by the same monitor as everything else, so it falls up-and-left like
   * every other shadow on screen - a board lit from one direction with its panel
   * shadow going another way would break the whole illusion in one glance. The
   * board is a thick panel rather than a thin slab, so it stands taller than the
   * furniture and throws a correspondingly longer, softer shadow.
   *
   * The board's OWN footprint is punched out of the bake. With a translucent
   * surface you would otherwise see the shadow through the board it belongs to,
   * which reads as a smudge under the glass.
   */
  private syncDrop(game: CanvasGameState, light: LightScope): void {
    const { boardRect } = game;
    const key = `${boardRect.width}x${boardRect.height}|${Math.round(light.x)},${Math.round(light.y)}`;
    if (key !== this.dropKey) {
      this.dropKey = key;
      this.drop?.destroy();
      this.drop = this.bakeDrop(game, light);
      if (this.drop) this.underlay.addChild(this.drop);
    }
    // Only the intensity rides the flicker; re-baking per frame would be absurd.
    if (this.drop) this.drop.alpha = 0.5 + 0.25 * light.level;
  }

  private bakeDrop(game: CanvasGameState, light: LightScope): Sprite | null {
    const { boardRect, boardRect: { scale } } = game;
    const w = Math.max(1, Math.round(boardRect.width));
    const h = Math.max(1, Math.round(boardRect.height));

    const cast = shadowFor(
      light,
      boardRect.left + w / 2,
      boardRect.top + h / 2,
      slabHeight(scale) * BOARD_HEIGHT_FACTOR,
    );
    const offX = cast.dx * cast.length;
    const offY = cast.dy * cast.length;
    const blur = Math.max(6, DROP_BLUR * scale);
    const pad = Math.ceil(blur * 3);

    const canvas = document.createElement("canvas");
    canvas.width = w + pad * 2;
    canvas.height = h + pad * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = withAlpha(PALETTE.shadow, 0.85);
    ctx.fillRect(pad, pad, w, h);
    ctx.filter = "none";

    // Remove the part that would sit under the board itself.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.fillRect(pad - offX, pad - offY, w, h);
    ctx.globalCompositeOperation = "source-over";

    const sprite = new Sprite(Texture.from(canvas));
    sprite.position.set(boardRect.left - pad + offX, boardRect.top - pad + offY);
    return sprite;
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
    this.drop?.destroy();
    this.container.destroy({ children: true });
    this.underlay.destroy({ children: true });
  }
}
