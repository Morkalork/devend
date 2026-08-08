/**
 * SleekRenderer — the experimental board renderer.
 *
 * Implements the same 8-member contract GameCanvas already drives the Pixi
 * renderer through (init / resize / render / destroy / markStaticDirty /
 * presentEmpty / captureForDissolve / isReady), so it drops in behind the
 * existing `devend:renderer` flag as a third option with no changes to the game
 * loop, input mapping or physics.
 *
 * WHAT MAKES IT "SLEEK", in priority order:
 *
 * 1. PIXEL DISCIPLINE. The surface is created at `resolution: 1` over a canvas
 *    GameCanvas sized in physical pixels, so this coordinate space IS the device
 *    pixel grid. Axis-aligned geometry snaps to it exactly (see pixelGrid.ts);
 *    diagonals and curves are left unsnapped and resolved by MSAA at native DPR.
 *    Crisp where crispness is possible, smooth where it isn't - never the blurry
 *    half-pixel middle, and never a quantised diagonal.
 *
 * 2. ONE LIGHT. A single off-screen monitor past the bottom-right corner (see
 *    light.ts) owns every shadow, rim and wash in the scene. Layers are handed
 *    the same LightScope object each frame; none may invent its own.
 *
 * 3. ONE PALETTE. Every colour comes from palette.ts.
 *
 * DELIBERATELY NOT YET PORTED (this is the vertical slice): breakables, mirrors,
 * debris, pickups, chests, circuits, charges, data streams, phasing objects,
 * chains, lock-flash assimilations, the level-clear sweep, the shatter dissolve,
 * ambient rain and the perf HUD. `missingFeatures()` reports what a given board
 * would have needed, so finishing the tail is a checklist rather than a hunt.
 */

import { Application, Container, Graphics } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { RenderContext } from "../types";
import { BoardLayer } from "./boardLayer";
import { WallLayer } from "./wallLayer";
import { EntityLayer } from "./entityLayer";
import { AreaLayer } from "./areaLayer";
import { SleekBallLayer, clearSphereCache } from "./ballLayer";
import { lightScope } from "./light";
import { PALETTE } from "./palette";

export class SleekRenderer {
  private app = new Application();
  private ready = false;
  private pendingSize: { w: number; h: number } | null = null;

  private root = new Container();
  private boardScope = new Container();
  private boardMask = new Graphics();

  private board = new BoardLayer();
  private areas = new AreaLayer();
  private entities = new EntityLayer();
  private walls = new WallLayer();
  private balls = new SleekBallLayer();

  private staticDirty = true;
  private maskKey = "";
  private reportedMissing = new Set<string>();

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.app.init({
      canvas,
      width,
      height,
      // The whole point: MSAA is what resolves a diagonal fence into one clean
      // edge instead of a staircase. Non-negotiable for this renderer.
      antialias: true,
      backgroundAlpha: 0,
      // 1:1 with the physical canvas, so renderer coordinates ARE device pixels
      // and `Math.round` is an exact hardware-pixel snap.
      resolution: 1,
      autoDensity: false,
      preserveDrawingBuffer: false,
      autoStart: false,
      sharedTicker: false,
      powerPreference: "high-performance",
    });
    this.app.ticker.stop(); // the game loop drives presentation

    // Draw order: surface, floor markings, furniture, fences, then actors.
    this.boardScope.addChild(
      this.board.container,
      this.areas.container,
      this.entities.container,
      this.walls.container,
      this.balls.container,
    );
    this.root.addChild(this.boardScope, this.boardMask);
    this.boardScope.mask = this.boardMask;
    this.app.stage.addChild(this.root);

    // No bloom pass. The classic renderer leans on it to sell the neon; here the
    // form is carried by the light model, and a bloom would smear exactly the
    // crisp edges this renderer exists to produce.

    this.ready = true;
    if (this.pendingSize) {
      this.resize(this.pendingSize.w, this.pendingSize.h);
      this.pendingSize = null;
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  resize(widthPx: number, heightPx: number): void {
    if (!this.ready) {
      this.pendingSize = { w: widthPx, h: heightPx };
      return;
    }
    if (this.app.renderer.width === widthPx && this.app.renderer.height === heightPx) return;
    this.app.renderer.resize(widthPx, heightPx);
    // Every bake is sized in device pixels, so a real resize invalidates all.
    clearSphereCache();
    this.staticDirty = true;
    this.maskKey = "";
  }

  markStaticDirty(): void {
    this.staticDirty = true;
  }

  render(game: CanvasGameState, _rctx: RenderContext): void {
    if (!this.ready) return;
    const now = performance.now();
    const { boardRect } = game;
    const scale = boardRect.scale;

    // ONE light for the whole frame, sampled once so the flicker can't drift
    // between layers.
    const light = lightScope(boardRect, now);

    const w2s = (x: number, y: number) => ({
      x: boardRect.left + x * scale,
      y: boardRect.top + y * scale,
    });

    this.syncMask(game);

    this.board.sync(game, light, w2s, this.staticDirty);
    this.areas.sync(game, light, w2s, scale);
    this.entities.sync(game, light, w2s, scale);
    this.walls.sync(game, light, w2s, scale);
    this.balls.sync(game, light, w2s, scale);
    this.staticDirty = false;

    this.noteMissing(game);

    this.app.render();
  }

  /** Clip everything to the board polygon so nothing bleeds into the margin. */
  private syncMask(game: CanvasGameState): void {
    const { boardRect, boardPolygon } = game;
    const key = `${boardRect.left},${boardRect.top},${boardRect.width},${boardRect.height},${boardPolygon?.vertices.length ?? 0}`;
    if (key === this.maskKey) return;
    this.maskKey = key;

    this.boardMask.clear();
    if (boardPolygon && boardPolygon.vertices.length >= 3) {
      this.boardMask
        .poly(
          boardPolygon.vertices.map(v => ({
            x: Math.round(boardRect.left + v.x * boardRect.scale),
            y: Math.round(boardRect.top + v.y * boardRect.scale),
          })),
        )
        .fill({ color: 0xffffff });
    } else {
      this.boardMask
        .rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height)
        .fill({ color: 0xffffff });
    }
  }

  /**
   * Log board features this slice does not draw yet, once each per session.
   * A silently missing mechanic is far worse than a noisy console: a chest that
   * simply isn't rendered looks like a physics bug, not an unfinished renderer.
   */
  private noteMissing(game: CanvasGameState): void {
    const check: Array<[string, boolean]> = [
      ["breakables", game.destructibles.length > 0],
      ["mirrors", game.mirrorPolygons.length > 0],
      ["phasing", (game.phasingObjects?.length ?? 0) > 0],
      ["circuit", !!game.circuit],
      ["charges", (game.charges?.length ?? 0) > 0],
      ["dataStream", !!game.dataStream],
      ["pickups", (game.pickups?.length ?? 0) > 0],
      ["lockFlash", game.assimilations.size > 0],
      ["dissolve", !!game.dissolve],
    ];
    for (const [name, present] of check) {
      if (present && !this.reportedMissing.has(name)) {
        this.reportedMissing.add(name);
        console.info(`[sleek] not yet ported: ${name}`);
      }
    }
  }

  /** Blank frame (used between levels), so the canvas is never a stale image. */
  presentEmpty(): void {
    if (!this.ready) return;
    this.boardScope.visible = false;
    this.app.renderer.background.color = PALETTE.boardVoid;
    this.app.render();
    this.boardScope.visible = true;
  }

  /**
   * The shatter dissolve is not ported yet. GameCanvas calls this before its
   * transition and then drives the effect itself, so a no-op degrades to "no
   * shatter" rather than breaking the level change.
   */
  captureForDissolve(_tint?: string): void {
    /* not ported in this slice */
  }

  destroy(): void {
    clearSphereCache();
    this.board.destroy();
    this.areas.destroy();
    this.entities.destroy();
    this.walls.destroy();
    this.balls.destroy();
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* half-initialised app */
    }
    this.ready = false;
  }
}
