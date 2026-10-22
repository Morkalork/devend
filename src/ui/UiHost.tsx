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
import { Fragment, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import type { Application as PixiApplication, Container } from "pixi.js";
import { loadUiFonts } from "./fonts";
import i18n from "@/i18n";
import { setUiHitTester } from "./hitGate";
import { installOnDemandRender, isUiOnDemandEnabled, noteUiContextLost, noteUiContextRestored } from "./onDemand";
import { setUiProbeApp } from "./uiProbe";

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
  const boundary = app.renderer.events.rootBoundary;
  // Pixi sets the boundary's root only inside its own event handlers, and the
  // board asks before those have run (its listener fires first), so it is set
  // here; without it the first touch on the board would throw.
  boundary.rootTarget = app.stage;
  let hit: Container | null = null;
  try { hit = boundary.hitTest(x, y) as Container | null; } catch { return false; }
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
    // Never preventDefault: Pixi does it on every touch at its target by
    // default, and on <body> that cancels the click of every DOM element on
    // the page (a DOM screen's buttons, Admin). The page lock is CSS instead.
    events.autoPreventDefault = false;
    events.setTargetElement(target);
    // Pixi does not listen for `pointercancel`. When the browser cancels a
    // touch (it took the gesture for itself, or the OS interrupted it), Pixi
    // never hears that the finger is gone: a scroll view stays "held" and
    // stops scrolling, and a card's hold timer runs out and opens its
    // explainer. Delivered as an up OUTSIDE, which every press and every
    // scroll view already treats as "let go, do nothing".
    const onPointerCancel = (nativeEvent: PointerEvent) => {
      internal.rootBoundary.rootTarget = internal.renderer.lastObjectRendered;
      for (const data of internal._normalizeToPointerData(nativeEvent)) {
        const event = internal._bootstrapEvent(internal._rootPointerEvent, data);
        event.type = "pointerupoutside";
        internal.rootBoundary.mapEvent(event);
      }
    };
    window.addEventListener("pointercancel", onPointerCancel, true);
    // The long press. On Android a finger held still raises `contextmenu`
    // and, unless it is refused, the browser takes the touch for its menu and
    // cancels it: a held card loses its explainer, a held scroll view stops
    // scrolling, a held-then-dragged fence never draws. There is no menu
    // anywhere in the canvas interface, so it is refused while that interface
    // owns the page; a text field (Admin's) keeps its own.
    const onContextMenu = (e: Event) => {
      if (!document.documentElement.classList.contains("canvas-ui")) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu, true);
    const undoOnDemand = isUiOnDemandEnabled() ? installOnDemandRender(app) : null;
    setUiHitTester((x, y) => interactiveAt(app, x, y));
    setUiProbeApp(app);
    if (import.meta.env.DEV) (window as unknown as { __uiApp?: PixiApplication }).__uiApp = app;
    return () => {
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      undoOnDemand?.();
      setUiHitTester(null);
      setUiProbeApp(null);
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

/**
 * `lockPage` false leaves the page lock to the caller (CanvasUiRoot locks only
 * while a layer is up); the Admin preview locks for as long as it is open.
 */
export function UiHost({ children, lockPage = true }: { children: ReactNode; lockPage?: boolean }) {
  const [fontsReady, setFontsReady] = useState(false);
  // Children wait for the application's own init, which is where @pixi/layout
  // loads Yoga. @pixi/react renders updates that arrive while init is still
  // running straight into the tree (StrictMode's double mount is one), and a
  // layout box made before Yoga exists throws.
  const [appReady, setAppReady] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  // Bumped when the GPU context comes back: every layer is rebuilt. Pixi
  // restores what it can on its own, but text it rasterised before the loss is
  // gone and is not redrawn until it changes (a menu came back with every label
  // missing), and a phone drops contexts under memory pressure.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let live = true;
    loadUiFonts(i18n.language).then(() => { if (live) setFontsReady(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!canvas) {
      return;
    }
    const onLost = () => noteUiContextLost();
    const onRestored = () => {
      noteUiContextRestored();
      setEpoch(e => e + 1);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [canvas]);

  useEffect(() => {
    if (!lockPage) return;
    const html = document.documentElement;
    html.classList.add("canvas-ui");
    return () => html.classList.remove("canvas-ui");
  }, [lockPage]);

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
      onInit={(app) => {
        setCanvas(app.canvas as HTMLCanvasElement);
        setAppReady(true);
      }}
    >
      {appReady && <EventBridge />}
      {appReady && <Fragment key={epoch}>{children}</Fragment>}
    </Application>
  );
}
