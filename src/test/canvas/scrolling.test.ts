/**
 * Canvas scrolling: the physics (scrollModel.ts), who owns a drag
 * (gesture.ts), and the wiring that makes the store's page and its card strip
 * stop fighting over one finger.
 *
 * The scroller this replaced was @pixi/layout's trackpad. It counted momentum
 * per FRAME (a flick on a 120 Hz phone died twice as fast), and every drag
 * moved every scroller under the finger, so swiping the store's cards also
 * scrolled its page. These tests pin both of those shut.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_FLING_SPEED, boundPast, clampScroll, isSettled, pruneSamples, releaseVelocity, rubberBand, scrollMin, stepScroll,
  type ScrollMotion,
} from "@/ui/kit/scrollModel";
import { beginPointer, claimPointer, claimedByOther, releasePointer } from "@/ui/kit/gesture";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Run a released scroll for `ms`, cut into frames of `frameMs`. */
function run(motion: ScrollMotion, ms: number, frameMs: number, min: number): ScrollMotion {
  let m = motion;
  for (let t = 0; t < ms; t += frameMs) {
    m = stepScroll(m, Math.min(frameMs, ms - t), min);
  }
  return m;
}

describe("the range", () => {
  it("is nothing when the content fits, and the overflow when it does not", () => {
    expect(scrollMin(800, 600)).toBe(0);
    expect(scrollMin(800, 2000)).toBe(-1200);
  });

  it("names the end a position is past", () => {
    expect(boundPast(-10, -500)).toBeNull();
    expect(boundPast(5, -500)).toBe(0);
    expect(boundPast(-520, -500)).toBe(-500);
    expect(clampScroll(40, -500)).toBe(0);
    expect(clampScroll(-900, -500)).toBe(-500);
  });
});

describe("a fling", () => {
  it("travels the same distance at 60 Hz and at 120 Hz", () => {
    // The bug this replaces: friction per frame, so frame rate set the distance.
    const start = { position: -400, velocity: -1.5 };
    const at60 = run(start, 1500, 1000 / 60, -100000);
    const at120 = run(start, 1500, 1000 / 120, -100000);
    expect(Math.abs(at60.position - at120.position)).toBeLessThan(0.5);
  });

  it("is not cut short by a stalled frame", () => {
    const start = { position: -400, velocity: -1.5 };
    const smooth = run(start, 600, 1000 / 60, -100000);
    let stalled = stepScroll(start, 45, -100000); // one long frame
    stalled = run(stalled, 555, 1000 / 60, -100000);
    expect(Math.abs(smooth.position - stalled.position)).toBeLessThan(1);
  });

  it("slows down and stops on its own", () => {
    const end = run({ position: -400, velocity: -2 }, 5000, 16, -100000);
    expect(end.velocity).toBe(0);
    expect(end.position).toBeLessThan(-400);
  });

  it("flung into an end, overshoots and comes back to rest exactly on it", () => {
    const min = -1000;
    const end = run({ position: -950, velocity: -3 }, 3000, 16, min);
    expect(end.position).toBe(min);
    expect(end.velocity).toBe(0);
    expect(isSettled(end, min)).toBe(true);
  });

  it("pulls content that shrank under a resting page back into range", () => {
    // The page rested at -800, then the content got shorter.
    const end = run({ position: -800, velocity: 0 }, 2000, 16, -300);
    expect(end.position).toBe(-300);
  });
});

describe("grabbing a scroll while it settles", () => {
  // Reported as Sprint Planning scrolling down and then refusing to scroll back
  // up: @pixi/layout's scroller kept its spring across a grab, so a drag that
  // began before the settle finished was thrown back to the bottom on release.
  // This model keeps no spring between steps: where it goes depends only on
  // where the drag left it.
  const min = -100;

  it("goes where the new drag takes it, not where the old spring was heading", () => {
    let m = run({ position: -130, velocity: 0 }, 48, 16, min); // springing back up to the bottom
    expect(m.position).toBeLessThan(min);
    // Grabbed (the finger zeroes the velocity), dragged down past the top, let go still.
    m = { position: rubberBand(200, min, 800), velocity: 0 };
    expect(run(m, 3000, 16, min).position).toBe(0);
  });

  it("still springs back to the bottom after a drag that ends past it", () => {
    const m = { position: rubberBand(-120, min, 800), velocity: 0 };
    expect(run(m, 3000, 16, min).position).toBe(min);
  });
});

describe("a drag past an end", () => {
  it("follows the finger one for one in range", () => {
    expect(rubberBand(-250, -500, 800)).toBe(-250);
  });

  it("gives less the further it is pulled, and never a whole screen", () => {
    const a = rubberBand(100, -500, 800);
    const b = rubberBand(400, -500, 800);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(100);
    // Each further pixel of pull moves the content less than the first ones did.
    expect((b - a) / 300).toBeLessThan(a / 100);
    expect(rubberBand(100000, -500, 800)).toBeLessThan(800);
    expect(rubberBand(-600, -500, 800)).toBeGreaterThan(-600);
  });
});

describe("the release velocity", () => {
  it("is the recent travel per ms", () => {
    const v = releaseVelocity([{ t: 0, position: 0 }, { t: 50, position: -100 }, { t: 100, position: -200 }], 105);
    expect(v).toBeCloseTo(-2);
  });

  it("is nothing when the finger stopped before it lifted", () => {
    expect(releaseVelocity([{ t: 0, position: 0 }, { t: 50, position: -100 }], 200)).toBe(0);
  });

  it("ignores travel older than its window and caps a wild sample", () => {
    const v = releaseVelocity([{ t: 0, position: 5000 }, { t: 300, position: 0 }, { t: 350, position: -50 }], 352);
    expect(v).toBeCloseTo(-1);
    expect(releaseVelocity([{ t: 0, position: 0 }, { t: 1, position: -999 }], 1)).toBe(-MAX_FLING_SPEED);
  });

  it("keeps only the samples it can still read", () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({ t: i * 10, position: -i }));
    expect(pruneSamples(samples, 490).length).toBeLessThan(25);
  });
});

describe("who owns a drag", () => {
  const page = Symbol("page");
  const strip = Symbol("strip");
  const touch = (id: number) => ({ id });

  beforeEach(() => {
    beginPointer(1, touch(1));
  });

  it("is whoever claims it first; the other is refused", () => {
    expect(claimPointer(1, strip)).toBe(true);
    expect(claimPointer(1, page)).toBe(false);
    expect(claimedByOther(1, page)).toBe(true);
    expect(claimedByOther(1, strip)).toBe(false);
    // A press never claims, so to it any claim is someone else's.
    expect(claimedByOther(1)).toBe(true);
  });

  it("is free again once released", () => {
    claimPointer(1, strip);
    releasePointer(1, strip);
    expect(claimedByOther(1)).toBe(false);
    expect(claimPointer(1, page)).toBe(true);
  });

  it("survives a second listener of the same touch-down, and not a new touch", () => {
    const down = touch(2);
    beginPointer(1, down);
    claimPointer(1, page); // the page caught a fling on touch-down
    beginPointer(1, down); // the next listener up hears the same event
    expect(claimedByOther(1)).toBe(true);
    beginPointer(1, touch(3)); // a new touch: a lost pointer-up cannot outlive its gesture
    expect(claimedByOther(1)).toBe(false);
  });

  it("is per finger", () => {
    claimPointer(1, page);
    beginPointer(2, touch(4));
    expect(claimedByOther(2)).toBe(false);
  });
});

describe("the wiring", () => {
  const kit = read("src/ui/kit/extra.tsx");
  const scroll = kit.slice(kit.indexOf("export function ScrollView"), kit.indexOf("// ── Appear"));

  it("no longer rides @pixi/layout's trackpad, but keeps the layout that lets content overflow", () => {
    expect(scroll).not.toContain("trackpad=");
    // "hidden" squeezes the content into the box: the store's card strip collapsed to nothing.
    expect(scroll).toContain('overflow: "scroll"');
    expect(scroll).toContain("Ticker.shared.remove(libraryStep, box)");
    expect(scroll).toContain("box.removeAllListeners(type)");
  });

  it("claims a drag only past the slop along its own axis, and runs on the interface's ticker", () => {
    expect(scroll).toContain("Math.abs(travel) < Math.abs(cross) || !claimPointer(e.pointerId, owner.current)");
    expect(scroll).toContain("useTick(");
    expect(scroll).toContain("stepScroll(motion.current, ticker.deltaMS, min)");
  });

  it("follows a claimed finger anywhere on screen, not only inside the box", () => {
    expect(scroll).toContain("onGlobalPointerMove={onGlobalPointerMove}");
  });

  it("lets go on an up outside, which is how a cancelled touch arrives", () => {
    expect(scroll).toContain("onPointerUpOutside={endDrag}");
    expect(scroll).toContain("onPointerCancel={endDrag}");
  });

  it("has the card strip claim its swipe and leave a claimed one alone", () => {
    const carousel = read("src/ui/screens/Carousel.tsx");
    expect(carousel).toContain("!claimPointer(e.pointerId, owner.current)");
    expect(carousel).toContain("claimedByOther(e.pointerId, owner.current)");
    expect(carousel).toContain("releasePointer(d.pointerId, owner.current)");
  });

  it("has a press let go of its tap when anyone takes the finger", () => {
    const press = read("src/ui/kit/press.ts");
    expect(press).toContain("claimedByOther(e.pointerId) || Math.hypot");
    expect(press).toContain("!claimedByOther(e.pointerId)");
  });
});

describe("the browser never takes a canvas screen's swipe", () => {
  // Under the canvas sits Index's per-screen wrapper, `overflow-y: auto`. A
  // swipe landing on it was a page pan, the browser cancelled the touch after
  // its first move, and the scroll view never saw the rest.
  it("turns panning off for the whole DOM while the canvas lock is on", () => {
    expect(read("src/index.css")).toMatch(/html\.canvas-ui #root,\s*html\.canvas-ui #root \* \{\s*touch-action: none;/);
  });

  it("tells Pixi when the browser cancels a touch, as an up outside", () => {
    const host = read("src/ui/UiHost.tsx");
    expect(host).toMatch(/window\.addEventListener\("pointercancel", onPointerCancel, true\)/);
    expect(host).toMatch(/event\.type = "pointerupoutside";/);
    expect(host).toMatch(/window\.removeEventListener\("pointercancel", onPointerCancel, true\)/);
  });
});
