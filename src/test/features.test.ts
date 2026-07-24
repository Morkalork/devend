/**
 * Feature-unlock system (features.ts): the catalogue that drives the general
 * "Feature Unlocked" modal. Loadouts is the first feature, earned by beating
 * the level-10 boss; legacy players who already had loadouts keep them.
 */
import { describe, it, expect } from "vitest";
import {
  getAllFeatures,
  getFeature,
  featuresUnlockedAtLevel,
  seedLegacyFeatureUnlocks,
} from "@/lib/features";

describe("feature catalogue (loaded from public/features.yml)", () => {
  it("parses the baked YAML into a non-empty catalogue", () => {
    expect(getAllFeatures().length).toBeGreaterThan(0);
  });

  it("ships loadouts, tied to beating the level-10 boss", () => {
    const loadouts = getFeature("loadouts");
    expect(loadouts).toBeDefined();
    expect(loadouts!.unlockLevel).toBe(10);
  });

  it("ships achievements, tied to clearing level 5", () => {
    const achievements = getFeature("achievements");
    expect(achievements).toBeDefined();
    expect(achievements!.unlockLevel).toBe(5);
  });

  it("ships certificates as an EVENT-unlocked feature (no unlock level)", () => {
    const certificates = getFeature("certificates");
    expect(certificates).toBeDefined();
    expect(certificates!.unlockLevel).toBeUndefined();
  });

  it("getFeature returns undefined for an unknown id", () => {
    expect(getFeature("does-not-exist")).toBeUndefined();
  });

  it("every feature has a stable id, an icon name, a colour, and a numeric-or-absent unlock level", () => {
    for (const f of getAllFeatures()) {
      expect(typeof f.id).toBe("string");
      expect(f.id.length).toBeGreaterThan(0);
      expect(f.unlockLevel === undefined || Number.isFinite(f.unlockLevel)).toBe(true);
      expect(typeof f.icon).toBe("string");
      expect(f.color).toMatch(/^#/);
    }
  });
});

describe("featuresUnlockedAtLevel", () => {
  it("returns achievements exactly when clearing level 5", () => {
    expect(featuresUnlockedAtLevel(5).map(f => f.id)).toContain("achievements");
  });

  it("returns loadouts exactly when completing level 10", () => {
    expect(featuresUnlockedAtLevel(10).map(f => f.id)).toContain("loadouts");
  });

  it("never returns event-unlocked features (certificates) for any level", () => {
    for (let level = 1; level <= 30; level++) {
      expect(featuresUnlockedAtLevel(level).map(f => f.id)).not.toContain("certificates");
    }
  });

  it("returns nothing for a level with no feature attached", () => {
    expect(featuresUnlockedAtLevel(4)).toEqual([]);
    expect(featuresUnlockedAtLevel(9)).toEqual([]);
  });
});

describe("seedLegacyFeatureUnlocks", () => {
  it("grants loadouts to players who had the old first-win flag", () => {
    expect(seedLegacyFeatureUnlocks([], true)).toEqual(["loadouts"]);
  });

  it("leaves the list untouched when the legacy flag is false", () => {
    expect(seedLegacyFeatureUnlocks([], false)).toEqual([]);
  });

  it("is idempotent (never duplicates an already-present id)", () => {
    expect(seedLegacyFeatureUnlocks(["loadouts"], true)).toEqual(["loadouts"]);
  });

  it("preserves other already-unlocked ids", () => {
    expect(seedLegacyFeatureUnlocks(["something"], true)).toEqual(["something", "loadouts"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a"];
    seedLegacyFeatureUnlocks(input, true);
    expect(input).toEqual(["a"]);
  });
});
