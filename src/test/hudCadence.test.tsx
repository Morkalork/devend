/**
 * The HUD no longer re-renders on the clock it does not show, and the bars
 * that drain do it outside React (lib/activeClock.ts, kit DrainBar).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { setActiveClock, useActiveSeconds } from "@/lib/activeClock";
import { setUiLayer, removeUiLayer, useUiLayers } from "@/ui/layerStore";

afterEach(() => act(() => setActiveClock(0)));

describe("the active clock", () => {
  it("re-renders a subscriber each second while it is enabled", () => {
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useActiveSeconds(true); });
    const before = renders;
    act(() => setActiveClock(1));
    act(() => setActiveClock(2));
    expect(result.current).toBe(2);
    expect(renders).toBe(before + 2);
  });

  it("never re-renders a map that has no clock to show", () => {
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useActiveSeconds(false); });
    const before = renders;
    for (let s = 1; s <= 30; s++) act(() => setActiveClock(s));
    expect(result.current).toBe(0);
    expect(renders).toBe(before);
  });

  it("is written by the loop, not kept as GameCanvas state or pushed up to GameScreen", () => {
    const canvas = readFileSync("src/components/game/GameCanvas.tsx", "utf8");
    expect(canvas).not.toContain("setActiveSeconds");
    expect(canvas).toContain("setActiveClock(s);");
    expect(canvas).not.toMatch(/^\s+activeSeconds,$/m);
    const screen = readFileSync("src/components/game/GameScreen.tsx", "utf8");
    expect(screen).toContain('useActiveSeconds(mapTimeLimit != null || !!level.boss || mapObjective?.kind === "speedClear")');
    expect(screen).not.toContain("gameState.activeSeconds");
  });
});

describe("the layer store", () => {
  it("does not re-render the root when a layer is re-filed unchanged", () => {
    let renders = 0;
    renderHook(() => { renders++; return useUiLayers(); });
    const node = <span />;
    act(() => setUiLayer("cadence-test", 1, node));
    const before = renders;
    act(() => setUiLayer("cadence-test", 1, node));
    act(() => setUiLayer("cadence-test", 1, node));
    expect(renders).toBe(before);
    act(() => setUiLayer("cadence-test", 1, <span />));
    expect(renders).toBe(before + 1);
    act(() => removeUiLayer("cadence-test"));
  });
});

describe("the draining bars", () => {
  it("drain in their own loop and redraw only on a whole-pixel change", () => {
    const kit = readFileSync("src/ui/kit/extra.tsx", "utf8");
    expect(kit).toContain("const px = Math.round(Math.max(0, Math.min(1, r())) * width * RESOLUTION);");
    expect(kit).toMatch(/if \(key !== drawn\) \{/);
  });

  it("are used for the deadline and the ability timers, which no longer re-render per frame", () => {
    const ship = readFileSync("src/ui/game/ShipEarlyBar.tsx", "utf8");
    expect(ship).toContain("<DrainBar read={read} active");
    expect(ship).not.toContain("useTween(");
    const timers = readFileSync("src/ui/game/AbilityCountdownBar.tsx", "utf8");
    expect(timers).toContain("useTickEvery(active, 250);");
    expect(timers).not.toContain("useFrameTick");
  });
});
