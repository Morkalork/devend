/**
 * Build-scaled upgrades: an upgrade whose effect grows with how committed the
 * run is to its archetype.
 *
 * The problem this exists for. Of 40 upgrade families, 25 grant a flat value:
 * a number that is worth exactly the same whatever else you own. A flat value
 * can be ranked once and then picked forever, which is why every run converges
 * on the same build and why some upgrades read as "just not very useful" - they
 * lost that ranking and nothing can ever change it.
 *
 * The goal is stronger than "every upgrade should have a place" (Mega Crit's
 * stated aim for Slay the Spire). It is that every upgrade should be excellent
 * in SOME build and lose its edge in an unfocused one, so that the pick depends
 * on the run rather than on a table.
 *
 * The mechanism reuses what is already there: every upgrade carries archetype
 * `tags`, and set bonuses already count them. A `scaling` block says "this
 * effect grows per owned upgrade sharing this tag", so a focused risk build
 * makes its risk upgrades hit hard while a scattered one gets the base rate.
 *
 * The upgrade's OWN family is excluded from the count, deliberately. Counting
 * siblings would make a family power itself: buy all four tiers of Technical
 * Debt and each tier feeds the next, which is a compounding loop rather than a
 * build decision. Excluding it means the bonus measures how much of the
 * ARCHETYPE you have committed to, which is the thing being rewarded.
 */
import { MULTIPLICATIVE_KEYS, type GameModifiers } from "@/hooks/useActiveModifiers";
import type { UpgradeConfig, UpgradeScaling, UpgradeTag } from "@/types/upgrade";

/** How much a scaling block is currently paying, and why. */
export interface ScalingReadout {
  upgradeId: string;
  upgradeName: string;
  tag: string;
  key: keyof GameModifiers;
  /** Owned upgrades with the tag, outside this upgrade's own family. */
  count: number;
  /** The count actually paid for, after the cap. */
  effective: number;
  /** The delta this contributes: +0.15 on a multiplier, +2 on an additive. */
  amount: number;
}

/**
 * Owned upgrades carrying `tag`, excluding every tier of `family`.
 *
 * Families are identified by shared `name`, the same way the rest of the
 * catalogue does it (fast_compile_junior/_senior/_principal are all "Fast
 * Compile").
 */
export function taggedOwnedOutsideFamily(
  ownedIds: string[], upgrades: UpgradeConfig[], tag: string, family: string,
): number {
  const byId = new Map(upgrades.map(u => [u.id, u]));
  let n = 0;
  for (const id of ownedIds) {
    const u = byId.get(id);
    if (!u || u.name === family) continue;
    if ((u.tags ?? []).includes(tag as UpgradeTag)) n++;
  }
  return n;
}

/** The per-upgrade breakdown of what build scaling is paying right now. */
export function scalingReadouts(
  ownedIds: string[], upgrades: UpgradeConfig[],
): ScalingReadout[] {
  const byId = new Map(upgrades.map(u => [u.id, u]));
  const out: ScalingReadout[] = [];
  for (const id of ownedIds) {
    const u = byId.get(id);
    const s: UpgradeScaling | undefined = u?.scaling;
    if (!u || !s) continue;
    if (!Number.isFinite(s.per) || s.per === 0) continue;

    const count = taggedOwnedOutsideFamily(ownedIds, upgrades, s.tag, u.name);
    // `max` caps the COUNT, not the payout, so a card can promise "up to five
    // other risk upgrades" and the number on it stays legible.
    const effective = typeof s.max === "number" ? Math.min(count, Math.max(0, s.max)) : count;
    if (effective <= 0) continue;
    out.push({
      upgradeId: u.id, upgradeName: u.name, tag: s.tag,
      key: s.key as keyof GameModifiers,
      count, effective, amount: s.per * effective,
    });
  }
  return out;
}

/**
 * Build scaling folded into one bonus map, ready to merge with the other
 * modifier sources.
 *
 * Multiplicative keys are returned as `1 + delta` because mergeBonuses
 * MULTIPLIES those, so a raw 0.15 would wipe the modifier out rather than add
 * 15% to it. Two upgrades scaling the same multiplicative key compound, which
 * matches how two upgrades granting it directly already behave.
 */
export function computeScalingBonuses(
  ownedIds: string[], upgrades: UpgradeConfig[],
): Partial<Record<keyof GameModifiers, number>> {
  const bonuses: Partial<Record<keyof GameModifiers, number>> = {};
  for (const r of scalingReadouts(ownedIds, upgrades)) {
    if (MULTIPLICATIVE_KEYS.includes(r.key)) {
      bonuses[r.key] = (bonuses[r.key] ?? 1) * (1 + r.amount);
    } else {
      bonuses[r.key] = (bonuses[r.key] ?? 0) + r.amount;
    }
  }
  return bonuses;
}
