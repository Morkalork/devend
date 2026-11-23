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

/** The longest description a node has room to draw (ui/screens/treeLayout.ts NODE_W, NODE_H). */
const BRIEF_MAX = 60;
/** Translations run longer than English; this is what three lines hold. */
const BRIEF_MAX_TRANSLATED = 90;

describe("the tree's words in every language", () => {
  it.each(["es", "sv", "bn"])("%s keeps every node's description short enough for its node", (lang) => {
    const locale = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${lang}.json`), "utf8"));
    const words = locale.content.tree as Record<string, { description?: string; detail?: string }>;
    for (const n of nodes) {
      const text = words[n.id]?.description;
      expect(text, `${lang}: ${n.id} has no description`).toBeTruthy();
      expect(text!.length, `${lang}: ${n.id}: "${text}"`).toBeLessThanOrEqual(BRIEF_MAX_TRANSLATED);
      // The fine print is translated wherever the English has some.
      expect(!!words[n.id]?.detail, `${lang}: ${n.id} detail`).toBe(!!n.detail);
    }
  });
});

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
    // The tree draws the description ON the node, three lines of it at most,
    // so it is one short line; what only a buyer needs goes in `detail`.
    expect(n.description.length, `${n.id}: "${n.description}"`).toBeLessThanOrEqual(BRIEF_MAX);
    expect(n.detail ?? "").not.toContain("—");
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

  it("grows in steps: one root a branch, every other node behind a parent, some behind two", () => {
    // The owner's rule: X1 before X2, and X1 and Z1 before Y1, so an early,
    // modest buy opens a family and the branches meet further out.
    for (const branch of ["fences", "hands", "office"] as const) {
      const mine = nodesOf(branch, nodes);
      const roots = mine.filter(n => (n.prerequisites ?? []).length === 0 && !n.upgradeOf);
      expect(roots.map(r => r.id), branch).toHaveLength(1);
      expect(roots[0].tier).toBe("Junior");
      for (const n of mine) {
        for (const p of n.prerequisites ?? []) {
          expect(byId.get(p)!.branch, `${n.id} reaches across to ${p}`).toBe(branch);
        }
      }
    }
    const twoParents = nodes.filter(n => (n.prerequisites ?? []).length >= 2);
    expect(twoParents.length).toBeGreaterThanOrEqual(6);
    // Deeper is dearer: a child's tier never falls below a parent's.
    const rank = { Junior: 0, Senior: 1, Principal: 2, Architect: 3, Wizard: 4 } as Record<string, number>;
    for (const n of nodes) {
      for (const p of [...(n.prerequisites ?? []), ...(n.upgradeOf ? [n.upgradeOf] : [])]) {
        expect(rank[n.tier], `${n.id} under ${p}`).toBeGreaterThanOrEqual(rank[byId.get(p)!.tier]);
      }
    }
  });

  it("prices effort: an ordinary map buys a root, a great map a Senior, a flawless map a Principal", () => {
    // upgradePricing.ts measured ordinary 16h, good 34h, flawless 47h.
    const pricing = mergePricing(data.pricing);
    const at = (tier: string) => resolveUpgradeCost({ tier: tier as UpgradeConfig["tier"] }, pricing)!;
    expect(at("Junior")).toBeLessThanOrEqual(16);
    expect(at("Senior")).toBeGreaterThan(16);
    expect(at("Senior")).toBeLessThanOrEqual(34);
    expect(at("Principal")).toBeGreaterThan(34);
    expect(at("Principal")).toBeLessThanOrEqual(47);
    expect(at("Architect")).toBeGreaterThan(47);
    // The roster's rungs follow the same three steps.
    expect(DEFAULT_TREE.rungBase[0]).toBeLessThanOrEqual(16);
    expect(DEFAULT_TREE.rungBase[1]).toBeLessThanOrEqual(34);
    expect(DEFAULT_TREE.rungBase[2]).toBeLessThanOrEqual(47);
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
    expect(parseTreeConfig(data.tree)).toEqual({ rungBase: [15, 30, 45], stackFactor: 1.25, ballCost: [30, 45] });
    expect(parseTreeConfig(null)).toEqual(DEFAULT_TREE);
    expect(parseTreeConfig({ stackFactor: 0.5, rungBase: [1, 2] })).toEqual(DEFAULT_TREE);
  });

  it("stacking costs more on one ball, and a rung stops at rank three", () => {
    const plain = { slot: 1, rungs: {} };
    const one = { slot: 1, rungs: { weight: 1 as const } };
    const three = { slot: 1, rungs: { weight: 1 as const, worth: 1 as const, pace: 1 as const } };
    expect(rungPrice(plain, "weight", DEFAULT_TREE)).toBe(15);
    expect(rungPrice(one, "weight", DEFAULT_TREE)).toBe(Math.round(30 * 1.25));
    expect(rungPrice(one, "worth", DEFAULT_TREE)).toBe(Math.round(15 * 1.25));
    expect(rungPrice(three, "frost", DEFAULT_TREE)).toBe(Math.round(15 * Math.pow(1.25, 3)));
    expect(nextRank({ slot: 1, rungs: { sight: 3 } }, "sight")).toBeNull();
    expect(rungPrice({ slot: 1, rungs: { sight: 3 } }, "sight", DEFAULT_TREE)).toBeNull();
    expect(rungOffers(plain, DEFAULT_TREE).map(o => o.rung)).toEqual([...RUNG_IDS]);
    expect(rungOffers({ slot: 1, rungs: { sight: 3 } }, DEFAULT_TREE).map(o => o.rung)).not.toContain("sight");
    // Expense Account's discount.
    expect(rungPrice(plain, "weight", DEFAULT_TREE, 0.7)).toBe(Math.round(15 * 0.7));
  });

  it("breadth costs more per ball, up to the cap", () => {
    expect(ballPrice(1, DEFAULT_TREE)).toBe(30);
    expect(ballPrice(2, DEFAULT_TREE)).toBe(45);
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
