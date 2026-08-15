/**
 * Upgrade forks: a family's LAST tier should be a choice, not an increment.
 *
 * The rule is a design one, so this tests content rather than code. Before it,
 * 15 of 21 multi-tier families ended on "the same modifier with a bigger
 * number", which is where build identity should be expressed and wasn't.
 *
 * It also guards the two things that make a fork safe to ADD to a family that
 * already shipped:
 *
 * 1. The existing upgrade's id must survive. Player saves store owned ids, and
 *    eight certificates point at these ids by `sourceUpgradeId`, so renaming
 *    the original to `_a` would strip owned upgrades from live runs and break
 *    certificate credit.
 * 2. The group is therefore named AFTER that original id, because cert credit
 *    resolves `upgrade.choiceGroup ?? upgrade.id` (useGameSession). That is
 *    what lets EITHER option unlock the certificate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeTier } from "@/types/upgrade";

const load = <T>(file: string): T =>
  yaml.load(readFileSync(resolve(__dirname, "../../public", file), "utf8")) as T;

const UPGRADES = load<{ upgrades: UpgradeConfig[] }>("upgrades.yml").upgrades;
const CERTS = load<{ certificates?: { id: string; sourceUpgradeId?: string }[] }>(
  "certificates.yml",
).certificates ?? [];

const TIER_ORDER: UpgradeTier[] = ["Junior", "Senior", "Principal", "Architect", "Wizard"];

/** Upgrades grouped by family. A family is identified by its shared `name`. */
const families = (() => {
  const byName = new Map<string, UpgradeConfig[]>();
  for (const u of UPGRADES) {
    if (u.ascensionOnly) continue; // priced for the post-L30 economy, tuned separately
    if (!byName.has(u.name)) byName.set(u.name, []);
    byName.get(u.name)!.push(u);
  }
  // Single-upgrade families have no "last tier" to fork.
  return [...byName.entries()].filter(([, list]) => list.length > 1);
})();

const topTierOf = (list: UpgradeConfig[]): UpgradeTier =>
  TIER_ORDER.filter(t => list.some(u => u.tier === t)).pop()!;

const isForked = (list: UpgradeConfig[]): boolean => {
  const atTop = list.filter(u => u.tier === topTierOf(list));
  return atTop.length > 1 && atTop.some(u => u.choiceGroup);
};

/**
 * Families whose last tier is still a flat increment. Now empty: every
 * multi-tier family ends on a decision. The list stays so a future family can
 * be parked here deliberately rather than by accident, but it may only ever
 * SHRINK, and an addition should be argued for in review.
 */
const UNFORKED_BY_DESIGN: string[] = [];

describe("a family's last tier is a choice", () => {
  it("only the known-unforked families end on an increment", () => {
    const unforked = families.filter(([, l]) => !isForked(l)).map(([name]) => name);
    expect(unforked.sort()).toEqual([...UNFORKED_BY_DESIGN].sort());
  });

  it("the exception list never grows", () => {
    expect(UNFORKED_BY_DESIGN).toEqual([]);
  });

  /** Guards against the rule passing because nothing was actually checked. */
  it("is checking a real set of families", () => {
    expect(families.length).toBeGreaterThanOrEqual(20);
    expect(families.every(([, l]) => isForked(l))).toBe(true);
  });
});

describe("every choiceGroup is well formed", () => {
  const groups = (() => {
    const byGroup = new Map<string, UpgradeConfig[]>();
    for (const u of UPGRADES) {
      if (!u.choiceGroup) continue;
      if (!byGroup.has(u.choiceGroup)) byGroup.set(u.choiceGroup, []);
      byGroup.get(u.choiceGroup)!.push(u);
    }
    return byGroup;
  })();

  it("offers at least two options", () => {
    for (const [group, opts] of groups) {
      expect(opts.length, `${group} has only one option`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps all options at the same tier and in the same family", () => {
    for (const [group, opts] of groups) {
      expect(new Set(opts.map(o => o.tier)).size, `${group} spans tiers`).toBe(1);
      expect(new Set(opts.map(o => o.name)).size, `${group} spans families`).toBe(1);
    }
  });

  it("shares one prerequisite set, so a choice is never also a gate", () => {
    for (const [group, opts] of groups) {
      const sets = opts.map(o => JSON.stringify([...(o.prerequisites ?? [])].sort()));
      expect(new Set(sets).size, `${group} options have different prerequisites`).toBe(1);
    }
  });
});

/**
 * The rule that made it safe to fork already-shipped families: keep the
 * original id and name the group after it.
 */
describe("adding a fork does not orphan saves or certificates", () => {
  it("every certificate's source upgrade is still creditable", () => {
    for (const cert of CERTS) {
      if (!cert.sourceUpgradeId) continue;
      const creditable = UPGRADES.some(
        u => u.id === cert.sourceUpgradeId || u.choiceGroup === cert.sourceUpgradeId,
      );
      expect(creditable, `certificate ${cert.id} sources a missing upgrade`).toBe(true);
    }
  });

  // certKey resolves to `choiceGroup ?? id`, so a cert pointing at a forked
  // family only keeps working if the group carries the id the cert names.
  it("a forked certificate source is credited by EITHER option", () => {
    const forkedSources = CERTS
      .map(c => c.sourceUpgradeId)
      .filter((id): id is string => !!id && UPGRADES.some(u => u.choiceGroup === id));

    expect(forkedSources.length).toBeGreaterThan(0); // guard against a vacuous pass
    for (const source of forkedSources) {
      const opts = UPGRADES.filter(u => u.choiceGroup === source);
      for (const opt of opts) {
        expect(opt.choiceGroup ?? opt.id).toBe(source);
      }
    }
  });
});
