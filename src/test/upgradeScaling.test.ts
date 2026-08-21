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
  const target = "performance_bonus_principal";
  const upgrade = byId.get(target)!;

  it("pays nothing when the upgrade is owned alone", () => {
    expect(scalingReadouts([target], UPGRADES)).toEqual([]);
    expect(computeScalingBonuses([target], UPGRADES)).toEqual({});
  });

  /** The headline property: an unfocused build gets the base rate. */
  it("pays nothing for a scattered build", () => {
    const scattered = ["freeze", "safety", "tempo", "risk"]
      .flatMap(t => otherTagged(t as UpgradeTag, upgrade.name, 1))
      .filter(id => !(byId.get(id)!.tags ?? []).includes("bank"));
    const owned = [target, ...scattered];
    expect(computeScalingBonuses(owned, UPGRADES)).toEqual({});
  });

  it("pays more the deeper the archetype goes", () => {
    const amounts = [1, 2, 3].map(n => {
      const owned = [target, ...otherTagged("bank", upgrade.name, n)];
      return scalingReadouts(owned, UPGRADES)[0]?.amount ?? 0;
    });
    expect(amounts[0]).toBeGreaterThan(0);
    expect(amounts[1]).toBeGreaterThan(amounts[0]);
    expect(amounts[2]).toBeGreaterThan(amounts[1]);
  });

  it("stops at the cap, so the card's promise holds", () => {
    const max = upgrade.scaling!.max!;
    const atCap = [target, ...otherTagged("bank", upgrade.name, max)];
    const past = [target, ...otherTagged("bank", upgrade.name, max + 3)];
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
    const owned = [target, ...otherTagged("bank", upgrade.name, 3)];
    const b = computeScalingBonuses(owned, UPGRADES);
    expect(MULTIPLICATIVE_KEYS).toContain("scoreMultiplier");
    expect(b.scoreMultiplier).toBeCloseTo(1 + 0.04 * 3, 6);
  });

  it("returns additive keys as a raw delta", () => {
    const bp = byId.get("benefits_package_principal")!;
    expect(MULTIPLICATIVE_KEYS).not.toContain("pickupChanceBonus");
    const owned = ["benefits_package_principal", ...otherTagged("risk", bp.name, 2)];
    const b = computeScalingBonuses(owned, UPGRADES);
    expect(b.pickupChanceBonus).toBeCloseTo(0.01 * 2, 6);
  });

  it("ignores an upgrade that is not owned, however much of its tag is", () => {
    const owned = otherTagged("bank", upgrade.name, 4);
    expect(computeScalingBonuses(owned, UPGRADES)).toEqual({});
  });
});

// ── Stepped scaling, for integer keys ───────────────────────────────────────

/**
 * `every` grants `per` once per N counted upgrades rather than once each.
 *
 * It exists because a quarter of a Continue is meaningless and 0.6 of a
 * concurrent fence is actively wrong: concurrentFenceLimit reads its modifier
 * through Math.round, so fractional accumulation would snap at 0.5 into a
 * hidden cliff instead of a ramp. Stepping keeps the grant whole from the start.
 */
describe("stepped scaling", () => {
  const mk = (every: number, max: number, per = 1): UpgradeConfig[] => ([
    {
      id: "step-target", name: "Stepper", tier: "Junior", description: "d",
      cost: 10, tags: ["tempo"], modifiers: { additionalConcurrentFences: 1 },
      scaling: { tag: "tempo", key: "additionalConcurrentFences", per, every, max },
    } as unknown as UpgradeConfig,
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `filler-${i}`, name: `Filler ${i}`, tier: "Junior", description: "d",
      cost: 10, tags: ["tempo"], modifiers: { fenceGenerationSpeedMultiplier: 1.01 },
    } as unknown as UpgradeConfig)),
  ]);
  const owned = (n: number) => ["step-target", ...Array.from({ length: n }, (_, i) => `filler-${i}`)];
  const amountAt = (cat: UpgradeConfig[], n: number) =>
    scalingReadouts(owned(n), cat)[0]?.amount ?? 0;

  it("grants nothing until a whole step is reached", () => {
    const cat = mk(4, 8);
    expect(amountAt(cat, 0)).toBe(0);
    expect(amountAt(cat, 3)).toBe(0);
    expect(amountAt(cat, 4)).toBe(1);
  });

  it("grants only whole units, never a fraction", () => {
    const cat = mk(4, 8);
    for (let n = 0; n <= 10; n++) {
      expect(Number.isInteger(amountAt(cat, n)), `owning ${n}`).toBe(true);
    }
  });

  it("steps again at each further multiple", () => {
    const cat = mk(4, 8);
    expect(amountAt(cat, 7)).toBe(1);
    expect(amountAt(cat, 8)).toBe(2);
  });

  /** `max` caps the COUNT in both forms, so it means one thing everywhere. */
  it("caps through the count, not the steps", () => {
    const cat = mk(4, 8);
    expect(amountAt(cat, 11)).toBe(2); // count clamped to 8 -> 2 steps
    expect(scalingReadouts(owned(11), cat)[0].effective).toBe(8);
    expect(scalingReadouts(owned(11), cat)[0].steps).toBe(2);
  });

  it("degrades to one grant each when every is absent or 1", () => {
    for (const e of [1, 0, -3]) {
      const cat = mk(e, 8);
      expect(amountAt(cat, 5), `every ${e}`).toBe(5);
    }
  });

  it("reports steps alongside the raw count", () => {
    const r = scalingReadouts(owned(6), mk(4, 8))[0];
    expect(r.count).toBe(6);
    expect(r.effective).toBe(6);
    expect(r.steps).toBe(1);
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

  /**
   * Integer keys must be stepped. A key the game reads as a count (a fence, a
   * Continue, a shop slot) cannot take a fraction: at best it is meaningless,
   * at worst it rounds at 0.5 into a cliff the card never mentions.
   */
  it("steps every scaling block on a whole-unit key", () => {
    const WHOLE_UNIT_KEYS = new Set([
      "additionalConcurrentFences", "extraContinues", "extraLives", "extraShopItems",
      "shopRestockCount", "parBonus", "pickupPayoutLevel", "instantFencesPerMap",
      "wallShieldsPerMap", "freezeUsesPerMap", "ballFreezeCount", "extraCertificateHours",
      "underParInstantFence", "ballPathPredictionBounces", "ballPathPredictionBalls",
    ]);
    for (const u of scaled) {
      if (!WHOLE_UNIT_KEYS.has(u.scaling!.key)) continue;
      const every = u.scaling!.every ?? 1;
      expect(Number.isInteger(u.scaling!.per), `${u.id} per`).toBe(true);
      expect(every, `${u.id} scales the whole-unit key ${u.scaling!.key} without an every`)
        .toBeGreaterThan(1);
    }
  });

  /** A step nobody can reach is a promise the catalogue cannot keep. */
  it("can reach at least one step of every stepped block", () => {
    for (const u of scaled) {
      const s = u.scaling!;
      if (!s.every || s.every <= 1) continue;
      const available = UPGRADES.filter(
        o => o.name !== u.name && (o.tags ?? []).includes(s.tag),
      ).length;
      const reachable = Math.min(available, s.max ?? available);
      expect(Math.floor(reachable / s.every), `${u.id} can never reach a step`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * No key may be scaled from two places.
   *
   * Scaling one modifier from two upgrades compounds it twice into a number
   * nobody can reason about. It happened here: scoreMultiplier was scaled by
   * both Technical Debt and Performance Bonus, stacking to 5.03x on a build
   * that owned both lines fully, when the 80h per-map cap makes anything past
   * roughly 2x wasted. The reward was simultaneously enormous and worthless.
   *
   * Mutually exclusive siblings are the one exception: two options of the same
   * choiceGroup can never both be owned, so they cannot compound.
   */
  it("scales each modifier key from exactly one place", () => {
    const byKey = new Map<string, UpgradeConfig[]>();
    for (const u of scaled) {
      const list = byKey.get(u.scaling!.key) ?? [];
      list.push(u);
      byKey.set(u.scaling!.key, list);
    }
    const offenders: string[] = [];
    for (const [key, list] of byKey) {
      if (list.length < 2) continue;
      // Same choiceGroup means only one can ever be owned.
      const groups = new Set(list.map(u => u.choiceGroup ?? u.id));
      if (groups.size === 1) continue;
      offenders.push(`${key} <- ${list.map(u => u.id).join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("says so on the card, so the effect is not invisible", () => {
    for (const u of scaled) {
      expect(u.description ?? "", `${u.id}`).toMatch(/every other|for each|up to|once you own|for every/i);
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
