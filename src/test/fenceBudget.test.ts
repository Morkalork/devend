import { describe, it, expect } from "vitest";
import { fenceBudgetExhausted, fencesLeft, FenceBudgetFlags } from "@/lib/fenceBudget";

const play: FenceBudgetFlags = { levelComplete: false, gameOver: false, pushMode: "none", pushPromptPending: false };

describe("fenceBudgetExhausted", () => {
  it("is false when no budget is set", () => {
    expect(fenceBudgetExhausted(undefined, 999, play)).toBe(false);
  });

  it("is false while fences remain", () => {
    expect(fenceBudgetExhausted(14, 13, play)).toBe(false);
  });

  it("is true when the budget is reached during normal play", () => {
    expect(fenceBudgetExhausted(14, 14, play)).toBe(true);
    expect(fenceBudgetExhausted(14, 15, play)).toBe(true); // safety: over the cap
  });

  it("does not fail a map that was just won by the final cut", () => {
    expect(fenceBudgetExhausted(14, 14, { ...play, levelComplete: true })).toBe(false);
    // A winning space-clear opens the push-your-luck prompt instead of completing.
    expect(fenceBudgetExhausted(14, 14, { ...play, pushMode: "prompt" })).toBe(false);
    expect(fenceBudgetExhausted(14, 14, { ...play, pushPromptPending: true })).toBe(false);
    expect(fenceBudgetExhausted(14, 14, { ...play, pushMode: "pushing" })).toBe(false);
  });

  it("does not double-fire once the map is already over", () => {
    expect(fenceBudgetExhausted(14, 14, { ...play, gameOver: true })).toBe(false);
  });
});

describe("fencesLeft", () => {
  it("returns the remaining budget, floored at 0", () => {
    expect(fencesLeft(14, 0)).toBe(14);
    expect(fencesLeft(14, 10)).toBe(4);
    expect(fencesLeft(14, 14)).toBe(0);
    expect(fencesLeft(14, 20)).toBe(0);
  });
});
