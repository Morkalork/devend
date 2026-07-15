/**
 * UpgradeShop `closed` state: when a round doesn't lock enough balls the store
 * still opens, but shows a "Not enough balls locked" banner and blocks purchases.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise react-i18next synchronously
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { UpgradeConfig } from '@/types/upgrade';

const upgrades: UpgradeConfig[] = [
  { id: 'up-a', name: 'Test Upgrade A', tier: 'Junior', description: 'Does A', cost: 5, unlockLevel: 1, modifiers: {} },
  { id: 'up-b', name: 'Test Upgrade B', tier: 'Junior', description: 'Does B', cost: 5, unlockLevel: 1, modifiers: {} },
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
    ...overrides,
  };
}

afterEach(cleanup);

describe('UpgradeShop closed state', () => {
  it('shows the "Not enough balls locked" banner and blocks purchases when closed', () => {
    const onPurchase = vi.fn();
    const onContinue = vi.fn();
    render(<UpgradeShop {...baseProps({ closed: true, onPurchase, onContinue })} />);

    // Closed banner is present.
    expect(screen.getByText('Not enough balls locked')).toBeTruthy();

    // Clicking an offered card must NOT select it (the button stays "Continue",
    // never "Buy 1").
    fireEvent.click(screen.getByText('Test Upgrade A'));
    expect(screen.queryByText('Buy 1')).toBeNull();

    // Continuing buys nothing and just proceeds.
    fireEvent.click(screen.getByText('Continue'));
    expect(onPurchase).not.toHaveBeenCalled();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('open store (control): no banner, and a card can be selected to buy', () => {
    render(<UpgradeShop {...baseProps({ closed: false })} />);

    expect(screen.queryByText('Not enough balls locked')).toBeNull();

    // Selecting a purchasable card flips the button to the buy label.
    fireEvent.click(screen.getByText('Test Upgrade A'));
    expect(screen.getByText('Buy 1')).toBeTruthy();
  });

  it('holding the closed banner opens the explainer modal', () => {
    vi.useFakeTimers();
    try {
      render(<UpgradeShop {...baseProps({ closed: true })} />);
      const banner = screen.getByText('Not enough balls locked');

      // Not shown until the hold threshold (450ms) elapses.
      expect(screen.queryByText('Store closed')).toBeNull();
      fireEvent.pointerDown(banner, { clientX: 10, clientY: 10 });
      act(() => { vi.advanceTimersByTime(500); });

      expect(screen.getByText('Store closed')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
