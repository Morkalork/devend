/**
 * The play region's counters: which show, where, and how they warn.
 */
import { describe, it, expect } from "vitest";
import { FENCE_BUDGET_WARN, playChipLayout } from "@/ui/game/overlayModel";

const NONE = { accentColor: "#00ff88", freeze: null, derails: null, bands: null, fenceBudget: null };

describe("play chips", () => {
  it("shows nothing for a map without counters", () => {
    expect(playChipLayout(NONE)).toEqual([]);
  });

  it("puts freeze top-right and the fence budget top-left", () => {
    const chips = playChipLayout({ ...NONE, freeze: { left: 2, total: 3 }, fenceBudget: { left: 5, total: 8 } });
    expect(chips.find(c => c.id === "freeze")).toMatchObject({ side: "right", top: 8, text: "2/3", alpha: 1 });
    expect(chips.find(c => c.id === "fenceBudget")).toMatchObject({ side: "left", top: 8, text: "5/8", color: "#00ff88" });
  });

  it("stacks derails under freeze, and bands under derails or in their place", () => {
    const both = playChipLayout({ ...NONE, derails: { left: 1, total: 2 }, bands: { left: 1, total: 2 } });
    expect(both.find(c => c.id === "derails")?.top).toBe(44);
    expect(both.find(c => c.id === "bands")?.top).toBe(80);
    const alone = playChipLayout({ ...NONE, bands: { left: 1, total: 2 } });
    expect(alone.find(c => c.id === "bands")?.top).toBe(44);
  });

  it("dims a counter at zero", () => {
    const chips = playChipLayout({ ...NONE, freeze: { left: 0, total: 3 } });
    expect(chips[0].alpha).toBe(0.4);
  });

  it("warns on the fence budget at two or fewer", () => {
    expect(playChipLayout({ ...NONE, fenceBudget: { left: 3, total: 8 } })[0].color).toBe("#00ff88");
    expect(playChipLayout({ ...NONE, fenceBudget: { left: 2, total: 8 } })[0].color).toBe(FENCE_BUDGET_WARN);
    expect(FENCE_BUDGET_WARN).toBe("#ff8a5b");
  });

  it("rounds a modifier's per-map total, as the HUD did", () => {
    expect(playChipLayout({ ...NONE, freeze: { left: 1, total: 2.6 } })[0].text).toBe("1/3");
  });
});
