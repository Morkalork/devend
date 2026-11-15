/**
 * The shop must not sell a multiplier the per-map cap refuses to pay.
 *
 * Overtime is capped per map by a backstop: `basePoints x overtimeCapHeadroom`
 * plus every axis ceiling. Past that ceiling, more scoreMultiplier is not merely weak, it
 * is INERT: the player spends real overtime on a card whose effect is discarded
 * at scoring time, and nothing on screen says so.
 *
 * That had happened. The shop sold x3.23 in stacked multiplier against a median
 * map that caps at x2.9, so Technical Debt's Architect tier (x1.5 on a line
 * already trunking at x2.43) was paying in a currency the game would not
 * honour. Both fork options became ways to beat the ceiling instead: one raises
 * it (overtimeCapBonus), one earns above it (Ship Early is paid on top of the
 * cap). The multiplier on offer dropped to x2.15.
 *
 * This is the guard that keeps it there. It is the same class of bug as the
 * Garbage Collector line, which granted modifiers no code read: an upgrade that
 * cannot pay out is dead weight whether the cause is a missing consumer or a
 * ceiling that swallows it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig } from "@/types/upgrade";
import type { LevelConfig } from "@/types/level";
import { getAxisCeilings, axisCeilingTotal, DEFAULT_MAP_BASE_POINTS } from "@/lib/scoring";

import { ENGINE_MAPS } from "./fixtures/maps";

const UPGRADES = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/upgrades.yml"), "utf8"),
) as { upgrades: UpgradeConfig[] }).upgrades;
const SCORING = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/scoring-config.yml"), "utf8"),
) as { scoring: { overtimeCapHeadroom: number; lockValue: number } }).scoring;
const LEVELS = ENGINE_MAPS.filter(l => typeof l.level === "number");

/**
 * The most scoreMultiplier a run can buy from the shop.
 *
 * Mutually exclusive options count once, at their best, since only one of a
 * choiceGroup can ever be owned.
 */
function maxBuyableMultiplier(): number {
  const groups = new Map<string, UpgradeConfig[]>();
  let product = 1;
  for (const u of UPGRADES) {
    const m = u.modifiers?.scoreMultiplier;
    if (!m || m === 1) continue;
    if (u.choiceGroup) {
      groups.set(u.choiceGroup, [...(groups.get(u.choiceGroup) ?? []), u]);
    } else {
      product *= m;
    }
  }
  for (const opts of groups.values()) {
    product *= Math.max(...opts.map(o => o.modifiers.scoreMultiplier as number));
  }
  return product;
}

/**
 * The real backstop (src/lib/scoring.ts): the base x headroom, plus every axis
 * ceiling. The score multiplier scales the map's whole earned pay (it used to
 * scale only the 5h base, floored, which is why Performance Bonus paid 0h).
 */
const AXES = getAxisCeilings();
function backstop(level: LevelConfig): number {
  return Math.round((level.points ?? DEFAULT_MAP_BASE_POINTS) * SCORING.overtimeCapHeadroom) + axisCeilingTotal();
}

/**
 * The multiplier at which a map's pay first meets the backstop.
 *
 * Deliberately a MODEST map: the base plus a full Delivery lane (every ball
 * locked), and no other lane. A better-played map caps sooner; this asks the
 * question for the map the multiplier has to pay on, not the perfect one.
 */
function firstBindingMultiplier(level: LevelConfig): number {
  const pay = (level.points ?? DEFAULT_MAP_BASE_POINTS) + AXES.delivery;
  for (let m = 1; m <= 20; m += 0.01) {
    if (Math.round(pay * m) > backstop(level)) return m;
  }
  return Infinity;
}

/** The most a map can pay before the multiplier: the base plus every lane full. */
function perfectPay(level: LevelConfig): number {
  return (level.points ?? DEFAULT_MAP_BASE_POINTS) + axisCeilingTotal();
}

const bindPoints = LEVELS.map(firstBindingMultiplier).sort((a, b) => a - b);
const median = bindPoints[Math.floor(bindPoints.length / 2)];

describe("what the cap will honour", () => {
  it("measures a binding point for every map", () => {
    expect(bindPoints).toHaveLength(LEVELS.length);
    expect(bindPoints.every(Number.isFinite)).toBe(true);
  });

  /** The headline guard. */
  it("does not sell more multiplier than the median map can pay", () => {
    const sold = maxBuyableMultiplier();
    expect(
      sold,
      `the shop sells x${sold.toFixed(2)} but the median map caps at x${median.toFixed(2)}, ` +
      `so the deepest multiplier tiers pay in a currency the cap refuses`,
    ).toBeLessThanOrEqual(median);
  });

  /**
   * The other side: the backstop must still bound a maximal build on a
   * perfect map, or it would not be bounding anything at all.
   */
  it("still stops a maximal build on a perfect map", () => {
    const sold = maxBuyableMultiplier();
    const capped = LEVELS.filter(l => Math.round(perfectPay(l) * sold) > backstop(l));
    expect(capped.length).toBeGreaterThan(0);
  });
});

describe("the ways past the ceiling", () => {
  const byId = new Map(UPGRADES.map(u => [u.id, u]));

  /**
   * Technical Debt's fork is now an opposition about the cap itself, where it
   * used to be x1.5 against x1.5 with only a cosmetic difference in curse.
   */
  it("Technical Debt's Architect fork raises the ceiling or earns above it", () => {
    const raise = byId.get("technical_debt_architect")!;
    const beat = byId.get("technical_debt_architect_b")!;
    expect(raise.modifiers.overtimeCapBonus).toBeGreaterThan(0);
    expect(beat.modifiers.shipEarlyBonusMultiplier).toBeGreaterThan(1);
    // Neither sells the multiplier the cap would eat any more.
    expect(raise.modifiers.scoreMultiplier ?? 1).toBe(1);
    expect(beat.modifiers.scoreMultiplier ?? 1).toBe(1);
  });

  /**
   * Both keys must stay reachable by something. A "way past the ceiling" that
   * no upgrade grants is the ceiling with extra steps.
   */
  it("keeps at least one source of each cap escape", () => {
    const grants = (key: string) =>
      UPGRADES.filter(u => (u.modifiers?.[key] ?? 0) > (key.endsWith("Multiplier") ? 1 : 0));
    expect(grants("overtimeCapBonus").length).toBeGreaterThan(0);
    expect(grants("shipEarlyBonusMultiplier").length).toBeGreaterThan(0);
  });
});
