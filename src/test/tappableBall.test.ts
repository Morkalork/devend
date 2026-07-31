/**
 * White "tappable" ball (issue #57): config integrity, the isTappableBall
 * helper, exclusion from rainbow spits, and the guard that a tappable ball is
 * never a map's ONLY ball (tapping it away would empty the board and win).
 */
import { describe, it, expect } from "vitest";
import {
  getBallType,
  isTappableBall,
  getSpawnableBallTypes,
  selectBallTypesForMap,
} from "@/lib/ballTypes";

describe("white tappable ball config", () => {
  it("ships a white ball with the tappable ability and the top lock multiplier", () => {
    const white = getBallType("white");
    expect(white).toBeDefined();
    expect(white!.ability).toBe("tappable");
    expect(isTappableBall(white!.ability)).toBe(true);
    // The biggest single-lock payout in the game (beats black's x4).
    const black = getBallType("black");
    expect(white!.lockMultiplier).toBeGreaterThan(black!.lockMultiplier);
    // Rare + mid-run.
    expect(white!.unlockLevel).toBeGreaterThanOrEqual(10);
    expect(white!.spawnChance).toBeGreaterThan(0);
    expect(white!.spawnChance).toBeLessThan(1);
  });

  it("isTappableBall is only true for the tappable ability", () => {
    expect(isTappableBall("tappable")).toBe(true);
    expect(isTappableBall("none")).toBe(false);
    expect(isTappableBall("rainbow")).toBe(false);
  });

  it("a rainbow ball never spits a tappable ball (nor another rainbow)", () => {
    const spawnable = getSpawnableBallTypes(40);
    expect(spawnable.some(t => t.ability === "tappable")).toBe(false);
    expect(spawnable.some(t => t.ability === "rainbow")).toBe(false);
  });
});

describe("selectBallTypesForMap never leaves a tappable ball as the ONLY ball", () => {
  it("a 1-ball map past the white unlock is never white-only", () => {
    // Sweep many map ids on a high level (white eligible) with a single slot.
    for (let i = 0; i < 300; i++) {
      const picks = selectBallTypesForMap(`m-${i}`, 25, 1);
      expect(picks.length).toBe(1);
      // The lone ball is never the tappable one.
      expect(isTappableBall(picks[0].ability)).toBe(false);
    }
  });

  it("multi-ball maps may include white, but always alongside a non-tappable", () => {
    let sawWhite = false;
    for (let i = 0; i < 300; i++) {
      const picks = selectBallTypesForMap(`x-${i}`, 25, 3);
      if (picks.some(p => isTappableBall(p.ability))) {
        sawWhite = true;
        expect(picks.some(p => !isTappableBall(p.ability))).toBe(true);
      }
    }
    // Given the 0.12 chance over 300 maps, white should have appeared at least once.
    expect(sawWhite).toBe(true);
  });
});
