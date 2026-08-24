/**
 * Upgrades that only pay in a situation.
 *
 * The catalogue is 114 upgrades and 86 of them are FLAT: a number that applies
 * always, everywhere, to everyone. That is the whole of the "same build every
 * run" problem. When every effect is unconditional there is a strictly-best
 * pick at every price, the shop resolves to the same order every time, and run
 * two plays exactly like run one.
 *
 * A condition turns a number into a bet. "+40% while you are on your last life"
 * is worth more than a flat +15% to a player who plays close to the edge and
 * worth nothing to one who hoards Continues, so the two build differently and
 * neither is wrong. That is a decision, which is what a draft is supposed to be.
 *
 * ── Evaluated once, at map start ───────────────────────────────────────────
 *
 * Not per frame. A modifier set that changed mid-map would mean the fence you
 * started drawing under one rule finishes under another, and the HUD numbers
 * would drift while the player watched. Per-map means the shop can promise
 * something honest ("live on the next map") and the map plays by one set of
 * rules from first cut to last.
 *
 * This mechanism already existed, hand-rolled: useGameSession has a second
 * modifier pass folding in War Chest (keys off the bank) and Clean Release
 * (keys off the under-par carry). Those are conditions written in TypeScript
 * one upgrade at a time. This makes them a field in the YAML instead.
 */
import type { LevelConfig } from "@/types/level";

/**
 * What a condition can look at.
 *
 * Deliberately small, and deliberately all knowable BEFORE the first cut. A
 * condition on something that changes during play ("while you have no fences
 * growing") could not be evaluated once, and could not be promised by the shop.
 */
export interface RunContext {
  /** 1-based map number in the run. */
  level: number;
  lives: number;
  /** Overtime in hand right now. */
  banked: number;
  /** Ascension depth: 0 is a first pass through the ladder. */
  depth: number;
  map: MapContext;
}

export interface MapContext {
  balls: number;
  hasWell: boolean;
  hasMover: boolean;
  hasBreakable: boolean;
  hasArea: boolean;
  hasBoss: boolean;
}

export type MapFeature = "well" | "mover" | "breakable" | "area" | "boss";

/**
 * One situation an upgrade can be conditional on.
 *
 * A closed union, so an unknown kind fails to compile rather than silently
 * evaluating as "met" - which would be the worst failure here, an upgrade that
 * quietly pays always and looks conditional on the card.
 */
export type UpgradeCondition =
  /** On your last life, or close to it. The desperation archetype. */
  | { kind: "livesAtMost"; value: number }
  /** Rich. Rewards banking over spending, which nothing else does. */
  | { kind: "bankedAtLeast"; value: number }
  /** Late in the run, when a payoff has time to matter. */
  | { kind: "levelAtLeast"; value: number }
  /** Busy maps only. Pairs with the ball roster the ladder ramps. */
  | { kind: "ballsAtLeast"; value: number }
  /** This map contains a particular thing to play against. */
  | { kind: "mapHas"; feature: MapFeature }
  /** Ascended runs only. */
  | { kind: "depthAtLeast"; value: number };

/** Read a map's features once, so a condition never re-scans the level. */
export function mapContextOf(level: LevelConfig | null | undefined): MapContext {
  const entities = level?.entities ?? [];
  return {
    balls: level?.maxBalls ?? level?.balls?.length ?? 0,
    hasWell: (level?.gravityWells?.length ?? 0) > 0,
    hasMover: entities.some(e => e.kind === "mover"),
    hasBreakable: entities.some(e => (e as { breakable?: boolean }).breakable === true),
    hasArea: (level?.coloredAreas?.length ?? 0) > 0,
    hasBoss: !!level?.boss,
  };
}

/**
 * Is this condition satisfied right now?
 *
 * An upgrade with NO condition is always met: the flat catalogue keeps working
 * untouched, which is what lets this be introduced without retuning 114 things
 * at once.
 */
export function conditionMet(
  condition: UpgradeCondition | undefined, ctx: RunContext | null | undefined,
): boolean {
  if (!condition) return true;
  // No context means nothing is known about the run, which happens in the
  // Playground and in previews. Treating conditions as MET there keeps a card's
  // numbers readable rather than showing every conditional upgrade as a zero.
  if (!ctx) return true;

  switch (condition.kind) {
    case "livesAtMost": return ctx.lives <= condition.value;
    case "bankedAtLeast": return ctx.banked >= condition.value;
    case "levelAtLeast": return ctx.level >= condition.value;
    case "ballsAtLeast": return ctx.map.balls >= condition.value;
    case "depthAtLeast": return ctx.depth >= condition.value;
    case "mapHas":
      switch (condition.feature) {
        case "well": return ctx.map.hasWell;
        case "mover": return ctx.map.hasMover;
        case "breakable": return ctx.map.hasBreakable;
        case "area": return ctx.map.hasArea;
        case "boss": return ctx.map.hasBoss;
      }
  }
}

/**
 * The i18n key and params for a condition, for the shop card.
 *
 * A conditional upgrade whose condition is not on the card is a trap: the
 * player pays for a number that then does not appear, and concludes the game
 * is broken rather than that they misread it. This is not optional polish.
 */
export function conditionText(
  condition: UpgradeCondition,
): { key: string; params: Record<string, number | string> } {
  switch (condition.kind) {
    case "livesAtMost": return { key: "upgradeConditions.livesAtMost", params: { count: condition.value } };
    case "bankedAtLeast": return { key: "upgradeConditions.bankedAtLeast", params: { hours: condition.value } };
    case "levelAtLeast": return { key: "upgradeConditions.levelAtLeast", params: { level: condition.value } };
    case "ballsAtLeast": return { key: "upgradeConditions.ballsAtLeast", params: { count: condition.value } };
    case "depthAtLeast": return { key: "upgradeConditions.depthAtLeast", params: { depth: condition.value } };
    case "mapHas": return { key: `upgradeConditions.mapHas.${condition.feature}`, params: {} };
  }
}

/** Every condition kind, for the tests that check each one has words. */
export const CONDITION_KINDS = [
  "livesAtMost", "bankedAtLeast", "levelAtLeast", "ballsAtLeast", "depthAtLeast",
] as const;
export const MAP_FEATURES: MapFeature[] = ["well", "mover", "breakable", "area", "boss"];
