/**
 * The press-and-hold explainer's copy.
 *
 * The gesture itself needs a real finger, so what is worth guarding here is the
 * silent failure: a missing locale key renders the RAW KEY on screen
 * ("boardInfo.mirror.title") and nothing crashes, so it ships looking fine to
 * anyone who does not hold that particular object. Every kind the hit-test can
 * return is mounted and required to produce real prose.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise react-i18next synchronously
import { BoardEntityInfoModal } from '@/components/game/BoardEntityInfoModal';
import type { BoardEntityKind } from '@/lib/boardEntityInfo';

/** Every kind boardEntityAt can return. */
const KINDS: BoardEntityKind[] = [
  'pickup', 'chestLoot', 'dormantBall', 'terminal', 'ball',
  'chest', 'objective', 'breakable', 'mirror', 'mover',
  'phasing', 'obstacle', 'area',
];

afterEach(cleanup);

describe('board entity explainer copy', () => {
  it.each(KINDS)('gives %s a real title and body, not a raw key', kind => {
    render(<BoardEntityInfoModal hit={{ kind }} onClose={() => {}} />);
    const text = document.body.textContent ?? '';
    // A missing key renders as the key itself, which is the failure this catches.
    expect(text).not.toContain('boardInfo.');
    // Both title and body must actually say something.
    expect(text.length).toBeGreaterThan(40);
  });

  it('shows the reusable hint, so the gesture teaches itself', () => {
    render(<BoardEntityInfoModal hit={{ kind: 'mirror' }} onClose={() => {}} />);
    expect(screen.getByText(/Hold anything on the board/)).toBeTruthy();
  });

  it('explains a mirror in terms of what it does to the player', () => {
    render(<BoardEntityInfoModal hit={{ kind: 'mirror' }} onClose={() => {}} />);
    expect(screen.getByText(/Mirror/)).toBeTruthy();
    expect(screen.getByText(/hard angles/)).toBeTruthy();
  });
});
