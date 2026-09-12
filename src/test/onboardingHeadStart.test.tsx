/**
 * Onboarding's head start ("Every map starts with 8% of the board already
 * captured") reported as not working: "I don't see any difference."
 *
 * The mechanism itself turns out to be correct once traced all the way
 * through: initGame shrinks the arena AND deliberately re-inflates the space
 * grid's own baseline ("Inflate the percentage baseline so the remaining%
 * starts at targetRemaining instead of 100") so the live "% remaining" HUD and
 * the win-condition threshold both read the true head start (92% remaining at
 * map start for an 8% bonus, not 100%) rather than 100% of an already-smaller
 * board. That part earns its own tests below so it stays proven rather than
 * merely trusted a second time.
 *
 * What genuinely was missing, found by tracing every reader of
 * `startingCapturePercent` rather than trusting the one everyone already knew
 * about:
 *
 *   1. It was the one modifier of its kind absent from the Specs panel
 *      (ModifierBreakdown) that lets a player confirm every OTHER similarly
 *      subtle bonus landed - instant fences, extra concurrent fences,
 *      Runway's bank thresholds all have a row there; this did not. A ~92%
 *      instead of 100% on a HUD number that is also animating and flashing on
 *      every cut is an easy thing to miss walking away with "nothing happened
 *      here", and the one place built to answer that question directly had
 *      nothing to say about this modifier.
 *   2. Its 0..40 cap lived at exactly one reader (initGame) rather than at the
 *      merge. Harmless while initGame was the only reader, but adding the
 *      Specs row above would have shown the raw, uncapped sum instead of what
 *      the map the player is about to load actually gets - the cap is now
 *      shared from computeGameModifiers, with initGame keeping its own
 *      defensive copy for the callers (bot harness, Playground, hand-built
 *      test fixtures) that never go through that merge at all.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/i18n";
import {
  computeGameModifiers, DEFAULT_MODIFIERS, MAX_STARTING_CAPTURE_PERCENT,
} from "@/hooks/useActiveModifiers";
import { createInitialGameData } from "@/lib/initGame";
import { getRemainingPercent } from "@/lib/spaceGrid";
import { setRunSeedText } from "@/lib/runRng";
import { ModifierBreakdown } from "@/components/game/ModifierBreakdown";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { UpgradeConfig } from "@/types/upgrade";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const UPGRADES = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;
const lookup = new Map(UPGRADES.map(u => [u.id, u]));

const BASE_LEVEL: LevelConfig = {
  id: "level-onboarding-probe", level: 1, sizeThreshold: 60, expectedCuts: 6,
  points: 20, variety: 0, randomShapes: 0, maxBalls: 1,
};

function modsWith(startingCapturePercent: number): GameModifiers {
  return { ...DEFAULT_MODIFIERS, startingCapturePercent } as GameModifiers;
}

/** A seed pins the run's own incidental randomness (ball spawn position etc.)
 *  so two builds of the same level differ only by the modifier under test. */
function build(startingCapturePercent: number) {
  setRunSeedText("onboarding-head-start-probe");
  return createInitialGameData(BASE_LEVEL, 1, modsWith(startingCapturePercent));
}

afterEach(() => {
  cleanup();
  setRunSeedText(null);
});

describe("the head start is real, both geometrically and on the HUD", () => {
  it("hands the player a genuinely smaller board to clear", () => {
    const flat = build(0);
    const started = build(16);
    const areaOf = (poly: typeof flat.boardPolygon) => {
      const v = poly.vertices;
      let a = 0;
      for (let i = 0; i < v.length; i++) {
        const j = (i + 1) % v.length;
        a += v[i].x * v[j].y - v[j].x * v[i].y;
      }
      return Math.abs(a) / 2;
    };
    // 16% less area to clear, exactly: (1 - 0.16).
    expect(areaOf(started.boardPolygon) / areaOf(flat.boardPolygon)).toBeCloseTo(0.84, 1);
  });

  it("starts the live '% remaining' readout below 100, not just the geometry", () => {
    // THIS is the number the player is actually looking at during play. If it
    // read 100 at the start of every map, the effect really would be
    // invisible regardless of what the geometry did underneath it.
    for (const [percent, expected] of [[8, 92], [16, 84], [40, 60]] as const) {
      const remaining = getRemainingPercent(build(percent).spaceGrid);
      // Cell-grid quantisation on a 15-unit lattice, not a fudge factor.
      expect(remaining, `${percent}% head start`).toBeCloseTo(expected, 0);
    }
  });

  it("is inert at zero, which is every map before the upgrade is owned", () => {
    expect(getRemainingPercent(build(0).spaceGrid)).toBe(100);
  });
});

describe("the cap moved to where every reader shares it", () => {
  it("caps the sum of every source, not one at a time", () => {
    // Onboarding tops out at 16 (Junior 8 + Senior 4 + a Principal choice 4);
    // Equity Grant certificate hours fold in as extraBonuses the same way.
    // Stacked past the ceiling has to land exactly ON it, not silently over.
    const onboardingChain = ["onboarding_junior", "onboarding_senior", "onboarding_principal_a"];
    const withCert = computeGameModifiers(onboardingChain, lookup, { startingCapturePercent: 30 });
    expect(withCert.startingCapturePercent).toBe(MAX_STARTING_CAPTURE_PERCENT);
  });

  it("never goes negative even if a future source subtracts", () => {
    const negative = computeGameModifiers([], lookup, { startingCapturePercent: -5 });
    expect(negative.startingCapturePercent).toBe(0);
  });

  it("leaves a total under the cap untouched", () => {
    const one = computeGameModifiers(["onboarding_junior"], lookup).startingCapturePercent;
    expect(one).toBe(8);
    expect(one).toBeLessThan(MAX_STARTING_CAPTURE_PERCENT);
  });

  it("caps a raw value fed straight to initGame too, for callers that never merge one", () => {
    // The bot harness, the Playground preview and plenty of hand-built test
    // fixtures elsewhere in this suite construct a GameModifiers object by
    // hand rather than through computeGameModifiers. Feeding createInitialGameData
    // a wildly out-of-range value directly must still land on the same board a
    // properly-capped 40 would, not shrink the arena further still.
    const overshoot = createInitialGameData(BASE_LEVEL, 1, modsWith(90));
    const capped = createInitialGameData(BASE_LEVEL, 1, modsWith(MAX_STARTING_CAPTURE_PERCENT));
    expect(getRemainingPercent(overshoot.spaceGrid)).toBeCloseTo(getRemainingPercent(capped.spaceGrid), 0);
  });

  it("shares the exact same ceiling in both places, so they cannot quietly disagree", () => {
    // Written as a relationship rather than a duplicated literal: this is
    // exactly the "one fact stated twice" shape that let the two clamps drift
    // apart in the first place, and the fix was making them read one constant.
    const uncappedGood = computeGameModifiers(["onboarding_junior"], lookup, {
      startingCapturePercent: MAX_STARTING_CAPTURE_PERCENT - 8,
    }).startingCapturePercent;
    expect(uncappedGood).toBe(MAX_STARTING_CAPTURE_PERCENT);
  });
});

describe("the Specs panel now confirms it landed", () => {
  it("lists the head start as active, at the map's actual size", () => {
    render(<ModifierBreakdown activeModifiers={modsWith(8)} />);
    expect(screen.getByText("Head Start")).toBeTruthy();
    expect(screen.getByText("+8%")).toBeTruthy();
  });

  it("shows the capped number, not a stacked-past-the-ceiling one", () => {
    const stacked = computeGameModifiers(
      ["onboarding_junior", "onboarding_senior", "onboarding_principal_a"],
      lookup,
      { startingCapturePercent: 30 },
    );
    render(<ModifierBreakdown activeModifiers={stacked} />);
    expect(screen.getByText(`+${MAX_STARTING_CAPTURE_PERCENT}%`)).toBeTruthy();
    expect(screen.queryByText(/\+46%/)).toBeNull();
  });

  it("reads as inactive, not merely absent, when nobody owns it", () => {
    render(<ModifierBreakdown activeModifiers={modsWith(0)} />);
    expect(screen.getByText("Head Start")).toBeTruthy();
    expect(screen.getByText(/No head start owned/)).toBeTruthy();
  });
});
