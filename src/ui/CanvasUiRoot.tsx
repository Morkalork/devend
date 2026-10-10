/**
 * The one interface canvas for the whole game (CANVAS_UI_PLAN.md).
 *
 * Mounted once by Index for every screen except Admin's, which stays DOM.
 * Draws whatever layers the current screens have filed (layerStore.ts), in
 * draw order, and provides the screen size. The page is locked only while a
 * locking layer is up, so a DOM screen (Playground's panels) still scrolls.
 */
import { Fragment, useEffect } from "react";
import { UiHost } from "./UiHost";
import { useUiLayers } from "./layerStore";
import { UiScreenContext } from "./screen";
import { useViewportSize } from "./viewport";

export function CanvasUiRoot() {
  const layers = useUiLayers();
  const screen = useViewportSize();
  const locked = layers.some(l => l.lock);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("canvas-ui", locked);
    return () => html.classList.remove("canvas-ui");
  }, [locked]);

  return (
    <UiHost lockPage={false}>
      <UiScreenContext.Provider value={screen}>
        <layoutContainer layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
          {layers.map(l => (
            <layoutContainer key={l.id} label={`layer:${l.id}`}
              layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
              <Fragment>{l.node}</Fragment>
            </layoutContainer>
          ))}
        </layoutContainer>
      </UiScreenContext.Provider>
    </UiHost>
  );
}
