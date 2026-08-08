// Renderer flag — which implementation draws the game board.
//
// 'pixi' (the WebGL port, src/lib/rendering/pixi/) is the default: native
// device resolution + the bloom pass. 'canvas2d' (renderFrame.ts) remains as
// the opt-out escape hatch and the automatic fallback when WebGL init fails
// (GameCanvas handles that per session). The choice is read ONCE when
// GameCanvas mounts, so switching requires a remount: the Playground toggle
// bumps its gameKey, a real game needs a reload.
//
// 'sleek' (src/lib/rendering/sleek/) is the EXPERIMENTAL board rewrite: same
// WebGL plumbing as 'pixi', but device-pixel-exact geometry and a single
// off-screen light source. Select it with ?renderer=sleek. It is a vertical
// slice - see SleekRenderer's header for what it does not draw yet - so it is
// not a candidate for the default until that list is empty.
//
// POLICY (decided): canvas2d is the FALLBACK ONLY. It stays load-bearing for
// three reasons - the WebGL-init fallback (old Android WebViews), the intro
// fly-in capture (renderFrame draws the tile snapshot even under Pixi), and
// being the reference the Pixi layer was ported from. But it is NOT held at
// visual parity: new board cosmetics go Pixi-FIRST, and the 2D path only needs
// a plain/functional version (playable + legible), not a pixel match. Don't
// spend effort making the two identical.
//
// Precedence: ?renderer= query param (one-shot, also persisted) > localStorage
// > default. Persisting the query override makes `?renderer=canvas2d` sticky
// for on-device Android testing where editing localStorage is awkward.

export type RendererKind = "canvas2d" | "pixi" | "sleek";

const LS_RENDERER = "devend:renderer";
const DEFAULT_RENDERER: RendererKind = "pixi";

function isRendererKind(v: string | null): v is RendererKind {
  return v === "canvas2d" || v === "pixi" || v === "sleek";
}

/** True for the WebGL-backed renderers (both share GameCanvas's pixi path). */
export function isWebGLRenderer(kind: RendererKind): boolean {
  return kind === "pixi" || kind === "sleek";
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
