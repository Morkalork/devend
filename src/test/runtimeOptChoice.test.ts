/**
 * Runtime Optimisation tier-3 choice: option A is a flat 15% slow; option B is a
 * milder 5% slow plus one random ball crippled each map (slowOneBallFactor).
 */
import { describe, it, expect } from 'vitest';
import { computeGameModifiers } from '@/hooks/useActiveModifiers';
import { createInitialGameData } from '@/lib/initGame';
import { UpgradeConfig } from '@/types/upgrade';
import { LevelConfig } from '@/types/level';

const RO: UpgradeConfig[] = [
  { id: 'ro_a', name: 'Runtime Optimisation', tier: 'Principal', description: '', choiceGroup: 'runtime_optimisation_principal', modifiers: { ballSpeedMultiplier: 0.85 } },
  { id: 'ro_b', name: 'Runtime Optimisation', tier: 'Principal', description: '', choiceGroup: 'runtime_optimisation_principal', modifiers: { ballSpeedMultiplier: 0.95, slowOneBallFactor: 0.5 } },
];
const lookup = new Map(RO.map(u => [u.id, u]));

const level = (id: string): LevelConfig => ({
  id, level: 6, sizeThreshold: 25, expectedCuts: 14, points: 40, maxBalls: 4,
} as unknown as LevelConfig);

describe('Runtime Optimisation tier-3 choice', () => {
  it('option A: flat 15% slow, no single-ball factor', () => {
    const m = computeGameModifiers(['ro_a'], lookup);
    expect(m.ballSpeedMultiplier).toBeCloseTo(0.85);
    expect(m.slowOneBallFactor).toBe(0);
  });

  it('option B: 5% slow, and arms the single random-ball slow', () => {
    const m = computeGameModifiers(['ro_b'], lookup);
    expect(m.ballSpeedMultiplier).toBeCloseTo(0.95);
    expect(m.slowOneBallFactor).toBe(0.5);
  });

  it('both options share one choiceGroup (named after the cert source id)', () => {
    expect(lookup.get('ro_a')!.choiceGroup).toBe('runtime_optimisation_principal');
    expect(lookup.get('ro_b')!.choiceGroup).toBe(lookup.get('ro_a')!.choiceGroup);
  });

  it('slowOneBallFactor cripples exactly one ball each map', () => {
    const base = computeGameModifiers([], new Map());
    const withSlow = { ...base, slowOneBallFactor: 0.5 };
    // Ball selection is deterministic per (level id, number, maxBalls), so speeds
    // line up by index; only the random victim differs.
    const baseSpeeds = createInitialGameData(level('ro-test'), 6, base).balls.map(b => b.baseSpeed);
    const slowedSpeeds = createInitialGameData(level('ro-test'), 6, withSlow).balls.map(b => b.baseSpeed);

    expect(baseSpeeds.length).toBeGreaterThanOrEqual(2);
    let halved = 0;
    let unchanged = 0;
    for (let i = 0; i < baseSpeeds.length; i++) {
      if (Math.abs(slowedSpeeds[i] - baseSpeeds[i] * 0.5) < 1e-6) halved++;
      else if (Math.abs(slowedSpeeds[i] - baseSpeeds[i]) < 1e-6) unchanged++;
    }
    expect(halved).toBe(1);
    expect(unchanged).toBe(baseSpeeds.length - 1);
  });
});
