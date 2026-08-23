/**
 * Padded Estimate: par relief, and why it is worth having at all.
 *
 * Par drives two things. Finishing under it banks the THRIFT axis, which is now
 * a real route worth up to 20h rather than the 4h of noise the old under-par
 * ladder paid into an 80h pot. Going over it trips the performance multiplier:
 * one fence over multiplies the map's base by 0.6, two by 0.4, three or more by
 * 0.2 while switching the Greed axis off outright.
 *
 * So this family sells slack before a cliff. These tests are mostly about that
 * cliff, and about the fork staying a real choice: one option buys SLACK, the
 * other buys REWARD, and they must not collapse into two shades of the same
 * thing (the first design did exactly that).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { effectivePar } from "@/lib/par";
import { getPerformanceMultiplier, getAxisCeilings } from "@/lib/scoring";
import { thriftRatio } from "@/lib/scoreAxes";
import type { ScoringConfig } from "@/types/scoring";
import type { UpgradeConfig } from "@/types/upgrade";

const CONFIG = yaml.load(
  readFileSync(resolve(__dirname, "../../public/scoring-config.yml"), "utf8"),
) as ScoringConfig;
const UPGRADES = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;

describe("effective par", () => {
  it("is the map's own par with nothing owned", () => {
    expect(effectivePar(6)).toBe(6);
    expect(effectivePar(6, { parBonus: 0 })).toBe(6);
  });

  it("adds the bonus", () => {
    expect(effectivePar(6, { parBonus: 2 })).toBe(8);
  });

  /**
   * The penalty brackets are exact equality checks (`fencesOverPar === 1`), so
   * a fractional par would land 0.5 over and fall through to the 3-or-more
   * branch: the HARSHEST penalty, from an upgrade that was supposed to help.
   */
  it("stays a whole number, however fractional the bonus", () => {
    for (const b of [0.4, 0.5, 1.9, 2.5]) {
      expect(Number.isInteger(effectivePar(6, { parBonus: b })), `bonus ${b}`).toBe(true);
    }
    expect(effectivePar(6, { parBonus: 1.9 })).toBe(7); // floored, never rounded up
  });

  it("never drops below 1, since a par of 0 makes every clear over par", () => {
    expect(effectivePar(0)).toBe(1);
    expect(effectivePar(-5, { parBonus: 0 })).toBe(1);
  });

  it("ignores a negative bonus rather than punishing the player", () => {
    expect(effectivePar(6, { parBonus: -3 })).toBe(6);
  });
});

// ── The cliff, which is the whole point ─────────────────────────────────────

describe("what par relief actually buys", () => {
  const mult = (used: number, par: number) =>
    getPerformanceMultiplier(used, par, CONFIG).multiplier;

  it("the over-par cliff is steep, which is why slack is worth buying", () => {
    const atPar = mult(6, 6);
    expect(mult(7, 6)).toBeLessThan(atPar);
    expect(mult(8, 6)).toBeLessThan(mult(7, 6));
    expect(mult(9, 6)).toBeLessThan(mult(8, 6));
  });

  it("Sandbagging rescues a run that went over, by moving the cliff", () => {
    // 8 fences on a par-6 map is two over: a heavy penalty.
    const without = mult(8, effectivePar(6));
    const with2 = mult(8, effectivePar(6, { parBonus: 2 }));
    expect(with2).toBeGreaterThan(without);
    expect(with2).toBe(mult(6, 6)); // exactly as if you had hit par
  });

  it("raising par also fills more of the Thrift axis", () => {
    const c = getAxisCeilings(CONFIG);
    const base = thriftRatio(5, effectivePar(6), c.thriftFullAtParFraction);
    const padded = thriftRatio(5, effectivePar(6, { parBonus: 2 }), c.thriftFullAtParFraction);
    expect(padded).toBeGreaterThan(base);
  });

  /**
   * The fork must not collapse into "the same thing twice", and the first
   * design did exactly that: the second option forgave one fence over par,
   * which is arithmetically identical to raising par by one, so both scored the
   * same on every overrun while Sandbagging ALSO lifted the under-par bonus.
   * Strictly worse is not a choice.
   *
   * These two are genuinely opposed. Sandbagging wins on a map that got away
   * from you; Overdelivery wins on one you clear well under par.
   */
  it("Sandbagging wins when the map got away from you", () => {
    const used = 9; // three over the base par of 6
    expect(mult(used, effectivePar(6, { parBonus: 3 })))
      .toBeGreaterThan(mult(used, effectivePar(6, { parBonus: 2 })));
  });

  it("Overdelivery wins when you clear well under par", () => {
    const used = 3;
    const c = getAxisCeilings(CONFIG);
    const thrift = (par: number, mult: number) =>
      c.thrift * mult * thriftRatio(used, par, c.thriftFullAtParFraction);
    const sandbag = thrift(effectivePar(6, { parBonus: 3 }), 1);
    const overdeliver = thrift(effectivePar(6, { parBonus: 2 }), 2);
    expect(overdeliver).toBeGreaterThan(sandbag);
  });

  /**
   * Overdelivery raises the Thrift CEILING rather than its payout, so a run
   * that already filled the axis still gets more out of it. Multiplying a
   * payout already clamped to the ceiling would do nothing at all, which is
   * the exact failure that killed the Garbage Collector line.
   */
  it("Overdelivery lifts a filled Thrift axis past its own ceiling", () => {
    const c = getAxisCeilings(CONFIG);
    const ratio = thriftRatio(1, effectivePar(6, { parBonus: 2 }), c.thriftFullAtParFraction);
    expect(ratio, "this run should already fill the axis").toBe(1);
    expect(c.thrift * 2 * ratio).toBeGreaterThan(c.thrift);
  });
});

// ── The catalogue ───────────────────────────────────────────────────────────

describe("the Padded Estimate family", () => {
  const fam = UPGRADES.filter(u => u.name === "Padded Estimate");

  it("has four tiers sharing one name, so Tenure can walk it as a chain", () => {
    expect(fam).toHaveLength(4);
    expect(new Set(fam.map(u => u.name)).size).toBe(1);
  });

  it("stacks to three fences of par down the Sandbagging line", () => {
    const trunk = fam.filter(u => !u.choiceGroup || u.id.endsWith("_principal"));
    const total = trunk.reduce((n, u) => n + (u.modifiers.parBonus ?? 0), 0);
    expect(total).toBe(3);
  });

  /** The fork options must differ in KIND, not just in number. */
  it("forks into slack versus reward, not two shades of slack", () => {
    const opts = fam.filter(u => u.choiceGroup);
    expect(opts).toHaveLength(2);
    expect(opts.some(o => (o.modifiers.parBonus ?? 0) > 0)).toBe(true);
    expect(opts.some(o => (o.modifiers.underParBonusMultiplier ?? 1) > 1)).toBe(true);
  });

  it("unlocks in tier order", () => {
    const levels = ["Junior", "Senior", "Principal"].map(
      t => Math.min(...fam.filter(u => u.tier === t).map(u => u.unlockLevel ?? 1)),
    );
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  /**
   * The dead line this replaced. bonusRemovalChance / bonusRemovalAmount were
   * declared, shown in the Specs panel, and read by NO game logic, so four
   * upgrades were purchasable with real overtime while doing nothing.
   */
  it("leaves no trace of the Garbage Collector line it replaced", () => {
    expect(UPGRADES.filter(u => (u.name ?? "").startsWith("Garbage"))).toHaveLength(0);
    for (const u of UPGRADES) {
      expect(Object.keys(u.modifiers ?? {}), u.id).not.toContain("bonusRemovalChance");
      expect(Object.keys(u.modifiers ?? {}), u.id).not.toContain("bonusRemovalAmount");
    }
  });
});
