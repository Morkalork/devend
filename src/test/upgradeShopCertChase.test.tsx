/**
 * The "counts toward a certificate" note on shop cards.
 *
 * Buying a max-tier upgrade credits an upgrade-chain certificate, but the credit
 * fired silently in useGameSession and the unlock only surfaced a run or more
 * later. Nothing told the player the purchase counted toward anything, so this
 * note is the whole feedback loop for ten of the seventeen certificates.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise react-i18next synchronously
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { UpgradeConfig } from '@/types/upgrade';
import { Certificate } from '@/types/certificate';

const upgrades: UpgradeConfig[] = [
  { id: 'chain_top', name: 'Chain Top', tier: 'Junior', description: 'Tops a chain', cost: 5, unlockLevel: 1, modifiers: {} },
  { id: 'plain', name: 'Plain Upgrade', tier: 'Junior', description: 'Sources nothing', cost: 5, unlockLevel: 1, modifiers: {} },
  // A forked tier: both options credit the shared choiceGroup, not their own id.
  { id: 'fork_a', name: 'Forked', tier: 'Senior', description: 'Option A', cost: 5, unlockLevel: 1, choiceGroup: 'fork_group', modifiers: {} },
  { id: 'fork_b', name: 'Forked', tier: 'Senior', description: 'Option B', cost: 5, unlockLevel: 1, choiceGroup: 'fork_group', modifiers: {} },
];

const certificates: Certificate[] = [
  {
    id: 'chain-cert', name: 'Chain Cert', description: 'A permanent reward.',
    unlockType: 'upgrade-chain', sourceUpgradeId: 'chain_top', requiredRuns: 3,
    levels: [{ cost: 3, effect: { type: 'extraLives', value: 1 } }],
  },
  {
    id: 'fork-cert', name: 'Fork Cert', description: 'Earned from either fork.',
    unlockType: 'upgrade-chain', sourceUpgradeId: 'fork_group', requiredRuns: 3,
    levels: [{ cost: 3, effect: { type: 'extraLives', value: 1 } }],
  },
  // Not an upgrade-chain cert: no purchase can advance it, so no card may claim to.
  {
    id: 'ach-cert', name: 'Achievement Cert', description: 'From an achievement.',
    unlockType: 'achievement', sourceAchievementId: 'senior-dev',
    levels: [{ cost: 5, effect: { type: 'extraLives', value: 1 } }],
  },
];

function baseProps(overrides: Partial<React.ComponentProps<typeof UpgradeShop>> = {}) {
  return {
    playerPoints: 100,
    upgrades,
    ownedUpgradeIds: [] as string[],
    completedLevel: 3, // not a multiple of 5 → no waypoint banner
    isLocked: () => false,
    onPurchase: vi.fn(),
    onContinue: vi.fn(),
    certificates,
    maxTierCounts: { chain_top: 1, fork_group: 2 },
    unlockedCertIds: [] as string[],
    ...overrides,
  };
}

afterEach(cleanup);

describe('shop cards show certificate chase progress', () => {
  it('annotates an upgrade that sources a certificate, and only that upgrade', () => {
    render(<UpgradeShop {...baseProps()} />);
    expect(screen.getByText('Chain Cert')).toBeTruthy();
    expect(screen.getByText('1/3 runs')).toBeTruthy();
    // The plain upgrade sources nothing and must stay unannotated.
    expect(screen.queryByText('Plain Upgrade')).toBeTruthy();
  });

  it('credits a forked tier via its choiceGroup, as the session does', () => {
    render(<UpgradeShop {...baseProps()} />);
    // fork_a/fork_b collapse to one card keyed on the group; without the
    // choiceGroup lookup this card would show nothing at all.
    expect(screen.getByText('Fork Cert')).toBeTruthy();
    expect(screen.getByText('2/3 runs')).toBeTruthy();
  });

  it('previews the pending purchase: selecting the card advances the fraction', () => {
    // Fork left at 0/3 so the fraction under test is unambiguous on the page.
    render(<UpgradeShop {...baseProps({ maxTierCounts: { chain_top: 1 } })} />);
    expect(screen.getByText('1/3 runs')).toBeTruthy();
    fireEvent.click(screen.getByText('Chain Top'));
    // The note now reports what buying it DOES, not where the player already was.
    expect(screen.getByText('2/3 runs')).toBeTruthy();
  });

  it('drops the note once the certificate is unlocked: that chase is over', () => {
    render(<UpgradeShop {...baseProps({ unlockedCertIds: ['chain-cert', 'fork-cert'] })} />);
    expect(screen.queryByText('Chain Cert')).toBeNull();
    expect(screen.queryByText('Fork Cert')).toBeNull();
  });

  it('never claims a purchase advances an achievement certificate', () => {
    render(<UpgradeShop {...baseProps()} />);
    expect(screen.queryByText('Achievement Cert')).toBeNull();
  });

  it('renders nothing certificate-related when the props are absent', () => {
    render(<UpgradeShop {...baseProps({ certificates: undefined, maxTierCounts: undefined })} />);
    expect(screen.queryByText('Chain Cert')).toBeNull();
    expect(screen.queryByText(/runs$/)).toBeNull();
  });
});
