/**
 * The Ascension ladder: ten named rungs, applied cumulatively.
 *
 * Before this, every ascension depth was the same game with the balls 8% faster
 * (speedRampPerDepth ^ depth) plus one blanket rule (completed fences wear out)
 * that was identical at depth 1 and depth 12. Depth 3 and depth 4 differed by a
 * single number, so "I am on Ascension 6" said nothing about what the run was
 * like. That is a slider, not a ladder.
 *
 * Each rung now names one specific change, and the rungs below it stay in
 * force, so a depth is describable: at 4 the shop is every other level, the
 * assignment offers two doors, there is no Promotion, and completed fences wear
 * out. The player can recite it.
 *
 * RULES, NOT NERFS. Most rungs change a rule rather than subtracting from a
 * stat, and that is deliberate. A rung that does `fenceDurabilityBonus: -1`
 * meets Defensive Programming in the shop, an upgrade whose only purpose is to
 * add ascension fence durability: buying it cancels the rung exactly, so the
 * rung turns one upgrade into a mandatory tax and leaves it useless everywhere
 * else. The test is not "does anything counter this" but "is the counter exact
 * and cheap". Nothing in the shop sells you a third assignment door, so
 * `doorOffers` cannot be bought back at any price.
 *
 * Two rungs deliberately DO collide, because their counter is a real decision
 * rather than a purchase: the overtime cap against the Stock Options capstone
 * (once per run, +20 against this -10), and ball speed against Runtime
 * Optimisation. Both make an existing pick more interesting at depth instead of
 * mandatory.
 */
import type { TFunction } from "i18next";
import { MAX_ABILITY_SLOTS } from "@/lib/abilities";
import { contentText } from "@/i18n/content";
import type { AscensionRung, AscensionRules } from "@/types/loadout";

/** How many rungs the ladder has. Depths past this repeat the last rung's
 *  state; the ladder is the named part, not the ceiling. */
export const LADDER_LENGTH = 10;

/** Nothing applied: the normal, unascended game. */
export const NO_ASCENSION_RULES: AscensionRules = {
  shopEveryOtherLevel: false,
  doorOffers: null,
  abilitySlots: MAX_ABILITY_SLOTS,
  noCapstone: false,
  fencesWearOut: false,
  everyMapMutated: false,
  pickupLifetimeFactor: 1,
  forcedCurseLoadoutId: null,
  modifiers: {},
};

/**
 * The rungs in force at `depth`, lowest first. Depth 0 is the normal game and
 * yields nothing; a depth past the ladder's end yields the whole ladder.
 */
export function rungsUpTo(depth: number, ladder: AscensionRung[]): AscensionRung[] {
  if (!Number.isFinite(depth) || depth <= 0) return [];
  return ladder.filter(r => r.depth <= depth).sort((a, b) => a.depth - b.depth);
}

/**
 * Fold every rung in force at `depth` into one resolved rule set.
 *
 * Later rungs win on scalars, and modifiers accumulate, so a ladder that names
 * the same key twice tightens rather than replaces. `pickupLifetimeFactor`
 * multiplies for the same reason: two rungs halving it should quarter it.
 */
export function ascensionRules(depth: number, ladder: AscensionRung[]): AscensionRules {
  const rungs = rungsUpTo(depth, ladder);
  if (rungs.length === 0) return { ...NO_ASCENSION_RULES };

  const out: AscensionRules = { ...NO_ASCENSION_RULES, modifiers: {} };
  for (const r of rungs) {
    const e = r.effects ?? {};
    if (e.shopEveryOtherLevel) out.shopEveryOtherLevel = true;
    if (e.noCapstone) out.noCapstone = true;
    if (e.fencesWearOut) out.fencesWearOut = true;
    if (e.everyMapMutated) out.everyMapMutated = true;
    // A tighter door count wins, so a later rung can never widen the draft.
    if (typeof e.doorOffers === "number") {
      out.doorOffers = out.doorOffers == null ? e.doorOffers : Math.min(out.doorOffers, e.doorOffers);
    }
    // Same rule for ability slots: the ladder only ever takes away.
    if (typeof e.abilitySlots === "number") {
      out.abilitySlots = Math.max(1, Math.min(out.abilitySlots, e.abilitySlots));
    }
    if (typeof e.pickupLifetimeFactor === "number" && e.pickupLifetimeFactor > 0) {
      out.pickupLifetimeFactor *= e.pickupLifetimeFactor;
    }
    if (e.forcedCurseLoadoutId) out.forcedCurseLoadoutId = e.forcedCurseLoadoutId;
    for (const [k, v] of Object.entries(e.modifiers ?? {})) {
      if (typeof v !== "number") continue;
      const key = k as keyof AscensionRules["modifiers"];
      const prev = out.modifiers[key];
      // Multiplicative keys compound across rungs; everything else sums. Ball
      // speed is the only multiplicative one the ladder uses today, and a
      // ladder naming it twice should compound, not overwrite.
      out.modifiers[key] = MULTIPLICATIVE.has(k)
        ? (prev ?? 1) * v
        : (prev ?? 0) + v;
    }
  }
  return out;
}

/** Ladder keys that compound rather than sum. Mirrors useActiveModifiers. */
const MULTIPLICATIVE = new Set([
  "ballSpeedMultiplier",
  "ballSizeMultiplier",
  "scoreMultiplier",
  "fenceGenerationSpeedMultiplier",
  "shopDiscountMultiplier",
  "spaceBonusMultiplier",
  "shipEarlyBonusMultiplier",
  "pushBonusMultiplier",
  "slowOneBallFactor",
]);

/**
 * Whether the shop opens after clearing `levelNumber`.
 *
 * Every other level counted from the first, so level 1's shop still opens and
 * the run is never left with no way to spend its opening income. Assignment
 * levels are unaffected: they replace the shop with the door draft anyway, and
 * silently eating one would cost the player a contract.
 */
export function shopOpensAfter(levelNumber: number, rules: AscensionRules): boolean {
  if (!rules.shopEveryOtherLevel) return true;
  return levelNumber % 2 === 1;
}

/** The rung earned at exactly this depth, for the "what is new" callout. */
export function rungAt(depth: number, ladder: AscensionRung[]): AscensionRung | null {
  return ladder.find(r => r.depth === depth) ?? null;
}

/**
 * What to put in front of the player when a depth begins.
 *
 * Leads with the rung just earned, because that is the question being asked:
 * what does THIS ascension add. The rungs below it are named but not described,
 * as a reminder of what is already in force rather than a wall of text nobody
 * reads. The full descriptions stay in the Specs panel.
 *
 * Returns null when there is nothing to announce (depth 0, or a ladder that
 * failed to load), which is the caller's cue not to open a modal at all.
 */
export function ascensionAnnouncement(
  t: TFunction, depth: number, ladder: AscensionRung[],
): { title: string; body: string } | null {
  const inForce = rungsUpTo(depth, ladder);
  if (inForce.length === 0) return null;

  const earned = rungAt(depth, ladder);
  // Past the ladder's end there is no new rung, so lead with the deepest one.
  const lead = earned ?? inForce[inForce.length - 1];
  const rest = inForce.filter(r => r.depth !== lead.depth);

  const parts = [
    `${contentText.rungName(t, lead)}\n${contentText.rungDesc(t, lead)}`,
  ];
  if (rest.length > 0) {
    parts.push(t("ascension.alsoInForce", {
      names: rest.map(r => contentText.rungName(t, r)).join(", "),
    }));
  }
  return {
    title: t("ascension.ladderTitle", { depth }),
    body: parts.join("\n\n"),
  };
}
