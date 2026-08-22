/**
 * The ability slot cap: at most five DISTINCT abilities held at once.
 *
 * A cap rather than an ever-growing bar, for the same reason the upgrade shop
 * offers three of a hundred: a loadout you chose is a build, a loadout you
 * accumulated is an inventory. With the whole catalogue available there is no
 * wrong moment to smash a chest and no reason to prefer one reward over another.
 *
 * The behaviour at the cap is the part worth pinning. A roll that lands on an
 * ability the player does NOT hold is converted into a charge of one they DO,
 * rather than refused: a chest is something they spent balls and time smashing,
 * and paying nothing because the bar is full punishes them for the reward system
 * working. Every test below is really about that conversion staying lossless.
 */
import { describe, it, expect } from "vitest";
import {
  rollAbilityReward, rollCappedAbilityReward, getAllAbilities, MAX_ABILITY_SLOTS,
} from "@/lib/abilities";
import { ascensionRules, NO_ASCENSION_RULES } from "@/lib/ascensionLadder";
import type { AscensionRung } from "@/types/loadout";

/** A generator that walks a fixed sequence, so a roll is reproducible. */
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
/**
 * A cheap deterministic stream, for "roll a lot of times" checks.
 *
 * Scrambled and warmed up on purpose. A plain `s = seed` Lehmer generator emits
 * seed*48271/2^31 first, which for any small seed is a value near ZERO, so every
 * seed's first roll picks the first weighted entry and a loop over 400 seeds
 * tests one outcome 400 times. That is how a sampling test passes while proving
 * nothing, and it is what the spread assertion below exists to catch.
 */
const stream = (seed: number) => {
  let s = ((seed * 2654435761) % 2147483647) || 1;
  const next = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  for (let i = 0; i < 8; i++) next();
  return next;
};

const ALL = () => getAllAbilities().map(a => a.id);
const LATE = 30; // past every startLevel, so the whole catalogue is eligible

describe("the cap itself", () => {
  it("is five", () => {
    expect(MAX_ABILITY_SLOTS).toBe(5);
  });

  it("is smaller than the catalogue, or it would not be a cap", () => {
    expect(getAllAbilities().length).toBeGreaterThan(MAX_ABILITY_SLOTS);
  });
});

describe("below the cap", () => {
  it("changes nothing: the roll is the roll", () => {
    const held = ALL().slice(0, 2);
    for (const s of [1, 7, 99, 1234]) {
      const plain = rollAbilityReward(undefined, LATE, stream(s));
      const capped = rollCappedAbilityReward(undefined, LATE, stream(s), held);
      expect(capped, `seed ${s}`).toBe(plain);
    }
  });

  it("is unchanged when nothing is held at all", () => {
    const plain = rollAbilityReward(undefined, LATE, stream(5));
    expect(rollCappedAbilityReward(undefined, LATE, stream(5), [])).toBe(plain);
  });

  it("behaves exactly like the plain roll when no held set is supplied", () => {
    // Every existing caller and test passes nothing, and must keep working.
    const plain = rollAbilityReward(undefined, LATE, stream(11));
    expect(rollCappedAbilityReward(undefined, LATE, stream(11))).toBe(plain);
  });
});

describe("at the cap", () => {
  const held = () => ALL().slice(0, MAX_ABILITY_SLOTS);

  it("never grants a sixth distinct ability, however the dice fall", () => {
    const h = held();
    for (let s = 1; s <= 300; s++) {
      const got = rollCappedAbilityReward(undefined, LATE, stream(s), h);
      expect(h, `seed ${s} granted ${got}`).toContain(got);
    }
  });

  /** The whole point: the chest still pays. */
  it("always pays something", () => {
    const h = held();
    for (let s = 1; s <= 300; s++) {
      expect(rollCappedAbilityReward(undefined, LATE, stream(s), h)).not.toBeNull();
    }
  });

  it("passes a roll straight through when it lands on something held", () => {
    const h = held();
    // Force the very first weighted pick by handing the roll a 0.
    const first = rollAbilityReward(undefined, LATE, seq(0));
    expect(h).toContain(first);            // guard: the probe must be meaningful
    expect(rollCappedAbilityReward(undefined, LATE, seq(0), h)).toBe(first);
  });

  it("still spreads across the held set rather than always paying the same one", () => {
    const h = held();
    const seen = new Set<string>();
    for (let s = 1; s <= 400; s++) seen.add(rollCappedAbilityReward(undefined, LATE, stream(s), h)!);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("ignores duplicate ids when counting what is held", () => {
    const h = [...ALL().slice(0, 2), ...ALL().slice(0, 2)];  // 2 distinct, 4 entries
    // Two distinct is below the cap, so the roll must pass straight through.
    const plain = rollAbilityReward(undefined, LATE, stream(3));
    expect(rollCappedAbilityReward(undefined, LATE, stream(3), h)).toBe(plain);
  });

  it("honours a chest's own pool when it overlaps what is held", () => {
    const h = held();
    const pool = [h[0], h[1]];
    for (let s = 1; s <= 60; s++) {
      const got = rollCappedAbilityReward(pool, LATE, stream(s), h);
      expect(pool, `seed ${s}`).toContain(got);
    }
  });

  /**
   * A chest whose authored pool is entirely abilities the player cannot receive.
   * It must still pay from the held set rather than returning null, which would
   * be a chest that visibly opens and gives nothing.
   */
  it("still pays when the chest's pool and the held set do not overlap", () => {
    const h = ALL().slice(0, MAX_ABILITY_SLOTS);
    const outside = ALL().filter(id => !h.includes(id));
    expect(outside.length, "catalogue too small for this probe").toBeGreaterThan(0);
    for (let s = 1; s <= 60; s++) {
      const got = rollCappedAbilityReward(outside, LATE, stream(s), h);
      expect(got, `seed ${s}`).not.toBeNull();
      expect(h, `seed ${s}`).toContain(got);
    }
  });
});

describe("a tighter cap", () => {
  it("is honoured when ascension supplies one", () => {
    const h = ALL().slice(0, 3);
    for (let s = 1; s <= 200; s++) {
      const got = rollCappedAbilityReward(undefined, LATE, stream(s), h, 3);
      expect(h, `seed ${s} granted ${got}`).toContain(got);
    }
  });

  it("never reads as zero slots, which would make chests unpayable", () => {
    const h = ALL().slice(0, 2);
    for (const slots of [0, -3]) {
      const got = rollCappedAbilityReward(undefined, LATE, stream(9), h, slots);
      expect(got, `slots ${slots}`).not.toBeNull();
    }
  });
});

describe("the ascension ladder tightens it", () => {
  const mk = (depth: number, effects: Record<string, unknown>): AscensionRung =>
    ({ depth, name: `r${depth}`, description: "", effects } as unknown as AscensionRung);

  it("starts at the full cap with no ascension", () => {
    expect(NO_ASCENSION_RULES.abilitySlots).toBe(MAX_ABILITY_SLOTS);
  });

  it("takes the tighter of two rungs, so a later one can never widen it", () => {
    const l = [mk(1, { abilitySlots: 4 }), mk(2, { abilitySlots: 3 })];
    expect(ascensionRules(2, l).abilitySlots).toBe(3);
    const reversed = [mk(1, { abilitySlots: 3 }), mk(2, { abilitySlots: 4 })];
    expect(ascensionRules(2, reversed).abilitySlots).toBe(3);
  });

  it("never drops below one slot", () => {
    expect(ascensionRules(1, [mk(1, { abilitySlots: 0 })]).abilitySlots).toBe(1);
    expect(ascensionRules(1, [mk(1, { abilitySlots: -5 })]).abilitySlots).toBe(1);
  });

  it("leaves the cap alone at depths the rung has not reached", () => {
    const l = [mk(7, { abilitySlots: 4 })];
    expect(ascensionRules(6, l).abilitySlots).toBe(MAX_ABILITY_SLOTS);
    expect(ascensionRules(7, l).abilitySlots).toBe(4);
  });
});
