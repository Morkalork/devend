import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fenceBudgetOutcome, fenceBudgetExhausted, fencesLeft, FenceBudgetFlags } from "@/lib/fenceBudget";

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

/**
 * Running out of fences DURING a push.
 *
 * The old rule returned false whenever the push flow was open, meaning to spare
 * a winning final cut from failing. It also stopped the budget counting for the
 * whole push, so on the maps built around a WIP limit the limit simply stopped
 * existing the moment you chose to push: level 17 has a budget of 10 and the
 * bug report came with 13 cuts on the HUD.
 *
 * Worse than meaningless, it stranded the map. No fail, no end, and if the last
 * ball could not be sealed there was nothing left to do at all.
 */
describe("running out of fences mid-push", () => {
  const flags = (over: Partial<Parameters<typeof fenceBudgetOutcome>[2]> = {}) => ({
    levelComplete: false, gameOver: false,
    pushMode: "none" as const, pushPromptPending: false, ...over,
  });

  it("still fails in ordinary play", () => {
    expect(fenceBudgetOutcome(10, 10, flags())).toBe("fail");
  });

  it("does nothing while there are fences left", () => {
    expect(fenceBudgetOutcome(10, 9, flags())).toBe("none");
    expect(fenceBudgetOutcome(10, 9, flags({ pushMode: "pushing" }))).toBe("none");
  });

  /** The fix: the budget counts during a push, and ending it banks. */
  it("banks the push instead of stranding it", () => {
    expect(fenceBudgetOutcome(10, 10, flags({ pushMode: "pushing" }))).toBe("bank");
    expect(fenceBudgetOutcome(10, 13, flags({ pushMode: "pushing" }))).toBe("bank");
  });

  /**
   * Banks rather than fails, because the map was already won when the prompt
   * opened. Taking a life for spending fences the game offered would punish a
   * choice it invited.
   */
  it("never fails a push, whatever the overrun", () => {
    for (const cuts of [10, 11, 20, 100]) {
      expect(fenceBudgetOutcome(10, cuts, flags({ pushMode: "pushing" })), String(cuts))
        .not.toBe("fail");
    }
  });

  it("leaves the prompt alone, since the player has not chosen yet", () => {
    expect(fenceBudgetOutcome(10, 10, flags({ pushMode: "prompt" }))).toBe("none");
    expect(fenceBudgetOutcome(10, 10, flags({ pushPromptPending: true }))).toBe("none");
  });

  it("does nothing once the map is over either way", () => {
    expect(fenceBudgetOutcome(10, 10, flags({ levelComplete: true }))).toBe("none");
    expect(fenceBudgetOutcome(10, 10, flags({ gameOver: true, pushMode: "pushing" }))).toBe("none");
  });

  it("keeps the old boolean meaning exactly one of the outcomes", () => {
    // Callers that only ask "should this map fail" must not start seeing a
    // banked push as a failure.
    expect(fenceBudgetExhausted(10, 10, flags())).toBe(true);
    expect(fenceBudgetExhausted(10, 10, flags({ pushMode: "pushing" }))).toBe(false);
  });
});

describe("the call site acts on all three outcomes", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../lib/physics/applyCut.ts"), "utf8");

  it("fails, banks, and does neither, rather than only failing", () => {
    expect(SRC).toMatch(/fenceBudgetOutcome\(/);
    expect(SRC).toMatch(/budget === "fail"/);
    expect(SRC).toMatch(/budget === "bank"/);
  });

  it("banks through the same completion path a normal win uses", () => {
    const block = SRC.slice(SRC.indexOf('budget === "bank"'), SRC.indexOf('budget === "bank"') + 200);
    expect(block).toMatch(/triggerLevelComplete/);
  });
});
