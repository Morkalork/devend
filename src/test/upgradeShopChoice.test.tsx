/**
 * Tier-3 "choice" upgrades in the shop: a choiceGroup shows as ONE card that
 * expands to a chooser; picking an option selects that variant for purchase.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise react-i18next synchronously
import { UpgradeShop } from '@/components/game/UpgradeShop';
import { UpgradeConfig } from '@/types/upgrade';

// Two mutually exclusive options of one choice group (like Feature Freeze III).
const choice: UpgradeConfig[] = [
  { id: 'ff_a', name: 'Feature Freeze', tier: 'Principal', description: 'Rapid two quick freezes', cost: 30, unlockLevel: 1, choiceGroup: 'ff3', tags: ['freeze'], modifiers: {} },
  { id: 'ff_b', name: 'Feature Freeze', tier: 'Principal', description: 'Deep one long freeze', cost: 30, unlockLevel: 1, choiceGroup: 'ff3', tags: ['freeze'], modifiers: {} },
];

function props(over: Partial<React.ComponentProps<typeof UpgradeShop>> = {}) {
  return {
    playerPoints: 500,
    upgrades: choice,
    ownedUpgradeIds: [] as string[],
    completedLevel: 5,
    isLocked: () => false,
    onPurchase: vi.fn(),
    onContinue: vi.fn(),
    ...over,
  };
}

afterEach(cleanup);

describe('UpgradeShop tier-3 choice card', () => {
  it('shows one card that opens a chooser; picking an option selects it', () => {
    render(<UpgradeShop {...props()} />);

    // A single choice card with a "choose" prompt; the options aren't shown yet.
    expect(screen.getByText('Tap to choose one of two options.')).toBeTruthy();
    expect(screen.queryByText('Rapid two quick freezes')).toBeNull();

    // Tapping the card opens the chooser with both options.
    fireEvent.click(screen.getByText('Tap to choose one of two options.'));
    expect(screen.getByText('Rapid two quick freezes')).toBeTruthy();
    expect(screen.getByText('Deep one long freeze')).toBeTruthy();

    // Picking one selects that variant for purchase (arms the buy button).
    fireEvent.click(screen.getByText('Rapid two quick freezes'));
    expect(screen.getByText('Buy 1')).toBeTruthy();
  });
});
