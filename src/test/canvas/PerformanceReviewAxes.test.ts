/**
 * The canvas Performance Review's rows (src/ui/screens/performanceReviewAxesModel.ts),
 * carrying over the behavioural assertions of resultsDeficit.test.tsx and the
 * axis cases in levelCompleteBreakdown.test.tsx. The flawless-run cases in
 * resultsDeficit test src/lib directly and need no port.
 */
import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import type { BankedAxes } from "@/types/scoring";
import { axisRows } from "@/ui/screens/performanceReviewAxesModel";
import { COLOR } from "@/ui/theme";

const t = i18n.t.bind(i18n) as unknown as TFunction;

const CEILINGS = { delivery: 30, craft: 30, tempo: 24, thrift: 20, greed: 25 };
type Axis = keyof typeof CEILINGS;

function axes(over: Partial<Record<Axis, number>> = {}, ceilingOver: Partial<Record<string, number>> = {}): BankedAxes {
  const banked = { delivery: 30, craft: 18, tempo: 0, thrift: 20, greed: 5, ...over };
  return {
    ...banked,
    total: Object.values(banked).reduce((a, b) => a + b, 0),
    ceilings: { ...CEILINGS, ...ceilingOver },
    ratios: { delivery: 1, craft: 0.6, tempo: 0, thrift: 1, greed: 0.2 },
  } as unknown as BankedAxes;
}

const row = (a: BankedAxes, name: string) => axisRows(a, t).find(r => r.name === name)!;
const texts = (a: BankedAxes) => axisRows(a, t).map(r => r.valueText);

describe("the axis readout", () => {
  it("names what each axis cost you as well as what it paid", () => {
    expect(row(axes({ craft: 18 }), "craft").valueText).toBe("18/30h");
  });

  it("marks a short axis as a loss, so the eye does not read only the 18", () => {
    const r = row(axes({ craft: 18 }), "craft");
    expect(r.tone).toBe("short");
    expect(r.valueColor).toBe(COLOR.destructive);
  });

  it("marks a full axis rather than showing it as a loss of nothing", () => {
    const r = row(axes({ delivery: 30 }), "delivery");
    expect(r.valueText).toBe("30h ✓");
    expect(r.tone).toBe("full");
  });

  it("shows an untouched axis as its whole ceiling lost", () => {
    expect(row(axes({ tempo: 0 }), "tempo").valueText).toBe("0/24h");
  });

  it("says nothing rather than a deficit when the map never offered the axis", () => {
    const all = texts(axes({ greed: 0 }, { greed: 0 }));
    expect(all).not.toContain("-0h");
    expect(all).not.toContain("0/0h");
    expect(row(axes({ greed: 0 }, { greed: 0 }), "greed").valueText).toBe("-");
  });

  it("makes the shortfalls and the banked hours add up on screen", () => {
    expect(row(axes({ greed: 5 }), "greed").valueText).toBe("5/25h");
  });

  it("never reports a total the ring makes unreachable", () => {
    const combined = String(Object.values(CEILINGS).reduce((a, b) => a + b, 0));
    for (const r of axisRows(axes(), t)) {
      expect(r.valueText).not.toContain(combined);
      expect(r.label).not.toContain(combined);
    }
  });

  it("shows an axis that paid nothing, rather than hiding it", () => {
    const a = axes({ craft: 0 }, { craft: 20 });
    expect(row(a, "craft").label).toBe("Craft");
    expect(row(a, "craft").valueText).toBe("0/20h");
  });

  it("does not draw Engagement on a map that never offered it", () => {
    expect(axisRows(axes(), t).map(r => r.name)).not.toContain("engagement");
    const offered = { ...axes(), engagement: 4, ceilings: { ...CEILINGS, engagement: 10 } } as unknown as BankedAxes;
    expect(axisRows(offered, t).map(r => r.name)).toContain("engagement");
  });

  it("fills each bar to earned / ceiling, capped at full", () => {
    expect(row(axes({ craft: 15 }), "craft").fill).toBeCloseTo(0.5);
    expect(row(axes({ craft: 45 }), "craft").fill).toBe(1);
    expect(row(axes({ greed: 0 }, { greed: 0 }), "greed").fill).toBe(0);
  });
});
