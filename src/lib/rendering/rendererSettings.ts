// Renderer flag — which implementation draws the game board.
//
// 'pixi' (the WebGL port, src/lib/rendering/pixi/) is the default: native
// device resolution + the bloom pass. 'canvas2d' (renderFrame.ts) remains as
// the opt-out escape hatch and the automatic fallback when WebGL init fails
// (GameCanvas handles that per session). The choice is read ONCE when
// GameCanvas mounts, so switching requires a remount: the Playground toggle
// bumps its gameKey, a real game needs a reload.
//
// Precedence: ?renderer= query param (one-shot, also persisted) > localStorage
// > default. Persisting the query override makes `?renderer=canvas2d` sticky
// for on-device Android testing where editing localStorage is awkward.

export type RendererKind = "canvas2d" | "pixi";

const LS_RENDERER = "devend:renderer";
const DEFAULT_RENDERER: RendererKind = "pixi";

function isRendererKind(v: string | null): v is RendererKind {
  return v === "canvas2d" || v === "pixi";
}

/** The renderer to use for this session. */
export function getRenderer(): RendererKind {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("renderer");
    if (isRendererKind(fromQuery)) {
      setRenderer(fromQuery);
      return fromQuery;
    }
    const stored = localStorage.getItem(LS_RENDERER);
    if (isRendererKind(stored)) return stored;
  } catch {
    /* private mode / no window: fall through to default */
  }
  return DEFAULT_RENDERER;
}

/** Persist the renderer choice. Takes effect on the next GameCanvas mount. */
export function setRenderer(kind: RendererKind): void {
  try {
    localStorage.setItem(LS_RENDERER, kind);
  } catch {
    /* private mode: the choice just won't persist */
  }
}
