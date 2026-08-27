/**
 * The upgrade pick an assignment pays, and how the player is told to take it.
 *
 * Reported from a real session: "on Assignment Complete the 'Pick a Principal
 * Upgrade' label is not a button, nor do I get to pick an upgrade in any other
 * way."
 *
 * The wiring was fine. A tierDraft reward queues offers, and the summary's
 * Continue leads to the 1-of-3 pick. But the summary shows that same label in
 * TWO places - once per tier in the mission's tier list (dimmed when not
 * reached) and once in the gold "You earned" panel - and the button under both
 * of them just said "Continue". An imperative label with nothing to press on it
 * and a button that does not mention it is a reward the player cannot find.
 *
 * So the button now names the next step. These pin both halves: the reward is
 * really produced and really draftable, and the screen says how to take it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import '@/i18n';
import { AssignmentSummaryScreen } from '@/components/game/AssignmentSummaryScreen';
import { assignmentRewardForBlock, eligibleTierUpgrades } from '@/lib/assignments';
import type { AssignmentConfig, AssignmentMapResult } from '@/types/assignment';
import type { UpgradeConfig } from '@/types/upgrade';

const pool = (yaml.load(
  readFileSync(resolve(process.cwd(), 'public/assignments.yml'), 'utf8'),
) as { assignments: AssignmentConfig[] }).assignments;
const upgrades = (yaml.load(
  readFileSync(resolve(process.cwd(), 'public/upgrades.yml'), 'utf8'),
) as { upgrades: UpgradeConfig[] }).upgrades;

const mk = (o: Partial<AssignmentMapResult> = {}): AssignmentMapResult => ({
  locks: 0, superiorLocks: 0, cutsDelta: 0, clearSeconds: 999,
  ballCount: 0, allBallsLocked: false, ...o,
});

afterEach(cleanup);

describe('an assignment that pays an upgrade pick', () => {
  const drafters = pool.filter(a =>
    a.mission.tiers.some(t => t.reward.type === 'tierDraft'),
  );

  it('there are some, or none of this matters', () => {
    expect(drafters.length).toBeGreaterThan(0);
  });

  it('always has upgrades left to offer, even to a player who owns nothing', () => {
    // An empty pool silently drops the reward: grantAssignmentReward nulls the
    // label and the player is told they earned nothing.
    for (const a of drafters) {
      for (const tier of a.mission.tiers) {
        if (tier.reward.type !== 'tierDraft') continue;
        const offers = eligibleTierUpgrades(upgrades, tier.reward.tier, []);
        expect(offers.length, `${a.id} tier ${tier.threshold}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('produces the draft when the block actually clears the tier', () => {
    // End to end on the pure half: a perfect block earns the top tier, and if
    // that tier is a pick then a pick is what comes back.
    for (const a of drafters) {
      const top = a.mission.tiers[a.mission.tiers.length - 1];
      if (top.reward.type !== 'tierDraft') continue;
      // A block good enough for anything: five maps, clean, fast, everything
      // sealed, well under par.
      const perfect = Array.from({ length: 5 }, () => mk({
        locks: 20, superiorLocks: 20, cutsDelta: -5, clearSeconds: 1,
        allBallsLocked: true, smashes: 20, lockedByType: {},
      }));
      // ...except Ship It, which is cleared by sealing NOTHING.
      const results = a.mission.track.kind === 'noLocks'
        ? Array.from({ length: 5 }, () => mk())
        : perfect;
      const earned = assignmentRewardForBlock(a, results);
      // A ball-type bounty needs a named type, which the block resolves; an
      // unnamed one cannot pass, and that is its own tested behaviour.
      if (a.mission.track.kind === 'ballType') continue;
      expect(earned, `${a.id} paid nothing for a perfect block`).toBeTruthy();
    }
  });
});

describe('the summary tells the player how to take it', () => {
  const assignment = pool.find(a =>
    a.mission.tiers.some(t => t.reward.type === 'tierDraft'),
  )!;

  function renderSummary(over: Partial<React.ComponentProps<typeof AssignmentSummaryScreen>> = {}) {
    return render(
      <AssignmentSummaryScreen
        assignment={assignment}
        results={[mk(), mk(), mk(), mk(), mk()]}
        blockStats={{ locks: 4, livesLost: 1 } as never}
        rewardLabel="Pick a Principal upgrade"
        onContinue={vi.fn()}
        {...over}
      />,
    );
  }

  it('names the pick on the button when one is owed', () => {
    // The fix. "Continue" under a reward that reads as an instruction is what
    // made the pick look missing.
    renderSummary({ nextIsUpgradePick: true });
    expect(screen.getByText('Pick your upgrade'), 'the button still just says Continue').toBeTruthy();
    expect(screen.getByText('Choose it on the next screen.')).toBeTruthy();
  });

  it('still says Continue when the reward is not a pick', () => {
    // Lives and overtime are banked already; there is nothing to choose, and a
    // button promising a pick would be the same lie in reverse.
    renderSummary({ nextIsUpgradePick: false, rewardLabel: '+2 lives' });
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.queryByText('Pick your upgrade')).toBeNull();
    expect(screen.queryByText('Choose it on the next screen.')).toBeNull();
  });

  it('says nothing about a pick when the mission was missed', () => {
    renderSummary({ nextIsUpgradePick: false, rewardLabel: null });
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.queryByText('Pick your upgrade')).toBeNull();
  });
});

describe('the screens are wired to each other', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('routes the summary Continue into the pick when one is pending', () => {
    const src = read('src/hooks/useGameSession.ts');
    const i = src.indexOf('const handleContinueFromSummary');
    expect(i, 'the summary Continue handler is gone').toBeGreaterThan(-1);
    const block = src.slice(i, i + 400);
    expect(block).toContain('pendingTierDraft');
    expect(block).toContain('goToTierDraft');
  });

  it('renders the pick screen and tells the button about it', () => {
    const index = read('src/pages/Index.tsx');
    expect(index, 'the tier draft screen is never rendered').toContain("currentScreen === 'tierDraft'");
    expect(
      index,
      'the summary is never told a pick is pending, so its button cannot say so',
    ).toContain('nextIsUpgradePick={!!session.pendingTierDraft}');
  });

  it('keeps one reading of whether a pick is owed', () => {
    // grantAssignmentReward used to ALSO return a `tierDraftOwed` flag "for the
    // caller"; both callers ignored it. A second statement of the same fact
    // that nothing reads can only go stale.
    expect(read('src/hooks/useGameSession.ts')).not.toContain('tierDraftOwed: boolean');
  });
});
