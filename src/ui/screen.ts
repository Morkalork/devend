/**
 * The size of the screen the canvas interface lays out in, in CSS pixels.
 * Provided once by CanvasUiRoot; every full-screen piece (a modal's backdrop,
 * a bottom bar, a top bar) reads it here rather than measuring for itself, so
 * they all agree.
 */
import { createContext, useContext } from "react";

export interface UiScreen {
  width: number;
  height: number;
}

export const UiScreenContext = createContext<UiScreen>({ width: 390, height: 844 });

export function useUiScreen(): UiScreen {
  return useContext(UiScreenContext);
}
