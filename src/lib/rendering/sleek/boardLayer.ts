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
import { traceActiveContours, snapContoursToWalls, traceLockContours } from "@/lib/rendering/regionContour";
import { PALETTE, withAlpha } from "./palette";
import { ambientAt, lightScope, shadowFor, slabHeight, type LightScope } from "./light";
import { washSpriteAlpha, washStops } from "./boardWash";
import { snapStroke, hairline, type Pt } from "./pixelGrid";
import { transformKey } from "./transformKey";

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

/**
 * Multi-lock tiers drawn for locked territory, and the tint each one adds.
 *
 * Kept low and few on purpose: this marks the substrate the player has already
 * won, so it must never compete with live space or the balls for attention. Three
 * tiers is enough - a quadruple lock is rare enough to look the same as a triple.
 */
const LOCK_TIERS = 3;
const LOCK_TIER_ALPHA = 0.13;

/** The board panel's own height above the page, as a multiple of the furniture. */
const BOARD_HEIGHT_FACTOR = 2.4;
/** Radius of the baked wash gradient, in texture pixels. Scaled to fit any board. */
const WASH_BAKE_RADIUS = 256;
/** Softness of the board's drop shadow, in screen px per unit scale. */
const DROP_BLUR = 22;

/** Stroke width of the superior hatch, in screen px. */
const SUPERIOR_HATCH_WIDTH = 1.5;

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
  private locked = new Graphics();    // territory earned by trapping a ball
  /**
   * The superior hatch, on its own canvas rather than sharing `locked`.
   *
   * A Pixi Graphics accumulates one path across calls, and `fill()` does not
   * discard what came before it: stroking the hatch on the same object also
   * stroked every locked-pocket contour already sitting in that path, which
   * drew long stray lines across the board. Its own Graphics cannot be
   * contaminated by, or contaminate, the fills.
   */
  private hatch = new Graphics();
  private active = new Graphics();    // still-playable space, punched on top
  private lattice = new Graphics();   // the faint grid inside live space
  private latticeMask = new Graphics();
  /**
   * Everywhere a shadow is allowed to fall: the whole board, with locked
   * territory punched out.
   *
   * Locked ground is settled: the ball is sealed away and the pocket is won, so
   * it is a record rather than a place things still stand on. Fences bounding a
   * pocket are right at its edge, so their shadows fall almost entirely INSIDE
   * it, and on a small pocket that is most of the tint covered in grey. The
   * renderer masks the shared shadow plane with this, which catches every
   * caster at once (fences, obstacles, props, balls) instead of asking each
   * layer to remember.
   */
  readonly shadowMask = new Graphics();
  private wash: Sprite | null = null; // baked ambient falloff, multiplied over
  private drop: Sprite | null = null; // baked drop shadow under the whole board

  private geometryKey = "";
  private washKey = "";
  private dropKey = "";

  constructor() {
    this.lattice.mask = this.latticeMask;
    // Locked sits between the substrate and live space: it tints territory that
    // has been captured, and live space is painted opaque on top, which also
    // means a pocket that later REOPENS (a destructible breaking) hides its
    // stale tint for free rather than needing the array cleaned up.
    this.surface.addChild(this.captured, this.locked, this.hatch, this.active, this.lattice, this.latticeMask);
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
  /**
   * `room` is the MONITOR, never the lamp, and that is load-bearing.
   *
   * Both things this layer draws with a light are room facts rather than board
   * facts: the panel's drop shadow falls on the page BEHIND the board, and the
   * wash is the room's ambient falloff across the panel. A lamp lying on the
   * board's surface does not relight the room, so neither should follow it.
   * Everything that stands ON the board - walls, obstacles, props, balls - takes
   * the lamp instead, which is the whole point of the mechanic.
   *
   * It is also what keeps this layer cheap. Both of these are BAKED CANVASES
   * keyed partly on the light's position, and they were written when the light
   * could never move. Handing them a light that moves every frame allocates a
   * board-sized canvas, fills a gradient or a blur into it, and uploads a new
   * GPU texture SIXTY TIMES A SECOND. That is not a slow frame, it is a
   * compounding one, and it is exactly what "it starts lagging after a few
   * seconds" was.
   */
  sync(game: CanvasGameState, room: LightScope, w2s: W2S, dirty: boolean): void {
    this.syncGeometry(game, w2s, dirty);
    this.syncWash(game, room);
    this.syncDrop(game, room);
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
  private syncDrop(game: CanvasGameState, room: LightScope): void {
    const { boardRect } = game;
    // Board size ONLY, and `bakeDrop` builds its own room light rather than
    // taking one, so this key CANNOT go stale and the bake CANNOT churn.
    //
    // Unlike the wash, this one is not a pure translation: the board's own
    // footprint is punched out of the blurred silhouette, so the visible
    // crescent's shape really does depend on which way the shadow falls. There
    // is no positioning trick that avoids re-baking it. What there is instead
    // is the observation that a panel's shadow on the page BEHIND it is a fact
    // about the room, and a lamp lying on the board does not move it.
    const key = `${boardRect.width}x${boardRect.height}`;
    if (key !== this.dropKey) {
      this.dropKey = key;
      // `{ texture: true, textureSource: true }`, not a bare destroy(). Pixi's
      // default frees the SPRITE and leaves its GPU texture allocated, so every
      // re-bake used to orphan a board-sized texture that nothing would ever
      // collect. That is what turned the per-frame bake from "a slow frame"
      // into "fine for a few seconds, then unplayable": two textures a frame at
      // sixty frames a second is hundreds of megabytes of VRAM a second.
      this.drop?.destroy({ texture: true, textureSource: true });
      this.drop = this.bakeDrop(game);
      if (this.drop) this.underlay.addChild(this.drop);
    }
    // Only the intensity rides the flicker; re-baking per frame would be absurd.
    if (this.drop) this.drop.alpha = 0.5 + 0.25 * room.level;
  }


  private bakeDrop(game: CanvasGameState): Sprite | null {
    const { boardRect, boardRect: { scale } } = game;
    // The ROOM's light, rebuilt here from the board rect rather than accepted
    // as an argument. A caller cannot accidentally hand this a moving light,
    // which is what turned a once-per-map blur into a per-frame one.
    const light = lightScope(boardRect, 0);
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
    // The TRANSFORM is part of the identity of this bake, not just the rect.
    // Everything below is projected through w2s, and on a gravity map w2s
    // rotates while the rect stays exactly where it was - so keying on the rect
    // alone left the live-space split and the lock tints frozen at whatever
    // angle they were last traced at, while every uncached layer swung round.
    // That is the "lock that didn't fill its area". See transformKey.
    const key = `${boardRect.left},${boardRect.top},${boardRect.width},${boardRect.height}`
      + `|${transformKey(w2s)}`;
    if (!dirty && key === this.geometryKey) return;
    this.geometryKey = key;

    // ── Captured territory: the whole board, which live space is punched out of.
    this.captured.clear();
    this.captured
      .rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height)
      .fill({ color: PALETTE.captured, alpha: 1 });

    this.active.clear();
    this.locked.clear();
    this.hatch.clear();
    this.latticeMask.clear();
    this.lattice.clear();

    // Shadows are allowed over the whole board until drawLocked subtracts the
    // pockets. Rebuilt here (not per frame) because it changes only when the
    // lock state does, which is exactly what marks the board dirty.
    this.shadowMask.clear();
    this.shadowMask.rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height);
    if (!spaceGrid) {
      this.shadowMask.fill({ color: 0xffffff, alpha: 1 });
      return;
    }

    // Before the live-space trace, because a fully captured board returns early
    // below and the locked tint is exactly what you want to see on that frame.
    this.drawLocked(game, w2s);

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
    // Only FENCES and board edges. Snapping the live-space outline to obstacle
    // boundaries buys nothing - the obstacle's own body is painted over that
    // outline anyway - while doubling the chances of a point being dragged
    // somewhere it does not belong.
    const boundingWalls = game.walls.filter(w => !w.isObstacleBoundary);
    const loops = snapContoursToWalls(raw, boundingWalls, spaceGrid.cellSize * 1.8, "segment");

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
    this.active.stroke({ width: hairline(), color: PALETTE.accentDim, alpha: 0.55 });

    this.drawLattice(game, w2s);
  }

  /**
   * Territory earned by TRAPPING a ball, as opposed to merely swept up.
   *
   * The economy is lock-centric - a plain clear pays almost nothing next to a
   * lock - but until now the board drew both the same green, so the record of
   * how well a map was played was invisible the moment the lock flash faded.
   * `grid.lockCaptured` has been maintained on every cut all along, intensity
   * and all, and nothing read it.
   *
   * Intensity is the number of balls sealed in that pocket at once, and it is
   * rendered by OVERLAYING one pass per tier rather than by picking a colour per
   * count: a triple lock is covered three times and simply comes out brighter,
   * so the scale stays legible without inventing a palette for it.
   *
   * Contours get the same 1.05-cell wall snap as the lock flash, not the 1.8
   * used for live space. These are pocket-shaped, and the wider reach was what
   * dragged contour points into long stray chords on tight pockets.
   */
  private drawLocked(game: CanvasGameState, w2s: W2S): void {
    const grid = game.spaceGrid;
    const lock = grid?.lockCaptured;
    if (!grid || !lock) {
      this.shadowMask.fill({ color: 0xffffff, alpha: 1 });
      return;
    }
    const gw = grid.width;

    // Punch every locked pocket out of the shadow mask. Tier 1 and only tier 1:
    // the tiers nest, so punching each one would cancel back to visible under
    // the even-odd rule and put the shadows straight back into the pockets that
    // were locked hardest. A loop the trace returns as a HOLE in the locked
    // shape (live space enclosed by a locked ring) nests one level deeper and
    // correctly comes back as a place shadows fall again.
    for (const loop of traceLockContours(grid, game.walls)) {
      if (loop.length < 3) continue;
      this.shadowMask.poly(loop.map(p => w2s(p.x, p.y)));
    }
    this.shadowMask.fill({ color: 0xffffff, alpha: 1 });

    for (let tier = 1; tier <= LOCK_TIERS; tier++) {
      let present = false;
      for (let i = 0; i < lock.length; i++) {
        if (lock[i] >= tier) { present = true; break; }
      }
      if (!present) break; // tiers are cumulative, so nothing above this exists

      const loops = traceLockContours(grid, game.walls, tier);
      let drew = false;
      for (const loop of loops) {
        if (loop.length < 3) continue;
        this.locked.poly(loop.map(p => w2s(p.x, p.y)));
        drew = true;
      }
      if (drew) this.locked.fill({ color: PALETTE.accent, alpha: LOCK_TIER_ALPHA });
    }

    this.drawSuperiorHatch(game, w2s);
  }

  /**
   * Diagonal hatching over pockets that were sealed by a SUPERIOR lock.
   *
   * Superior locks pay double and were, once the gold flash had faded, visually
   * identical to an ordinary one: the board kept a record of how much a pocket
   * paid (lockCaptured intensity) and none at all of how well it was played.
   * Reported twice as not different enough, and both earlier passes had gone
   * into the FLASH, which is over in half a second.
   *
   * A hatch rather than another colour, because the tint is already carrying
   * intensity through brightness and a second brightness cue would collide with
   * it. Texture is a free axis: a striped pocket and a plain one read apart at
   * any tint level, and at a glance from across the board.
   *
   * Drawn per cell rather than as a clipped pattern, which sounds worse than it
   * is: this layer only redraws when the lock state changes, so the hatch is
   * built once per lock and then sits there. A Pixi mask would cost a texture
   * per pocket for the same picture.
   */
  private drawSuperiorHatch(game: CanvasGameState, w2s: W2S): void {
    const grid = game.spaceGrid;
    const sup = grid?.superiorCaptured;
    if (!grid || !sup) return;

    const size = grid.cellSize;
    let drew = false;
    for (let i = 0; i < sup.length; i++) {
      if (!sup[i]) continue;
      const col = i % grid.width;
      const row = (i / grid.width) | 0;
      // Every other anti-diagonal, so the stripes sit about a cell and a half
      // apart instead of packing into a solid wash at cell resolution.
      if (((col + row) & 1) !== 0) continue;
      const x = grid.originX + col * size;
      const y = grid.originY + row * size;
      const a = w2s(x, y + size);
      const b = w2s(x + size, y);
      this.hatch.moveTo(a.x, a.y).lineTo(b.x, b.y);
      drew = true;
    }
    if (drew) {
      this.hatch.stroke({ width: SUPERIOR_HATCH_WIDTH, color: PALETTE.superior, alpha: 0.5 });
    }
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
    g.stroke({ width: hairline(), color: PALETTE.grid, alpha: 0.6 });
  }

  /**
   * The monitor's wash: a baked radial falloff multiplied over the board, so
   * the bottom-right corner sits nearest the light and the top-left falls into
   * shadow. Baked once per board size; the per-frame flicker only rides on the
   * sprite's alpha, which costs nothing.
   */
  private syncWash(game: CanvasGameState, room: LightScope): void {
    const { boardRect } = game;
    // Board size ONLY. The bake is a radial gradient, which is rotationally
    // symmetric, so where the light is can be expressed by MOVING the sprite
    // rather than re-drawing it - and that is the difference between a canvas
    // allocation per frame and one per map.
    const key = `${boardRect.width}x${boardRect.height}`;
    if (key !== this.washKey) {
      this.washKey = key;
      this.wash?.destroy({ texture: true, textureSource: true });
      this.wash = this.bakeWash();
      if (this.wash) this.container.addChild(this.wash);
    }
    if (!this.wash) return;

    // Scaled so the gradient's outer stop lands on the furthest board corner,
    // which is exactly what the old per-position bake computed as `far`. Same
    // picture, no bake. Every board pixel is inside `far` of the light by that
    // definition, so the circle always covers the whole board.
    const lx = room.x - boardRect.left;
    const ly = room.y - boardRect.top;
    const far = Math.hypot(
      Math.max(lx, boardRect.width - lx),
      Math.max(ly, boardRect.height - ly),
    );
    this.wash.position.set(room.x, room.y);
    this.wash.scale.set(Math.max(1e-3, far) / WASH_BAKE_RADIUS);
    // Brighter monitor = less darkening; see washSpriteAlpha.
    this.wash.alpha = washSpriteAlpha(room.level);
  }

  /**
   * One unit radial, centred in its own texture. Callers place and scale it.
   *
   * No light in the signature, on purpose. The stops are the shadow colour
   * throughout (the innermost is fully transparent, so the colour it nominally
   * carried never showed), and the geometry is a plain circle. Nothing about it
   * CAN depend on where the light is, which is what makes it safe to bake once.
   */
  private bakeWash(): Sprite | null {
    const size = WASH_BAKE_RADIUS * 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const r = WASH_BAKE_RADIUS;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    // Stops come from boardWash.ts, which states them as the effective alpha a
    // player sees rather than as raw stops: a stop means nothing without the
    // sprite alpha it is multiplied by, and that moves with the flicker.
    for (const stop of washStops()) {
      grad.addColorStop(stop.offset, withAlpha(PALETTE.shadow, stop.alpha));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const sprite = new Sprite(Texture.from(canvas));
    sprite.anchor.set(0.5);
    // Ambient occlusion of the whole surface: strictly subtractive.
    sprite.blendMode = "multiply";
    return sprite;
  }


  /** Ambient level under an object, for layers that tint themselves by it. */
  static ambient(light: LightScope, x: number, y: number): number {
    return ambientAt(light, x, y);
  }

  destroy(): void {
    this.wash?.destroy({ texture: true, textureSource: true });
    this.drop?.destroy({ texture: true, textureSource: true });
    this.container.destroy({ children: true });
    this.underlay.destroy({ children: true });
  }
}
