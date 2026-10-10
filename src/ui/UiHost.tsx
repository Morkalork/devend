/**
 * The canvas the game's interface is drawn on (CANVAS_UI_PLAN.md).
 *
 * One full-screen, transparent Pixi application, fixed over the page. The
 * game board keeps its own canvas underneath (GameCanvas: the 3D and 2D board
 * renderers own their WebGL context); this one draws everything else.
 *
 * INPUT. The canvas itself has `pointer-events: none`, and Pixi's event system
 * listens on the page root instead. So every touch reaches both: the interface
 * hit-tests its own widgets, and the board canvas below gets the touch as it
 * always has. The board asks `uiCovers` before starting a fence, so a button
 * over the board never also cuts it (hitGate.ts). Nothing on a canvas screen
 * is a DOM element a touch can land on and be taken for a scroll, which is the
 * whole point of the plan.
 *
 * THE PAGE IS LOCKED while this is mounted: `canvas-ui` on <html> fixes the
 * body and turns off scrolling, overscroll and touch panning (index.css).
 */
import "./setup";
import { Application, useApplication } from "@pixi/react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import type { Application as PixiApplication, Container } from "pixi.js";
import { loadUiFonts } from "./fonts";
import { setUiHitTester } from "./hitGate";

/** The parts of Pixi's EventSystem the pointer-up override reaches into. */
interface PixiEventInternals {
  features: { click: boolean };
  renderer: { lastObjectRendered: unknown };
  rootBoundary: { rootTarget: unknown; cursor: string | null; mapEvent(e: { type: string }): void };
  domElement: HTMLElement;
  _rootPointerEvent: unknown;
  _onPointerUp: (e: PointerEvent) => void;
  _normalizeToPointerData(e: PointerEvent): unknown[];
  _bootstrapEvent(target: unknown, data: unknown): { type: string };
  setCursor(c: string | null): void;
}

/** Is anything interactive in the interface under this client point? */
function interactiveAt(app: PixiApplication, clientX: number, clientY: number): boolean {
  const canvas = app.canvas as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const hit = app.renderer.events.rootBoundary.hitTest(x, y) as Container | null;
  // The full-screen root is not interactive; a hit means a widget.
  return !!hit && hit !== app.stage;
}

/**
 * Wires the event system to the page and registers the board's hit gate.
 *
 * Pixi listens on <body> rather than on its own canvas (which lets pointers
 * through), so a touch anywhere reaches it whatever DOM element is underneath.
 * Its coordinate mapping assumes its target is a canvas (it divides by the
 * target's `.width`), so it is replaced with the plain one: client position
 * minus the interface canvas's own position, in CSS pixels, which is the
 * stage's unit under autoDensity.
 */
function EventBridge(): null {
  const { app } = useApplication();
  useLayoutEffect(() => {
    if (!app?.renderer) return;
    const canvas = app.canvas as HTMLCanvasElement;
    const target = document.body;
    const events = app.renderer.events;
    const original = events.mapPositionToPoint.bind(events);
    events.mapPositionToPoint = (point, x, y) => {
      const r = canvas.getBoundingClientRect();
      point.x = x - r.left;
      point.y = y - r.top;
    };
    // Pixi calls a pointer-up "outside" unless the DOM event's own target is
    // its element, and an outside up cancels the press. With the canvas letting
    // pointers through, the target is whatever DOM sits underneath, so every
    // tap would cancel itself. Outside means outside the page here. Swapped in
    // before setTargetElement, which is what (re)attaches the listener.
    const internal = events as unknown as PixiEventInternals;
    // Detach first, while the listeners are still the bound originals: Pixi
    // removes them by the current property, so swapping first would leave the
    // original attached alongside the replacement, cancelling every press.
    events.setTargetElement(null as unknown as HTMLElement);
    const originalUp = internal._onPointerUp;
    internal._onPointerUp = function onPointerUp(this: PixiEventInternals, nativeEvent: PointerEvent) {
      if (!this.features.click) return;
      this.rootBoundary.rootTarget = this.renderer.lastObjectRendered;
      const path = nativeEvent.composedPath?.() ?? [];
      const hit = (path[0] ?? nativeEvent.target) as Node | null;
      const outside = hit && this.domElement.contains(hit) ? "" : "outside";
      for (const data of this._normalizeToPointerData(nativeEvent)) {
        const event = this._bootstrapEvent(this._rootPointerEvent, data);
        event.type += outside;
        this.rootBoundary.mapEvent(event);
      }
      this.setCursor(this.rootBoundary.cursor);
    }.bind(internal);
    events.setTargetElement(target);
    setUiHitTester((x, y) => interactiveAt(app, x, y));
    return () => {
      setUiHitTester(null);
      try { events.setTargetElement(null as unknown as HTMLElement); } catch { /* torn down */ }
      internal._onPointerUp = originalUp;
      events.mapPositionToPoint = original;
      try { events.setTargetElement(canvas); } catch { /* torn down */ }
      // Pixi styles its target; the page lock is a class on <html> instead.
      target.style.touchAction = "";
      target.style.cursor = "";
    };
  }, [app]);
  return null;
}

export function UiHost({ children }: { children: ReactNode }) {
  const [fontsReady, setFontsReady] = useState(false);
  // Children wait for the application's own init, which is where @pixi/layout
  // loads Yoga. @pixi/react renders updates that arrive while init is still
  // running straight into the tree (StrictMode's double mount is one), and a
  // layout box made before Yoga exists throws.
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    let live = true;
    loadUiFonts().then(() => { if (live) setFontsReady(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("canvas-ui");
    return () => html.classList.remove("canvas-ui");
  }, []);

  if (!fontsReady) return null;
  return (
    <Application
      className="canvas-ui-surface"
      resizeTo={window}
      backgroundAlpha={0}
      antialias
      autoDensity
      resolution={Math.min(3, window.devicePixelRatio || 1)}
      // The board has its own context; this one never needs a stencil-heavy
      // or high-performance GPU path.
      powerPreference="low-power"
      preference="webgl"
      onInit={() => setAppReady(true)}
    >
      {appReady && <EventBridge />}
      {appReady && children}
    </Application>
  );
}
