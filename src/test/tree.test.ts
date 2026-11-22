/**
 * The ball tree's catalogue (BALL_TREE_PLAN.md phase 3; lib/tree.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { getAllFenceTypes } from "@/lib/fences";
import { catalogueFileFor } from "@/lib/cardRules";
import { mergePricing, resolveUpgradeCost } from "@/lib/upgradePricing";
import {
  DEFAULT_TREE, TREE_BRANCHES, ballPrice, nextRank, nodesOf, parseTreeConfig, rungOffers, rungPrice, startTraitOffer,
} from "@/lib/tree";
import { ROSTER_MAX, RUNG_IDS } from "@/lib/roster";

const data = yaml.load(readFileSync(resolve(__dirname, "../../public/tree.yml"), "utf8")) as UpgradeData;
const nodes = data.upgrades;
const byId = new Map(nodes.map(n => [n.id, n]));

describe("tree.yml", () => {
  it("is the tree rule set's catalogue", () => {
    expect(catalogueFileFor("tree")).toBe("/tree.yml");
    expect(nodes.length).toBeGreaterThanOrEqual(30);
    expect(new Set(nodes.map(n => n.id)).size).toBe(nodes.length);
  });

  it.each(nodes.map(n => [n.id, n] as const))("%s is filed, worded and reaches the engine", (_id, n: UpgradeConfig) => {
    expect(TREE_BRANCHES).toContain(n.branch);
    expect(n.branch).not.toBe("balls");
    expect(n.name).toBeTruthy();
    expect(n.description).toBeTruthy();
    expect(n.description).not.toContain("—");
    for (const key of Object.keys(n.modifiers ?? {})) {
      expect(key in DEFAULT_MODIFIERS, `${n.id}: ${key}`).toBe(true);
    }
    for (const p of n.prerequisites ?? []) {
      expect(byId.has(p), `${n.id} requires ${p}`).toBe(true);
    }
    if (n.upgradeOf) {
      expect(byId.has(n.upgradeOf), `${n.id} rides ${n.upgradeOf}`).toBe(true);
    }
    if (n.grantsFenceType) {
      expect(getAllFenceTypes().map(f => f.id)).toContain(n.grantsFenceType);
    }
    // Nothing in the tree is a number on all balls: those are the player's now.
    for (const key of ["ballSpeedMultiplier", "ballSizeMultiplier", "fastestBallSlowPercent", "openingSlowSeconds"]) {
      expect(n.modifiers?.[key as keyof typeof n.modifiers], `${n.id} sets ${key}`).toBeUndefined();
    }
  });

  it("prices every node and never inflates", () => {
    const pricing = mergePricing(data.pricing);
    expect(pricing.blockInflation).toBe(1);
    for (const n of nodes) {
      const cost = resolveUpgradeCost(n, pricing);
      expect(cost, n.id).not.toBeNull();
      expect(cost!).toBeGreaterThan(0);
    }
  });

  it("files every fence type and every verb", () => {
    const fences = nodesOf("fences", nodes).map(n => n.grantsFenceType).filter(Boolean);
    for (const id of ["ice", "flare", "tripwire", "guardrail", "redeploy", "mutex", "semaphore"]) {
      expect(fences).toContain(id);
    }
    const hands = nodesOf("hands", nodes).map(n => n.id);
    for (const id of ["breakpoint", "stash", "refactor", "rate_limiter", "feature_freeze", "control_freak"]) {
      expect(hands).toContain(id);
    }
  });
});

describe("the roster's prices", () => {
  it("reads the tree block, falling back field by field", () => {
    expect(parseTreeConfig(data.tree)).toEqual({ rungBase: [12, 20, 32], stackFactor: 1.35, ballCost: [30, 50] });
    expect(parseTreeConfig(null)).toEqual(DEFAULT_TREE);
    expect(parseTreeConfig({ stackFactor: 0.5, rungBase: [1, 2] })).toEqual(DEFAULT_TREE);
  });

  it("stacking costs more on one ball, and a rung stops at rank three", () => {
    const plain = { slot: 1, rungs: {} };
    const one = { slot: 1, rungs: { weight: 1 as const } };
    const three = { slot: 1, rungs: { weight: 1 as const, worth: 1 as const, pace: 1 as const } };
    expect(rungPrice(plain, "weight", DEFAULT_TREE)).toBe(12);
    expect(rungPrice(one, "weight", DEFAULT_TREE)).toBe(Math.round(20 * 1.35));
    expect(rungPrice(one, "worth", DEFAULT_TREE)).toBe(Math.round(12 * 1.35));
    expect(rungPrice(three, "frost", DEFAULT_TREE)).toBe(Math.round(12 * Math.pow(1.35, 3)));
    expect(nextRank({ slot: 1, rungs: { sight: 3 } }, "sight")).toBeNull();
    expect(rungPrice({ slot: 1, rungs: { sight: 3 } }, "sight", DEFAULT_TREE)).toBeNull();
    expect(rungOffers(plain, DEFAULT_TREE).map(o => o.rung)).toEqual([...RUNG_IDS]);
    expect(rungOffers({ slot: 1, rungs: { sight: 3 } }, DEFAULT_TREE).map(o => o.rung)).not.toContain("sight");
    // Expense Account's discount.
    expect(rungPrice(plain, "weight", DEFAULT_TREE, 0.7)).toBe(Math.round(12 * 0.7));
  });

  it("breadth costs more per ball, up to the cap", () => {
    expect(ballPrice(1, DEFAULT_TREE)).toBe(30);
    expect(ballPrice(2, DEFAULT_TREE)).toBe(50);
    expect(ballPrice(ROSTER_MAX, DEFAULT_TREE)).toBeNull();
    expect(ballPrice(0, DEFAULT_TREE)).toBeNull();
  });

  it("deals the run-start trait as weight and two others, seeded", () => {
    let i = 0;
    const seq = [0.1, 0.9];
    const pick = () => seq[i++ % seq.length];
    const offer = startTraitOffer(pick);
    expect(offer[0]).toBe("weight");
    expect(new Set(offer).size).toBe(3);
    expect(offer.every(id => RUNG_IDS.includes(id))).toBe(true);
  });
});
