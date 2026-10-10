/**
 * The certificate store's rules (canvas port of
 * components/game/CertificateStore; no DOM test covered it): sections, the
 * nearest-first locked ladder, level selection, pricing and the projected
 * balance.
 */
import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import type { Certificate } from "@/types/certificate";
import type { Achievement } from "@/types/achievement";
import { DEFAULT_META_STATS } from "@/types/metaProgression";
import {
  buyingText, certSections, clearSelection, getCostForSelection, getUnlockInfo, levelRowState, nextLevelCost,
  pendingPurchase, projectedBalance, toggleExpanded, toggleLevelSelection, type UnlockContext,
} from "@/ui/screens/certModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;

const levels = (...costs: number[]) => costs.map(cost => ({ cost, effect: { type: "ballSpeedMultiplier" as const, value: 0.95 } }));
const cert = (id: string, extra: Partial<Certificate> = {}): Certificate => ({
  id, name: id, description: "", unlockType: "always", levels: levels(2, 3, 5), ...extra,
});

const ach: Achievement = {
  id: "fencer", name: "Fencer", description: "Draw fences", requirement: { stat: "totalFencesDrawn", threshold: 100 },
  bonus: { modifier: "ballSpeedMultiplier" as Achievement["bonus"]["modifier"], value: 1, description: "" },
};

const ctx = (over: Partial<UnlockContext> = {}): UnlockContext => ({
  upgrades: [], achievements: [ach], metaStats: { ...DEFAULT_META_STATS, totalFencesDrawn: 80 },
  maxTierCounts: { chain_leaf: 1 }, lifetimeHoursSpent: 3, ...over,
});

describe("pricing", () => {
  it("sums only the levels between owned and the target", () => {
    const c = cert("a");
    expect(getCostForSelection(c, 3, {})).toBe(10);
    expect(getCostForSelection(c, 3, { a: 1 })).toBe(8);
    expect(getCostForSelection(c, 2, { a: 1 })).toBe(3);
  });

  it("projects the balance after every pending selection", () => {
    const certs = [cert("a"), cert("b")];
    expect(projectedBalance(20, {}, certs, {})).toBe(20);
    expect(projectedBalance(20, { a: 2, b: 1 }, certs, { a: 1 })).toBe(20 - 3 - 2);
  });

  it("can afford only a positive cost within the balance, and says how short it is", () => {
    const c = cert("a");
    expect(pendingPurchase(c, 2, {}, 5)).toEqual({ pendingCost: 5, canAfford: true, shortBy: 0 });
    expect(pendingPurchase(c, 3, {}, 5)).toEqual({ pendingCost: 10, canAfford: false, shortBy: 5 });
    expect(pendingPurchase(c, undefined, {}, 5).canAfford).toBe(false);
  });

  it("shows the next level's price, or none once maxed", () => {
    expect(nextLevelCost(cert("a"), 1)).toBe(3);
    expect(nextLevelCost(cert("a"), 3)).toBeNull();
  });
});

describe("selection", () => {
  it("ignores owned levels, toggles the same level off, and moves the target otherwise", () => {
    const owned = { a: 1 };
    expect(toggleLevelSelection({}, "a", 1, owned)).toEqual({});
    const one = toggleLevelSelection({}, "a", 3, owned);
    expect(one).toEqual({ a: 3 });
    expect(toggleLevelSelection(one, "a", 2, owned)).toEqual({ a: 2 });
    expect(toggleLevelSelection(one, "a", 3, owned)).toEqual({});
    expect(clearSelection({ a: 2, b: 1 }, "a")).toEqual({ b: 1 });
  });

  it("marks rows owned, in the pending range, or open", () => {
    expect([1, 2, 3, 4].map(n => levelRowState(n, 1, 3))).toEqual(["owned", "selected", "selected", "open"]);
    expect(levelRowState(2, 1, undefined)).toBe("open");
  });

  it("names a single level or the range being bought", () => {
    expect(buyingText(t, 1, 2)).toBe("Buying Lv 2");
    expect(buyingText(t, 0, 3)).toBe("Buying Lv 1-3");
  });

  it("opens one card at a time", () => {
    expect(toggleExpanded(null, "a")).toBe("a");
    expect(toggleExpanded("a", "b")).toBe("b");
    expect(toggleExpanded("a", "a")).toBeNull();
  });
});

describe("unlocks", () => {
  it("reads each unlock type's progress, capped at the requirement", () => {
    const chain = getUnlockInfo(t, cert("c", { unlockType: "upgrade-chain", sourceUpgradeId: "chain_leaf" }), ctx());
    expect(chain).toMatchObject({ current: 1, required: 3, progressLabel: "runs" });
    expect(chain.requirementText).toContain("3 different runs");

    const viaAch = getUnlockInfo(t, cert("d", { unlockType: "achievement", sourceAchievementId: "fencer" }), ctx());
    expect(viaAch).toMatchObject({ current: 80, required: 100, progressLabel: "fences drawn" });

    const missingAch = getUnlockInfo(t, cert("e", { unlockType: "achievement", sourceAchievementId: "nope" }), ctx());
    expect(missingAch).toMatchObject({ current: 0, required: 1, progressLabel: "" });

    const hours = getUnlockInfo(t, cert("f", { unlockType: "hours-spent", requiredHoursSpent: 2 }), ctx());
    expect(hours).toMatchObject({ current: 2, required: 2 });
  });

  it("splits locked, available and maxed, with the locked ladder nearest first", () => {
    const certs = [
      cert("far", { unlockType: "hours-spent", requiredHoursSpent: 30 }),
      cert("near", { unlockType: "achievement", sourceAchievementId: "fencer" }),
      cert("open"),
      cert("done"),
    ];
    const s = certSections(t, certs, { done: 3, open: 1 }, ["open", "done"], ctx());
    expect(s.available.map(c => c.id)).toEqual(["open"]);
    expect(s.maxed.map(c => c.id)).toEqual(["done"]);
    expect(s.locked.map(c => c.id)).toEqual(["near", "far"]);
  });
});
