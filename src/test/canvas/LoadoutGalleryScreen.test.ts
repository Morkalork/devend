/**
 * The loadout gallery's split and progress (canvas port of
 * components/game/LoadoutGalleryScreen; no DOM test covered it).
 */
import { describe, it, expect } from "vitest";
import type { LoadoutConfig } from "@/types/loadout";
import { lockedLoadoutProgress, loadoutGallery } from "@/ui/screens/loadoutModel";

const lo = (id: string, extra: Partial<LoadoutConfig> = {}): LoadoutConfig => ({
  id, name: id, curse: "", blessing: "", modifiers: {}, ...extra,
});

describe("loadoutGallery", () => {
  it("counts unique wins against the gated loadouts and splits by unlock", () => {
    const g = loadoutGallery(
      [lo("free"), lo("two", { uniqueWinsRequired: 2 }), lo("five", { uniqueWinsRequired: 5 }), lo("forced", { neverDrafted: true })],
      ["a", "b"],
    );
    expect(g.uniqueWins).toBe(2);
    expect(g.totalGated).toBe(2);
    expect(g.unlocked.map(l => l.id)).toEqual(["free", "two"]);
    // An imposed loadout is never unlocked for the draft, so it lists as locked.
    expect(g.locked.map(l => l.id)).toEqual(["five", "forced"]);
  });
});

describe("lockedLoadoutProgress", () => {
  it("says how many wins remain and fills the bar up to the requirement", () => {
    expect(lockedLoadoutProgress(lo("five", { uniqueWinsRequired: 5 }), 2)).toEqual({ required: 5, remaining: 3, current: 2, value: 0.4 });
    expect(lockedLoadoutProgress(lo("forced", { neverDrafted: true }), 2)).toEqual({ required: 0, remaining: 0, current: 0, value: 0 });
  });
});
