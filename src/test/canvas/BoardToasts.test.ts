/**
 * The board's transient effects: their keyframe curves (index.css), the colour
 * strings they are handed, and the keys that restart them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ABILITY_ICON, BONUS_PULSE, CHEST_TOAST, EASE, cssColor, sampleKeyframes } from "@/ui/game/fxModel";

describe("the toasts' animations", () => {
  it("rise in, hold and lift away like chest-toast", () => {
    expect(CHEST_TOAST.duration).toBe(1.7);
    expect(sampleKeyframes(CHEST_TOAST.frames, 0)).toEqual({ alpha: 0, y: 12, scale: 0.9 });
    expect(sampleKeyframes(CHEST_TOAST.frames, 0.12)).toEqual({ alpha: 1, y: 0, scale: 1 });
    expect(sampleKeyframes(CHEST_TOAST.frames, 1)).toEqual({ alpha: 0, y: -22, scale: 0.98 });
  });

  it("pop the ability glyph like ability-icon-pop", () => {
    expect(ABILITY_ICON.duration).toBe(1.1);
    expect(sampleKeyframes(ABILITY_ICON.frames, 0.15).scale).toBeCloseTo(1.12);
    expect(sampleKeyframes(ABILITY_ICON.frames, 0.6)).toEqual({ alpha: 1, scale: 1 });
    expect(sampleKeyframes(ABILITY_ICON.frames, 1).alpha).toBe(0);
  });

  it("break the bonus pulse outward and fade it like bonus-fence-pulse", () => {
    expect(BONUS_PULSE.duration).toBe(0.85);
    expect(sampleKeyframes(BONUS_PULSE.frames, 0)).toEqual({ alpha: 0.95, scale: 0.6 });
    expect(sampleKeyframes(BONUS_PULSE.frames, 0.6).alpha).toBeCloseTo(0.55);
    expect(sampleKeyframes(BONUS_PULSE.frames, 1)).toEqual({ alpha: 0, scale: 1.7 });
  });

  it("ease each segment the way CSS ease-out does", () => {
    expect(EASE.out(0)).toBe(0);
    expect(EASE.out(1)).toBe(1);
    // ease-out runs ahead of linear.
    expect(EASE.out(0.5)).toBeGreaterThan(0.5);
    expect(EASE.inOut(0.5)).toBeCloseTo(0.5, 3);
  });
});

describe("the colours they are handed", () => {
  it("reads the CSS forms the game passes", () => {
    expect(cssColor("#ffd76b")).toEqual({ color: 0xffd76b, alpha: 1 });
    expect(cssColor("#0f0")).toEqual({ color: 0x00ff00, alpha: 1 });
    expect(cssColor("#ffb45499").alpha).toBeCloseTo(0x99 / 255);
    expect(cssColor("rgba(10,14,20,0.72)")).toEqual({ color: 0x0a0e14, alpha: 0.72 });
  });
});

describe("restarting", () => {
  it("keys every one-shot effect on its key, so a new toast replays from the start", () => {
    const src = readFileSync("src/ui/game/BoardToasts.tsx", "utf8");
    expect(src).toContain("<ChestToast key={chestToast.key}");
    expect(src).toContain("<BeatBanner key={beatBanner.key}");
    expect(src).toContain("<AbilityPop key={abilityIconFx.key}");
    expect(src).toContain("<BonusPulse key={bonusPulseKey}");
  });
});
