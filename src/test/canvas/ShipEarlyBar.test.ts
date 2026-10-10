/**
 * The canvas ShipEarlyBar (src/ui/game/ShipEarlyBar.tsx): the countdown, the
 * payout ticks and the chip.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getShipEarlyThresholds } from "@/lib/scoring";
import { shipEarlyView, shipEarlyChip, cssColor } from "@/ui/game/bottomModel";
import { deadlineColor } from "@/lib/deadlineDisplay";

const SRC = readFileSync(resolve(process.cwd(), "src/ui/game/ShipEarlyBar.tsx"), "utf8");

describe("the countdown", () => {
  it("draws nothing without a time limit (the tutorial band)", () => {
    expect(shipEarlyView({ seconds: 0, ballCount: 2, timeLimit: 0 })).toBeNull();
  });

  it("drains over the limit and counts whole seconds left", () => {
    const v = shipEarlyView({ seconds: 15, ballCount: 2, timeLimit: 60 })!;
    expect(v.remaining).toBeCloseTo(0.75);
    expect(v.secondsLeft).toBe(45);
    expect(shipEarlyView({ seconds: 90, ballCount: 2, timeLimit: 60 })!.remaining).toBe(0);
  });

  it("shades green to red as it empties", () => {
    expect(shipEarlyView({ seconds: 0, ballCount: 1, timeLimit: 60 })!.color).toBe(cssColor(deadlineColor(1)));
    expect(shipEarlyView({ seconds: 60, ballCount: 1, timeLimit: 60 })!.color).toBe(cssColor(deadlineColor(0)));
    expect(cssColor("hsl(120, 85%, 52%)") >> 8 & 0xff).toBeGreaterThan(cssColor("hsl(120, 85%, 52%)") >> 16 & 0xff);
  });
});

describe("the payout ticks", () => {
  it("marks only rungs that fall inside the limit, scaled per ball", () => {
    const rungs = getShipEarlyThresholds();
    const balls = 2;
    const limit = 600;
    const v = shipEarlyView({ seconds: 0, ballCount: balls, timeLimit: limit })!;
    const inside = rungs.filter(r => r.withinSecondsPerBall * balls < limit);
    expect(v.ticks.map(t => t.key)).toEqual(inside.map(r => r.withinSecondsPerBall));
    for (const [i, t] of v.ticks.entries()) expect(t.at).toBeCloseTo(1 - inside[i].withinSecondsPerBall * balls / limit);
    // A limit shorter than every window shows none.
    expect(shipEarlyView({ seconds: 0, ballCount: 50, timeLimit: 1 })!.ticks).toEqual([]);
  });

  it("widens the windows with Deadline Extension", () => {
    const base = shipEarlyView({ seconds: 0, ballCount: 1, timeLimit: 600 })!;
    const ext = shipEarlyView({ seconds: 0, ballCount: 1, timeLimit: 600, extraSecondsPerBall: 5 })!;
    expect(ext.ticks[0].at).toBeLessThan(base.ticks[0].at);
  });
});

describe("the chip", () => {
  it("advertises the bonus early, then counts seconds once the windows pass", () => {
    const early = shipEarlyView({ seconds: 0, ballCount: 2, timeLimit: 600 })!;
    expect(early.payoutHours).toBeGreaterThan(0);
    expect(shipEarlyChip(early)).toEqual({ key: "shipEarlyBar.bonus", values: { hours: early.payoutHours } });
    const late = shipEarlyView({ seconds: 590, ballCount: 2, timeLimit: 600 })!;
    expect(late.payoutHours).toBe(0);
    expect(shipEarlyChip(late)).toEqual({ key: "shipEarlyBar.seconds", values: { s: 10 } });
  });

  it("scales the advertised hours by the Hard Deadline multiplier", () => {
    const one = shipEarlyView({ seconds: 0, ballCount: 2, timeLimit: 600, bonusMultiplier: 1 })!;
    const two = shipEarlyView({ seconds: 0, ballCount: 2, timeLimit: 600, bonusMultiplier: 2 })!;
    expect(two.payoutHours).toBeGreaterThan(one.payoutHours);
  });
});

describe("the lane", () => {
  it("is exactly the context lane tall, even when hidden", () => {
    expect((SRC.match(/height: HUD\.contextLane/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
