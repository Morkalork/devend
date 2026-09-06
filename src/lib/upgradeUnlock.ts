/**
 * When an upgrade becomes buyable: prerequisites, and the family-maxed gate.
 *
 * One function, because this rule was already written twice - `isLocked` in
 * useUpgradeManager and the shelf's own unlocked/locked split in UpgradeShop -
 * and the two would have had to grow the new condition in step or quietly
 * disagree about which upgrades exist.
 *
 * ── Why `prerequisites` alone could not express "maxed that family" ────────
 *
 * Every multi-tier family in upgrades.yml ends in a `choiceGroup` of two
 * mutually exclusive options: Rapid or Deep Freeze, and 25 more like it. Buying
 * one locks out the other for the rest of the run.
 *
 * `prerequisites` is AND. So an upgrade that wants to say "you finished that
 * line, whichever way you took it" has no way to say it:
 *
 *   BOTH BRANCHES  upgradeGraph reports mutually-exclusive-prereqs, an ERROR -
 *                  they lock each other out, so it could never be bought.
 *   ONE BRANCH     upgradeGraph reports choice-gated-branch, a warning - and it
 *                  is right: take the other option and this is gone for the
 *                  whole run. A reward for finishing a line that a coin flip
 *                  can delete is not a reward for finishing a line.
 *
 * Hence `unlockAfterChoice`: eligible once ANY member of that group is owned.
 * It is deliberately a separate field rather than a magic value inside
 * `prerequisites`, because it has different semantics (OR, over a group) and a
 * list that meant AND for some entries and OR for others would be a trap.
 */
import type { UpgradeConfig } from "@/types/upgrade";

/** True once the player has taken one of a choice group's options. */
export function choiceGroupTaken(
  group: string,
  ownedIds: readonly string[],
  byId: ReadonlyMap<string, UpgradeConfig>,
): boolean {
  return ownedIds.some(id => byId.get(id)?.choiceGroup === group);
}

/**
 * Can this upgrade be offered and bought, ignoring price and level?
 *
 * Both gates have to pass. An upgrade may carry a chain of prerequisites AND a
 * family-maxed gate - there is no map today that does, and there is no reason
 * to refuse one that wants to.
 */
export function prerequisitesMet(
  upgrade: UpgradeConfig,
  ownedIds: readonly string[],
  byId: ReadonlyMap<string, UpgradeConfig>,
): boolean {
  if (upgrade.unlockAfterChoice
      && !choiceGroupTaken(upgrade.unlockAfterChoice, ownedIds, byId)) {
    return false;
  }
  const prereqs = upgrade.prerequisites ?? [];
  return prereqs.every(id => ownedIds.includes(id));
}

/**
 * Every choice group in a catalogue, with its members.
 *
 * Shared by the validators rather than rebuilt at each: a group that exists in
 * one reader's index and not another's is exactly how a gate ends up pointing
 * at nothing and silently locking an upgrade out forever.
 */
export function choiceGroups(
  upgrades: readonly UpgradeConfig[],
): Map<string, UpgradeConfig[]> {
  const out = new Map<string, UpgradeConfig[]>();
  for (const u of upgrades) {
    if (!u.choiceGroup) continue;
    const list = out.get(u.choiceGroup);
    if (list) list.push(u);
    else out.set(u.choiceGroup, [u]);
  }
  return out;
}

/**
 * The family a choice group belongs to, by name, or null for an unknown group.
 *
 * Members of a group share a `name` - that is what makes them a family - so the
 * first member's name IS the family's. Named here rather than derived at each
 * screen because three of them ask the question and a screen that answered it
 * differently would tell the player to max a family that does not exist.
 */
export function familyOfChoiceGroup(
  group: string, upgrades: readonly UpgradeConfig[],
): string | null {
  return upgrades.find(u => u.choiceGroup === group)?.name ?? null;
}

/**
 * Why an upgrade is locked, in the terms the player is shown.
 *
 * Both gates, because a screen that showed only `prerequisites` would say
 * "Nothing. This is a chain head." over a card it then refuses to sell - which
 * is what the Atlas and the shop's detail card both did the day the fences
 * moved onto `unlockAfterChoice`. An unbuyable card that claims to need nothing
 * is worse than an unexplained one: it reads as the shop being broken.
 */
export function unlockRequirements(
  upgrade: UpgradeConfig, upgrades: readonly UpgradeConfig[],
): { prereqs: UpgradeConfig[]; maxedFamily: string | null } {
  const byId = new Map(upgrades.map(u => [u.id, u]));
  return {
    prereqs: (upgrade.prerequisites ?? [])
      .map(id => byId.get(id))
      .filter((u): u is UpgradeConfig => !!u),
    maxedFamily: upgrade.unlockAfterChoice
      ? familyOfChoiceGroup(upgrade.unlockAfterChoice, upgrades)
      : null,
  };
}
