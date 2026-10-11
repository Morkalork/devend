/**
 * The arcade button's look as values (index.css `.arcade-button-*`,
 * `.menu-highlight`), split from arcade.tsx so that file exports only
 * components (lint: react-refresh/only-export-components).
 */
import { CanvasTextMetrics } from "pixi.js";
import { COLOR, ROLE, hsl } from "../theme";
import { textStyle, type TextLook } from "./style";

/** The highlight gold, hsl(45 100% 62%) in index.css `.menu-highlight`. */
export const GOLD = hsl(45, 100, 62);
/** What CSS `grayscale` makes of the primary green: the locked look. */
export const GREY = 0xc8c8c8;

export type ArcadeVariant = "primary" | "secondary" | "danger";

export const ARCADE = {
  // .arcade-button-sm: 0.72rem text, 0.72rem 1.45rem padding.
  sm: { text: 11.5, py: 11.5, px: 23 },
  // .arcade-button: 0.9375rem text, 0.85rem 1.7rem padding.
  md: { text: 15, py: 13.6, px: 27.2 },
} as const;

/** The arcade button's letter spacing, as a share of its text size: a little air, not the old 0.1em. */
export const ARCADE_TRACKING = 0.02;

/**
 * The ink an arcade button's label and icons use. The primary button is a
 * solid fill now, so its ink is the dark surface colour; custom content
 * inside one (WelcomeScreen's chips) must take its colour from here too.
 */
export function arcadeInk(variant: ArcadeVariant, locked = false): number {
  if (locked) return ROLE.muted;
  return variant === "primary" ? ROLE.surface : variant === "danger" ? ROLE.cost : ROLE.ink;
}

/** The label size an arcade button of this size uses, for custom content. */
export function arcadeTextSize(size: "sm" | "md"): number {
  return ARCADE[size].text;
}

/**
 * How wide `text` draws on one line in `look`, capped at `max`: the width to
 * give the box of a centred heading or label that should wrap only when it
 * has to. A wrapping label has no width of its own (it fills its box), so a
 * centred one needs its box sized to the text, or to the room, whichever is
 * less. Pass the text already upper-cased if it is drawn `upper`.
 */
export function fitTextWidth(text: string, look: TextLook, max = Infinity): number {
  return Math.min(max, Math.ceil(CanvasTextMetrics.measureText(text, textStyle(look)).width));
}
