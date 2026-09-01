/**
 * The store's ability slot, as the shop actually renders and sells it.
 *
 * abilityOffer.test.ts pins the rules; this pins the wiring, which is where a
 * feature that is right everywhere else still fails the one person using it:
 * the card has to be there, it has to be BOUGHT down its own channel rather
 * than counted as an upgrade, its price must not inflate with the level, and at
 * the cap the slot has to say it is closed instead of quietly vanishing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n';
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { UpgradeConfig } from '@/types/upgrade';
import { getEligibleAbilities, MAX_ABILITY_SLOTS } from '@/lib/abilities';
import { ABILITY_HOURS_PER_MAP } from '@/lib/abilityOffer';
import { inflationForLevel } from '@/lib/upgradePricing';

const plain: UpgradeConfig[] = [
  { id: 'u_a', name: 'Plain Upgrade', tier: 'Junior', description: 'An ordinary upgrade', cost: 30, unlockLevel: 1, tags: ['bank'], modifiers: {} },
];

function props(over: Partial<React.ComponentProps<typeof UpgradeShop>> = {}) {
  return {
    playerPoints: 5000,
    upgrades: plain,
    ownedUpgradeIds: [] as string[],
    completedLevel: 5,
    isLocked: () => false,
    onPurchase: vi.fn(),
    onContinue: vi.fn(),
    mapsRemaining: 10,
    heldAbilityIds: [] as string[],
    ...over,
  };
}

/** The rendered retainer card, found by the kicker the inverted card carries. */
const abilityCard = () => screen.queryByText('Ability');

afterEach(cleanup);

describe('the ability slot on the shelf', () => {
  it('is there beside the upgrades, not instead of one', () => {
    render(<UpgradeShop {...props()} />);
    expect(abilityCard()).toBeTruthy();
    // The upgrade it sits beside is still on the shelf.
    expect(screen.getByText('An ordinary upgrade')).toBeTruthy();
  });

  it('says what it is buying, in maps', () => {
    render(<UpgradeShop {...props({ mapsRemaining: 12 })} />);
    expect(screen.getByText(/One every map, 12 left/)).toBeTruthy();
  });

  it('is drawn inverted: a light ground carrying dark text', () => {
    render(<UpgradeShop {...props()} />);
    const card = abilityCard()!.closest('button')!;
    // The distinguishing pair. An upgrade card is bg-card with light text; if
    // this ever falls back to that palette the slot stops reading as a
    // different kind of thing, which is the whole point of the treatment.
    expect(card.className).toContain('bg-foreground');
    expect(card.className).toContain('text-background');
    const upgradeCard = screen.getByText('An ordinary upgrade').closest('button')!;
    expect(upgradeCard.className).not.toContain('bg-foreground');
  });

  it('buys down its own channel, never as an upgrade', () => {
    const onPurchase = vi.fn();
    const onPurchaseAbility = vi.fn();
    render(<UpgradeShop {...props({ onPurchase, onPurchaseAbility })} />);
    fireEvent.click(abilityCard()!.closest('button')!);
    fireEvent.click(screen.getByText('Buy 1'));
    expect(onPurchaseAbility).toHaveBeenCalledTimes(1);
    // An ability id, not the synthetic card id, and never the upgrade channel.
    const [id, price] = onPurchaseAbility.mock.calls[0];
    expect(getEligibleAbilities(5).map(a => a.id)).toContain(id);
    expect(price).toBe(10 * ABILITY_HOURS_PER_MAP);
    expect(onPurchase).not.toHaveBeenCalled();
  });

  it('does not inflate with the level, unlike everything else on the shelf', () => {
    // Level 25 is five inflation blocks in: the plain upgrade's price has more
    // than quadrupled while the retainer's is still ten maps at the flat rate.
    const onPurchaseAbility = vi.fn();
    render(<UpgradeShop {...props({ completedLevel: 25, onPurchaseAbility })} />);
    fireEvent.click(abilityCard()!.closest('button')!);
    fireEvent.click(screen.getByText('Buy 1'));
    expect(onPurchaseAbility.mock.calls[0][1]).toBe(10 * ABILITY_HOURS_PER_MAP);
    // The upgrade beside it took the full market rate on the same shelf, which
    // is what makes the exemption a real difference rather than a rounding one.
    const inflated = Math.round(30 * inflationForLevel(25));
    expect(inflated).toBeGreaterThan(30);
    expect(screen.getByText(new RegExp(`${inflated}h`))).toBeTruthy();
  });

  it('closes at the cap, and says so rather than just disappearing', () => {
    const full = getEligibleAbilities(30).slice(0, MAX_ABILITY_SLOTS).map(a => a.id);
    render(<UpgradeShop {...props({ completedLevel: 30, heldAbilityIds: full })} />);
    expect(abilityCard()).toBeNull();
    expect(screen.getByText(/Ability slot closed/)).toBeTruthy();
  });

  it('is removed without a closed notice when traded away for the free grant', () => {
    // Open Source Contribution takes the slot off the shelf. That is not the
    // cap, and telling the player their bar is full would be a lie - said with
    // a FULL bar, because with an empty one the two reasons look identical.
    const full = getEligibleAbilities(30).slice(0, MAX_ABILITY_SLOTS).map(a => a.id);
    render(<UpgradeShop {...props({ completedLevel: 30, heldAbilityIds: full, abilityOfferCount: 0 })} />);
    expect(abilityCard()).toBeNull();
    expect(screen.queryByText(/Ability slot closed/)).toBeNull();
  });

  it('announces the ability the free grant handed over', () => {
    render(<UpgradeShop {...props({ abilityOfferCount: 0, freeAbilityGrant: 'freezeAll' })} />);
    expect(screen.getByText(/Freeze All added to your bar/)).toBeTruthy();
  });

  it('offers two to choose between when Talent Scout is owned', () => {
    render(<UpgradeShop {...props({ abilityOfferCount: 2 })} />);
    expect(screen.getAllByText('Ability')).toHaveLength(2);
  });
});
