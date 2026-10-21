/**
 * The interface canvas draws only when something on it changed (ui/onDemand.ts),
 * and the board canvas's resolution follows the quality tier.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { Container, Graphics, Text } from "pixi.js";
import { installOnDemandRender, renderGroupChanged, uiDrawCount, isUiOnDemandEnabled, setUiOnDemandEnabled } from "@/ui/onDemand";
import { boardPixelRatioCap, setQualitySetting } from "@/lib/rendering/render3dSettings";

type Marks = Parameters<typeof renderGroupChanged>[0];
/** What Pixi's render pass does to the marks: draws, then clears them. */
function drawn(stage: Container): void {
  const rg = (stage as unknown as { renderGroup: NonNullable<Marks> & { childrenToUpdate: Record<string, { index: number }> } }).renderGroup;
  rg.structureDidChange = false;
  rg.childrenRenderablesToUpdate.index = 0;
  for (const d in rg.childrenToUpdate) rg.childrenToUpdate[d].index = 0;
  // ...and each object's own flags, which Pixi checks before marking it again.
  const clear = (c: Container) => {
    const f = c as unknown as { didChange: boolean; didViewUpdate?: boolean };
    f.didChange = false;
    if (f.didViewUpdate !== undefined) f.didViewUpdate = false;
    for (const k of c.children) clear(k);
  };
  for (const k of stage.children) clear(k);
}
const marks = (stage: Container) => (stage as unknown as { renderGroup: Marks }).renderGroup;

describe("what counts as a change", () => {
  let stage: Container;
  let box: Graphics;
  let label: Text;
  beforeEach(() => {
    stage = new Container({ isRenderGroup: true });
    box = new Graphics().rect(0, 0, 10, 10).fill(0xffffff);
    label = new Text({ text: "12" });
    stage.addChild(box, label);
    drawn(stage);
  });

  it("nothing touched is no change", () => {
    expect(renderGroupChanged(marks(stage))).toBe(false);
  });

  it("a moved, faded or rescaled object is", () => {
    box.x = 4;
    expect(renderGroupChanged(marks(stage))).toBe(true);
    drawn(stage);
    box.alpha = 0.5;
    expect(renderGroupChanged(marks(stage))).toBe(true);
  });

  it("new text is", () => {
    label.text = "13";
    expect(renderGroupChanged(marks(stage))).toBe(true);
  });

  it("a child added or removed is", () => {
    stage.addChild(new Container());
    expect(renderGroupChanged(marks(stage))).toBe(true);
  });

  it("a redrawn shape is", () => {
    box.clear().circle(0, 0, 4).fill(0xff0000);
    expect(renderGroupChanged(marks(stage))).toBe(true);
  });
});

describe("the application's draw", () => {
  it("is swapped for one that draws only on change, and swapped back on undo", () => {
    const stage = new Container({ isRenderGroup: true });
    const listeners: Array<() => void> = [];
    let renders = 0;
    const app = {
      stage,
      render: () => { renders++; drawn(stage); },
      renderer: { on: () => {}, off: () => {} },
      ticker: {
        add: (fn: () => void) => { listeners.push(fn); },
        remove: (fn: () => void) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      },
    };
    listeners.push(app.render);
    const undo = installOnDemandRender(app as never);
    const tick = (n: number) => { for (let i = 0; i < n; i++) for (const l of [...listeners]) l(); };
    tick(2);           // the first frames always draw
    const before = renders;
    tick(30);
    expect(renders).toBe(before);      // nothing changed: nothing drawn
    stage.addChild(new Container());
    tick(1);
    expect(renders).toBe(before + 1);
    expect(uiDrawCount()).toBeGreaterThan(0);
    undo();
    tick(3);
    expect(renders).toBe(before + 4);  // every frame again
  });

  it("is on unless Admin turns it off", () => {
    localStorage.clear();
    expect(isUiOnDemandEnabled()).toBe(true);
    setUiOnDemandEnabled(false);
    expect(isUiOnDemandEnabled()).toBe(false);
    setUiOnDemandEnabled(true);
    expect(isUiOnDemandEnabled()).toBe(true);
  });

  it("is installed by the interface host", () => {
    const host = readFileSync("src/ui/UiHost.tsx", "utf8");
    expect(host).toContain("const undoOnDemand = isUiOnDemandEnabled() ? installOnDemandRender(app) : null;");
    expect(host).toContain("undoOnDemand?.();");
  });

  it("is not kept busy by the lives heart, which breathes in steps, not every refresh", () => {
    const flash = readFileSync("src/ui/game/TopBarFlash.tsx", "utf8");
    expect(flash).toContain("export const BREATH_FPS = 20;");
    expect(flash).toContain("if (now - last < 1000 / BREATH_FPS) return;");
  });
});

describe("the board canvas's resolution", () => {
  beforeEach(() => localStorage.clear());
  it("is native up to 3x on high, and 2x below it", () => {
    setQualitySetting("high");
    expect(boardPixelRatioCap()).toBe(3);
    for (const t of ["medium", "low", "minimal"] as const) {
      setQualitySetting(t);
      expect(boardPixelRatioCap()).toBe(2);
    }
  });

  it("is what GameCanvas sizes the board by", () => {
    expect(readFileSync("src/components/game/GameCanvas.tsx", "utf8"))
      .toContain("Math.min(nativeDevicePixelRatio(), boardPixelRatioCap())");
  });
});
