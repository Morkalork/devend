/**
 * The board stays where it first appeared (lib/boardLayoutLatch.ts).
 *
 * Reported: "once the actual game board warps in, it moves the position of the
 * game board twice. The position must be exact and never change." Its place is
 * worked out from the surface and the bar stack under it, and both changed size
 * in the first moments of a map:
 *
 *   1. the goal row in the top bar painted empty (14px) and filled a commit
 *      later (34px), pushing the board's container, and the board, down 20px;
 *   2. the first layout used the measuring hook's first-commit guess for the
 *      stack (200px) instead of the stack, then moved when the real number
 *      landed, and moved again when a row mounted a commit late (the ability
 *      row waited for the game to report its handler).
 *
 * Pinned here: the layout rule (a stack change alone moves the board only when
 * the stack would cover it), the inset the board lays out against, and the
 * wiring that keeps each of the causes above fixed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeBoardRect } from "@/lib/boardConstants";
import { visibleBoardBottom, stackCoversBoard, layoutInset } from "@/lib/boardLayoutLatch";
import {
  measureBottomBars, useMeasuredBottomBars, BOTTOM_BARS_FALLBACK_PX,
} from "@/hooks/useBottomBarsHeight";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** The surfaces the board is laid out on, in physical pixels. */
const PORTRAIT = { w: 780, h: 1341 };      // 390x670 CSS at 2x, the traced phone
const LANDSCAPE = { w: 1600, h: 600 };     // short and wide: height-limited

describe("the layout rule", () => {
  it("never reads its own layout as covered", () => {
    // A board laid out against a stack must not then decide that same stack
    // covers it, or the latch would move it on every settle.
    for (const s of [PORTRAIT, LANDSCAPE, { w: 1179, h: 2556 }, { w: 1080, h: 1500 }]) {
      for (const inset of [0, 142 * 2, 200 * 2, s.h * 0.4]) {
        const rect = computeBoardRect(s.w, s.h, inset);
        expect(stackCoversBoard(rect, s.h, inset), `${s.w}x${s.h} inset ${inset}`).toBe(false);
      }
    }
  });

  it("holds the board still on a portrait phone while the stack grows a row", () => {
    // A width-limited board is centred in a band taller than itself, and the
    // gap under it takes a row or two. This is the case that was moving.
    const rect = computeBoardRect(PORTRAIT.w, PORTRAIT.h, 142 * 2);
    for (const grown of [142 + 34, 142 + 56, 142 + 70]) {
      expect(stackCoversBoard(rect, PORTRAIT.h, grown * 2), `stack ${grown}px`).toBe(false);
    }
    // And past the gap it gives way rather than sit under the bars.
    expect(stackCoversBoard(rect, PORTRAIT.h, (142 + 90) * 2)).toBe(true);
  });

  it("moves the board when the stack really would cover it", () => {
    // Staying put under the bars is worse than moving: they take taps, so the
    // bottom of the board could not be cut (issue #78).
    const rect = computeBoardRect(LANDSCAPE.w, LANDSCAPE.h, 100);
    expect(stackCoversBoard(rect, LANDSCAPE.h, 160)).toBe(true);
  });

  it("measures the drawn bottom edge, frame included", () => {
    const rect = { left: 0, top: 100, width: 900, height: 900, scale: 1 };
    // 900 - 45 margin + 14 frame.
    expect(visibleBoardBottom(rect)).toBe(100 + 869);
  });
});

describe("the inset the board lays out against", () => {
  it("prefers the stack as it stands over the hook's first-commit guess", () => {
    // The first layout ran with the fallback (200) while the real stack was
    // 142, and the board moved the moment the real number landed.
    expect(layoutInset(142, null, BOTTOM_BARS_FALLBACK_PX)).toBe(142);
  });

  it("keeps the deepest reading when the stack has briefly emptied", () => {
    // The stack unmounts its rows when a map is won; laying the next map out
    // against that would put the board under the rows when they come back.
    expect(layoutInset(44, 176, BOTTOM_BARS_FALLBACK_PX)).toBe(176);
    expect(layoutInset(190, 176, BOTTOM_BARS_FALLBACK_PX)).toBe(190);
  });

  it("falls back only when there is nothing to read", () => {
    expect(layoutInset(null, null, BOTTOM_BARS_FALLBACK_PX)).toBe(BOTTOM_BARS_FALLBACK_PX);
  });
});

describe("reading the stack", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  const mountBar = (height: number) => {
    const el = document.createElement("div");
    el.setAttribute("data-bottom-bars", "");
    el.getBoundingClientRect = () => ({ height } as DOMRect);
    document.body.appendChild(el);
  };

  it("reads the stack now, or reports that it cannot", () => {
    expect(measureBottomBars()).toBeNull();
    mountBar(0);
    expect(measureBottomBars(), "an unlaid-out stack is not a zero-height one").toBeNull();
    document.body.innerHTML = "";
    mountBar(142);
    expect(measureBottomBars()).toBe(142);
  });

  it("says 'not measured' rather than handing the board a guess", () => {
    const { result } = renderHook(() => useMeasuredBottomBars());
    expect(result.current).toBeNull();
  });
});

describe("the wiring", () => {
  const canvas = read("src/components/game/GameCanvas.tsx");

  it("lays each map out against the stack as it stands", () => {
    expect(canvas).toMatch(/const insetCss = layoutInset\(measureBottomBars\(\), bottomInsetRef\.current \?\? null, BOTTOM_BARS_FALLBACK_PX\)/);
  });

  it("lets a stack change move the board only when it covers it", () => {
    const resize = canvas.slice(canvas.indexOf("const resizeCanvas = (opts?: ResizeOpts) => {"));
    const latch = resize.slice(0, resize.indexOf("pendingResizeRef.current.offer("));
    expect(latch).toMatch(/if \(opts\?\.onlyIfCovered && game\.boardRect\.width > 0\)/);
    expect(latch).toMatch(/if \(!stackCoversBoard\(game\.boardRect, game\.screenSize\.height, inset \* dprNow\)\) return;/);
  });

  it("never hands the window's resize event to the resize as options", () => {
    expect(canvas).toMatch(/const onWindowResize = \(\) => resizeCanvas\(\);/);
    expect(canvas).not.toMatch(/addEventListener\("resize", resizeCanvas\)/);
  });

  it("keeps the dev guard that names a container that moved", () => {
    expect(canvas).toMatch(/\[board\] the board's container went from/);
  });

  it("gives the goal row its filled height from the first frame", () => {
    const bar = read("src/components/game/GameTopBar.tsx");
    const row = bar.slice(bar.indexOf("data-goal-row"));
    expect(row.slice(0, 200)).toMatch(/className=\{`h-\[34px\] flex-shrink-0 /);
  });

  it("mounts the ability row with the stack, not when the game reports a handler", () => {
    const screen = read("src/components/game/GameScreen.tsx");
    expect(screen).not.toMatch(/!mapComplete && gameState\.onUseAbility && \(/);
    expect(screen).toMatch(/onUse=\{gameState\.onUseAbility \?\? \(\(\) => \{\}\)\}/);
  });
});
