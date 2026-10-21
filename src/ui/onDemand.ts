/**
 * The interface canvas draws only when something on it changed.
 *
 * It drew every display frame, a full-screen antialiased pass at the screen's
 * native resolution (up to 3x), on every menu and over every map, for a HUD
 * whose pixels mostly sit still. Pixi already knows when anything changed:
 * every property set, text change, layout change and child added or removed
 * marks the object's render group, and drawing clears the marks. So the
 * ticker keeps running (scroll momentum and the kit's tweens need it), and the
 * draw is skipped on a frame where no render group has a mark.
 *
 * Admin can turn it off (Interface draws on demand), so "something did not
 * update" can be told apart from "this changed nothing" on a real device.
 */
import { UPDATE_PRIORITY, type Application, type Container } from "pixi.js";

const KEY = "devend:uiOnDemand";

export function isUiOnDemandEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function setUiOnDemandEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "0");
  } catch { /* storage blocked: stays on */ }
}

/** The render-group bookkeeping this reads (pixi.js scene/container/RenderGroup). */
interface RenderGroupMarks {
  structureDidChange: boolean;
  childrenToUpdate: Record<string, { index: number }>;
  childrenRenderablesToUpdate: { index: number };
  renderGroupChildren: RenderGroupMarks[];
}

/** Has anything in this render group, or one nested in it, changed since it was last drawn? */
export function renderGroupChanged(rg: RenderGroupMarks | null | undefined): boolean {
  if (!rg) return true;
  if (rg.structureDidChange || rg.childrenRenderablesToUpdate.index > 0) return true;
  for (const depth in rg.childrenToUpdate) if (rg.childrenToUpdate[depth].index > 0) return true;
  for (const child of rg.renderGroupChildren) if (renderGroupChanged(child)) return true;
  return false;
}

let forced = 0;
let draws = 0;

/** Draw the next frame or two whatever the marks say (a change Pixi cannot see). */
export function requestUiRender(): void { forced = Math.max(forced, 2); }

/** Frames actually drawn since load: for the perf readout and the tests. */
export function uiDrawCount(): number { return draws; }
if (import.meta.env.DEV) (window as unknown as { __uiDraws?: () => number }).__uiDraws = () => draws;

/** Swap the application's every-frame draw for the on-demand one. Returns the undo. */
export function installOnDemandRender(app: Application): () => void {
  const ticker = app.ticker;
  const stage = app.stage as Container & { renderGroup?: RenderGroupMarks };
  forced = 2;
  const onResize = () => requestUiRender();
  app.renderer.on("resize", onResize);
  const draw = () => {
    if (forced > 0 || renderGroupChanged(stage.renderGroup)) {
      if (forced > 0) forced--;
      draws++;
      app.render();
    }
  };
  ticker.remove(app.render, app);
  ticker.add(draw, null, UPDATE_PRIORITY.LOW);
  return () => {
    ticker.remove(draw, null);
    app.renderer.off("resize", onResize);
    ticker.add(app.render, app, UPDATE_PRIORITY.LOW);
  };
}
