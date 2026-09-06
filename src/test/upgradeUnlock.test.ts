/**
 * "Available once you've maxed that family" - the gate `prerequisites` cannot say.
 *
 * Every multi-tier family in upgrades.yml ends in a `choiceGroup` of two
 * mutually exclusive options, and `prerequisites` is AND. So a reward for
 * finishing a line had exactly two ways to be written, and both are wrong:
 *
 *   BOTH BRANCHES  upgradeGraph calls it mutually-exclusive-prereqs, an ERROR:
 *                  they lock each other out, so it can never be bought.
 *   ONE BRANCH     choice-gated-branch, a warning, and a fair one - take the
 *                  other option and the reward is gone for the whole run. A
 *                  payoff a coin flip deletes is not a payoff for finishing.
 *
 * `unlockAfterChoice` is the third way: eligible once ANY member is owned.
 *
 * The failure this file is really written around is the SECOND READER. The
 * shelf split in UpgradeShop read `prerequisites` itself rather than going
 * through isLocked, so a new gate enforced in one and not the other would have
 * offered a card the buy button then refused - which reads as a broken shop
 * rather than as a locked upgrade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { prerequisitesMet, choiceGroupTaken, choiceGroups } from "@/lib/upgradeUnlock";
import { buildUpgradeGraph } from "@/lib/upgradeGraph";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";

const CATALOGUE = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as UpgradeData).upgrades as UpgradeConfig[];

const up = (over: Partial<UpgradeConfig>): UpgradeConfig =>
  ({ id: "x", name: "X", tier: "Senior", description: "", ...over } as UpgradeConfig);

const index = (list: UpgradeConfig[]) => new Map(list.map(u => [u.id, u]));

const FORK = [
  up({ id: "top_a", choiceGroup: "top" }),
  up({ id: "top_b", choiceGroup: "top" }),
];

describe("the family-maxed gate", () => {
  const gated = up({ id: "reward", unlockAfterChoice: "top" });
  const byId = index([...FORK, gated]);

  it("stays shut until one of the branches is taken", () => {
    expect(prerequisitesMet(gated, [], byId)).toBe(false);
    expect(prerequisitesMet(gated, ["something_else"], byId)).toBe(false);
  });

  it("opens on EITHER branch, which is the whole point", () => {
    // Naming one branch in `prerequisites` would make this a coin flip.
    expect(prerequisitesMet(gated, ["top_a"], byId)).toBe(true);
    expect(prerequisitesMet(gated, ["top_b"], byId)).toBe(true);
  });

  it("still honours ordinary prerequisites alongside it", () => {
    // Both gates, not either: an upgrade may want a chain AND a maxed family,
    // and reading one as satisfying the other would open it early.
    const both = up({ id: "reward", unlockAfterChoice: "top", prerequisites: ["root"] });
    const m = index([...FORK, both, up({ id: "root" })]);
    expect(prerequisitesMet(both, ["top_a"], m)).toBe(false);
    expect(prerequisitesMet(both, ["root"], m)).toBe(false);
    expect(prerequisitesMet(both, ["root", "top_b"], m)).toBe(true);
  });

  it("is not fooled by an owned id the catalogue does not know", () => {
    expect(choiceGroupTaken("top", ["ghost"], byId)).toBe(false);
  });
});

describe("both readers ask the same question", () => {
  it("the shop shelf goes through the shared rule, not its own copy", () => {
    // The shelf's unlocked/locked split had its own `prerequisites.every(...)`.
    // A gate added to isLocked and not to that split offers a card the buy
    // button refuses, which reads as a broken shop.
    const src = readFileSync(
      resolve(process.cwd(), "src/components/game/UpgradeShop.tsx"), "utf8");
    expect(src).toMatch(/prerequisitesMet\(u, ownedUpgradeIds, byId\)/);
    expect(src, "the shelf reads prerequisites itself again")
      .not.toMatch(/u\.prerequisites\.every\(/);
  });

  it("isLocked goes through it too", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/hooks/useUpgradeManager.ts"), "utf8");
    expect(src).toMatch(/!prerequisitesMet\(upgrade, ownedIds, state\.upgradeLookup\)/);
    expect(src, "isLocked reads prerequisites itself again")
      .not.toMatch(/upgrade\.prerequisites\.some\(/);
  });
});

describe("the shipped catalogue", () => {
  it("has a two-way fork at the top of every multi-tier family", () => {
    // The premise. If a family ever ends in a single node, gating on it could
    // go back to being an ordinary prerequisite and this field would be dead
    // weight - so the premise is worth failing on rather than assuming.
    const groups = choiceGroups(CATALOGUE);
    expect(groups.size).toBeGreaterThan(20);
    const lonely = [...groups].filter(([, m]) => m.length < 2).map(([g]) => g);
    expect(lonely, "a choice group with nothing to choose between").toEqual([]);
  });

  it("points every gate at a real group it is not part of", () => {
    const groups = choiceGroups(CATALOGUE);
    const bad = CATALOGUE
      .filter(u => u.unlockAfterChoice)
      .filter(u => {
        const members = groups.get(u.unlockAfterChoice!);
        return !members || members.some(m => m.id === u.id);
      })
      .map(u => `${u.id} -> ${u.unlockAfterChoice}`);
    expect(bad).toEqual([]);
  });

  it("raises no graph errors over the whole catalogue", () => {
    // Including the new dead-family-gate kind, which is what a mistyped group
    // id would surface as.
    const { issues } = buildUpgradeGraph(CATALOGUE);
    const errors = issues.filter(i => i.severity === "error")
      .map(i => `${i.kind}: ${i.message}`);
    expect(errors).toEqual([]);
  });
});
