/**
 * The canvas screen gallery (Admin > Canvas UI kit > Screens): every canvas
 * screen, bar and modal drawn on its own with sample props, so a change to one
 * can be looked at without playing to the point where it appears.
 */
import type { ReactNode } from "react";

export interface GalleryEntry {
  /** Unique, and what the gallery's button is labelled (scripts tap it by this). */
  id: string;
  /** Which list it sits in. */
  group: "play" | "board" | "modal" | "screen";
  /** Draws the piece. It is mounted full-screen over a dark backdrop. */
  render: () => ReactNode;
}
