/**
 * The Specs panel's logic, out of the canvas components (ui/game/
 * TopBarDetailsPanel.tsx and ModifierBreakdown.tsx) so it can be tested
 * without a canvas: which sections show and in what order, what each objective
 * card reads, and every attribute row with the sources that feed it.
 */
import type { TFunction } from 'i18next';
import { GameModifiers, ModifierSource, MULTIPLICATIVE_KEYS } from '@/hooks/useActiveModifiers';
import { SPEND_CHUNK_HOURS } from '@/lib/treasury';
import { effectiveBallSpeedFactor } from '@/lib/ballTypes';
import { getShipEarlyThresholds } from '@/lib/scoring';
import { contentText } from '@/i18n/content';
import type { ObjectiveProgress } from '@/types/objective';

/** Which card the Specs panel was opened to answer for (the map-rule banner opens it on the rule). */
export type PanelFocus = 'mapRule' | null;

// ── Attributes (ModifierBreakdown) ─────────────────────────────────────────

export interface StatRow {
  label: string;
  value: string;
  changed: boolean;
  description: string;
  /** GameModifiers keys this row reads, used to attribute it to its sources. */
  keys: (keyof GameModifiers)[];
}

/** Additive keys expressed as fractions (shown as percentages, not raw counts). */
export const FRACTIONAL_ADDITIVE_KEYS = new Set<keyof GameModifiers>([
  'microManagerPerLock',
  'fenceSpeedPerLock',
  'fenceSpeedPerFence',
  'bankedSlowPerStep',
  'spendFenceSpeedPerChunk',
]);

/** Localized display name for a modifier source, by its kind. */
export function sourceName(t: TFunction, s: ModifierSource): string {
  switch (s.kind) {
    case 'upgrade': return contentText.upgradeName(t, s);
    case 'certificate': return contentText.certName(t, s);
    case 'achievement': return contentText.achName(t, s);
    case 'offer': return t('bottomBarDetails.offerSource', { name: contentText.offerName(t, s) });
    case 'tagSet': return t('bottomBarDetails.tagSetSource', { name: contentText.tagSetName(t, s) });
    case 'capstone': return t('bottomBarDetails.capstoneSource', { name: contentText.capstoneName(t, s) });
    default: return s.name;
  }
}

/** A source's contribution to the first of `keys` it actually changes, or null. */
export function contributionFor(s: ModifierSource, keys: (keyof GameModifiers)[]): { key: keyof GameModifiers; value: number } | null {
  for (const key of keys) {
    const v = s.modifiers[key];
    if (v == null) continue;
    const identity = MULTIPLICATIVE_KEYS.includes(key) ? v === 1 : v === 0;
    if (identity) continue;
    return { key, value: v };
  }
  return null;
}

/** Format one source's contribution the way its key reads elsewhere. */
export function formatContribution(key: keyof GameModifiers, v: number): string {
  if (MULTIPLICATIVE_KEYS.includes(key)) {
    const d = Math.round((v - 1) * 100);
    return `${d >= 0 ? '+' : ''}${d}%`;
  }
  if (FRACTIONAL_ADDITIVE_KEYS.has(key)) {
    const p = Math.round(v * 100);
    return `${p >= 0 ? '+' : ''}${p}%`;
  }
  return v >= 0 ? `+${v}` : `${v}`;
}

export interface Contributor {
  source: ModifierSource;
  key: keyof GameModifiers;
  value: number;
  /** Already formatted for display (formatContribution). */
  text: string;
}

/** The sources that move a row, each with its formatted share. */
export function rowContributors(row: StatRow, sources: ModifierSource[]): Contributor[] {
  const out: Contributor[] = [];
  for (const s of sources) {
    const c = contributionFor(s, row.keys);
    if (c) out.push({ source: s, key: c.key, value: c.value, text: formatContribution(c.key, c.value) });
  }
  return out;
}

/**
 * Ship Early countdown: always explained in the attributes so the on-board
 * timer bar has a reference. The top rung drives the "up to +Nh" chip; the
 * ladder derives from config so the copy can't drift from the actual payouts.
 */
export function shipEarlyTopPercent(): number {
  return getShipEarlyThresholds().reduce((mx, s) => Math.max(mx, s.percent), 0);
}

/** Every attribute row, in display order, each explained in plain language. */
export function modifierRows(t: TFunction, activeModifiers: GameModifiers, lockedBalls = 0): StatRow[] {
  const m = activeModifiers;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const bonus = (v: number) => (v > 0 ? `+${v}` : `${v}`);

  const microFactor =
    m.microManagerPerLock > 0 && lockedBalls > 0
      ? Math.pow(1 - m.microManagerPerLock, lockedBalls)
      : 1;
  // Floored combined factor — matches the physics cap (#42).
  const effectiveSpeed = effectiveBallSpeedFactor(m.ballSpeedMultiplier, microFactor);

  return [
    {
      label: t('bottomBarDetails.ballSpeed'),
      value: pct(effectiveSpeed),
      changed: effectiveSpeed !== 1,
      keys: ['ballSpeedMultiplier'],
      description: `${t('bottomBarDetails.ballSpeedDescBase', { base: pct(m.ballSpeedMultiplier) })}${
        m.microManagerPerLock > 0
          ? t('bottomBarDetails.ballSpeedDescMicro', { reduction: Math.round((1 - microFactor) * 100), count: lockedBalls })
          : ''
      }${t('bottomBarDetails.ballSpeedDescTail')}`,
    },
    {
      label: t('bottomBarDetails.ballSize'),
      value: pct(m.ballSizeMultiplier),
      changed: m.ballSizeMultiplier !== 1,
      keys: ['ballSizeMultiplier'],
      description: t('bottomBarDetails.ballSizeDesc'),
    },
    {
      label: t('bottomBarDetails.fenceSpeed'),
      value: pct(m.fenceGenerationSpeedMultiplier),
      changed: m.fenceGenerationSpeedMultiplier !== 1,
      keys: ['fenceGenerationSpeedMultiplier'],
      description: t('bottomBarDetails.fenceSpeedDesc'),
    },
    {
      label: t('bottomBarDetails.scoreMultiplier'),
      value: pct(m.scoreMultiplier),
      changed: m.scoreMultiplier !== 1,
      keys: ['scoreMultiplier'],
      description: t('bottomBarDetails.scoreMultiplierDesc'),
    },
    {
      label: t('bottomBarDetails.instantFences'),
      value: bonus(m.instantFencesPerMap),
      changed: m.instantFencesPerMap !== 0,
      keys: ['instantFencesPerMap'],
      description:
        m.instantFencesPerMap > 0
          ? t('bottomBarDetails.instantFencesActive', { count: m.instantFencesPerMap })
          : t('bottomBarDetails.instantFencesInactive'),
    },
    {
      // Onboarding / Equity Grant: a map's own board is smaller from the first
      // frame rather than anything visibly appearing captured, so this row is
      // the one place the effect is actually confirmable. Rounded the same way
      // initGame clamps it, so this can never claim a bigger head start than
      // the map you are about to play actually gets.
      label: t('bottomBarDetails.startingCapture'),
      value: `${bonus(m.startingCapturePercent)}%`,
      changed: m.startingCapturePercent !== 0,
      keys: ['startingCapturePercent'],
      description:
        m.startingCapturePercent > 0
          ? t('bottomBarDetails.startingCaptureActive', { percent: m.startingCapturePercent })
          : t('bottomBarDetails.startingCaptureInactive'),
    },
    {
      label: t('bottomBarDetails.concurrentFences'),
      value: bonus(m.additionalConcurrentFences),
      changed: m.additionalConcurrentFences !== 0,
      keys: ['additionalConcurrentFences'],
      description:
        m.additionalConcurrentFences > 0
          ? t('bottomBarDetails.concurrentFencesActive', { total: 1 + m.additionalConcurrentFences })
          : t('bottomBarDetails.concurrentFencesInactive'),
    },
    {
      label: t('bottomBarDetails.par'),
      value: bonus(m.parBonus),
      changed: m.parBonus !== 0 || m.underParBonusMultiplier !== 1,
      keys: ['parBonus', 'underParBonusMultiplier'],
      description:
        m.parBonus !== 0 || m.underParBonusMultiplier !== 1
          ? t('bottomBarDetails.parActive', { cuts: m.parBonus, mult: m.underParBonusMultiplier })
          : t('bottomBarDetails.parInactive'),
    },
    {
      label: t('bottomBarDetails.extraLives'),
      value: bonus(m.extraLives),
      changed: m.extraLives !== 0,
      keys: ['extraLives'],
      description:
        m.extraLives > 0
          ? t('bottomBarDetails.extraLivesActive', { count: m.extraLives })
          : t('bottomBarDetails.extraLivesInactive'),
    },
    {
      label: t('bottomBarDetails.runwayInstantFence'),
      value: m.runwayInstantFenceAt > 0 ? `${m.runwayInstantFenceAt}h+` : t('bottomBarDetails.off'),
      changed: m.runwayInstantFenceAt !== 0,
      keys: ['runwayInstantFenceAt'],
      description:
        m.runwayInstantFenceAt > 0
          ? t('bottomBarDetails.runwayInstantFenceActive', { hours: m.runwayInstantFenceAt })
          : t('bottomBarDetails.runwayInactive'),
    },
    {
      label: t('bottomBarDetails.runwayConcurrentFence'),
      value: m.runwayConcurrentFenceAt > 0 ? `${m.runwayConcurrentFenceAt}h+` : t('bottomBarDetails.off'),
      changed: m.runwayConcurrentFenceAt !== 0,
      keys: ['runwayConcurrentFenceAt'],
      description:
        m.runwayConcurrentFenceAt > 0
          ? t('bottomBarDetails.runwayConcurrentFenceActive', { hours: m.runwayConcurrentFenceAt })
          : t('bottomBarDetails.runwayInactive'),
    },
    {
      label: t('bottomBarDetails.runwayFreeze'),
      value: m.runwayFreezeAt > 0 ? `${m.runwayFreezeAt}h+` : t('bottomBarDetails.off'),
      changed: m.runwayFreezeAt !== 0,
      keys: ['runwayFreezeAt'],
      description:
        m.runwayFreezeAt > 0
          ? t('bottomBarDetails.runwayFreezeActive', { hours: m.runwayFreezeAt })
          : t('bottomBarDetails.runwayInactive'),
    },
    {
      label: t('bottomBarDetails.budgetCycle'),
      value: m.spendInstantFencePerChunk > 0 || m.spendFenceSpeedPerChunk > 0 || m.spendCapturePerChunk > 0
        ? t('bottomBarDetails.budgetCycleValue', { hours: SPEND_CHUNK_HOURS })
        : t('bottomBarDetails.off'),
      changed: m.spendInstantFencePerChunk !== 0 || m.spendFenceSpeedPerChunk !== 0 ||
        m.spendCapturePerChunk !== 0 || m.spendChunkCapBonus !== 0,
      keys: ['spendInstantFencePerChunk', 'spendFenceSpeedPerChunk', 'spendCapturePerChunk', 'spendChunkCapBonus'],
      description:
        m.spendInstantFencePerChunk > 0 || m.spendFenceSpeedPerChunk > 0 || m.spendCapturePerChunk > 0
          ? t('bottomBarDetails.budgetCycleActive', { hours: SPEND_CHUNK_HOURS })
          : t('bottomBarDetails.budgetCycleInactive'),
    },
    {
      label: t('bottomBarDetails.overtimePerLock'),
      value: bonus(m.overtimePerLock),
      changed: m.overtimePerLock !== 0,
      keys: ['overtimePerLock'],
      description:
        m.overtimePerLock > 0
          ? t('bottomBarDetails.overtimePerLockActive', { hours: m.overtimePerLock })
          : t('bottomBarDetails.overtimePerLockInactive'),
    },
    {
      label: t('bottomBarDetails.overtimePerSuperiorLock'),
      value: bonus(m.overtimePerSuperiorLock),
      changed: m.overtimePerSuperiorLock !== 0,
      keys: ['overtimePerSuperiorLock'],
      description:
        m.overtimePerSuperiorLock > 0
          ? t('bottomBarDetails.overtimePerSuperiorLockActive', { hours: m.overtimePerSuperiorLock })
          : t('bottomBarDetails.overtimePerSuperiorLockInactive'),
    },
    {
      label: t('bottomBarDetails.frozenLockBonus'),
      value: m.frozenLockBonus > 0 ? `x${1 + m.frozenLockBonus}` : t('bottomBarDetails.off'),
      changed: m.frozenLockBonus !== 0,
      keys: ['frozenLockBonus'],
      description:
        m.frozenLockBonus > 0
          ? t('bottomBarDetails.frozenLockBonusActive', { mult: 1 + m.frozenLockBonus })
          : t('bottomBarDetails.frozenLockBonusInactive'),
    },
    {
      label: t('bottomBarDetails.gravityLockBonus'),
      value: m.gravityLockBonus > 0 ? `x${1 + m.gravityLockBonus}` : t('bottomBarDetails.off'),
      changed: m.gravityLockBonus !== 0,
      keys: ['gravityLockBonus'],
      description:
        m.gravityLockBonus > 0
          ? t('bottomBarDetails.gravityLockBonusActive', { mult: 1 + m.gravityLockBonus })
          : t('bottomBarDetails.gravityLockBonusInactive'),
    },
    {
      label: t('bottomBarDetails.gravityBend'),
      value: m.gravityBendMultiplier !== 1
        ? `x${m.gravityBendMultiplier.toFixed(2)}`
        : t('bottomBarDetails.off'),
      changed: m.gravityBendMultiplier !== 1,
      keys: ['gravityBendMultiplier'],
      description:
        m.gravityBendMultiplier !== 1
          ? t('bottomBarDetails.gravityBendActive', {
              percent: Math.round((1 - m.gravityBendMultiplier) * 100),
            })
          : t('bottomBarDetails.gravityBendInactive'),
    },
    {
      label: t('bottomBarDetails.lockThreshold'),
      value: m.lockThresholdBonus > 0 ? `+${m.lockThresholdBonus}%` : t('bottomBarDetails.off'),
      changed: m.lockThresholdBonus !== 0,
      keys: ['lockThresholdBonus'],
      description:
        m.lockThresholdBonus > 0
          ? t('bottomBarDetails.lockThresholdActive', { percent: m.lockThresholdBonus })
          : t('bottomBarDetails.lockThresholdInactive'),
    },
    {
      label: t('bottomBarDetails.spawnFreeze'),
      value: m.spawnFreezeSeconds > 0 ? `${m.spawnFreezeSeconds}s` : t('bottomBarDetails.off'),
      changed: m.spawnFreezeSeconds !== 0,
      keys: ['spawnFreezeSeconds'],
      description:
        m.spawnFreezeSeconds > 0
          ? t('bottomBarDetails.spawnFreezeActive', { seconds: m.spawnFreezeSeconds })
          : t('bottomBarDetails.spawnFreezeInactive'),
    },
    {
      label: t('bottomBarDetails.bugSquash'),
      value: m.bugSquashChance > 0 ? `${m.bugSquashChance}%` : t('bottomBarDetails.off'),
      changed: m.bugSquashChance !== 0 || m.bugSquashSeconds !== 0,
      keys: ['bugSquashChance', 'bugSquashSeconds'],
      description:
        m.bugSquashChance > 0
          ? t('bottomBarDetails.bugSquashActive', { percent: m.bugSquashChance, seconds: m.bugSquashSeconds })
          : t('bottomBarDetails.bugSquashInactive'),
    },
    {
      // Deliberately vague (no percentages): Benefits Package is sold as
      // "tokens appear more often", never as an exact number.
      label: t('bottomBarDetails.pickupChance'),
      value: m.pickupChanceBonus > 0 ? t('bottomBarDetails.on') : t('bottomBarDetails.off'),
      changed: m.pickupChanceBonus !== 0,
      keys: ['pickupChanceBonus'],
      description:
        m.pickupChanceBonus > 0
          ? t('bottomBarDetails.pickupChanceActive')
          : t('bottomBarDetails.pickupChanceInactive'),
    },
    {
      label: t('bottomBarDetails.pickupPayout'),
      value: m.pickupPayoutLevel > 0 ? `+${m.pickupPayoutLevel}` : t('bottomBarDetails.off'),
      changed: m.pickupPayoutLevel !== 0,
      keys: ['pickupPayoutLevel'],
      description:
        m.pickupPayoutLevel > 0
          ? t('bottomBarDetails.pickupPayoutActive', { level: m.pickupPayoutLevel })
          : t('bottomBarDetails.pickupPayoutInactive'),
    },
    {
      label: t('bottomBarDetails.pushBonus'),
      value: m.pushBonusMultiplier !== 1 ? `x${m.pushBonusMultiplier}` : t('bottomBarDetails.off'),
      changed: m.pushBonusMultiplier !== 1,
      keys: ['pushBonusMultiplier'],
      description:
        m.pushBonusMultiplier !== 1
          ? t('bottomBarDetails.pushBonusActive', { mult: m.pushBonusMultiplier })
          : t('bottomBarDetails.pushBonusInactive'),
    },
    {
      label: t('bottomBarDetails.fenceSpeedPerLock'),
      value: pct(m.fenceSpeedPerLock),
      changed: m.fenceSpeedPerLock !== 0,
      keys: ['fenceSpeedPerLock'],
      description:
        m.fenceSpeedPerLock > 0
          ? t('bottomBarDetails.fenceSpeedPerLockActive', { percent: Math.round(m.fenceSpeedPerLock * 100) })
          : t('bottomBarDetails.fenceSpeedPerLockInactive'),
    },
    {
      label: t('bottomBarDetails.simultaneousLockBonus'),
      value: bonus(m.simultaneousLockBonus),
      changed: m.simultaneousLockBonus !== 0,
      keys: ['simultaneousLockBonus'],
      description:
        m.simultaneousLockBonus > 0
          ? t('bottomBarDetails.simultaneousLockBonusActive', { count: m.simultaneousLockBonus })
          : t('bottomBarDetails.simultaneousLockBonusInactive'),
    },
    {
      label: t('bottomBarDetails.freezeNoCooldown'),
      value: m.freezeNoCooldown > 0 ? t('bottomBarDetails.on') : t('bottomBarDetails.off'),
      changed: m.freezeNoCooldown !== 0,
      keys: ['freezeNoCooldown'],
      description:
        m.freezeNoCooldown > 0
          ? t('bottomBarDetails.freezeNoCooldownActive')
          : t('bottomBarDetails.freezeNoCooldownInactive'),
    },
    {
      label: t('bottomBarDetails.fenceSpeedPerFence'),
      value: pct(m.fenceSpeedPerFence),
      changed: m.fenceSpeedPerFence !== 0,
      keys: ['fenceSpeedPerFence'],
      description:
        m.fenceSpeedPerFence > 0
          ? t('bottomBarDetails.fenceSpeedPerFenceActive', { percent: Math.round(m.fenceSpeedPerFence * 100) })
          : t('bottomBarDetails.fenceSpeedPerFenceInactive'),
    },
    {
      label: t('bottomBarDetails.underParInstantFence'),
      value: bonus(m.underParInstantFence),
      changed: m.underParInstantFence !== 0,
      keys: ['underParInstantFence'],
      description:
        m.underParInstantFence > 0
          ? t('bottomBarDetails.underParInstantFenceActive', { count: m.underParInstantFence })
          : t('bottomBarDetails.underParInstantFenceInactive'),
    },
    {
      label: t('bottomBarDetails.bankedSlow'),
      value: m.bankedSlowPerStep > 0 ? t('bottomBarDetails.bankedSlowValue', { percent: Math.round(m.bankedSlowPerStep * 100) }) : t('bottomBarDetails.off'),
      changed: m.bankedSlowPerStep !== 0,
      keys: ['bankedSlowPerStep'],
      description:
        m.bankedSlowPerStep > 0
          ? t('bottomBarDetails.bankedSlowActive', { percent: Math.round(m.bankedSlowPerStep * 100) })
          : t('bottomBarDetails.bankedSlowInactive'),
    },
    {
      label: t('bottomBarDetails.spaceBonusMultiplier'),
      value: pct(m.spaceBonusMultiplier),
      changed: m.spaceBonusMultiplier !== 1,
      keys: ['spaceBonusMultiplier'],
      description:
        m.spaceBonusMultiplier !== 1
          ? t('bottomBarDetails.spaceBonusMultiplierActive', { mult: m.spaceBonusMultiplier })
          : t('bottomBarDetails.spaceBonusMultiplierInactive'),
    },
    {
      label: t('bottomBarDetails.overtimeCapBonus'),
      value: bonus(m.overtimeCapBonus),
      changed: m.overtimeCapBonus !== 0,
      keys: ['overtimeCapBonus'],
      description:
        m.overtimeCapBonus > 0
          ? t('bottomBarDetails.overtimeCapBonusActive', { hours: m.overtimeCapBonus })
          : t('bottomBarDetails.overtimeCapBonusInactive'),
    },
    {
      label: t('bottomBarDetails.freeCheapestOffer'),
      value: m.freeCheapestOffer > 0 ? t('bottomBarDetails.on') : t('bottomBarDetails.off'),
      changed: m.freeCheapestOffer !== 0,
      keys: ['freeCheapestOffer'],
      description:
        m.freeCheapestOffer > 0
          ? t('bottomBarDetails.freeCheapestOfferActive')
          : t('bottomBarDetails.freeCheapestOfferInactive'),
    },
    {
      label: t('bottomBarDetails.wallShieldsPerMap'),
      value: bonus(m.wallShieldsPerMap),
      changed: m.wallShieldsPerMap !== 0,
      keys: ['wallShieldsPerMap'],
      description:
        m.wallShieldsPerMap > 0
          ? t('bottomBarDetails.wallShieldsPerMapActive', { count: m.wallShieldsPerMap })
          : t('bottomBarDetails.wallShieldsPerMapInactive'),
    },
    {
      label: t('bottomBarDetails.fenceGrace'),
      value: m.fenceGraceMs > 0 ? `${(m.fenceGraceMs / 1000).toFixed(1)}s` : t('bottomBarDetails.off'),
      changed: m.fenceGraceMs !== 0,
      keys: ['fenceGraceMs'],
      description:
        m.fenceGraceMs > 0
          ? t('bottomBarDetails.fenceGraceActive', { seconds: (m.fenceGraceMs / 1000).toFixed(1) })
          : t('bottomBarDetails.fenceGraceInactive'),
    },
    {
      label: t('bottomBarDetails.shipEarlyWindow'),
      value: m.shipEarlySecondsPerBall > 0 ? t('bottomBarDetails.shipEarlyWindowValue', { seconds: m.shipEarlySecondsPerBall }) : t('bottomBarDetails.off'),
      changed: m.shipEarlySecondsPerBall !== 0,
      keys: ['shipEarlySecondsPerBall'],
      description:
        m.shipEarlySecondsPerBall > 0
          ? t('bottomBarDetails.shipEarlyWindowActive', { seconds: m.shipEarlySecondsPerBall })
          : t('bottomBarDetails.shipEarlyWindowInactive'),
    },
    {
      label: t('bottomBarDetails.shipEarlyMultiplier'),
      value: m.shipEarlyBonusMultiplier !== 1 ? `x${m.shipEarlyBonusMultiplier}` : t('bottomBarDetails.off'),
      changed: m.shipEarlyBonusMultiplier !== 1,
      keys: ['shipEarlyBonusMultiplier'],
      description:
        m.shipEarlyBonusMultiplier !== 1
          ? t('bottomBarDetails.shipEarlyMultiplierActive', { mult: m.shipEarlyBonusMultiplier })
          : t('bottomBarDetails.shipEarlyMultiplierInactive'),
    },
    {
      label: t('bottomBarDetails.scopeCreepImmediate'),
      value: m.scopeCreepImmediate > 0 ? t('bottomBarDetails.on') : t('bottomBarDetails.off'),
      changed: m.scopeCreepImmediate !== 0,
      keys: ['scopeCreepImmediate'],
      description:
        m.scopeCreepImmediate > 0
          ? t('bottomBarDetails.scopeCreepImmediateActive')
          : t('bottomBarDetails.scopeCreepImmediateInactive'),
    },
    {
      label: t('bottomBarDetails.extraShopSlots'),
      value: bonus(m.extraShopItems),
      changed: m.extraShopItems !== 0,
      keys: ['extraShopItems'],
      description:
        m.extraShopItems > 0
          ? t('bottomBarDetails.extraShopSlotsActive', { count: m.extraShopItems })
          : t('bottomBarDetails.extraShopSlotsInactive'),
    },
    {
      label: t('bottomBarDetails.shopRestocks'),
      value: bonus(m.shopRestockCount),
      changed: m.shopRestockCount !== 0,
      keys: ['shopRestockCount'],
      description:
        m.shopRestockCount > 0
          ? t('bottomBarDetails.shopRestocksActive', { count: m.shopRestockCount })
          : t('bottomBarDetails.shopRestocksInactive'),
    },
    {
      label: t('bottomBarDetails.microManager'),
      value: m.microManagerPerLock > 0 ? t('bottomBarDetails.microManagerValue', { percent: Math.round(m.microManagerPerLock * 100) }) : t('bottomBarDetails.off'),
      changed: m.microManagerPerLock > 0,
      keys: ['microManagerPerLock'],
      description:
        m.microManagerPerLock > 0
          ? t('bottomBarDetails.microManagerActive', { percent: Math.round(m.microManagerPerLock * 100), count: lockedBalls, speed: pct(effectiveSpeed) })
          : t('bottomBarDetails.microManagerInactive'),
    },
    {
      label: t('bottomBarDetails.ballPathPrediction'),
      value:
        m.ballPathPredictionBounces > 0
          ? t('bottomBarDetails.bounceCount', { count: m.ballPathPredictionBounces })
          : t('bottomBarDetails.off'),
      changed: m.ballPathPredictionBounces > 0,
      keys: ['ballPathPredictionBounces', 'ballPathPredictionBalls'],
      description:
        m.ballPathPredictionBounces > 0
          ? t('bottomBarDetails.ballPathPredictionActive', {
              bounceText: t('bottomBarDetails.bounceCount', { count: m.ballPathPredictionBounces }),
              target: m.ballPathPredictionBalls >= 100
                ? t('bottomBarDetails.ballPathTargetAll')
                : t('bottomBarDetails.ballPathTargetTop', { count: m.ballPathPredictionBalls }),
            })
          : t('bottomBarDetails.ballPathPredictionInactive'),
    },
  ];
}

/** Rows split the way the readout shows them: changed ones first, then the defaults. */
export function splitRows(rows: StatRow[]): { active: StatRow[]; inactive: StatRow[] } {
  return { active: rows.filter(r => r.changed), inactive: rows.filter(r => !r.changed) };
}

// ── The Specs panel (TopBarDetailsPanel) ───────────────────────────────────

export type SpecsSection =
  | 'mapRule' | 'build' | 'objectives' | 'assignment' | 'status' | 'upgrades' | 'attributes' | 'manual';

export interface SpecsSectionInput {
  focus: PanelFocus;
  hasMutator: boolean;
  hasBuild: boolean;
  hasAssignment: boolean;
  hasModifiers: boolean;
  manualCount: number;
}

/** The map rule leads when the player got here by tapping it (and there is one). */
export function isMapRuleFirst(focus: PanelFocus, hasMutator: boolean): boolean {
  return focus === 'mapRule' && hasMutator;
}

/**
 * Where the map-rule card goes: hoisted to the top when the panel was opened to
 * answer for it, in ASSIGNMENT otherwise, never both (two copies read as a bug,
 * and are how the two drift apart).
 */
export function mutatorPlacement(focus: PanelFocus, hasMutator: boolean): 'first' | 'assignment' | null {
  if (!hasMutator) return null;
  return isMapRuleFirst(focus, hasMutator) ? 'first' : 'assignment';
}

/**
 * The sections in the order the player scrolls through them. Objectives,
 * status and upgrades (the list, or its empty card) always show. The manual
 * stays LAST: it is reference material looked up occasionally, while the build
 * above is what the panel is opened for.
 */
export function specsSections(i: SpecsSectionInput): SpecsSection[] {
  const out: SpecsSection[] = [];
  if (isMapRuleFirst(i.focus, i.hasMutator)) out.push('mapRule');
  if (i.hasBuild) out.push('build');
  out.push('objectives');
  if (i.hasAssignment) out.push('assignment');
  out.push('status', 'upgrades');
  if (i.hasModifiers) out.push('attributes');
  if (i.manualCount > 0) out.push('manual');
  return out;
}

/** A section's heading, as the panel prints it (upper-cased on screen). */
export function sectionHeading(
  t: TFunction, s: SpecsSection, o: { upgradeCount?: number } = {},
): string {
  const count = o.upgradeCount ?? 0;
  switch (s) {
    case 'mapRule': return t('topBarDetails.mapRule');
    case 'build': return t('topBarDetails.build');
    case 'objectives': return t('topBarDetails.objectives');
    case 'assignment': return t('topBarDetails.assignment');
    case 'status': return t('topBarDetails.yourStatus');
    case 'upgrades': return count > 0 ? t('topBarDetails.activeUpgradesCount', { count }) : t('topBarDetails.activeUpgrades');
    case 'attributes': return t('topBarDetails.attributes');
    case 'manual': return t('topBarDetails.manual');
  }
}

/**
 * Whether the run's Sprint Planning offer earns a card in the Specs panel: one
 * with a lasting effect or a price. A prize was granted at the pick and already
 * shows as upgrades; Tenure is only ever a prize.
 */
export function offerShowsInSpecs(offer: { id: string; modifiers?: object; price?: object } | null | undefined): boolean {
  return !!offer && offer.id !== 'tenure' && !!(offer.modifiers || offer.price);
}

/** Whether the run has a BUILD to show: archetype tags or a Sprint Planning offer. */
export function hasBuildSection(tagCounts: Map<string, number> | undefined, offerCount: number): boolean {
  return (!!tagCounts && tagCounts.size > 0) || offerCount > 0;
}

export interface TagChipSpec {
  tag: string;
  count: number;
  /** The set bonus is lit: ringed, and the suffix is a check mark. */
  setActive: boolean;
  suffix: string;
}

/** The build readout's tag chips, most-owned first. */
export function tagChipSpecs(tagCounts: Map<string, number>, threshold: number): TagChipSpec[] {
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => {
      const setActive = count >= threshold;
      return { tag, count, setActive, suffix: setActive ? '✓' : `${count}/${threshold}` };
    });
}

export interface ObjectiveCard {
  /** The card is lit (goal reached). */
  met: boolean;
  value: string;
  detail: string;
}

/**
 * Territory CAPTURE, spoken in captured percent. `spaceRemaining` and
 * `spaceRequired` are both REMAINING percent (the map is won when remaining
 * falls to the threshold); printed raw under a capture heading, an untouched
 * level 34 read "100% / 5%", the exact inverse of the truth (0% captured, 95%
 * needed). Converted once, here, rather than in each string that reads them.
 */
export function territoryCard(t: TFunction, spaceRemaining: number, spaceRequired: number): ObjectiveCard {
  const captured = 100 - spaceRemaining;
  const required = 100 - spaceRequired;
  const met = spaceRemaining <= spaceRequired;
  return {
    met,
    value: `${captured}% / ${required}%`,
    detail: met
      ? t('topBarDetails.territoryGoalMet', { captured, required })
      : t('topBarDetails.territoryGoalPending', { required, captured, more: spaceRemaining - spaceRequired }),
  };
}

/** Fence cuts against par; `met` here means over par (the card turns red). */
export function cutsCard(t: TFunction, cutsUsed: number, parCuts: number): ObjectiveCard & { overPar: boolean } {
  const overPar = cutsUsed > parCuts;
  return {
    met: overPar,
    overPar,
    value: t('topBarDetails.cutsParValue', { used: cutsUsed, par: parCuts }),
    detail: overPar
      ? t('topBarDetails.cutsOverPar', { count: cutsUsed - parCuts })
      : cutsUsed === 0
        ? t('topBarDetails.cutsParInfo', { par: parCuts })
        : t('topBarDetails.cutsRemaining', { count: parCuts - cutsUsed }),
  };
}

/**
 * Thread locks, measured in THIS map's count (the same thing the win gate
 * reads). Lit only when a requirement exists and is met.
 */
export function locksCard(t: TFunction, lockedBalls: number, threadLockRequired = 0): ObjectiveCard {
  const lockReq = threadLockRequired;
  const lockMet = lockedBalls >= lockReq;
  return {
    met: lockMet && lockReq > 0,
    value: lockReq > 0 ? `${lockedBalls} / ${lockReq}` : `${lockedBalls}`,
    detail: lockReq > 0
      ? lockMet
        ? t('topBarDetails.lockObjectiveMet', { locked: lockedBalls, required: lockReq })
        : t('topBarDetails.lockObjectivePending', { required: lockReq, more: lockReq - lockedBalls })
      : lockedBalls > 0
        ? t('topBarDetails.lockNoneRequiredWithLocks', { count: lockedBalls })
        : t('topBarDetails.lockNoneRequired'),
  };
}

/** The optional objective's state: done (accumulate met), blown (limit broken), and its tally. */
export function objectiveState(p: ObjectiveProgress | null | undefined): {
  complete: boolean; overBudget: boolean; tally: string | null;
} {
  const complete = p?.mode === 'accumulate' && !!p?.met;
  const overBudget = p?.mode === 'limit' && p?.met === false;
  return { complete, overBudget, tally: p ? `${p.current}/${p.target}${complete ? ' ✓' : ''}` : null };
}

/** Micro Manager's current slow, capped at 50% like the physics. */
export function microManagerPercent(lockedBalls: number, perLock: number): number {
  return Math.min(50, Math.round(lockedBalls * perLock * 100));
}
