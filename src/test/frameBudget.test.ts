/**
 * The frame budget: a cap on frames a second, and a cap on physics steps a
 * frame (frameGate.ts, useGameLoop.ts, render3dSettings.getFrameCap).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createFrameGate } from "@/lib/frameGate";
import { DEFAULT_FRAME_CAP, getFrameCap, setFrameCap } from "@/lib/rendering/render3dSettings";

/** Frames drawn in one second of a display refreshing at `hz`. */
function drawn(fps: number, hz: number): number {
  const gate = createFrameGate(fps);
  let n = 0;
  for (let i = 0; i < hz; i++) if (gate.due((i * 1000) / hz)) n++;
  return n;
}

describe("the frame cap", () => {
  beforeEach(() => localStorage.clear());

  it("holds 60 on a 120Hz display, and on 90Hz averages 60 rather than halving to 45", () => {
    expect(drawn(60, 120)).toBe(60);
    expect(drawn(60, 90)).toBeGreaterThanOrEqual(59);
    expect(drawn(60, 90)).toBeLessThanOrEqual(61);
  });

  it("leaves a 60Hz display alone, and 30 draws every other refresh", () => {
    expect(drawn(60, 60)).toBe(60);
    expect(drawn(30, 60)).toBe(30);
  });

  it("off draws every refresh", () => {
    expect(drawn(0, 144)).toBe(144);
  });

  it("does not burst to catch up after a stall", () => {
    const gate = createFrameGate(60);
    gate.due(0);
    expect(gate.due(500)).toBe(true);   // a half-second hitch
    expect(gate.due(508)).toBe(false);  // the next 120Hz refresh is not owed a frame
    expect(gate.due(517)).toBe(true);
  });

  it("is 60 by default, and remembered when changed", () => {
    expect(getFrameCap()).toBe(DEFAULT_FRAME_CAP);
    expect(DEFAULT_FRAME_CAP).toBe(60);
    setFrameCap(30);
    expect(getFrameCap()).toBe(30);
    setFrameCap(0);
    expect(getFrameCap()).toBe(0);
    setFrameCap(60);
    expect(localStorage.getItem("devend:frameCap")).toBeNull();
  });
});

describe("the loop", () => {
  const loop = readFileSync("src/hooks/useGameLoop.ts", "utf8");

  it("skips a refresh the cap says is not due, before any work", () => {
    expect(loop).toMatch(/const gameLoop = \(timestamp: number\): void => \{\s*\/\/[^\n]*\n\s*if \(!gate\.due\(timestamp\)\) \{ schedule\(\); return; \}/);
    expect(loop).toContain("const gate = createFrameGate(getFrameCap());");
  });

  it("runs at most four physics steps a frame, and drops the backlog past that", () => {
    expect(loop).toContain("export const MAX_STEPS_PER_FRAME = 4;");
    expect(loop).toMatch(/if \(_physSteps >= MAX_STEPS_PER_FRAME\) \{[\s\S]{0,200}game\.accumulator %= PHYSICS_STEP;\s*break;/);
  });
});
