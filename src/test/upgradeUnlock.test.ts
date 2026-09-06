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
import {
  prerequisitesMet, choiceGroupTaken, choiceGroups, familyOfChoiceGroup,
  unlockRequirements,
} from "@/lib/upgradeUnlock";
import { hasFreeFenceSlot, fenceOfferIsEmpty, ACQUIRABLE_SLOTS } from "@/lib/fenceOwnership";
import { getAllFenceTypes, STANDARD_FENCE_ID } from "@/lib/fences";
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

describe("the fences the catalogue gates this way", () => {
  const gated = CATALOGUE.filter(u => u.grantsFenceType && u.unlockAfterChoice);

  it("crowns a maxed family per gated fence, one family each", () => {
    expect(gated.map(u => u.grantsFenceType).sort())
      .toEqual(["flare", "ice", "mutex", "redeploy", "semaphore", "tripwire"]);
    // A different family each, so no one line hands out two fences.
    const groups = gated.map(u => u.unlockAfterChoice);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("carries a tag its family already has", () => {
    // Not decoration. Shop weight is 1 + owned upgrades sharing a tag, so a
    // player who just maxed the family owns three or four of that tag and the
    // fence rolls at four or five times the baseline. Without the shared tag it
    // rolls at 1 and "a chance to show up" is a chance nobody gets.
    const byGroup = choiceGroups(CATALOGUE);
    for (const u of gated) {
      const familyName = byGroup.get(u.unlockAfterChoice!)![0].name;
      const familyTags = new Set(
        CATALOGUE.filter(x => x.name === familyName).flatMap(x => x.tags ?? []));
      const shared = (u.tags ?? []).filter(t => familyTags.has(t));
      expect(shared.length, `${u.id} shares no tag with ${familyName}`)
        .toBeGreaterThan(0);
    }
  });

  it("is priced as a payoff, not as a mid-chain step", () => {
    // Principal or Architect, both of which cost noticeably more per level than
    // the Senior these used to be. A fence you walk a whole family for that
    // costs what a Senior costs is not a payoff.
    for (const u of gated) {
      expect(["Principal", "Architect"], `${u.id} is a ${u.tier}`).toContain(u.tier);
    }
  });

  it("does not sit behind ordinary prerequisites as well", () => {
    // The gate IS the requirement. A chain on top of it would be a second
    // commitment nobody asked for, and it would put the fence behind a branch
    // again - the thing unlockAfterChoice exists to avoid.
    for (const u of gated) {
      expect(u.prerequisites ?? [], `${u.id} is gated twice`).toEqual([]);
    }
  });
});

describe("a locked card says WHY it is locked", () => {
  /**
   * The screens that answer "what do I need for this" all read `prerequisites`,
   * and a family-gated fence has none at all. So the day the fences moved:
   *
   *   the shop's locked tooltip printed "Requires" and then nothing;
   *   the shop's detail card said "Nothing required" on a card it refuses to
   *     sell;
   *   the Atlas said "Nothing. This is a chain head." about the four
   *     most-gated upgrades in the catalogue.
   *
   * An unbuyable card that claims to need nothing is worse than an unexplained
   * one - it reads as the shop being broken rather than as a locked upgrade.
   */
  it("names the family a gated upgrade is waiting on", () => {
    const ice = CATALOGUE.find(u => u.id === "cold_storage_ice")!;
    const need = unlockRequirements(ice, CATALOGUE);
    expect(need.prereqs, "ice grew a prerequisite as well").toEqual([]);
    expect(need.maxedFamily).toBe("Feature Freeze");
  });

  it("reads the family name off the group's own members", () => {
    expect(familyOfChoiceGroup("feature_freeze_principal", CATALOGUE))
      .toBe("Feature Freeze");
    expect(familyOfChoiceGroup("no_such_group", CATALOGUE)).toBeNull();
  });

  it("leaves an ordinary chained upgrade reading exactly as before", () => {
    const chained = CATALOGUE.find(u => (u.prerequisites ?? []).length > 0)!;
    const need = unlockRequirements(chained, CATALOGUE);
    expect(need.prereqs.map(p => p.id)).toEqual(chained.prerequisites);
    expect(need.maxedFamily).toBeNull();
  });

  for (const [file, path] of [
    ["the shop", "src/components/game/UpgradeShop.tsx"],
    ["the Atlas", "src/components/admin/UpgradeAtlasScreen.tsx"],
  ] as const) {
    it(`${file} asks about both gates, not just prerequisites`, () => {
      const src = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(src).toMatch(/unlockRequirements\(|familyOfChoiceGroup\(/);
    });
  }
});

describe("the shelf knows the fence bar can be full", () => {
  /**
   * SIX acquirable types against FOUR slots. fenceSlotsFrom caps silently, so a
   * fence card offered into a full bar takes the player's hours and grants
   * nothing - which fenceOwnership's own comment calls the one outcome a store
   * must never have. It had the guard from the day it was written and NOTHING
   * CALLED IT, and the rewrite is what made hitting the cap ordinary: the open
   * shelf plus the account-scoped drill are two slots before a single family is
   * maxed.
   */
  it("has more acquirable types than slots, which is why this matters", () => {
    const acquirable = getAllFenceTypes().filter(f => f.id !== STANDARD_FENCE_ID);
    expect(acquirable.length).toBeGreaterThan(ACQUIRABLE_SLOTS);
  });

  it("stops offering a NEW fence type once the bar is full", () => {
    const room = ["ice", "flare", "redeploy"];
    const full = [...room, "drill"];
    expect(hasFreeFenceSlot(room)).toBe(true);
    expect(hasFreeFenceSlot(full)).toBe(false);
    expect(fenceOfferIsEmpty("tripwire", room)).toBe(false);
    expect(fenceOfferIsEmpty("tripwire", full)).toBe(true);
  });

  it("stops offering one the bar already holds, which grants nothing either", () => {
    expect(fenceOfferIsEmpty("ice", ["ice"])).toBe(true);
  });

  it("says nothing about a card that grants no fence at all", () => {
    expect(fenceOfferIsEmpty(undefined, ["ice", "flare", "redeploy", "drill"])).toBe(false);
  });

  it("is the rule the shelf actually filters on", () => {
    // Not "the module is imported": the guard was importable and dead for the
    // whole of its life, which is the bug this section is about.
    const src = readFileSync(
      resolve(process.cwd(), "src/components/game/UpgradeShop.tsx"), "utf8");
    expect(src).toMatch(/!fenceOfferIsEmpty\(u\.grantsFenceType, heldFenceTypeIds\)/);
    // Against the list the BAR is drawn from, not a second derivation: the held
    // set comes from three economies and two readings of it would be free to
    // disagree with what the player is looking at.
    const wiring = readFileSync(resolve(process.cwd(), "src/pages/Index.tsx"), "utf8");
    expect(wiring).toMatch(/heldFenceTypeIds=\{session\.fenceSlotIds\}/);
  });
});
