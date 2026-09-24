/**
 * The board does not change size while a fence is being drawn on it.
 *
 * Four reports of "the gameboard is zooming out", and the fourth came with the
 * question that cracked it: "can it be a reaction between the canvas and the
 * react part of the game?" It can, and it was. None of it is the browser's page
 * zoom, which is what three rounds of gesture-refusing went after.
 *
 *   Index.tsx sized every screen `100dvh`, and the DYNAMIC viewport height is
 *   defined to move as the mobile URL bar collapses. A drag begun on the chrome
 *   BESIDE the board is a scroll gesture to the browser - only the canvas
 *   carries `touch-action: none` - and a scroll is what collapses the bar. The
 *   bar moves, `100dvh` moves, `window` fires resize, and GameCanvas rebuilds
 *   `boardRect` from the container. Mid-fence.
 *
 * Which is exactly why it only happened when the drag started off the board,
 * the correlation reported twice and explained by none of the earlier fixes.
 *
 * Two answers, and this file guards the second. The board screens are sized
 * `100svh` now, which does not move at all. And any resize that still arrives -
 * an orientation change, a keyboard, a cause nobody has thought of - is HELD
 * until the board is idle, because suppressing one cause is not the same as
 * being safe against the class.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mayResizeNow, PendingResize } from "@/lib/boardResizeHold";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const idle = { dragging: false, growingWalls: 0 };

describe("when the board may be re-laid out", () => {
  it("allows it on an idle board, which is every ordinary resize", () => {
    expect(mayResizeNow(idle)).toBe(true);
  });

  it("refuses it while a finger is drawing", () => {
    expect(mayResizeNow({ dragging: true, growingWalls: 0 })).toBe(false);
  });

  it("refuses it while a released fence is still growing", () => {
    // The half that is easy to miss. A fence keeps extending after release and
    // lands on coordinates decided when it started, so moving the board out
    // from under one in flight is the same bug arriving a second later.
    expect(mayResizeNow({ dragging: false, growingWalls: 1 })).toBe(false);
  });
});

describe("a resize that had to wait", () => {
  it("is applied at once when nothing is in the way", () => {
    const p = new PendingResize();
    expect(p.offer(idle), "an ordinary resize was deferred for no reason").toBe(true);
    expect(p.isOwed).toBe(false);
  });

  it("is remembered rather than dropped when the board is busy", () => {
    const p = new PendingResize();
    expect(p.offer({ dragging: true, growingWalls: 0 })).toBe(false);
    expect(p.isOwed, "the layout change was lost, not deferred").toBe(true);
  });

  it("lands on the next idle moment", () => {
    const p = new PendingResize();
    p.offer({ dragging: true, growingWalls: 0 });
    expect(p.claim()).toBe(true);
  });

  it("collapses a burst into one, because the handler re-measures", () => {
    // A URL bar collapsing fires a stream of resizes. Replaying them would be
    // replaying stale measurements; the handler reads the container itself when
    // it finally runs, so ten owed and one owed are the same instruction.
    const p = new PendingResize();
    for (let i = 0; i < 10; i++) p.offer({ dragging: true, growingWalls: 0 });
    expect(p.claim()).toBe(true);
    expect(p.claim(), "one deferred burst ran the handler twice").toBe(false);
  });

  it("costs nothing on a release that deferred nothing", () => {
    // Almost every release. `claim` has to be cheap and honest about it.
    const p = new PendingResize();
    p.offer(idle);
    expect(p.claim()).toBe(false);
  });

  it("forgets it once claimed, so a later idle does no work", () => {
    const p = new PendingResize();
    p.offer({ dragging: true, growingWalls: 2 });
    expect(p.claim()).toBe(true);
    expect(p.isOwed).toBe(false);
    expect(p.claim()).toBe(false);
  });
});

describe("the two ends of the chain, in the source", () => {
  it("sizes a board screen with a height that does not move", () => {
    // `dvh` is the one that moves with the URL bar. On a screen holding a
    // board that is the whole bug, so those screens get `svh`.
    const index = read("src/pages/Index.tsx");
    expect(index, "the board screens are back on a height that moves")
      .toContain("'100svh' : '100dvh'");
    expect(index).toContain("BOARD_SCREENS");
  });

  it("asks the hold before it re-measures, not after", () => {
    // Measuring first and discarding would still run the expensive part on
    // every frame of a collapsing URL bar.
    const canvas = read("src/components/game/GameCanvas.tsx");
    const fn = canvas.slice(canvas.indexOf("const resizeCanvas = () => {"));
    const guard = fn.indexOf("pendingResizeRef.current.offer");
    const measure = fn.indexOf("container.getBoundingClientRect()");
    expect(guard, "the resize handler no longer consults the hold").toBeGreaterThan(-1);
    expect(guard, "it measures the container before asking whether it may")
      .toBeLessThan(measure);
  });

  it("flushes the held resize when the drag ends", () => {
    // Without this the board stays at the stale size until the next time the
    // window happens to change, which on a phone can be never.
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toContain("pendingResizeRef.current.claim()");
  });
});
