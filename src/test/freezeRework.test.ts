/**
 * Feature Freeze rework: the tiers are non-additive (tier-3 option A reduces the
 * duration Senior added while adding a use), so this pins the additive-modifier
 * math that makes them resolve correctly, plus the tier-3 choiceGroup shape.
 */
import { describe, it, expect } from 'vitest';
import { computeGameModifiers } from '@/hooks/useActiveModifiers';
import { UpgradeConfig } from '@/types/upgrade';

// Mirrors public/upgrades.yml's Feature Freeze line.
const FF: UpgradeConfig[] = [
  { id: 'ff_j', name: 'Feature Freeze', tier: 'Junior', description: '', modifiers: { ballFreezeDuration: 1, freezeUsesPerMap: 1 } },
  { id: 'ff_s', name: 'Feature Freeze', tier: 'Senior', description: '', prerequisites: ['ff_j'], modifiers: { ballFreezeDuration: 1 } },
  { id: 'ff_a', name: 'Feature Freeze', tier: 'Principal', description: '', prerequisites: ['ff_s'], choiceGroup: 'ff3', modifiers: { ballFreezeDuration: -1, freezeUsesPerMap: 1 } },
  { id: 'ff_b', name: 'Feature Freeze', tier: 'Principal', description: '', prerequisites: ['ff_s'], choiceGroup: 'ff3', modifiers: { ballFreezeDuration: 1 } },
];
const lookup = new Map(FF.map(u => [u.id, u]));

function freeze(ids: string[]) {
  const m = computeGameModifiers(ids, lookup);
  return { dur: m.ballFreezeDuration, uses: m.freezeUsesPerMap };
}

describe('Feature Freeze tiers resolve to the intended duration + uses', () => {
  it('Junior: 1 freeze, 1 second', () => {
    expect(freeze(['ff_j'])).toEqual({ dur: 1, uses: 1 });
  });

  it('Senior: still 1 freeze, now 2 seconds', () => {
    expect(freeze(['ff_j', 'ff_s'])).toEqual({ dur: 2, uses: 1 });
  });

  it('Principal option A (Rapid): 2 freezes, 1 second each', () => {
    // The -1 duration cancels Senior's +1 back down to 1s, and the +1 use makes 2.
    expect(freeze(['ff_j', 'ff_s', 'ff_a'])).toEqual({ dur: 1, uses: 2 });
  });

  it('Principal option B (Deep): 1 freeze, 3 seconds', () => {
    expect(freeze(['ff_j', 'ff_s', 'ff_b'])).toEqual({ dur: 3, uses: 1 });
  });

  it('the two Principal options share one choiceGroup (mutually exclusive)', () => {
    const a = lookup.get('ff_a')!;
    const b = lookup.get('ff_b')!;
    expect(a.choiceGroup).toBe(b.choiceGroup);
    expect(a.choiceGroup).toBeTruthy();
  });
});
