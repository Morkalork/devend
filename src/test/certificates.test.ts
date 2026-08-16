import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { CertConfig } from "@/types/certificate";
import type { AchievementConfig } from "@/types/achievement";
import type { UpgradeData } from "@/types/upgrade";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { certEffectLabel } from "@/lib/certEffectLabel";

// Read straight from the YAML sources of truth so this suite guards the data,
// not a hand-maintained copy of it (same approach as upgrades.test.ts).
const read = <T,>(file: string): T =>
  yaml.load(readFileSync(resolve(process.cwd(), file), "utf8")) as T;

const certificates = read<CertConfig>("public/certificates.yml").certificates;
const achievementIds = new Set(
  read<AchievementConfig>("public/achievements.yml").achievements.map(a => a.id),
);
const upgrades = read<UpgradeData>("public/upgrades.yml").upgrades;
const upgradeIds = new Set(upgrades.map(u => u.id));

// A certificate sources an upgrade id OR a choiceGroup: when a tier forks into
// mutually-exclusive options, useGameSession credits the group instead of the
// option (see its certKey), so either choice unlocks the same certificate.
const certCreditKeys = new Set([
  ...upgradeIds,
  ...upgrades.map(u => u.choiceGroup).filter((g): g is string => !!g),
]);

describe("certificate catalogue integrity", () => {
  it("has unique ids", () => {
    const ids = certificates.map(c => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  // These cross-file references are pure strings, so a rename or a deletion in
  // achievements.yml/upgrades.yml silently strands a certificate: it loads fine
  // and simply never unlocks, which is invisible until a player asks why.
  it("points every achievement unlock at a real achievement", () => {
    const broken = certificates
      .filter(c => c.unlockType === "achievement")
      .filter(c => !c.sourceAchievementId || !achievementIds.has(c.sourceAchievementId))
      .map(c => `${c.id} -> ${c.sourceAchievementId ?? "(none)"}`);
    expect(broken).toEqual([]);
  });

  it("points every upgrade-chain unlock at a real upgrade or choice group", () => {
    const broken = certificates
      .filter(c => c.unlockType === "upgrade-chain")
      .filter(c => !c.sourceUpgradeId || !certCreditKeys.has(c.sourceUpgradeId))
      .map(c => `${c.id} -> ${c.sourceUpgradeId ?? "(none)"}`);
    expect(broken).toEqual([]);
  });

  it("gives every hours-spent unlock a threshold", () => {
    const broken = certificates
      .filter(c => c.unlockType === "hours-spent")
      .filter(c => !(typeof c.requiredHoursSpent === "number" && c.requiredHoursSpent > 0))
      .map(c => c.id);
    expect(broken).toEqual([]);
  });

  // An effect naming a modifier that no longer exists is dropped on merge, so
  // the level costs real Certificate Hours and then does nothing at all.
  it("only grants effects the modifier pipeline actually reads", () => {
    const known = new Set([...Object.keys(DEFAULT_MODIFIERS), "startingLevelBonus"]);
    const unknown: string[] = [];
    for (const c of certificates)
      for (const l of c.levels) if (!known.has(l.effect.type)) unknown.push(`${c.id} -> ${l.effect.type}`);
    expect(unknown).toEqual([]);
  });

  it("prices every level, and never cheaper than the level before it", () => {
    for (const c of certificates) {
      expect(c.levels.length, `${c.id} has no levels`).toBeGreaterThan(0);
      let prev = 0;
      for (const l of c.levels) {
        expect(l.cost, `${c.id} level cost`).toBeGreaterThan(0);
        expect(l.cost, `${c.id} costs must not decrease`).toBeGreaterThanOrEqual(prev);
        prev = l.cost;
      }
    }
  });
});

// A minimal stand-in for i18next's `t`: resolves a dotted key against the real
// en.json and interpolates {{...}}. Using the actual locale file means these
// tests fail if a label key is missing, not just if the formatter forgets one.
const en = JSON.parse(readFileSync(resolve(process.cwd(), "src/i18n/locales/en.json"), "utf8"));
const fakeT = ((key: string, opts?: Record<string, unknown>) => {
  const hit = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
  if (typeof hit !== "string") return (opts?.defaultValue as string) ?? "";
  return hit.replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts?.[name] ?? `{{${name}}}`));
}) as unknown as Parameters<typeof certEffectLabel>[0];

describe("certificate effect labels", () => {
  // The store shows one description for the whole certificate, so the only
  // place a level's actual value can be stated is this label. A type with no
  // label renders an empty row: a priced button that says nothing.
  it("labels every effect used in certificates.yml", () => {
    const unlabelled: string[] = [];
    for (const c of certificates)
      for (const l of c.levels)
        if (!certEffectLabel(fakeT, l.effect).trim()) unlabelled.push(`${c.id} -> ${l.effect.type}`);
    expect(unlabelled).toEqual([]);
  });

  it("leaves no interpolation placeholder unfilled", () => {
    const leaky: string[] = [];
    for (const c of certificates)
      for (const l of c.levels)
        if (certEffectLabel(fakeT, l.effect).includes("{{")) leaky.push(`${c.id} -> ${l.effect.type}`);
    expect(leaky).toEqual([]);
  });

  it("signs deltas by direction, not by whether the number is a bonus", () => {
    // 0.95 is a REDUCTION even though it is a good thing, and 1.05 an increase
    // even where that is bad (shop prices). The sign must follow the number.
    expect(certEffectLabel(fakeT, { type: "ballSpeedMultiplier", value: 0.95 })).toBe("Ball speed -5%");
    expect(certEffectLabel(fakeT, { type: "scoreMultiplier", value: 1.05 })).toBe("Overtime +5%");
    // 0.93 - 1 is -0.07000000000000006 in floating point.
    expect(certEffectLabel(fakeT, { type: "shopDiscountMultiplier", value: 0.93 })).toBe("Shop prices -7%");
    expect(certEffectLabel(fakeT, { type: "extraLives", value: 1 })).toBe("Starting lives +1");
  });

  it("returns empty for an unknown type rather than inventing a label", () => {
    expect(certEffectLabel(fakeT, { type: "notAModifier" as never, value: 3 })).toBe("");
  });
});

/**
 * Something has to be buyable on day one.
 *
 * Certificate Hours start accruing on the first run, but every certificate was
 * gated behind an upgrade chain, an achievement or lifetime spending, so the
 * store was a room of locked doors and the currency was easy to forget you had.
 * At least one cert is now simply on the shelf.
 *
 * (Benchmarking used to be tested here. It was removed: a HUD toggle bought
 * with the same scarce currency as a permanent stat was never worth the hours.)
 */
describe("the store has something to sell from the start", () => {
  const starters = certificates.filter(c => c.unlockType === "always");

  it("carries at least one certificate that needs no unlocking", () => {
    expect(starters.length).toBeGreaterThanOrEqual(1);
  });

  it("prices the first level within reach of an early run", () => {
    // Hours come in at 1 per 5 levels, so anything much past this is not
    // really "available from the start", it just looks like it.
    for (const cert of starters) {
      expect(cert.levels[0].cost, `${cert.id} opening level`).toBeLessThanOrEqual(6);
    }
  });

  it("needs no source, since there is nothing to source it from", () => {
    for (const cert of starters) {
      expect(cert.sourceUpgradeId, cert.id).toBeUndefined();
      expect(cert.sourceAchievementId, cert.id).toBeUndefined();
      expect(cert.requiredHoursSpent, cert.id).toBeUndefined();
    }
  });

  it("still gates every other certificate behind something", () => {
    for (const cert of certificates.filter(c => c.unlockType !== "always")) {
      const gated = cert.sourceUpgradeId ?? cert.sourceAchievementId ?? cert.requiredHoursSpent;
      expect(gated, `${cert.id} is gated but names no source`).toBeDefined();
    }
  });

  it("does not sell Benchmarking any more", () => {
    expect(certificates.some(c => c.id === "benchmarking")).toBe(false);
    // ...and nothing quietly took its place in the shop either.
    expect([...upgradeIds].filter(id => id.startsWith("benchmarking"))).toEqual([]);
  });
});

/**
 * Signing Bonus and Corporate Card: the two starters, and the specific shapes
 * their effects have to keep.
 */
describe("the starter certificates", () => {
  const signing = certificates.find(c => c.id === "signing-bonus")!;
  const card = certificates.find(c => c.id === "corporate-card")!;

  it("banks hours before the run begins, in equal steps", () => {
    expect(signing.levels).toHaveLength(3);
    for (const level of signing.levels) {
      expect(level.effect).toEqual({ type: "startingOvertime", value: 10 });
    }
  });

  it("rises in price with each level, so the third is a real commitment", () => {
    const costs = signing.levels.map(l => l.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(costs.length);
  });

  /**
   * Two levels, two different rules rather than a stacking number: one lock
   * required, then none. A third would have nothing left to relax.
   */
  it("frees the store in exactly two steps", () => {
    expect(card.levels).toHaveLength(2);
    for (const level of card.levels) {
      expect(level.effect).toEqual({ type: "storeLockRelief", value: 1 });
    }
  });
});
