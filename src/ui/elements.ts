/**
 * Thin subclasses registered as JSX elements, for the two Pixi classes whose
 * typings confuse @pixi/react: Text's deprecated (text, style) constructor
 * overload makes its props resolve to `{ toString }`, and Graphics is typed to
 * require a `draw` callback even when it is handed a shared context. Each
 * subclass has the one options constructor, which is what @pixi/react calls.
 */
import { Container, Graphics, Text, type ContainerOptions, type GraphicsContext, type TextOptions } from "pixi.js";
import type { PixiReactElementProps } from "@pixi/react";

export class UiText extends Text {
  constructor(options?: TextOptions) {
    super(options ?? {});
  }
}

/** A container showing one shared GraphicsContext (an icon), set by prop. */
export class UiGraphics extends Container {
  private g = new Graphics();
  constructor(options?: ContainerOptions & { context?: GraphicsContext }) {
    const { context, ...rest } = options ?? {};
    super(rest);
    this.addChild(this.g);
    if (context) this.context = context;
  }
  set context(ctx: GraphicsContext) {
    if (this.g.context === ctx) return;
    this.g.destroy();
    this.g = new Graphics(ctx);
    this.addChild(this.g);
  }
  get context(): GraphicsContext {
    return this.g.context;
  }
}

declare module "@pixi/react" {
  interface PixiElements {
    uiText: PixiReactElementProps<typeof UiText>;
    uiGraphics: PixiReactElementProps<typeof UiGraphics>;
  }
}
