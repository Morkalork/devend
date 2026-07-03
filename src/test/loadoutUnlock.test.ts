import { describe, it, expect } from "vitest";
import type { LoadoutConfig } from "@/types/loadout";
import { isLoadoutUnlocked, unlockedForStart, newlyUnlocked } from "@/lib/loadoutUnlock";

const L = (id: string, uniqueWinsRequired?: number): LoadoutConfig => ({
  id,
  name: id,
  curse: "c",
  blessing: "b",
  modifiers: {},
  ...(uniqueWinsRequired != null ? { uniqueWinsRequired } : {}),
});

const catalogue: LoadoutConfig[] = [
  L("starter_a"),
  L("starter_b"),
  L("gate_1", 1),
  L("gate_2", 2),
  L("gate_3", 3),
];

describe("isLoadoutUnlocked", () => {
  it("treats loadouts without uniqueWinsRequired as always unlocked", () => {
    expect(isLoadoutUnlocked(L("x"), 0)).toBe(true);
  });

  it("locks a gated loadout until the win count meets its requirement", () => {
    const g = L("g", 2);
    expect(isLoadoutUnlocked(g, 1)).toBe(false);
    expect(isLoadoutUnlocked(g, 2)).toBe(true);
    expect(isLoadoutUnlocked(g, 3)).toBe(true);
  });
});

describe("unlockedForStart", () => {
  it("returns only the ungated loadouts at zero wins", () => {
    expect(unlockedForStart(catalogue, 0).map(l => l.id)).toEqual(["starter_a", "starter_b"]);
  });

  it("reveals one additional loadout per unique win", () => {
    expect(unlockedForStart(catalogue, 1).map(l => l.id)).toContain("gate_1");
    expect(unlockedForStart(catalogue, 2).map(l => l.id)).toContain("gate_2");
    expect(unlockedForStart(catalogue, 3)).toHaveLength(5);
  });
});

describe("newlyUnlocked", () => {
  it("returns exactly the loadout that crosses the threshold on a win", () => {
    expect(newlyUnlocked(catalogue, 0, 1).map(l => l.id)).toEqual(["gate_1"]);
    expect(newlyUnlocked(catalogue, 1, 2).map(l => l.id)).toEqual(["gate_2"]);
  });

  it("returns nothing when the count did not change (repeat win)", () => {
    expect(newlyUnlocked(catalogue, 2, 2)).toEqual([]);
  });

  it("returns every loadout crossed when the count jumps by more than one", () => {
    expect(newlyUnlocked(catalogue, 0, 3).map(l => l.id)).toEqual(["gate_1", "gate_2", "gate_3"]);
  });
});
