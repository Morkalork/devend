/**
 * The whole-scene transition: the shatter.
 *
 * It works by SNAPSHOTTING the scene rather than continuing to draw it, which
 * is what keeps it cheap and — more importantly — what makes it look like
 * something happening TO the board rather than the board carrying on underneath
 * an overlay. Once it owns the frame, the live scene stops rendering entirely.
 *
 * It is also a place the light model deliberately stops applying: a board
 * flying apart in pieces is no longer a lit surface with objects on it.
 */

import {
  Container,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
  CanvasSource,
} from "pixi.js";
import type { DissolveState } from "@/types/game";
import { DISSOLVE_DURATION } from "@/lib/gameConstants";

/**
 * Shatter: the frame breaks into tiles that fly apart.
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
    const anim = elapsed;

    for (let i = 0; i < dissolve.tiles.length; i++) {
      const tile = dissolve.tiles[i];
      const s = this.sprites[i];
      if (!s) continue;
      const t = Math.max(0, anim - tile.delay);
      const tMax = dur - tile.delay;
      const progress = tMax > 0 ? Math.min(1, t / tMax) : 1;
      // Shards fade as they scatter.
      s.alpha = Math.max(0, 1 - progress * 1.15);
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
