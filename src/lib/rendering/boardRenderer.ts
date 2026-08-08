/**
 * The contract GameCanvas drives a WebGL board renderer through.
 *
 * Both PixiGameRenderer and the experimental SleekRenderer implement it, which
 * is what lets the renderer flag pick between them without GameCanvas knowing
 * anything about either. Extracted from the shape GameCanvas already used, so
 * it documents an existing arrangement rather than imposing a new one.
 */

import type { CanvasGameState } from "@/types/gameState";
import type { RenderContext } from "./types";

export interface BoardRenderer {
  /** True once the WebGL context is live and the scene graph is built. */
  readonly isReady: boolean;
  /** Attach to a canvas already sized in PHYSICAL pixels. */
  init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void>;
  /** Physical-pixel dimensions; a same-size call must be a no-op. */
  resize(widthPx: number, heightPx: number): void;
  /** Draw and present one frame. */
  render(game: CanvasGameState, rctx: RenderContext): void;
  /** GameCanvas repainted the shared board-grid / region OffscreenCanvases. */
  markStaticDirty(): void;
  /** Present a blank board (between levels). */
  presentEmpty(): void;
  /** Snapshot the current frame for the shatter transition. */
  captureForDissolve(tint?: string): void;
  destroy(): void;
}
