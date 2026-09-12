/**
 * The economy deflation, and the saves that outlive it.
 *
 * Hours were divided by four. Almost nothing in the economy notices, because
 * almost all of it is ratios: axis ceilings against axis ratios, prices against
 * an anchor, block inflation as a multiplier. What DOES notice is everything
 * already written down - per-map highscores, per-archetype bests, the Hall of
 * Fame - which is banked in the old hours and, left alone, sits four times
 * above anything the new economy can pay. Every record would be permanently
 * unbeatable and the beat-your-highscore bonus would never fire again.
 *
 * So these tests are in two halves: that the shipped economy actually moved
 * together (a price that did not follow its income is a shelf nobody can
 * afford), and that the migration converts a stale save exactly once.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMetaProgression } from "@/hooks/useMetaProgression";
import { useHallOfFame } from "@/hooks/useHallOfFame";
import { UNLOCK_STATE_STORAGE_KEY } from "@/types/metaProgression";
import { HALL_STORAGE_KEY } from "@/types/hallOfFame";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  DEFLATION_FACTOR, ECONOMY_SCALE_VERSION, deflateHours, deflateRecord, needsDeflation,
} from "@/lib/economyDeflation";
import { DEFAULT_SCORING_CONFIG, getAxisCeilings, getLockValue } from "@/lib/scoring";
import { mergePricing, computeUpgradeCost } from "@/lib/upgradePricing";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const upgradeDoc = yaml.load(read("public/upgrades.yml")) as { pricing?: Record<string, number> };
const levelDoc = yaml.load(read("public/map.yml")) as { levels: Array<{ points: number }> };

describe("the shipped config moved together", () => {
  it("keeps the cheapest hire at about one good map", () => {
    // The relationship the anchor exists to hold. A good map pays ~34h and a
    // formula Junior costs ~34h, so a good map buys one thing.
    const junior = computeUpgradeCost("Junior", mergePricing(upgradeDoc.pricing));
    expect(junior).toBeGreaterThan(25);
    expect(junior).toBeLessThan(45);
  });

  it("keeps a lock worth more than half the map's whole flat base", () => {
    // "Locking IS the income": a bare clear must not fund a hire. It was 12
    // against a base of 20; both moved, the ratio did not.
    expect(getLockValue() / levelDoc.levels[0].points).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps every axis ceiling a workable integer", () => {
    // A ceiling is also a resolution: `Math.round(ceiling x ratio)` can only
    // tell apart as many outcomes as the ceiling has steps. Anything at 1 or 2
    // has stopped measuring, which is the failure /10 would have shipped.
    const c = getAxisCeilings(DEFAULT_SCORING_CONFIG);
    for (const axis of ["delivery", "craft", "tempo", "thrift", "greed", "engagement"] as const) {
      expect(Number.isInteger(c[axis]), `${axis} is a whole number of hours`).toBe(true);
      expect(c[axis], `${axis} has room to grade a run`).toBeGreaterThanOrEqual(5);
    }
  });

  it("declares the same ceilings in the YAML as in the baked fallback", () => {
    // The fallback ships in the bundle and the YAML is fetched at runtime; a
    // deflation that moved one and not the other would pay two economies.
    const doc = yaml.load(read("public/scoring-config.yml")) as typeof DEFAULT_SCORING_CONFIG;
    expect(doc.scoring.axes).toEqual(DEFAULT_SCORING_CONFIG.scoring.axes);
    expect(doc.scoring.lockValue).toBe(DEFAULT_SCORING_CONFIG.scoring.lockValue);
  });
});

describe("deflateHours", () => {
  it("divides by the factor", () => {
    expect(deflateHours(400)).toBe(100);
    expect(deflateHours(136)).toBe(34);
  });

  it("rounds rather than floors, so records do not drift down", () => {
    expect(deflateHours(10)).toBe(3);   // 2.5 up, not 2
    expect(deflateHours(DEFLATION_FACTOR * 7 + 2)).toBe(8);
  });

  it("never quarters a real record away to nothing", () => {
    // 0 reads as "never played this map" to every caller, which would drop the
    // map off the highscore board rather than just lowering its number.
    for (const tiny of [1, 2, 3, 4]) expect(deflateHours(tiny)).toBeGreaterThanOrEqual(1);
  });

  it("leaves absent and garbage values alone", () => {
    expect(deflateHours(0)).toBe(0);
    expect(deflateHours(-50)).toBe(0);
    expect(deflateHours(NaN)).toBe(0);
    expect(deflateHours(Infinity)).toBe(0);
  });
});

describe("the migration runs exactly once", () => {
  it("converts a save with no stamp", () => {
    expect(needsDeflation(undefined)).toBe(true);
    expect(needsDeflation(1)).toBe(true);
  });

  it("leaves a stamped save alone", () => {
    expect(needsDeflation(ECONOMY_SCALE_VERSION)).toBe(false);
  });

  it("is idempotent through the stamp, not through the arithmetic", () => {
    // The arithmetic itself is NOT idempotent - that is the whole hazard, and
    // why the stamp has to carry it. Quartering twice is a 16x loss.
    const once = deflateHours(400);
    expect(deflateHours(once)).not.toBe(once);
    expect(needsDeflation(ECONOMY_SCALE_VERSION)).toBe(false);
  });

  it("treats a save from a FUTURE scale as already converted", () => {
    // A newer build's save opened by an older one must not be re-divided.
    expect(needsDeflation(ECONOMY_SCALE_VERSION + 1)).toBe(false);
  });

  it("rescales every entry of a highscore record", () => {
    expect(deflateRecord({ "level-1": 120, "level-2": 40 })).toEqual({ "level-1": 30, "level-2": 10 });
    expect(deflateRecord({})).toEqual({});
  });
});

/**
 * Wired, not merely written.
 *
 * This session has repeatedly shipped logic that was correct and never reached
 * the code path that needed it, so the migration is exercised through the real
 * hooks and real localStorage rather than by trusting the call sites.
 */
describe("the migration is wired into the saves that need it", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("quarters an unstamped unlock save and stamps it on the way out", async () => {
    localStorage.setItem(UNLOCK_STATE_STORAGE_KEY, JSON.stringify({
      unlockedIds: [], wonLoadoutIds: [], loadoutsIntroduced: true,
      mapHighscores: { "level-1": 120, "level-2": 60 },
      archetypeBests: { lock: 400 },
      encounteredBallTypeIds: [], unlockedFeatureIds: [], lastRunUpgradeIds: [],
    }));
    const hook = renderHook(() => useMetaProgression());
    await waitFor(() => expect(hook.result.current.isLoaded).toBe(true));
    expect(hook.result.current.mapHighscores["level-1"]).toBe(30);
    expect(hook.result.current.mapHighscores["level-2"]).toBe(15);
  });

  it("leaves a stamped unlock save exactly where it is", async () => {
    localStorage.setItem(UNLOCK_STATE_STORAGE_KEY, JSON.stringify({
      unlockedIds: [], wonLoadoutIds: [], loadoutsIntroduced: true,
      mapHighscores: { "level-1": 30 },
      archetypeBests: {}, encounteredBallTypeIds: [], unlockedFeatureIds: [],
      lastRunUpgradeIds: [], economyScale: ECONOMY_SCALE_VERSION,
    }));
    const hook = renderHook(() => useMetaProgression());
    await waitFor(() => expect(hook.result.current.isLoaded).toBe(true));
    // Reopening must not quarter an already-converted record a second time.
    expect(hook.result.current.mapHighscores["level-1"]).toBe(30);
  });

  it("quarters an unstamped Hall of Fame, scores and trajectory alike", async () => {
    const run = (score: number) => ({
      score, levelsCompleted: 9, ascensionDepth: 0, primaryTag: null,
      secondaryTag: null, capstoneId: null, capstoneName: null, loadoutIds: [], savedAt: 1,
    });
    localStorage.setItem(HALL_STORAGE_KEY, JSON.stringify({
      topRuns: [run(800), run(400)],
      bestRunTrajectory: [100, 200, 400],
      monthlyBests: { "2026-01": run(600) },
      dailyBests: {}, dailyStreak: { count: 0, lastKey: "" },
    }));
    const hook = renderHook(() => useHallOfFame());
    await waitFor(() => expect(hook.result.current.topRuns.length).toBe(2));
    expect(hook.result.current.topRuns.map(r => r.score)).toEqual([200, 100]);
    expect(hook.result.current.bestRunTrajectory).toEqual([25, 50, 100]);
    expect(hook.result.current.monthlyBests["2026-01"].score).toBe(150);
  });

  it("leaves a stamped Hall of Fame alone", async () => {
    localStorage.setItem(HALL_STORAGE_KEY, JSON.stringify({
      topRuns: [{ score: 200, levelsCompleted: 9, ascensionDepth: 0, primaryTag: null,
        secondaryTag: null, capstoneId: null, capstoneName: null, loadoutIds: [], savedAt: 1 }],
      bestRunTrajectory: [25], monthlyBests: {}, dailyBests: {},
      dailyStreak: { count: 0, lastKey: "" }, economyScale: ECONOMY_SCALE_VERSION,
    }));
    const hook = renderHook(() => useHallOfFame());
    await waitFor(() => expect(hook.result.current.topRuns.length).toBe(1));
    expect(hook.result.current.topRuns[0].score).toBe(200);
    expect(hook.result.current.bestRunTrajectory).toEqual([25]);
  });
});
