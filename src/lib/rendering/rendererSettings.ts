// Renderer flag — which implementation draws the game board.
//
// 'sleek' (src/lib/rendering/sleek/) is THE DEFAULT: device-pixel-exact
// geometry (crisp on axis, antialiased on the diagonal) lit by a single
// off-screen monitor past the bottom-right corner, over a gently translucent
// board. See SleekRenderer's header for the model.
//
// 'pixi' (src/lib/rendering/pixi/) is the previous WebGL renderer - native
// resolution plus a bloom pass. Kept selectable with ?renderer=pixi, both as a
// comparison and because it still draws several board effects sleek has not
// ported (see SleekRenderer's header for that list).
//
// 'canvas2d' (renderFrame.ts) remains the opt-out escape hatch and the
// automatic fallback when WebGL init fails (GameCanvas handles that per
// session). The choice is read ONCE when GameCanvas mounts, so switching
// requires a remount: the Playground toggle bumps its gameKey, a real game
// needs a reload.
//
// NOTE for anyone changing the default back: a stored localStorage value always
// beats it, so players who ever loaded ?renderer=... are pinned to that choice
// until they clear it. The default only reaches players who never picked one.
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
const DEFAULT_RENDERER: RendererKind = "sleek";

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
