/**
 * The canvas MapTuningModal's field rules (src/ui/game/MapTuningModalModel.ts).
 */
import { describe, it, expect } from "vitest";
import { TUNABLE_FIELDS } from "@/lib/mapTuning";
import { TUNING_FIELDS, clampTuning, parseTuningInput, tuningStep } from "@/ui/game/MapTuningModalModel";

describe("the map tuner's fields", () => {
  it("covers exactly the tunable fields, with the DOM's ranges", () => {
    expect(TUNING_FIELDS.map(f => f.key).sort()).toEqual([...TUNABLE_FIELDS].sort());
    const par = TUNING_FIELDS.find(f => f.key === "expectedCuts")!;
    const thr = TUNING_FIELDS.find(f => f.key === "sizeThreshold")!;
    expect([par.min, par.max]).toEqual([1, 40]);
    expect([thr.min, thr.max, thr.suffix]).toEqual([1, 95, "%"]);
  });

  it("clamps what is typed into range", () => {
    expect(clampTuning(120, 1, 95)).toBe(95);
    expect(clampTuning(-3, 1, 95)).toBe(1);
    expect(parseTuningInput("120", 1, 95)).toBe(95);
    expect(parseTuningInput("12", 1, 95)).toBe(12);
  });

  it("keeps the last good value for a blank or half-typed field", () => {
    expect(parseTuningInput("", 1, 95)).toBeNull();
    expect(parseTuningInput("  ", 1, 95)).toBeNull();
    expect(parseTuningInput("-", 1, 95)).toBeNull();
    expect(parseTuningInput("abc", 1, 95)).toBeNull();
  });

  it("steps by one and stops at the ends", () => {
    expect(tuningStep(5, 1, 40)).toEqual({ down: 4, up: 6, canDown: true, canUp: true });
    expect(tuningStep(1, 1, 40)).toMatchObject({ down: 1, canDown: false });
    expect(tuningStep(40, 1, 40)).toMatchObject({ up: 40, canUp: false });
  });
});
