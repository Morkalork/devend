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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import '@/i18n';
import { AssignmentSummaryScreen } from '@/components/game/AssignmentSummaryScreen';
import { TierDraftScreen } from '@/components/game/TierDraftScreen';
import i18n from '@/i18n';
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
        // A perfect block is also a clean, thrifty, nervy one: no life lost, no
        // overtime spent, every push taken and banked. Without these the
        // survival, restraint and nerve contracts score zero on a block that is
        // perfect by every other measure.
        livesLost: 0, spent: 0, pushWon: true,
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

  it('makes the prize itself the button', () => {
    // Reported: "the text above the continue button looks clickable". It was a
    // bordered, tinted gold panel sitting directly on top of a button, which
    // reads as two buttons only one of which does anything. There is now ONE
    // control, and the reward is inside it.
    const onContinue = vi.fn();
    renderSummary({ nextIsUpgradePick: true, onContinue });
    const buttons = screen.getAllByRole('button');
    expect(buttons.length, 'the screen still offers more than one thing to press').toBe(1);
    expect(buttons[0].textContent).toContain('Pick a Principal upgrade');
    fireEvent.click(buttons[0]);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('names the pick on that button when one is owed', () => {
    renderSummary({ nextIsUpgradePick: true });
    expect(
      screen.getByRole('button').textContent,
      'the button does not say a pick is coming',
    ).toContain('Pick your upgrade');
  });

  it('still says Continue when the reward is not a pick', () => {
    // Lives and overtime are banked already; there is nothing to choose, and a
    // button promising a pick would be the same lie in reverse.
    renderSummary({ nextIsUpgradePick: false, rewardLabel: '+2 lives' });
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('+2 lives');
    expect(button.textContent).toContain('Continue');
    expect(button.textContent).not.toContain('Pick your upgrade');
  });

  it('falls back to a plain Continue when nothing was earned', () => {
    // No prize means nothing to press ON, so the ordinary button stays.
    renderSummary({ nextIsUpgradePick: false, rewardLabel: null });
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('Continue');
    expect(screen.getByText(/fell short/i)).toBeTruthy();
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

describe('the pick screen says what to do', () => {
  const offers = upgrades.filter(u => u.tier === 'Principal').slice(0, 3);

  it('has three cards to choose between', () => {
    expect(offers.length).toBe(3);
  });

  it('leads with the instruction, not with where the reward came from', () => {
    // Reported after the previous fix: "the next screen says Assignment
    // Reward, is that it?" The headline is the largest type on the page, the
    // confirm button starts DISABLED, and the only instruction was small
    // dimmed subtitle text - so the screen read as an announcement rather than
    // a prompt.
    render(
      <TierDraftScreen offers={offers} tier="Principal" onSelect={vi.fn()} />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent, 'the headline is not an instruction').toMatch(/pick/i);
    // Provenance is kept, just no longer shouted.
    expect(screen.getByText(/assignment reward/i)).toBeTruthy();
    // And every offer is on screen to choose from.
    for (const u of offers) expect(screen.getAllByText(u.name).length).toBeGreaterThan(0);
  });

  it('uses the same words as the button that led here', () => {
    // The summary promises "Pick your upgrade"; if this screen calls it
    // something else the player cannot tell they have arrived.
    const promise = i18n.t('assignmentSummary.pickButton') as string;
    const arrival = i18n.t('tierDraft.title') as string;
    expect(arrival.toLowerCase()).toBe(promise.toLowerCase());
  });

  it('keeps promise and arrival matching in every language', () => {
    for (const loc of ['en', 'es', 'sv']) {
      const bundle = i18n.getResourceBundle(loc, 'translation');
      expect(
        (bundle.tierDraft.title as string).toLowerCase(),
        `${loc}: the pick screen and the button that leads to it disagree`,
      ).toBe((bundle.assignmentSummary.pickButton as string).toLowerCase());
    }
  });
});

describe('the two screens look like one handover', () => {
  it('dresses the reward button and the pick screen in the same gold', () => {
    // The point of the shared constant: told what you earned on one screen and
    // taking it on the next, in two different colours, reads as two unrelated
    // parts of the game.
    const index = readFileSync(resolve(process.cwd(), 'src/pages/Index.tsx'), 'utf8');
    const i = index.indexOf('<TierDraftScreen');
    expect(i, 'the pick screen is gone').toBeGreaterThan(-1);
    expect(
      index.slice(i, i + 700),
      'the pick screen wears the run accent rather than the reward gold',
    ).toContain('accentColor={REWARD_GOLD}');
  });

  it('keeps one definition of that gold', () => {
    // Two hexes that happen to match today are two hexes that will not tomorrow.
    const summary = readFileSync(
      resolve(process.cwd(), 'src/components/game/AssignmentSummaryScreen.tsx'), 'utf8',
    );
    expect(summary, 'the summary hard-codes the gold instead of sharing it')
      .not.toMatch(/#ffd54a/i);
    expect(summary).toContain('REWARD_GOLD');
  });
});
