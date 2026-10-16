/**
 * Fence swipes on a phone held in one hand: the touches that are not the
 * drawing finger.
 *
 * Reported as "she drew what should have been a perfect fence, and it got
 * ignored. Nothing happened." The input layer trusted every touch on the
 * board equally, so the hand holding the phone (fingertips round the edge, a
 * curved screen's rim, a palm, a thumb resting on the board) cancelled or cut
 * short the fence being drawn, or swallowed the finger that came to draw it.
 *
 * Driven through the real hook with real pointer events against a real board,
 * one world unit to one CSS px, and read off the commands it queues.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createBotGame, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { useGameInput, EDGE_GRIP_CSS, HANDOFF_SLOP_CSS, PALM_CSS } from "@/hooks/useGameInput";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import { isPositionActive } from "@/lib/spaceGrid";
import { wallBlocksCutStart } from "@/lib/physics/cutStart";
import { resetTouchTrace, setTouchTraceEnabled, touchTraceLines } from "@/lib/touchTrace";
import type { CanvasGameState } from "@/types/gameState";
import type { GameMessageId } from "@/lib/gameMessages";
import { LADDER } from "./fixtures/maps";

const VIEW_W = 850; // so the right-hand grip band sits over the board (x > 826)

let game: CanvasGameState;
let canvas: HTMLCanvasElement;
let messages: GameMessageId[];
let unmount: () => void;

beforeEach(() => {
  installClock();
  setRunSeedText("fence-touches");
  game = createBotGame(LADDER.find(l => l.level === 1)!, 1, plainModifiers()).game;
  game.boardRect = { left: 0, top: 0, width: 900, height: 900, scale: 1 };
  canvas = document.createElement("canvas");
  canvas.width = 900; canvas.height = 900;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 900, right: 900, bottom: 900, x: 0, y: 0, toJSON: () => ({}) });
  document.body.appendChild(canvas);
  Object.defineProperty(window, "innerWidth", { value: VIEW_W, configurable: true });
  messages = [];
  const mods = plainModifiers();
  const noop = () => {};
  const hook = renderHook(() => useGameInput(
    { current: canvas }, { current: game }, mods, noop, noop, noop,
    undefined, undefined, undefined, undefined, { current: (id: GameMessageId) => { messages.push(id); } },
  ));
  unmount = hook.unmount;
});

afterEach(() => {
  unmount();
  canvas.remove();
  releaseClock();
  setRunSeedText(null);
  setTouchTraceEnabled(false);
  resetTouchTrace();
});

/** jsdom has no PointerEvent: a MouseEvent carrying the fields the hook reads. */
function fire(type: string, id: number, x: number, y: number, size = 8): void {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperties(e, {
    pointerId: { value: id }, pointerType: { value: "touch" }, width: { value: size }, height: { value: size },
  });
  canvas.dispatchEvent(e);
}

/** A drag from a to b in a few steps, without lifting. */
function drag(id: number, a: [number, number], b: [number, number]): void {
  for (let i = 1; i <= 4; i++) fire("pointermove", id, a[0] + ((b[0] - a[0]) * i) / 4, a[1] + ((b[1] - a[1]) * i) / 4);
}

const cuts = () => (game.pending ?? []).filter(c => c.kind === "cut") as Extract<NonNullable<CanvasGameState["pending"]>[number], { kind: "cut" }>[];

/** A point a fence may start from, near (x, y). */
function open(x: number, y: number): [number, number] {
  for (let r = 0; r < 200; r += 6) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const p = { x: Math.round(x + r * Math.cos(a)), y: Math.round(y + r * Math.sin(a)) };
      if (!game.spaceGrid || !isPositionActive(game.spaceGrid, p)) continue;
      if (!findRegionContainingPoint(game.regions, p.x, p.y)) continue;
      if (game.walls.some(w => wallBlocksCutStart(p, w, game.spaceGrid!))) continue;
      return [p.x, p.y];
    }
  }
  throw new Error(`no open ground near ${x},${y}`);
}

describe("one finger", () => {
  it("lands a fence from where it came down to where it lifted", () => {
    const a = open(300, 450), b: [number, number] = [600, 450];
    fire("pointerdown", 1, ...a);
    drag(1, a, b);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(1);
    expect(cuts()[0].start).toEqual({ x: a[0], y: a[1] });
    expect(cuts()[0].end).toEqual({ x: b[0], y: b[1] });
  });

  it("ends the fence where the finger lifted, even when the last move never arrived", () => {
    // A quick flick on a slow phone: down, then up, with the moves lost to a
    // long frame. The lift has the position; the fence used to end at the
    // start and be thrown away as a tap.
    const a = open(300, 450), b: [number, number] = [620, 470];
    fire("pointerdown", 1, ...a);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(1);
    expect(cuts()[0].end).toEqual({ x: b[0], y: b[1] });
  });
});

describe("the hand holding the phone", () => {
  it("a fingertip on the screen edge neither cancels the fence nor ends it", () => {
    const a = open(300, 450), mid: [number, number] = [450, 450], b: [number, number] = [600, 450];
    fire("pointerdown", 1, ...a);
    drag(1, a, mid);
    fire("pointerdown", 2, VIEW_W - EDGE_GRIP_CSS / 2, 500);  // the grip
    fire("pointerup", 2, VIEW_W - EDGE_GRIP_CSS / 2, 500);    // and its lift
    expect(cuts()).toHaveLength(0);
    drag(1, mid, b);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(1);
    expect(cuts()[0].end).toEqual({ x: b[0], y: b[1] });
    expect(messages).not.toContain("secondFingerCancel");
  });

  it("a palm-sized contact anywhere is ignored the same way", () => {
    const a = open(300, 450), b: [number, number] = [600, 450];
    fire("pointerdown", 1, ...a);
    drag(1, a, [450, 450]);
    fire("pointerdown", 2, 450, 700, PALM_CSS + 10);
    drag(1, [450, 450], b);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(1);
  });

  it("a thumb resting on the board hands the swipe to the finger that came to draw", () => {
    const thumb = open(200, 750), a = open(300, 300), b: [number, number] = [650, 300];
    fire("pointerdown", 1, ...thumb);           // resting, never moves
    fire("pointerdown", 2, ...a);               // used to cancel the thumb's "swipe" and be swallowed
    drag(2, a, b);
    fire("pointerup", 2, ...b);
    expect(cuts()).toHaveLength(1);
    expect(cuts()[0].start).toEqual({ x: a[0], y: a[1] });
    fire("pointerup", 1, ...thumb);             // the thumb lifting is nothing
    expect(cuts()).toHaveLength(1);
    expect(game.swipeStart).toBeNull();
  });

  it("when the finger set aside is the one that moves, it was the drawing finger", () => {
    const a = open(300, 300), rest = open(250, 700), b: [number, number] = [650, 300];
    fire("pointerdown", 1, ...a);
    fire("pointerdown", 2, ...rest);            // a thumb landing just after the drawing finger
    drag(1, a, b);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(1);
    expect(cuts()[0].start).toEqual({ x: a[0], y: a[1] });
    fire("pointerup", 2, ...rest);
    expect(cuts()).toHaveLength(1);
  });

  it("a second finger that lifts does not end someone else's fence", () => {
    const a = open(300, 450), b: [number, number] = [650, 450];
    fire("pointerdown", 1, ...a);
    fire("pointerdown", 2, ...open(500, 750)); // takes over (nothing moved yet) ...
    drag(1, a, b);                              // ... until finger 1 draws: back to 1
    fire("pointerup", 2, 500, 750);
    expect(cuts()).toHaveLength(0);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(1);
  });
});

describe("a second finger meant as one", () => {
  it("still cancels a fence that is really being drawn, and says so", () => {
    const a = open(300, 450), b: [number, number] = [600, 450];
    fire("pointerdown", 1, ...a);
    drag(1, a, [a[0] + HANDOFF_SLOP_CSS * 4, a[1]]);
    fire("pointerdown", 2, 450, 600);
    expect(game.swipeStart).toBeNull();
    expect(messages).toContain("secondFingerCancel");
    drag(1, [a[0] + HANDOFF_SLOP_CSS * 4, a[1]], b);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(0);
  });
});

describe("a touch the system takes away", () => {
  it("keeps a fence already drawn, and leaves nothing stuck behind", () => {
    const a = open(300, 450), b: [number, number] = [600, 450];
    fire("pointerdown", 1, ...a);
    drag(1, a, b);
    fire("pointercancel", 1, 0, 0);
    fire("pointerleave", 1, 0, 0);  // the spec sends a leave after a cancel
    expect(cuts()).toHaveLength(1);
    expect(cuts()[0].end).toEqual({ x: b[0], y: b[1] });
    expect(game.swipeStart).toBeNull();
    expect(game.swipePointerId).toBeNull();
  });

  it("is never a tap, and the next touch draws normally", () => {
    const a = open(300, 450), c = open(300, 300), d: [number, number] = [650, 300];
    fire("pointerdown", 1, ...a);
    fire("pointercancel", 1, 0, 0);
    expect(game.pending ?? []).toHaveLength(0);
    fire("pointerdown", 2, ...c);
    drag(2, c, d);
    fire("pointerup", 2, ...d);
    expect(cuts()).toHaveLength(1);
  });
});

describe("the touch trace", () => {
  it("writes nothing while off", () => {
    const a = open(300, 450);
    fire("pointerdown", 1, ...a);
    fire("pointerup", 1, 600, 450);
    expect(touchTraceLines()).toHaveLength(0);
  });

  it("says what happened to each touch while on", () => {
    setTouchTraceEnabled(true);
    const a = open(300, 450);
    fire("pointerdown", 1, ...a);
    fire("pointerdown", 2, 5, 500);
    fire("pointerup", 1, 600, 450);
    const lines = touchTraceLines().join("\n");
    expect(lines).toMatch(/#1 down: swipe started/);
    expect(lines).toMatch(/#2 down: second touch at the screen edge, ignored/);
    expect(lines).toMatch(/#1 up: fence/);
  });
});

describe("the long press", () => {
  // Android raises `contextmenu` on a finger held still and, unless it is
  // refused, cancels the touch for its menu: put a finger down, press, then
  // draw, and nothing at all happens. Headless Chromium has no long-press
  // gesture to replay, so this pins the refusal itself.
  it("is refused on the board, so the browser never takes the touch", () => {
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("is refused across the canvas interface too, except in a text field", async () => {
    const { readFileSync } = await import("node:fs");
    const host = readFileSync("src/ui/UiHost.tsx", "utf8");
    expect(host).toMatch(/window\.addEventListener\("contextmenu", onContextMenu, true\)/);
    expect(host).toMatch(/window\.removeEventListener\("contextmenu", onContextMenu, true\)/);
    expect(host).toMatch(/closest\?\.\("input, textarea, select, \[contenteditable\]"\)/);
  });

  it("leaves a trace saying how long the finger was down when a touch is taken", () => {
    setTouchTraceEnabled(true);
    fire("pointerdown", 1, ...open(300, 450));
    fire("pointercancel", 1, 0, 0);
    expect(touchTraceLines().join("\n")).toMatch(/#1 cancelled by the system after \d+ms: too short/);
  });
});

describe("a swipe nobody is holding", () => {
  it("is dropped by the next press, which draws normally even pressed hard", () => {
    // Left behind when the listeners were re-attached mid-gesture.
    const stale = open(500, 700);
    game.swipeStart = { x: stale[0], y: stale[1] };
    game.swipeRegionId = findRegionContainingPoint(game.regions, stale[0], stale[1])!.id;
    game.currentSwipePos = { ...game.swipeStart };
    game.swipePointerId = 99;
    const a = open(300, 300), b: [number, number] = [650, 300];
    fire("pointerdown", 1, ...a, PALM_CSS - 4);
    drag(1, a, b);
    fire("pointerup", 1, ...b);
    expect(cuts()).toHaveLength(1);
    expect(cuts()[0].start).toEqual({ x: a[0], y: a[1] });
  });
});

describe("a press something else took", () => {
  it("is named in the trace, since the board itself never hears it", () => {
    setTouchTraceEnabled(true);
    const cover = document.createElement("div");
    cover.className = "absolute inset-0 backdrop";
    document.body.appendChild(cover);
    const e = new MouseEvent("pointerdown", { clientX: 400, clientY: 400, bubbles: true });
    Object.defineProperty(e, "pointerId", { value: 7 });
    cover.dispatchEvent(e);
    cover.remove();
    expect(touchTraceLines().join("\n")).toMatch(/#7 down: over the board, but taken by <div \.absolute\.inset-0\.backdrop>/);
  });
});
