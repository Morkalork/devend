/**
 * Assignment rewards on ONE value scale, so every mission is worth the effort.
 *
 * Reported from play: "I just got 6 overtime hours for locking 2 balls per map
 * a few times. That is worth nothing in comparison to the effort" - Daily
 * Standup's first tier, taken for a real 5-map behavioral constraint and paid
 * a sixth of what the file's own design comment says a first tier should be
 * worth (+2 lives).
 *
 * Seven of the eleven assignments had this: a flat "+6/+8/+10/+11 overtime"
 * first tier left over from BEFORE the roster was rebalanced onto lives and
 * free upgrade picks, and two of them (Lock Quota, Under Budget) never got a
 * tierDraft top tier at all. The anchor the design comment quoted for "how
 * much is a life worth" was ALSO wrong - 13h, mechanically carried through the
 * hours-by-4 deflation from an already-approximate pre-deflation "~50h" that
 * was never checked against the live formula. The real number, read off
 * upgrades.yml's own pricing block (not upgradePricing.ts's unused fallback
 * default), is 34h: what the cheapest thing the shop sells actually costs.
 *
 * This file holds both fixes in place: every mission's first tier pays real
 * value, every mission has a route to a free upgrade pick, and the anchor
 * quoted in assignments.yml's own comment matches the live shop.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { mergePricing, computeUpgradeCost } from "@/lib/upgradePricing";
import type { AssignmentData, AssignmentReward } from "@/types/assignment";
import type { UpgradeData } from "@/types/upgrade";

const assignmentDoc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/assignments.yml"), "utf8"),
) as AssignmentData;
const assignments = assignmentDoc.assignments;

const upgradeDoc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as UpgradeData;

/** A flat overtime reward under this many hours reads as nothing next to a life. */
const TRIVIAL_OVERTIME_HOURS = 20;

describe("the shop anchor the design comment quotes is the live one", () => {
  it("prices a Junior-tier upgrade at the figure assignments.yml's comment cites", () => {
    // The exact bug: the comment used to say "13h", carried by simple division
    // from a pre-deflation guess, never checked against upgrades.yml's own
    // `pricing:` block - which is what the shop actually charges, not
    // upgradePricing.ts's DEFAULT_UPGRADE_PRICING fallback (anchorHours 190,
    // for tests and the moment before the YAML loads).
    const pricing = mergePricing(upgradeDoc.pricing);
    const juniorCost = computeUpgradeCost("Junior", pricing);
    expect(juniorCost).toBe(34);

    const comment = readFileSync(resolve(process.cwd(), "public/assignments.yml"), "utf8");
    expect(comment, "the balance comment's anchor no longer matches the shop")
      .toContain(`${juniorCost}h`);
  });
});

describe("every mission's first tier is worth taking", () => {
  it("never pays a trivial flat-overtime reward", () => {
    const trivial: string[] = [];
    for (const a of assignments) {
      const first = a.mission.tiers[0];
      if (first.reward.type === "overtime" && first.reward.hours < TRIVIAL_OVERTIME_HOURS) {
        trivial.push(`${a.id}: +${first.reward.hours} overtime`);
      }
    }
    expect(trivial, "a first tier this small reads as nothing against a couple of lives")
      .toEqual([]);
  });

  it("pays lives or overtime worth at least two lives, or an upgrade pick, at the first tier", () => {
    const pricing = mergePricing(upgradeDoc.pricing);
    const oneLife = computeUpgradeCost("Junior", pricing)!;
    const underpaid: string[] = [];
    for (const a of assignments) {
      const first = a.mission.tiers[0];
      const worth = worthInLives(first.reward, oneLife);
      if (worth !== null && worth < 2) underpaid.push(`${a.id}: ${first.label} (~${worth.toFixed(1)} lives)`);
    }
    expect(underpaid).toEqual([]);
  });
});

describe("every mission has a route to a free upgrade pick", () => {
  it("gives every assignment a tierDraft at its top tier", () => {
    // Lock Quota and Under Budget used to pay flat overtime at every tier with
    // no tierDraft anywhere - a flat number capping a five-map commitment
    // reads exactly as small as one starting it does.
    const noTierDraft = assignments
      .filter(a => !a.mission.tiers.some(t => t.reward.type === "tierDraft"))
      .map(a => a.id);
    expect(noTierDraft).toEqual([]);
  });
});

/**
 * Rough value of a reward in lives, or null for a reward this scale does not
 * price directly (a tierDraft, or a modifiers bundle).
 */
function worthInLives(reward: AssignmentReward, oneLifeHours: number): number | null {
  if (reward.type === "lives") return reward.count;
  if (reward.type === "overtime") return reward.hours / oneLifeHours;
  return null;
}
