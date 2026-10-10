/**
 * One-time setup for the canvas interface (CANVAS_UI_PLAN.md).
 *
 * `@pixi/layout` patches Pixi's display objects with a `layout` property (a
 * Yoga flexbox node), and has to be imported before any application is made;
 * `@pixi/layout/react` teaches @pixi/react's JSX about the layout components.
 * `extend` is @pixi/react's catalogue: only what is listed here can appear as
 * a JSX element, which keeps the rest of Pixi out of the bundle.
 */
import "@pixi/layout";
import "@pixi/layout/react";
import { extend } from "@pixi/react";
import { Container, Graphics, Sprite, Text } from "pixi.js";
import { LayoutContainer } from "@pixi/layout/components";
import { UiGraphics, UiText } from "./elements";
import { Layout } from "@pixi/layout";

extend({ Container, Graphics, Sprite, Text, LayoutContainer, UiText, UiGraphics });

// Boxes stack top to bottom unless told otherwise, the way the DOM's block
// elements did. @pixi/layout's default is CSS flexbox's `row`, so every
// container written as a translation of a `div` would otherwise lay its
// children out side by side.
Layout.defaultStyle.shared.flexDirection = "column";
// And they keep their content's size. CSS flex items do shrink by default, but
// never below their content (`min-height: auto`), which Yoga does not have:
// with Yoga's own default a column of cards in a scroll view is squeezed to
// fit the view, and text squeezed with it scales down. A box that should give
// way says so (`flex: 1` or `flexShrink: 1`).
Layout.defaultStyle.shared.flexShrink = 0;
