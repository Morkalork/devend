/**
 * The canvas AbilityCountdownBar (src/ui/game/AbilityCountdownBar.tsx): which
 * timers are drawn and how full.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liveTimers, countdownLayout, cssColor } from "@/ui/game/bottomModel";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/game/AbilityCountdownBar.tsx"), "utf8");
const timer = (kind: string, endMs: number, durationMs = 10_000) => ({ kind, name: kind, color: "#38bdf8", endMs, durationMs });

describe("the live timers", () => {
  it("drops a timer the moment it hits zero", () => {
    const got = liveTimers([timer("a", 5000), timer("b", 1000), timer("c", 999)], 1000);
    expect(got.map(t => t.kind)).toEqual(["a"]);
  });

  it("fills by the share left and rounds the seconds up", () => {
    const [t] = liveTimers([timer("a", 1000 + 2500)], 1000);
    expect(t.frac).toBeCloseTo(0.25);
    expect(t.secsLeft).toBe(3);
    expect(t.color).toBe(cssColor("#38bdf8"));
  });

  it("never overfills", () => {
    const [t] = liveTimers([timer("a", 20_000, 1000)], 0);
    expect(t.frac).toBe(1);
  });
});

describe("the lane", () => {
  it("one timer is a line, several share it side by side", () => {
    expect(countdownLayout(1)).toBe("line");
    expect(countdownLayout(2)).toBe("cells");
  });

  it("is exactly the context lane tall, even with nothing to show", () => {
    expect((SRC.match(/height: HUD\.contextLane/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("drains against the sim clock, not wall time", () => {
    expect(SRC).toMatch(/simNow\(\)/);
  });
});
