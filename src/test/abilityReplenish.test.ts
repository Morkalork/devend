/**
 * Shockwave comes back every map, once you have earned it.
 *
 * Reported as "once a user gets the Shockwave ability, it should replenish on
 * every map if it was used in the previous one - you always start with one on
 * each map". A top-up already existed and did not do that: it was armed by the
 * `panicShockwave` feature, unlocked by BEATING THE LEVEL 10 BOSS, while
 * Shockwave itself drops from chests from level 4. Find one at level 5, spend
 * it, and it stays gone for five maps.
 *
 * The trigger is now HAVING earned it, which is the thing the player can see.
 *
 * Two rules are easy to get backwards and invisible when you do, so both are
 * pinned here: a top-up must never LOWER a banked stack (a player who hoarded
 * three would be trimmed to one at every map start), and it must survive
 * spending the last charge (keying on the live stack would make the ability
 * replenish only while you did not need it to).
 */
import { describe, it, expect } from "vitest";
import { replenishAbilityCharges, heldAbilityIds } from "@/lib/abilityReplenish";
import { getAllAbilities, type AbilityDef } from "@/lib/abilities";

const def = (over: Partial<AbilityDef> = {}): AbilityDef => ({
  id: "shockwave", name: "Shockwave", kind: "shockwave", color: "#f00",
  weight: 1, startLevel: 4, ...over,
});

const SHOCK = def({ replenishTo: 1 });
const FREEZE = def({ id: "freezeAll", kind: "freeze" });
const CATALOGUE = [SHOCK, FREEZE];

describe("the catalogue actually marks Shockwave as replenishing", () => {
  // The logic below is worth nothing if the YAML never opts anything in. This
  // reads the shipped catalogue rather than a fixture.
  it("ships replenishTo on shockwave and on nothing else", () => {
    const replenishing = getAllAbilities().filter(a => (a.replenishTo ?? 0) > 0);
    expect(replenishing.map(a => a.id)).toEqual(["shockwave"]);
    expect(replenishing[0].replenishTo).toBe(1);
  });
});

describe("a map opens with the Shockwave you earned", () => {
  it("gives one to a player who has earned it and spent it", () => {
    // The exact report: used on the previous map, so the stack is empty.
    expect(replenishAbilityCharges({ shockwave: 0 }, ["shockwave"], CATALOGUE))
      .toEqual({ shockwave: 1 });
  });

  it("gives one when the id is gone from the stack entirely", () => {
    expect(replenishAbilityCharges({}, ["shockwave"], CATALOGUE))
      .toEqual({ shockwave: 1 });
  });

  it("gives nothing to a player who has never earned it", () => {
    // Otherwise every run would open with a free Shockwave and the chest that
    // grants it would be worthless.
    expect(replenishAbilityCharges({}, [], CATALOGUE)).toEqual({});
    expect(replenishAbilityCharges({}, ["freezeAll"], CATALOGUE)).toEqual({});
  });

  it("never trims a banked stack back down to the floor", () => {
    // A player who hoarded three across three chests keeps three.
    expect(replenishAbilityCharges({ shockwave: 3 }, ["shockwave"], CATALOGUE))
      .toEqual({ shockwave: 3 });
  });

  it("leaves ordinary consumables alone, however many you have earned", () => {
    // Freeze has no replenishTo: spending it must actually spend it.
    expect(replenishAbilityCharges({ freezeAll: 0 }, ["freezeAll", "shockwave"], CATALOGUE))
      .toEqual({ freezeAll: 0, shockwave: 1 });
  });

  it("returns the very same object when nothing changes", () => {
    // A React effect calls this on every render; a fresh object each time would
    // set state forever.
    const charges = { shockwave: 1 };
    expect(replenishAbilityCharges(charges, ["shockwave"], CATALOGUE)).toBe(charges);
  });
});

describe("the level-10 feature still grants it", () => {
  it("tops up a player who reached the boss without ever finding a chest", () => {
    // The old panicShockwave behaviour, preserved: nobody loses what they had.
    expect(replenishAbilityCharges({}, [], CATALOGUE, ["shockwave"]))
      .toEqual({ shockwave: 1 });
  });

  it("and the two routes do not double up", () => {
    expect(replenishAbilityCharges({}, ["shockwave"], CATALOGUE, ["shockwave"]))
      .toEqual({ shockwave: 1 });
  });
});

describe("what counts as having earned it", () => {
  it("counts an ability you are holding right now", () => {
    expect(heldAbilityIds({ shockwave: 2 })).toEqual(["shockwave"]);
  });

  it("counts one recorded as earned but already spent", () => {
    expect(heldAbilityIds({ shockwave: 0 }, ["shockwave"])).toEqual(["shockwave"]);
  });

  it("does not count an empty slot nobody ever earned", () => {
    expect(heldAbilityIds({ freezeAll: 0 })).toEqual([]);
  });

  it("rescues a run saved before the record existed", () => {
    // Such a save has no heldAbilityIds; the charge it carries is the evidence.
    // Without this the player is silently downgraded to a consumable Shockwave.
    const restored = heldAbilityIds({ shockwave: 1 }, []);
    expect(replenishAbilityCharges({ shockwave: 0 }, restored, CATALOGUE))
      .toEqual({ shockwave: 1 });
  });

  it("does not invent an entitlement from an empty save", () => {
    expect(heldAbilityIds({}, [])).toEqual([]);
  });
});
