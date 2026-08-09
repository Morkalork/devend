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

import { Application, Container, Graphics, RenderTexture } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { RenderContext } from "../types";
import { BoardLayer } from "./boardLayer";
import { WallLayer } from "./wallLayer";
import { EntityLayer } from "./entityLayer";
import { AreaLayer } from "./areaLayer";
import { SleekBallLayer, clearSphereCache } from "./ballLayer";
import { ObjectLayer } from "./objectLayer";
import { PropLayer } from "./propLayer";
import { FxLayer } from "./fxLayer";
import { ChromeLayer } from "./chromeLayer";
import { SweepTransition, ShatterTransition } from "./transitions";
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
  private props = new PropLayer();
  private entities = new EntityLayer();
  private objects = new ObjectLayer();
  private walls = new WallLayer();
  private fx = new FxLayer();
  private balls = new SleekBallLayer();
  private chrome = new ChromeLayer();

  private sweep = new SweepTransition();
  private shatter = new ShatterTransition();
  /** GPU snapshot for the shatter, taken by captureForDissolve. */
  private shatterRT: RenderTexture | null = null;

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

    // Draw order: surface, floor markings, props, furniture, fences, effects,
    // then the actors on top. Chrome lives OUTSIDE the board mask, because the
    // rim and the space bar deliberately sit on and past the board edge.
    this.boardScope.addChild(
      this.board.container,
      this.areas.container,
      this.props.container,
      this.entities.container,
      this.objects.container,
      this.walls.container,
      this.fx.container,
      this.balls.container,
      // Rim + danger frame: masked with the board, so their wide halo strokes
      // clip at the edge instead of blooming out over the page.
      this.chrome.container,
    );
    this.root.addChild(this.boardScope, this.boardMask);
    this.boardScope.mask = this.boardMask;
    // The board's drop shadow falls on the page BEHIND the board, so it is a
    // stage-level underlay added before everything else. The space bar is the
    // one piece of chrome that belongs outside the board on top. The shatter
    // sits above everything: while it runs, it IS the frame.
    this.app.stage.addChild(
      this.board.underlay,
      this.root,
      this.chrome.outer,
      this.shatter.container,
    );

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

  render(game: CanvasGameState, rctx: RenderContext): void {
    if (!this.ready) return;
    const now = performance.now();

    // ── Shatter owns the whole frame ────────────────────────────────────────
    if (game.dissolve) {
      // A sweep in flight becomes the shatter's source: its drained slices are
      // what the tiles are cut from.
      if (this.sweep.active) this.teardownSweep();
      this.root.visible = false;
      this.board.underlay.visible = false;
      this.chrome.outer.visible = false;
      this.shatter.render(game.dissolve, now, this.shatterRT?.source);
      this.app.render();
      return;
    }
    // Nothing in flight: release transition resources and restore the scene.
    this.shatter.clear();
    this.clearShatterRT();
    this.root.visible = true;
    this.board.underlay.visible = true;
    this.chrome.outer.visible = true;

    // ── Level-clear sweep ───────────────────────────────────────────────────
    // shimmerStart can sit in the FUTURE (it waits for lock flashes to finish),
    // so keep rendering live until the sweep actually begins.
    if (game.shimmerStart > 0 && now >= game.shimmerStart) {
      this.sweep.render(this.app, this.root, game, now);
      this.app.render();
      return;
    }
    if (this.sweep.active) this.teardownSweep();

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
    this.props.sync(game, light, w2s, scale, now);
    this.entities.sync(game, light, w2s, scale);
    this.objects.sync(game, light, w2s, scale);
    this.walls.sync(game, light, w2s, scale);
    this.fx.sync(game, light, rctx.activeModifiers, w2s, scale, now);
    this.balls.sync(game, light, w2s, scale, now);
    this.chrome.sync(game, light, scale, now, rctx.spaceThreshold);
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
      ["bossSplash", game.bossActive],
      ["damageCracks", game.destructibles.some(d => d.hits > 0)],
    ];
    for (const [name, present] of check) {
      if (present && !this.reportedMissing.has(name)) {
        this.reportedMissing.add(name);
        console.info(`[sleek] not yet ported: ${name}`);
      }
    }
  }

  /** Restore the live scene after a sweep and drop its baked textures. */
  private teardownSweep(): void {
    this.sweep.teardown();
    this.root.visible = true;
  }

  private clearShatterRT(): void {
    this.shatterRT?.destroy(true);
    this.shatterRT = null;
  }

  /** Blank frame (used between levels), so the canvas is never a stale image. */
  presentEmpty(): void {
    if (!this.ready) return;
    this.teardownSweep();
    this.shatter.clear();
    this.clearShatterRT();
    this.root.visible = false;
    this.app.renderer.background.color = PALETTE.boardVoid;
    this.app.render();
  }

  /**
   * GPU snapshot of whatever is currently presented - the drained sweep after a
   * level clear, or the live scene on game over - for the shatter tiles to be
   * cut from.
   *
   * Snapshotting on the GPU rather than reading the canvas back matters: a
   * drawImage(webglCanvas) readback stalls the pipeline, and it stalls it at
   * exactly the frame the shatter is supposed to start, which is the most
   * visible possible moment for a hitch.
   */
  captureForDissolve(_tint?: string): void {
    if (!this.ready) return;
    this.clearShatterRT();
    this.shatterRT = RenderTexture.create({
      width: this.app.renderer.width,
      height: this.app.renderer.height,
    });
    this.app.renderer.render({ container: this.app.stage, target: this.shatterRT });
  }

  destroy(): void {
    clearSphereCache();
    this.sweep.teardown();
    this.shatter.clear();
    this.clearShatterRT();
    this.board.destroy();
    this.areas.destroy();
    this.props.destroy();
    this.entities.destroy();
    this.objects.destroy();
    this.walls.destroy();
    this.fx.destroy();
    this.balls.destroy();
    this.chrome.destroy();
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* half-initialised app */
    }
    this.ready = false;
  }
}
