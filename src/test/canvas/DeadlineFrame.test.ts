/**
 * The map clock on the board's frame, on the canvas (carried over from
 * deadlineFrame.test.tsx: the pure deadlineDisplay tests there still cover the
 * shared library; these cover what the canvas frame draws).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { BoardFrameCss } from "@/ui/game/overlayModel";
import { clockRectPoints, deadlineGeometry, polylineLength } from "@/ui/game/overlayModel";
import { DEADLINE_FLASH, cssHex, sampleKeyframes } from "@/ui/game/fxModel";
import { hsl } from "@/ui/theme";

const FRAME: BoardFrameCss = { left: 6, top: 40, width: 388, height: 388, frame: 6 };

describe("the canvas deadline frame", () => {
  it("sits exactly on the board's frame band", () => {
    const g = deadlineGeometry(FRAME, 60, 60)!;
    expect(g.x).toBe(3);
    expect(g.y).toBe(3);
    expect(g.w).toBe(382);
    expect(g.h).toBe(382);
    expect(g.band).toBeCloseTo(3.6);
  });

  it("drains in step with the clock", () => {
    const length = 2 * (388 - 6) * 2;
    expect(deadlineGeometry(FRAME, 60, 60)!.lit).toBeCloseTo(length);
    expect(deadlineGeometry(FRAME, 30, 60)!.lit).toBeCloseTo(length / 2);
    expect(deadlineGeometry(FRAME, 0, 60)!.lit).toBeCloseTo(0);
  });

  it("traces the lit share from twelve o'clock clockwise", () => {
    const full = clockRectPoints(3, 3, 100, 80, 1);
    expect(full[0]).toEqual({ x: 53, y: 3 });
    expect(full[full.length - 1]).toEqual({ x: 53, y: 3 });
    expect(polylineLength(full)).toBeCloseTo(360);
    const half = clockRectPoints(3, 3, 100, 80, 0.5);
    expect(polylineLength(half)).toBeCloseTo(180);
    expect(clockRectPoints(3, 3, 100, 80, 0)).toHaveLength(1);
  });

  it("flashes the number at a milestone and not in between", () => {
    expect(deadlineGeometry(FRAME, 30, 60)!.milestone).toBe(30);
    expect(deadlineGeometry(FRAME, 29, 60)!.milestone).toBeNull();
  });

  it("draws nothing without a clock or before the board is sized", () => {
    expect(deadlineGeometry(FRAME, null, 60)).toBeNull();
    expect(deadlineGeometry(FRAME, 20, null)).toBeNull();
    expect(deadlineGeometry(null, 20, 60)).toBeNull();
    expect(deadlineGeometry(FRAME, 20, 0)).toBeNull();
  });

  it("runs green to red as the clock empties", () => {
    expect(deadlineGeometry(FRAME, 60, 60)!.color).toBe(hsl(120, 85, 52));
    expect(deadlineGeometry(FRAME, 0, 60)!.color).toBe(hsl(0, 85, 52));
    expect(cssHex("hsl(60, 85%, 52%)")).toBe(hsl(60, 85, 52));
  });
});

describe("the countdown flash", () => {
  it("zooms in, peaks at a quarter, and is gone by the end (deadline-flash)", () => {
    expect(sampleKeyframes(DEADLINE_FLASH.frames, 0)).toEqual({ alpha: 0, scale: 1.3 });
    const peak = sampleKeyframes(DEADLINE_FLASH.frames, 0.25);
    expect(peak.alpha).toBeCloseTo(0.85);
    expect(peak.scale).toBeCloseTo(1);
    expect(sampleKeyframes(DEADLINE_FLASH.frames, 1).alpha).toBe(0);
    expect(DEADLINE_FLASH.duration).toBe(1.2);
  });

  it("holds still under reduced motion, then fades", () => {
    expect(sampleKeyframes(DEADLINE_FLASH.still, 0.5)).toEqual({ alpha: 0.85, scale: 1 });
    expect(sampleKeyframes(DEADLINE_FLASH.still, 1).alpha).toBe(0);
  });
});

describe("the countdown numerals", () => {
  it("share one flash with the final-ten alarm (deadlineFrame.test.tsx)", () => {
    const frame = readFileSync("src/ui/game/DeadlineFrame.tsx", "utf8");
    const alarm = readFileSync("src/ui/game/BoardAlert.tsx", "utf8");
    // Keyed on the value, so each new number plays the flash once.
    expect(frame).toMatch(/<FlashNumeral key=\{geo\.milestone\}/);
    expect(alarm).toMatch(/<FlashNumeral key=\{seconds\}/);
  });
});
