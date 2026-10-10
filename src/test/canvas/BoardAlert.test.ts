/**
 * The out-of-time alarm on the canvas (carried over from hudContextSlot.test.tsx
 * and deadlineFrame.test.tsx).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/i18n";
import { ALARM, OUTSTANDING, alarmEdgeAlpha } from "@/ui/game/overlayModel";
import { flashNumeralSize } from "@/ui/game/fxModel";

const src = readFileSync("src/ui/game/BoardAlert.tsx", "utf8");

describe("the out-of-time alarm", () => {
  it("shows nothing while there is time", () => {
    expect(src).toMatch(/if \(!urgent\) return null;/);
  });

  it("never takes a tap", () => {
    // The one absolute rule for anything drawn over the play area: the root is
    // inert, and nothing inside it is pressable.
    expect(src).toMatch(/return \(\s*<Inert/);
    expect(src).not.toMatch(/Pressable|Blocker|eventMode="static"/);
  });

  it("is red, not the win frame's amber", () => {
    expect(ALARM).toBe(0xff6b6b);
    expect(ALARM).not.toBe(OUTSTANDING);
  });

  it("says the word through i18n rather than hardcoding it", () => {
    expect(src).toContain('t("game.timeAlarm")');
    const label = i18n.t("game.timeAlarm");
    expect(label.trim().length).toBeGreaterThan(0);
    expect(label).not.toContain("game.timeAlarm");
  });

  it("shows the count as a flash keyed on the second, and none without one", () => {
    expect(src).toMatch(/seconds != null && \(\s*<FlashNumeral key=\{seconds\}/);
  });

  it("pulses its edge, or holds it steady under reduced motion", () => {
    expect(alarmEdgeAlpha(0, false)).toBeCloseTo(0.35);
    expect(alarmEdgeAlpha(1, false)).toBeCloseTo(1);
    expect(alarmEdgeAlpha(0, true)).toBe(0.85);
    expect(alarmEdgeAlpha(1, true)).toBe(0.85);
  });

  it("sizes the numeral like clamp(3rem, 22vw, 7rem)", () => {
    expect(flashNumeralSize(100)).toBe(48);
    expect(flashNumeralSize(390)).toBeCloseTo(85.8);
    expect(flashNumeralSize(1000)).toBe(112);
  });
});
