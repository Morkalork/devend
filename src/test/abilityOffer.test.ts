/**
 * The store's ability slot.
 *
 * The rules that only exist here, and that all look the same when they are
 * wrong: what the slot sells, when it closes, what it costs, and what a
 * retainer does to the next map.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  rollAbilityOffers, abilitySlotClosed, abilityOfferCost, abilityIdFromOffer, abilityOfferId,
  ABILITY_HOURS_PER_MAP, ABILITY_MIN_COST,
} from '@/lib/abilityOffer';
import { replenishAbilityCharges } from '@/lib/abilityReplenish';
import { getAllAbilities, getEligibleAbilities, MAX_ABILITY_SLOTS } from '@/lib/abilities';

/** Deterministic, and never 0 or 1, so a weighted pick lands mid-pool. */
const rng = (v = 0.5) => () => v;

describe('what the slot offers', () => {
  it('offers a retainer card the shop can render like any other', () => {
    const [card] = rollAbilityOffers(20, 10, [], 1, rng());
    expect(card).toBeTruthy();
    expect(card.grantsAbility).toBeTruthy();
    expect(card.id).toBe(abilityOfferId(card.grantsAbility!));
    expect(abilityIdFromOffer(card.id)).toBe(card.grantsAbility);
    // The shop tells the two kinds apart by this field alone, so an ordinary
    // upgrade must never answer to it.
    expect(abilityIdFromOffer('system_architect')).toBeNull();
  });

  it('never offers an ability the player already holds', () => {
    const held = getEligibleAbilities(20).slice(0, 3).map(a => a.id);
    for (let i = 0; i < 40; i++) {
      const offers = rollAbilityOffers(20, 10, held, 2, rng(i / 40));
      for (const o of offers) expect(held).not.toContain(o.grantsAbility);
    }
  });

  it('offers two distinct abilities when asked for two', () => {
    const offers = rollAbilityOffers(20, 10, [], 2, rng(0.3));
    expect(offers).toHaveLength(2);
    expect(offers[0].grantsAbility).not.toBe(offers[1].grantsAbility);
  });

  it('respects an ability that has not unlocked yet', () => {
    const late = getAllAbilities().filter(a => a.startLevel > 3).map(a => a.id);
    for (let i = 0; i < 20; i++) {
      const offers = rollAbilityOffers(3, 10, [], 2, rng(i / 20));
      for (const o of offers) expect(late).not.toContain(o.grantsAbility);
    }
  });

  it('carries the ability its own colour and kind, for the inverted card', () => {
    const [card] = rollAbilityOffers(20, 10, [], 1, rng());
    const def = getAllAbilities().find(a => a.id === card.grantsAbility)!;
    expect(card.abilityColor).toBe(def.color);
    expect(card.abilityKind).toBe(def.kind);
    expect(card.name).toBe(def.name);
  });
});

describe('when the slot closes', () => {
  it('closes at the ability cap, and not before', () => {
    const ids = getEligibleAbilities(30).map(a => a.id);
    expect(abilitySlotClosed(ids.slice(0, MAX_ABILITY_SLOTS - 1))).toBe(false);
    expect(abilitySlotClosed(ids.slice(0, MAX_ABILITY_SLOTS))).toBe(true);
  });

  it('offers nothing once it is closed', () => {
    const full = getEligibleAbilities(30).slice(0, MAX_ABILITY_SLOTS).map(a => a.id);
    expect(rollAbilityOffers(30, 10, full, 1, rng())).toEqual([]);
  });

  it('counts a SPENT ability against the cap, like a chest does', () => {
    // `held` is what was ever held, not the current stack. Otherwise a player
    // could free a slot by burning a charge, and the cap would stop meaning
    // anything about the build.
    const full = getEligibleAbilities(30).slice(0, MAX_ABILITY_SLOTS).map(a => a.id);
    expect(abilitySlotClosed(full)).toBe(true);
  });

  it('honours a tightened cap, which is how ascension changes the build', () => {
    const two = getEligibleAbilities(30).slice(0, 2).map(a => a.id);
    expect(abilitySlotClosed(two, 2)).toBe(true);
    expect(rollAbilityOffers(30, 10, two, 1, rng(), 2)).toEqual([]);
  });

  it('never offers more retainers than there is room to take', () => {
    // Two cards with one slot left is two promises the shop cannot both keep.
    const nearlyFull = getEligibleAbilities(30).slice(0, MAX_ABILITY_SLOTS - 1).map(a => a.id);
    expect(rollAbilityOffers(30, 10, nearlyFull, 3, rng())).toHaveLength(1);
  });
});

describe('what a retainer costs', () => {
  it('is worth one charge per map still to come', () => {
    expect(abilityOfferCost(20)).toBe(20 * ABILITY_HOURS_PER_MAP);
    expect(abilityOfferCost(5)).toBe(5 * ABILITY_HOURS_PER_MAP);
  });

  it('gets CHEAPER the later it is bought, which is the point', () => {
    // The shop's other prices inflate with the level. A retainer pays out once
    // per remaining map, so the same curve would charge the most for the least.
    expect(abilityOfferCost(3)).toBeLessThan(abilityOfferCost(25));
    const [early] = rollAbilityOffers(5, 30, [], 1, rng());
    const [late] = rollAbilityOffers(25, 5, [], 1, rng());
    expect(late.cost!).toBeLessThan(early.cost!);
  });

  it('still charges something on the last map', () => {
    expect(abilityOfferCost(0)).toBe(ABILITY_MIN_COST);
    expect(abilityOfferCost(-4)).toBe(ABILITY_MIN_COST);
  });
});

describe('what a retainer does afterwards', () => {
  const catalogue = getAllAbilities();
  const consumable = catalogue.find(a => !a.replenishTo)!;

  it('makes an ordinary consumable come back every map', () => {
    const after = replenishAbilityCharges({}, [consumable.id], catalogue, [], [consumable.id]);
    expect(after[consumable.id]).toBe(1);
  });

  it('does nothing for an ability that was never bought', () => {
    const after = replenishAbilityCharges({}, [consumable.id], catalogue, [], []);
    expect(after[consumable.id] ?? 0).toBe(0);
  });

  it('never trims a stack the player banked from chests', () => {
    const after = replenishAbilityCharges(
      { [consumable.id]: 4 }, [consumable.id], catalogue, [], [consumable.id],
    );
    expect(after[consumable.id]).toBe(4);
  });

  it('leaves an ability that already replenishes higher on its own floor', () => {
    const big = catalogue.find(a => (a.replenishTo ?? 0) > 1);
    if (!big) return; // nothing in the catalogue claims more than one today
    const after = replenishAbilityCharges({}, [big.id], catalogue, [], [big.id]);
    expect(after[big.id]).toBe(big.replenishTo);
  });
});

/**
 * The links that can be perfect on both sides and still leave the feature dead
 * for the one person using it.
 *
 * Every rule above is exercised against a function; none of them prove the
 * running game ever CALLS it. That is the bug this session already shipped once
 * (the launcher's data was built, published and rendered, and GameCanvas never
 * copied it), so the three joints are pinned in the source itself.
 */
describe('the wiring, not the rules', () => {
  const read = (rel: string) =>
    readFileSync(resolve(process.cwd(), rel), 'utf8');

  it('feeds bought retainers into the per-map replenish', () => {
    const src = read('src/hooks/useGameSession.ts');
    const call = src.slice(src.indexOf('replenishAbilityCharges('));
    const args = call.slice(0, call.indexOf('));'));
    expect(args, 'the replenish call ignores what the store sold')
      .toContain('retainedAbilityIds');
  });

  it('gives the shop everything its ability slot needs', () => {
    const src = read('src/pages/Index.tsx');
    // Bounded to the element itself. An unbounded slice runs to the end of the
    // file and finds these names in other components, which is how this check
    // first passed with the prop deleted.
    const open = src.indexOf('<UpgradeShop');
    const close = src.indexOf('/>', open);
    expect(open, 'Index no longer renders the shop').toBeGreaterThan(-1);
    expect(close, 'the UpgradeShop element never closes').toBeGreaterThan(open);
    const shop = src.slice(open, close);
    for (const prop of ['heldAbilityIds', 'abilitySlots', 'mapsRemaining', 'abilityOfferCount', 'onPurchaseAbility']) {
      expect(shop, `UpgradeShop is never given ${prop}`).toContain(prop);
    }
  });

  it('saves the retainers with the run, or they die at the next resume', () => {
    const src = read('src/hooks/useGameSession.ts');
    // Matched with a CRLF-tolerant regex, not a literal newline: on a Windows
    // checkout Git hands the file back with \r\n endings, so a literal \n
    // failed here on that platform only while CI (Linux) stayed green - a
    // test that failed by machine rather than by behaviour.
    expect(src, 'retainers are never written to the run save')
      .toMatch(/retainedAbilityIds,\r?\n\s*};/);
    expect(src, 'retainers are never read back from the run save')
      .toContain('save.retainedAbilityIds');
  });
});
