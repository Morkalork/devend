/**
 * Every id that points from one YAML catalogue into another has to land.
 *
 * The `mutator: gravity` bug was one instance of this: a reference that named
 * nothing, in a file that is cast to its type unchecked, so neither TypeScript
 * nor any test noticed. mapPins.test.ts covers the references map.yml makes.
 * This covers the ones the other catalogues make to each other.
 *
 * The failure mode is always silence. A certificate whose `sourceUpgradeId`
 * names no upgrade is not a crash: it is a reward that simply never unlocks, on
 * a screen that looks exactly the same as one where it can.
 *
 * ── Resolve, do not compare ──────────────────────────────────────────────────
 *
 * An upgrade-chain certificate can legitimately name a CHOICE GROUP rather than
 * an upgrade. A tier-3 split (runtime_optimisation_principal_a / _b) credits
 * either option through `upgrade.choiceGroup`, so the id the certificate names
 * is deliberately not an upgrade id. Writing this rule against upgrade ids
 * alone flags that as broken when it works perfectly - which is what a first
 * pass at this test did. The set of valid targets is what the RUNTIME accepts,
 * so both are in it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const load = <T = Record<string, unknown>>(name: string): T =>
  yaml.load(readFileSync(resolve(process.cwd(), `public/${name}.yml`), "utf8")) as T;

interface Upgrade { id: string; choiceGroup?: string }
interface Certificate { id: string; unlockType?: string; sourceUpgradeId?: string; sourceAchievementId?: string }

const upgrades = load<{ upgrades: Upgrade[] }>("upgrades").upgrades;
const certificates = load<{ certificates: Certificate[] }>("certificates").certificates;
const achievements = load<{ achievements: { id: string }[] }>("achievements").achievements;

/**
 * What `sourceUpgradeId` may name, matching useGameSession's `certKey`:
 * `upgrade?.choiceGroup ?? upgradeId`.
 */
const upgradeTargets = new Set([
  ...upgrades.map(u => u.id),
  ...upgrades.map(u => u.choiceGroup).filter((g): g is string => !!g),
]);
const achievementIds = new Set(achievements.map(a => a.id));

describe("certificate unlock sources resolve", () => {
  it("finds the certificates it is meant to be checking", () => {
    // A sweep over an empty list passes forever.
    expect(certificates.length).toBeGreaterThan(5);
    expect(certificates.some(c => c.sourceUpgradeId)).toBe(true);
    expect(certificates.some(c => c.sourceAchievementId)).toBe(true);
  });

  it.each(certificates.filter(c => c.sourceUpgradeId).map(c => [c.id, c] as const))(
    "%s names an upgrade or a choice group that exists",
    (_id, cert) => {
      expect(
        upgradeTargets.has(cert.sourceUpgradeId!),
        `${cert.id} unlocks from "${cert.sourceUpgradeId}", which is neither an `
        + `upgrade id nor a choiceGroup, so it can never unlock`,
      ).toBe(true);
    },
  );

  it.each(certificates.filter(c => c.sourceAchievementId).map(c => [c.id, c] as const))(
    "%s names an achievement that exists",
    (_id, cert) => {
      expect(
        achievementIds.has(cert.sourceAchievementId!),
        `${cert.id} unlocks from achievement "${cert.sourceAchievementId}", which does not exist`,
      ).toBe(true);
    },
  );

  it("gives every upgrade-chain certificate something to unlock from", () => {
    // An 'upgrade-chain' cert with no source is unreachable in a quieter way:
    // nothing to resolve, so nothing above would catch it.
    for (const cert of certificates.filter(c => c.unlockType === "upgrade-chain")) {
      expect(cert.sourceUpgradeId, `${cert.id} is upgrade-chain with no source`).toBeTruthy();
    }
    for (const cert of certificates.filter(c => c.unlockType === "achievement")) {
      expect(cert.sourceAchievementId, `${cert.id} is achievement-gated with no source`).toBeTruthy();
    }
  });
});

describe("a choice group is shared, or it is not a choice", () => {
  it("never leaves a choiceGroup with a single member", () => {
    // A group of one is a split that lost a side. It still resolves, so the
    // rules above stay green, but the shop offers no choice and the cert
    // unlocks from whichever half survived.
    const members = new Map<string, string[]>();
    for (const u of upgrades) {
      if (!u.choiceGroup) continue;
      members.set(u.choiceGroup, [...(members.get(u.choiceGroup) ?? []), u.id]);
    }
    expect(members.size, "no choice groups to check").toBeGreaterThan(0);
    const lonely = [...members.entries()].filter(([, ids]) => ids.length < 2);
    expect(lonely.map(([g, ids]) => `${g} has only ${ids.join(", ")}`)).toEqual([]);
  });
});
