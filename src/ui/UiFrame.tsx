/**
 * A screen inside the screen: lays its children out in `box` (screen CSS px)
 * and tells them, through useUiScreen, that the box IS the screen. Every
 * full-screen piece inside (a modal's backdrop, a bottom bar) then fills the
 * box rather than the window.
 *
 * The play screen draws in one, so the admin Playground can host it in a pane
 * beside its own controls; in the game the box is the whole window.
 */
import type { ReactNode } from "react";
import { UiScreenContext } from "./screen";
import type { ScreenBox } from "./screenBox";

export function UiFrame({ box, children }: { box: ScreenBox; children: ReactNode }) {
  return (
    <UiScreenContext.Provider value={{ width: box.width, height: box.height }}>
      <layoutContainer layout={{ position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height }}>
        {children}
      </layoutContainer>
    </UiScreenContext.Provider>
  );
}
