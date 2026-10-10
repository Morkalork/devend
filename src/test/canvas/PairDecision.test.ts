/** Which map a pair's Continue names (src/ui/screens/PairDecisionModel.ts). */
import { describe, it, expect } from "vitest";
import { pairResumeLevel } from "@/ui/screens/PairDecisionModel";

const save = (levelIndex: number) => ({ runId: "r", levelIndex, savedAt: 0 });

describe("the pair's resume point", () => {
  it("is absent when neither phone holds a save", () => {
    expect(pairResumeLevel(null, null)).toBeNull();
  });

  it("is the further-along save, 1-based", () => {
    expect(pairResumeLevel(save(6), save(5))).toBe(7);
    expect(pairResumeLevel(save(2), save(9))).toBe(10);
  });

  it("works with only one phone's save", () => {
    expect(pairResumeLevel(save(0), null)).toBe(1);
    expect(pairResumeLevel(null, save(3))).toBe(4);
  });
});
