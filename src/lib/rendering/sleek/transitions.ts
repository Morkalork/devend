/**
 * The two whole-scene transitions: the level-clear sweep and the shatter.
 *
 * Both work by SNAPSHOTTING the scene rather than continuing to draw it, which
 * is what keeps them cheap and — more importantly — what makes them look like
 * something happening TO the board rather than the board carrying on underneath
 * an overlay. Once a transition owns the frame, the live scene stops rendering
 * entirely.
 *
 * They are also the two places the light model deliberately stops applying: a
 * board being drained of colour, or flying apart in pieces, is no longer a lit
 * surface with objects on it.
 */

import {
  Application,
  ColorMatrixFilter,
  Container,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  TextureSource,
  CanvasSource,
} from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { DissolveState } from "@/types/game";
import { LEVEL_CLEAR_SHIMMER_MS, DISSOLVE_DURATION } from "@/lib/gameConstants";
import { PALETTE } from "./palette";

/**
 * Level-clear sweep: a luminous wave crosses the board, draining everything
 * behind it to grey.
 *
 * Both looks are baked ONCE when the sweep starts - the live scene, and a
 * desaturated copy of it - so every frame after that is two textured quads with
 * the drained one cropped at the wave line. No filters or re-tessellation per
 * frame, which matters because this fires at the exact moment the player is
 * being congratulated and a hitch would be very visible.
 */
export class SweepTransition {
  private live: RenderTexture | null = null;
  private drained: RenderTexture | null = null;
  private below: Sprite | null = null;
  private above: Sprite | null = null;
  private aboveMask: Graphics | null = null;
  private wave: Graphics | null = null;
  private key = 0;

  get active(): boolean {
    return this.live !== null;
  }

  /**
   * Build (once) and advance the sweep. `scene` is the container holding the
   * live board, hidden for the duration.
   */
  render(
    app: Application,
    scene: Container,
    game: CanvasGameState,
    now: number,
  ): void {
    const { left: bl, top: bt, width: bw, height: bh, scale } = game.boardRect;
    const W = app.renderer.width;
    const H = app.renderer.height;

    if (!this.live || this.key !== game.shimmerStart) {
      this.teardown();
      this.key = game.shimmerStart;

      this.live = RenderTexture.create({ width: W, height: H });
      app.renderer.render({ container: scene, target: this.live });

      // Desaturated + lifted: the wake reads as colour drained out, not as a
      // shadow falling over it.
      this.drained = RenderTexture.create({ width: W, height: H });
      const tmp = new Sprite(this.live);
      const grey = new ColorMatrixFilter();
      grey.desaturate();
      grey.brightness(1.25, true);
      tmp.filters = [grey];
      app.renderer.render({ container: tmp, target: this.drained });
      tmp.destroy();
      // Pixi does not free a display object's filters on destroy().
      grey.destroy();

      this.below = new Sprite(this.live);
      this.above = new Sprite(this.drained);
      this.aboveMask = new Graphics();
      this.above.mask = this.aboveMask;
      this.wave = new Graphics();
      this.wave.blendMode = "add";
      app.stage.addChild(this.below, this.above, this.aboveMask, this.wave);
      scene.visible = false;
    }

    const elapsed = Math.min(now - game.shimmerStart, LEVEL_CLEAR_SHIMMER_MS);
    const progress = Math.max(0, Math.min(1, elapsed / LEVEL_CLEAR_SHIMMER_MS));
    const waveY = bt + bh * progress;

    // Crop by MASK, not by mutating texture.frame: a sprite keeps scaling by
    // its texture's original size, so a cropped frame stretches the slice.
    const split = Math.max(0, Math.min(H, Math.round(waveY)));
    if (this.above && this.aboveMask) {
      this.above.visible = split > 0;
      if (split > 0) this.aboveMask.clear().rect(0, 0, W, split).fill({ color: 0xffffff });
    }

    const w = this.wave;
    if (!w) return;
    w.clear();
    if (progress >= 1) return;
    const bandH = 46 * scale;
    const peak = Math.sin(progress * Math.PI);
    w.rect(bl, Math.max(bt, waveY - bandH), bw, Math.min(bandH, waveY - bt))
      .fill({ color: PALETTE.accent, alpha: 0.25 * (0.4 + peak * 0.6) })
      .moveTo(bl, waveY).lineTo(bl + bw, waveY)
      .stroke({ width: 3 * scale, color: 0xffffff, alpha: 0.85 })
      .moveTo(bl, waveY).lineTo(bl + bw, waveY)
      .stroke({ width: 9 * scale, color: PALETTE.accent, alpha: 0.35 });
  }

  teardown(): void {
    this.below?.destroy();
    this.above?.destroy();
    this.aboveMask?.destroy();
    this.wave?.destroy();
    this.live?.destroy(true);
    this.drained?.destroy(true);
    this.below = this.above = null;
    this.aboveMask = this.wave = null;
    this.live = this.drained = null;
  }
}

/**
 * Shatter: the frame breaks into tiles that fly apart (or, reversed, fly IN and
 * settle — the run-start assemble).
 *
 * Tile kinematics mirror the ones the game loop already uses, so the physics
 * hold and the animation agree on when it is finished.
 */
export class ShatterTransition {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private forState: DissolveState | null = null;
  /** Only a source WE created may be destroyed here; a GPU one is borrowed. */
  private ownedSource: CanvasSource | null = null;

  render(dissolve: DissolveState, now: number, gpuSource?: TextureSource): void {
    if (this.forState !== dissolve) {
      this.clear();
      this.forState = dissolve;
      // An explicit source (rather than Texture.from) keeps these out of Pixi's
      // global texture cache, which would otherwise hand the same texture to a
      // later level's dissolve.
      const source = gpuSource
        ?? (this.ownedSource = new CanvasSource({ resource: dissolve.captured }));
      for (const tile of dissolve.tiles) {
        const s = new Sprite(new Texture({
          source,
          frame: new Rectangle(tile.sx, tile.sy, tile.sw, tile.sh),
        }));
        s.anchor.set(0.5);
        this.sprites.push(s);
        this.container.addChild(s);
      }
    }

    const elapsed = (now - dissolve.startTime) / 1000;
    const dur = DISSOLVE_DURATION / 1000;
    // Reverse (the run-start assemble) plays the same kinematics backwards, so
    // the tiles fly in from the scattered end-state and settle into place.
    const anim = dissolve.reverse ? Math.max(0, dur - elapsed) : elapsed;

    for (let i = 0; i < dissolve.tiles.length; i++) {
      const tile = dissolve.tiles[i];
      const s = this.sprites[i];
      if (!s) continue;
      const t = Math.max(0, anim - tile.delay);
      const tMax = dur - tile.delay;
      const progress = tMax > 0 ? Math.min(1, t / tMax) : 1;
      // Forward: shards fade as they scatter. Reverse: they must stay SOLID
      // while flying together - mirroring the fade leaves them nearly invisible
      // for most of the flight and the assemble reads as a soft blur instead of
      // shards. Only a short fade-in stops the scattered cloud popping in.
      s.alpha = dissolve.reverse
        ? Math.max(0, Math.min(1, elapsed / 0.2))
        : Math.max(0, 1 - progress * 1.15);
      s.position.set(tile.cx + tile.vx * t, tile.cy + tile.vy * t + 400 * t * t);
      s.rotation = tile.rotSpeed * t;
    }
  }

  clear(): void {
    if (!this.forState && this.sprites.length === 0) return; // called every idle frame
    for (const s of this.sprites) {
      s.texture.destroy(); // the per-tile frame texture only
      s.destroy();
    }
    this.sprites = [];
    this.ownedSource?.destroy();
    this.ownedSource = null;
    this.forState = null;
  }
}
