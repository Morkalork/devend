/**
 * Build-scaled upgrades: an effect that grows with how committed the run is to
 * its archetype.
 *
 * Why this exists. Of 40 upgrade families, 25 grant a flat value, and a flat
 * value can be ranked once and picked forever, which is why every run converges
 * on the same build. The target is stronger than "every upgrade should have a
 * place": every upgrade should be EXCELLENT in some build and lose its edge in
 * an unfocused one, so the pick depends on the run rather than on a table.
 *
 * The property worth guarding is that last clause. A scattered build must get
 * meaningfully less than a focused one, and a scaled upgrade bought alone must
 * be worth exactly its base value, or the mechanism is just a stealth buff.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  computeScalingBonuses, scalingReadouts, taggedOwnedOutsideFamily,
} from "@/lib/upgradeScaling";
import { MULTIPLICATIVE_KEYS } from "@/hooks/useActiveModifiers";
import type { UpgradeConfig, UpgradeTag } from "@/types/upgrade";

const UPGRADES = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;

const byId = new Map(UPGRADES.map(u => [u.id, u]));
const scaled = UPGRADES.filter(u => u.scaling);

/** Ids of `n` owned upgrades carrying `tag`, from families other than `family`. */
function otherTagged(tag: UpgradeTag, family: string, n: number): string[] {
  return UPGRADES
    .filter(u => u.name !== family && (u.tags ?? []).includes(tag))
    .slice(0, n)
    .map(u => u.id);
}

describe("counting the build", () => {
  it("ignores the upgrade's own family, so a family cannot power itself", () => {
    const td = UPGRADES.filter(u => u.name === "Technical Debt").map(u => u.id);
    expect(td.length).toBeGreaterThan(1);
    expect(taggedOwnedOutsideFamily(td, UPGRADES, "risk", "Technical Debt")).toBe(0);
  });

  it("counts owned upgrades of the tag from other families", () => {
    const others = otherTagged("risk", "Technical Debt", 3);
    expect(others).toHaveLength(3);
    expect(taggedOwnedOutsideFamily(others, UPGRADES, "risk", "Technical Debt")).toBe(3);
  });

  it("ignores upgrades that do not carry the tag", () => {
    const freeze = otherTagged("freeze", "Technical Debt", 2);
    expect(taggedOwnedOutsideFamily(freeze, UPGRADES, "risk", "Technical Debt")).toBe(0);
  });

  it("ignores ids that are not in the catalogue", () => {
    expect(taggedOwnedOutsideFamily(["nope", "gone"], UPGRADES, "risk", "X")).toBe(0);
  });
});

describe("what scaling pays", () => {
  const target = "technical_debt_architect";
  const upgrade = byId.get(target)!;

  it("pays nothing when the upgrade is owned alone", () => {
    expect(scalingReadouts([target], UPGRADES)).toEqual([]);
    expect(computeScalingBonuses([target], UPGRADES)).toEqual({});
  });

  /** The headline property: an unfocused build gets the base rate. */
  it("pays nothing for a scattered build", () => {
    const scattered = ["freeze", "safety", "tempo", "bank"]
      .flatMap(t => otherTagged(t as UpgradeTag, upgrade.name, 1))
      .filter(id => !(byId.get(id)!.tags ?? []).includes("risk"));
    const owned = [target, ...scattered];
    expect(computeScalingBonuses(owned, UPGRADES)).toEqual({});
  });

  it("pays more the deeper the archetype goes", () => {
    const amounts = [1, 2, 3].map(n => {
      const owned = [target, ...otherTagged("risk", upgrade.name, n)];
      return scalingReadouts(owned, UPGRADES)[0]?.amount ?? 0;
    });
    expect(amounts[0]).toBeGreaterThan(0);
    expect(amounts[1]).toBeGreaterThan(amounts[0]);
    expect(amounts[2]).toBeGreaterThan(amounts[1]);
  });

  it("stops at the cap, so the card's promise holds", () => {
    const max = upgrade.scaling!.max!;
    const atCap = [target, ...otherTagged("risk", upgrade.name, max)];
    const past = [target, ...otherTagged("risk", upgrade.name, max + 3)];
    const a = scalingReadouts(atCap, UPGRADES)[0];
    const b = scalingReadouts(past, UPGRADES)[0];
    expect(b.amount).toBe(a.amount);
    expect(b.effective).toBe(max);
    expect(b.count).toBeGreaterThan(max); // the raw count still reports honestly
  });

  /**
   * mergeBonuses MULTIPLIES multiplicative keys, so a raw 0.18 would cut the
   * modifier to a fifth instead of adding 18% to it.
   */
  it("returns multiplicative keys as a multiplier, not a raw delta", () => {
    const owned = [target, ...otherTagged("risk", upgrade.name, 3)];
    const b = computeScalingBonuses(owned, UPGRADES);
    expect(MULTIPLICATIVE_KEYS).toContain("scoreMultiplier");
    expect(b.scoreMultiplier).toBeCloseTo(1 + 0.06 * 3, 6);
  });

  it("returns additive keys as a raw delta", () => {
    const bp = byId.get("benefits_package_principal")!;
    expect(MULTIPLICATIVE_KEYS).not.toContain("pickupChanceBonus");
    const owned = ["benefits_package_principal", ...otherTagged("risk", bp.name, 2)];
    const b = computeScalingBonuses(owned, UPGRADES);
    expect(b.pickupChanceBonus).toBeCloseTo(0.01 * 2, 6);
  });

  it("ignores an upgrade that is not owned, however much of its tag is", () => {
    const owned = otherTagged("risk", upgrade.name, 4);
    expect(computeScalingBonuses(owned, UPGRADES)).toEqual({});
  });
});

// ── The catalogue as authored ───────────────────────────────────────────────

describe("the scaling blocks in upgrades.yml", () => {
  it("has some, or the mechanism is dead code", () => {
    expect(scaled.length).toBeGreaterThan(0);
  });

  it("names a real modifier key on every block", () => {
    const valid = new Set(UPGRADES.flatMap(u => Object.keys(u.modifiers ?? {})));
    for (const u of scaled) {
      expect(valid.has(u.scaling!.key), `${u.id} -> ${u.scaling!.key}`).toBe(true);
    }
  });

  /** Scaling a key the upgrade does not grant would come from nowhere. */
  it("scales a key the upgrade actually grants", () => {
    for (const u of scaled) {
      expect(
        Object.keys(u.modifiers ?? {}),
        `${u.id} scales ${u.scaling!.key} but does not grant it`,
      ).toContain(u.scaling!.key);
    }
  });

  it("scales a tag the upgrade actually carries", () => {
    for (const u of scaled) {
      expect(u.tags ?? [], `${u.id} scales on ${u.scaling!.tag}`).toContain(u.scaling!.tag);
    }
  });

  it("gives every block a cap, so no card promises something unbounded", () => {
    for (const u of scaled) {
      expect(typeof u.scaling!.max, `${u.id}`).toBe("number");
      expect(u.scaling!.max!, `${u.id}`).toBeGreaterThan(0);
    }
  });

  /**
   * The tag must have enough OTHER families to reach the cap, or the card
   * advertises a maximum the catalogue cannot supply.
   */
  it("caps at a number the catalogue can actually reach", () => {
    for (const u of scaled) {
      const available = UPGRADES.filter(
        o => o.name !== u.name && (o.tags ?? []).includes(u.scaling!.tag),
      ).length;
      expect(available, `${u.id} caps at ${u.scaling!.max} but only ${available} exist`)
        .toBeGreaterThanOrEqual(u.scaling!.max!);
    }
  });

  it("says so on the card, so the effect is not invisible", () => {
    for (const u of scaled) {
      expect(u.description ?? "", `${u.id}`).toMatch(/every other|for each|up to/i);
      expect(u.description ?? "", `${u.id} description`).not.toContain("—");
    }
  });

  /** A negative `per` is legitimate (lower ball speed is better) but must not
   *  drive a multiplier to zero or below at the cap. */
  it("cannot drive a multiplier to zero at full stack", () => {
    for (const u of scaled) {
      const s = u.scaling!;
      if (!MULTIPLICATIVE_KEYS.includes(s.key as never)) continue;
      expect(1 + s.per * s.max!, `${u.id}`).toBeGreaterThan(0.2);
    }
  });
});
