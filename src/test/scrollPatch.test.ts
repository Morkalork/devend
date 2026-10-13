/**
 * A scroll grabbed while it is still springing back from an overscroll must
 * not replay that spring on release (src/ui/scrollPatch.ts).
 *
 * Reported as Sprint Planning scrolling down and then refusing to scroll back
 * up: every grab that began before the settle finished was thrown back to the
 * bottom when the finger lifted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SlidingNumber } from "@pixi/layout/components";
import "@/ui/scrollPatch";

/** A content box 100px taller than its view, released 30px past the bottom. */
function settlingPastTheBottom(): SlidingNumber {
  const n = new SlidingNumber({ constrain: true, constrainPercent: 0.15 });
  n.min = 0;
  n.max = -100;
  n.grab(0);
  n.hold(-130);
  // Released: a few frames into the spring back to the bottom, not finished.
  for (let i = 0; i < 3; i++) n.slide();
  return n;
}

function settle(n: SlidingNumber): number {
  for (let i = 0; i < 2000; i++) n.slide();
  return n.value;
}

describe("grabbing a scroll while it settles", () => {
  it("is set up mid-spring, or the test is checking nothing", () => {
    const n = settlingPastTheBottom();
    expect((n as unknown as { _activeEase: unknown })._activeEase).not.toBeNull();
  });

  it("goes where the new drag takes it, not where the old spring was heading", () => {
    const n = settlingPastTheBottom();
    // Drag down past the top and let go: it must settle at the top.
    n.grab(0);
    n.hold(200);
    n.hold(200);
    expect(settle(n)).toBeCloseTo(0, 1);
  });

  it("still springs back to the bottom after a drag that ends past it", () => {
    const n = settlingPastTheBottom();
    n.grab(0);
    n.hold(-20);
    n.hold(-20);
    expect(settle(n)).toBeCloseTo(-100, 1);
  });
});

describe("the browser never takes a canvas screen's swipe", () => {
  // The other half of the same report: under the canvas sits Index's
  // per-screen wrapper, `overflow-y: auto`. A swipe landing on it was a page
  // pan, the browser cancelled the touch after its first move, and the scroll
  // view never saw the rest.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("turns panning off for the whole DOM while the canvas lock is on", () => {
    expect(read("src/index.css")).toMatch(/html\.canvas-ui #root,\s*html\.canvas-ui #root \* \{\s*touch-action: none;/);
  });

  it("tells Pixi when the browser cancels a touch, as an up outside", () => {
    const host = read("src/ui/UiHost.tsx");
    expect(host).toMatch(/window\.addEventListener\("pointercancel", onPointerCancel, true\)/);
    expect(host).toMatch(/event\.type = "pointerupoutside";/);
    expect(host).toMatch(/window\.removeEventListener\("pointercancel", onPointerCancel, true\)/);
  });

  it("loads the grab patch with the interface", () => {
    expect(read("src/ui/setup.ts")).toMatch(/import "\.\/scrollPatch";/);
  });
});
