/**
 * The two late-game balls (LATE_GAME_PLAN.md): the Autoscaler (act V) and the
 * Feature Flag (act VI). Each is a ball type, so the catalogue, the spawn and
 * the behaviour are pinned here, along with the maps that introduce them.
 */
import { describe, it, expect } from "vitest";
import { getBallType, getSpawnableBallTypes } from "@/lib/ballTypes";
import {
  armAutoscaler, autoscaleRadius, easeAutoscalers, retargetAutoscalers, DEFAULT_AUTOSCALE_MAX,
} from "@/lib/physics/autoscale";
import { armFeatureFlag, flagOffAt, flagSecondsToSwitch, tickFeatureFlags } from "@/lib/physics/featureFlag";
import type { Ball, Region } from "@/types/game";
import type { LevelConfig } from "@/types/level";
import { LADDER } from "./fixtures/maps";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";
import bn from "@/i18n/locales/bn.json";

const ball = (over: Partial<Ball> = {}): Ball => ({
  id: "b", state: "active", radius: 10, regionId: "r1", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 },
  ...over,
}) as Ball;

const region = (id: string, cells: number): Region => ({
  id, polygon: { vertices: [] }, estimatedArea: cells, samplePoints: Array.from({ length: cells }, () => ({ x: 0, y: 0 })),
}) as unknown as Region;

const map = (n: number): LevelConfig => LADDER.find(l => l.level === n)!;

describe("the Autoscaler", () => {
  it("is in the catalogue from 36, and never spat", () => {
    const t = getBallType("autoscaler");
    expect(t?.ability).toBe("autoscale");
    expect(t?.unlockLevel).toBe(36);
    expect(getSpawnableBallTypes(45).some(x => x.ability === "autoscale")).toBe(false);
  });

  it("scales linearly with its room's share of the board", () => {
    expect(autoscaleRadius(10, 2, 1)).toBe(20);
    expect(autoscaleRadius(10, 2, 0.5)).toBe(15);
    expect(autoscaleRadius(10, 2, 0)).toBe(10);
    expect(autoscaleRadius(10, 2, 3)).toBe(20);
  });

  it("is born at its open-board size", () => {
    const b = ball({ ability: "autoscale" });
    armAutoscaler(b, undefined);
    expect(b.autoscaleBase).toBe(10);
    expect(b.radius).toBeCloseTo(10 * DEFAULT_AUTOSCALE_MAX, 5);
  });

  it("shrinks toward its new room after a cut, over a few frames, not at once", () => {
    const b = ball({ ability: "autoscale" });
    armAutoscaler(b, 2);
    retargetAutoscalers([b], [region("r1", 250), region("r2", 750)], 1000);
    expect(b.autoscaleTarget).toBeCloseTo(12.5, 5);
    easeAutoscalers([b], 1 / 60);
    expect(b.radius).toBeLessThan(20);
    expect(b.radius).toBeGreaterThan(12.5);
    for (let i = 0; i < 120; i++) {
      easeAutoscalers([b], 1 / 60);
    }
    expect(b.radius).toBeCloseTo(12.5, 3);
  });

  it("leaves every other ball alone", () => {
    const b = ball();
    retargetAutoscalers([b], [region("r1", 10)], 1000);
    easeAutoscalers([b], 1);
    expect(b.radius).toBe(10);
  });
});

describe("the Feature Flag", () => {
  it("is in the catalogue from 41", () => {
    const t = getBallType("featureflag");
    expect(t?.ability).toBe("featureFlag");
    expect(t?.unlockLevel).toBe(41);
  });

  it("is on for its on stretch, then off for its off stretch", () => {
    const b = ball({ ability: "featureFlag" });
    armFeatureFlag(b, 4, 3, 0);
    expect(flagOffAt(b, 0)).toBe(false);
    expect(flagOffAt(b, 3.9)).toBe(false);
    expect(flagOffAt(b, 4.1)).toBe(true);
    expect(flagOffAt(b, 6.9)).toBe(true);
    expect(flagOffAt(b, 7.1)).toBe(false);
    expect(flagSecondsToSwitch(b, 1)).toBeCloseTo(3, 5);
    expect(flagSecondsToSwitch(b, 5)).toBeCloseTo(2, 5);
  });

  it("is phased per ball, so two flags do not blink as one", () => {
    const a = ball({ ability: "featureFlag" });
    const c = ball({ ability: "featureFlag" });
    armFeatureFlag(a, 4, 3, 0);
    armFeatureFlag(c, 4, 3, 0.7);
    expect(flagOffAt(a, 0)).not.toBe(flagOffAt(c, 0));
  });

  it("writes its state onto the ball each frame, and is never off once locked", () => {
    const b = ball({ ability: "featureFlag" });
    armFeatureFlag(b, 4, 3, 0);
    tickFeatureFlags([b], 5);
    expect(b.flagOff).toBe(true);
    b.state = "won";
    tickFeatureFlags([b], 5);
    expect(b.flagOff).toBe(false);
  });
});

describe("where the ladder introduces them", () => {
  it("meets the Autoscaler on 36 and uses it on 39", () => {
    expect(map(36).ballTypeIds).toContain("autoscaler");
    expect(map(39).ballTypeIds).toContain("autoscaler");
    expect(LADDER.filter(l => (l.level ?? 0) < 36).some(l => l.ballTypeIds?.includes("autoscaler"))).toBe(false);
  });

  it("meets the Feature Flag on 41 and uses it on 44", () => {
    expect(map(41).ballTypeIds).toContain("featureflag");
    expect(map(44).ballTypeIds).toContain("featureflag");
    expect(LADDER.filter(l => (l.level ?? 0) < 41).some(l => l.ballTypeIds?.includes("featureflag"))).toBe(false);
  });

  it("names both in every locale", () => {
    for (const [name, locale] of Object.entries({ es, sv, bn })) {
      const text = JSON.stringify(locale);
      expect(text, name).toContain("\"autoscaler\":{");
      expect(text, name).toContain("\"featureflag\":{");
      expect(text, name).not.toContain("—");
    }
    expect(en).toBeDefined();
  });
});
