/**
 * Performance Review (canvas port of components/game/HallOfFameScreen): the
 * behavioural assertions of src/test/hallOfFameScreen.test.tsx, against the
 * screen's model instead of rendered text.
 */
import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import { TAG_ORDER } from "@/lib/buildRecap";
import type { RunLedgerEntry } from "@/types/hallOfFame";
import { DEFAULT_META_STATS } from "@/types/metaProgression";
import {
  RANK_COLORS, archetypeBestText, buildName, capitalizeWords, gridRows, hoursText, lifetimeStats,
  monthLabel, recentDailies, showDaily, sortMapRecords, sortPlaques,
} from "@/ui/screens/hallModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;

const runs: RunLedgerEntry[] = [
  {
    score: 612, levelsCompleted: 22, ascensionDepth: 1,
    primaryTag: "lock", secondaryTag: "risk",
    capstoneId: "golden_handshake", capstoneName: "Golden Handshake",
    loadoutIds: ["crunch_time"], savedAt: 1752600000000,
  },
  {
    score: 431, levelsCompleted: 15, ascensionDepth: 0,
    primaryTag: null, secondaryTag: null,
    capstoneId: null, capstoneName: null, loadoutIds: [], savedAt: 1752500000000,
  },
];

describe("HallOfFameScreen model", () => {
  it("scores read as hours, and the archetype grid shows empty slots as '-'", () => {
    expect(hoursText(612)).toBe("612h");
    const bests: Record<string, number> = { lock: 612, freeze: 200 };
    const cells = TAG_ORDER.map(tag => archetypeBestText(bests[tag]));
    expect(cells).toHaveLength(6);
    expect(cells.filter(c => c === "-")).toHaveLength(4);
    expect(cells).toContain("612h");
    expect(cells).toContain("200h");
  });

  it("names a build from its tags, with the Generalist fallback", () => {
    expect(buildName(t, runs[1])).toMatch(/Generalist/i);
    const combo = buildName(t, runs[0]);
    expect(combo).toContain(t("upgradeShop.tags.lock"));
    expect(combo).toContain(t("upgradeShop.tags.risk"));
    expect(buildName(t, { primaryTag: "lock", secondaryTag: null })).toBe(t("upgradeShop.tags.lock"));
  });

  it("labels depth through i18n", () => {
    expect(t("hallOfFame.depthLabel", { depth: 1 })).toMatch(/Depth 1/);
    expect(t("hallOfFame.deepestAscension")).toBe("Deepest Ascension");
    expect(t("hallOfFame.employeeOfMonth")).toBe("Employee of the Month");
  });

  it("orders plaques newest month first, with localized month labels", () => {
    const plaques = sortPlaques({ "2026-06": runs[1], "2026-07": runs[0] });
    expect(plaques.map(([m]) => monthLabel(m, "en"))).toEqual(["July 2026", "June 2026"]);
    expect(plaques.map(([, r]) => r.score)).toEqual([612, 431]);
  });

  it("sorts map records naturally (level-2b before level-10)", () => {
    const ids = sortMapRecords({ "level-1": 34, "level-10": 61, "level-2b": 40 }).map(([id]) => id);
    expect(ids).toEqual(["level-1", "level-2b", "level-10"]);
  });

  it("keeps the last seven dailies, newest first, and shows the section only with something in it", () => {
    const dailies: Record<string, RunLedgerEntry> = {};
    for (let d = 1; d <= 9; d++) dailies[`2026-07-0${d}`] = runs[1];
    const recent = recentDailies(dailies);
    expect(recent).toHaveLength(7);
    expect(recent[0][0]).toBe("2026-07-09");
    expect(showDaily([], 0)).toBe(false);
    expect(showDaily([], 2)).toBe(true);
    expect(showDaily(recent, 0)).toBe(true);
  });

  it("gold, silver, bronze, then muted", () => {
    expect(RANK_COLORS).toHaveLength(3);
    expect(RANK_COLORS[3]).toBeUndefined();
  });

  it("lists the four lifetime stats in order", () => {
    const m = { ...DEFAULT_META_STATS, highestLevelReached: 7, totalFencesDrawn: 300, totalLevelsCompletedWithoutLoss: 4, totalLivesLost: 9 };
    expect(lifetimeStats(m)).toEqual([["highestLevel", 7], ["fencesDrawn", 300], ["perfectMaps", 4], ["livesLost", 9]]);
  });

  it("capitalizes like CSS and splits grids into rows", () => {
    expect(capitalizeWords("julio de 2026")).toBe("Julio De 2026");
    expect(gridRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
