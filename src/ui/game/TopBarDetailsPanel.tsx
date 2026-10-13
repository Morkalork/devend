/**
 * TopBarDetailsPanel (canvas port of components/game/TopBarDetailsPanel.tsx):
 * the full-screen "Specs" sheet for the current run. Your build (archetype
 * tags + loadout), the map's objectives and assignment (Promotion / mutator /
 * objective), your status, every owned upgrade, the full attribute (modifier)
 * breakdown and the manual. Opened by the Specs button in GameTopBar.
 *
 * Which sections show, their order and what each objective card says live in
 * specsModel.ts, so they are tested without a canvas.
 */
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Award, Wind, Heart, Lock, Scissors, Target, Hexagon, Skull, Sparkles, RotateCcw } from 'lucide-react';
import { MANUAL_ENTRIES, hasMetManualEntry, markManualRead } from '@/lib/manual';
import type { UpgradeConfig, UpgradeTag } from '@/types/upgrade';
import type { LoadoutConfig } from '@/types/loadout';
import type { ScalingReadout } from '@/lib/upgradeScaling';
import type { CapstoneConfig } from '@/types/capstone';
import type { ActiveMapMutator } from '@/types/mapMutator';
import type { ActiveMapObjective, ObjectiveProgress } from '@/types/objective';
import type { GameModifiers, ModifierSource } from '@/hooks/useActiveModifiers';
import type { PanelFocus } from './specsModel';
import { DEFAULT_TAG_SET_THRESHOLD } from '@/lib/upgradeTags';
import { getUpgradeIcon } from '@/components/game/upgradeIcons';
import { contentText } from '@/i18n/content';
import { COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen } from '../kit/ui';
import { TagChip } from './TagChip';
import { ModifierBreakdown } from './ModifierBreakdown';
import {
  cutsCard, hasBuildSection, locksCard, microManagerPercent, mutatorPlacement, objectiveState,
  sectionHeading, specsSections, tagChipSpecs, territoryCard, type SpecsSection,
} from './specsModel';
import { SPECS, cardHighLayout, cardLayout, filledIcon } from './specsStyle';
import { SpecsPara, SpecsSection as Section, SpecsText, StatHead } from './specsParts';
import { GlowFrame } from './modalParts';

export type { PanelFocus };

interface CertificateHourProgress {
  levelsCompleted: number;
  levelsToNextHour: number;
  progressInCurrentHour: number;
  hoursEarned: number;
  levelsPerHour: number;
}

interface TopBarDetailsPanelProps {
  visible: boolean;
  onClose: () => void;
  levelNumber: number;
  cutsUsed: number;
  parCuts: number;
  lives: number;
  continuesRemaining?: number;
  spaceRemaining: number;
  spaceRequired: number;
  lockedBalls: number;
  threadLockRequired?: number;
  ownedUpgrades: UpgradeConfig[];
  accentColor?: string;
  certificateProgress?: CertificateHourProgress;
  microManagerPerLock?: number;
  /** What build scaling is paying right now (upgradeScaling.ts). */
  scalingReadouts?: ScalingReadout[];
  activeLoadouts?: LoadoutConfig[];
  // Build readout: owned upgrades per archetype tag, and the count needed to
  // light a tag's set bonus.
  tagCounts?: Map<string, number>;
  tagSetThreshold?: number;
  // Attributes: merged modifiers + the sources that contribute to each.
  activeModifiers?: GameModifiers;
  modifierSources?: ModifierSource[];
  // The run's once-per-run Promotion, per-map mutator and optional objective
  // (folded in from the old top-bar chips, #61).
  capstone?: CapstoneConfig | null;
  mapMutator?: ActiveMapMutator | null;
  objective?: ActiveMapObjective | null;
  objectiveProgress?: ObjectiveProgress | null;
  /**
   * What the player asked about, when they got here by tapping something
   * rather than by opening Specs.
   *
   * A panel opened from a question should answer that question first. The map
   * rule normally sits third, inside ASSIGNMENT, behind the build and the
   * objectives - fine when you opened Specs to browse, useless when you tapped
   * a banner that said "Technical Gravity" because you wanted to know what
   * Technical Gravity does.
   */
  focus?: PanelFocus;
}

export function TopBarDetailsPanel({
  visible,
  onClose,
  levelNumber,
  cutsUsed,
  parCuts,
  lives,
  spaceRemaining,
  spaceRequired,
  lockedBalls,
  threadLockRequired,
  ownedUpgrades,
  accentColor = '#00ff88',
  certificateProgress,
  microManagerPerLock = 0,
  scalingReadouts = [],
  activeLoadouts = [],
  continuesRemaining = 0,
  tagCounts,
  tagSetThreshold = DEFAULT_TAG_SET_THRESHOLD,
  activeModifiers,
  modifierSources = [],
  capstone = null,
  mapMutator = null,
  objective = null,
  objectiveProgress = null,
  focus = null,
}: TopBarDetailsPanelProps) {
  // Entries the player has met. Opening the panel is what clears the badge:
  // the badge means "there is something new in here", so reading counts as
  // acknowledging it, and it must not need a separate dismiss.
  const manualSeen = MANUAL_ENTRIES.filter(e => hasMetManualEntry(e.id));
  useEffect(() => { if (visible) markManualRead(); }, [visible]);

  const { t } = useTranslation();
  const screen = useUiScreen();
  // Hidden means unmounted, as in the DOM: each open starts scrolled to the
  // top, which is what lets a focused open lead with the section it hoisted.
  if (!visible) return null;

  const accent = hex(accentColor);
  const card = cardLayout(accent);
  const cardHigh = cardHighLayout(accent);

  // Territory capture speaks in captured percent; see territoryCard.
  const territory = territoryCard(t, spaceRemaining, spaceRequired);
  const cuts = cutsCard(t, cutsUsed, parCuts);
  const locks = locksCard(t, lockedBalls, threadLockRequired ?? 0);
  const objState = objectiveState(objectiveProgress);

  // The map rule leads when the player got here by tapping it.
  const placement = mutatorPlacement(focus, !!mapMutator);

  const sections = specsSections({
    focus,
    hasMutator: !!mapMutator,
    hasBuild: hasBuildSection(tagCounts, activeLoadouts.length),
    hasAssignment: !!(capstone || mapMutator || objective),
    hasModifiers: !!activeModifiers,
    manualCount: manualSeen.length,
  });
  const heading = (s: SpecsSection) => sectionHeading(t, s, { upgradeCount: ownedUpgrades.length });

  /**
   * The map rule, as one card built once and placed in one of two spots. Two
   * copies of a card that must stay identical is how the hoisted one quietly
   * drifts from the one in ASSIGNMENT, and the player would see a different
   * explanation depending on which way they opened the panel.
   */
  const mutatorCard = mapMutator ? (
    <View layout={cardLayout(accent, tint(SPECS.mutator, 0x55 / 255))}>
      <StatHead icon={Wind} title={contentText.mutatorName(t, mapMutator)} titleColor={SPECS.mutator} marginBottom={8} />
      <SpecsPara text={contentText.mutatorDesc(t, mapMutator)} color={SPECS.ink} alpha={0.75} relaxed={false} />
      {mapMutator.clarify && (
        <SpecsPara text={contentText.mutatorClarify(t, mapMutator)} color={SPECS.ink} alpha={0.6} relaxed={false} layout={{ marginTop: 8 }} />
      )}
    </View>
  ) : null;

  const body: Record<SpecsSection, () => ReactNode> = {
    // Tapping the map-rule banner is a question, and a panel opened from a
    // question answers it first. The same card sits in ASSIGNMENT otherwise.
    mapRule: () => mutatorCard,

    // Archetype tags + loadout: the run's identity.
    build: () => (
      <>
        {tagCounts && tagCounts.size > 0 && (
          <View layout={card}>
            <View layout={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {tagChipSpecs(tagCounts, tagSetThreshold).map(c => (
                <TagChip key={c.tag} tag={c.tag as UpgradeTag} pill ringed={c.setActive} suffix={c.suffix} />
              ))}
            </View>
          </View>
        )}
        {/* Build scaling: what a focused archetype is currently paying.
            Invisible otherwise, since it moves a modifier rather than granting
            a card of its own. */}
        {scalingReadouts.length > 0 && (
          <View layout={cardLayout(accent, tint(accent, 0x55 / 255))}>
            <SpecsText text={t('topBarDetails.buildScaling')} size={10} weight="700" upper letterSpacing={1}
              color={accent} alpha={0.85} layout={{ marginBottom: 8 }} />
            <View layout={{ gap: 6 }}>
              {scalingReadouts.map(r => (
                <View key={r.upgradeId} layout={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <View layout={{ flex: 1 }}>
                    <SpecsText text={r.upgradeName} size={TEXT.xs} color={SPECS.ink} alpha={0.85} wrap />
                  </View>
                  <SpecsText text={t('topBarDetails.buildScalingFrom', { count: r.effective, tag: r.tag })}
                    size={TEXT.xs} weight="700" color={accent} />
                </View>
              ))}
            </View>
          </View>
        )}
        {activeLoadouts.map(loadout => (
          <View key={loadout.id} layout={card}>
            <SpecsText text={contentText.loadoutName(t, loadout)} size={TEXT.sm} weight="700" color={SPECS.amber} wrap layout={{ marginBottom: 8 }} />
            <View layout={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <Icon icon={Skull} size={14} color={SPECS.danger} layout={{ marginTop: 2 }} />
              <View layout={{ flex: 1 }}>
                <SpecsPara text={contentText.loadoutCurse(t, loadout)} color={SPECS.danger} />
              </View>
            </View>
            <View layout={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Icon icon={Sparkles} size={14} color={accent} layout={{ marginTop: 2 }} />
              <View layout={{ flex: 1 }}>
                <SpecsPara text={contentText.loadoutBlessing(t, loadout)} color={SPECS.ink} alpha={0.85} />
              </View>
            </View>
          </View>
        ))}
      </>
    ),

    objectives: () => (
      <>
        {/* Space capture */}
        <View layout={territory.met ? cardHigh : card}>
          <StatHead icon={Target} iconColor={accent} title={t('topBarDetails.territoryCapture')} titleColor={accent}
            value={territory.value} valueColor={territory.met ? accent : COLOR.foreground} />
          <SpecsPara text={territory.detail} color={SPECS.ink} alpha={0.6} />
        </View>

        {/* Cuts / Par */}
        <View layout={cuts.overPar ? cardLayout(accent, tint(SPECS.danger, 0x44 / 255)) : card}>
          <StatHead icon={Scissors} title={t('topBarDetails.fenceCuts')} titleColor={cuts.overPar ? SPECS.danger : accent}
            value={cuts.value} valueColor={cuts.overPar ? SPECS.danger : COLOR.foreground} />
          <SpecsPara text={cuts.detail} color={SPECS.ink} alpha={0.6} />
        </View>

        {/* Thread Locks: this map's count, the one the win gate reads. */}
        <View layout={locks.met ? cardHigh : card}>
          <StatHead
            icon={Lock}
            // The lock dims to the accent at 0x66 until the requirement is met.
            iconColor={accent}
            iconAlpha={locks.met ? 1 : 0x66 / 0xff}
            title={t('topBarDetails.threadLocks')} titleColor={accent}
            value={locks.value} valueColor={locks.met ? accent : COLOR.foreground}
          />
          <SpecsPara text={locks.detail} color={SPECS.ink} alpha={0.6} />
        </View>
      </>
    ),

    // Promotion, map mutator, optional objective.
    assignment: () => (
      <>
        {capstone && (
          <View layout={cardLayout(accent, tint(SPECS.capstone, 0x55 / 255))}>
            <StatHead icon={Award} title={contentText.capstoneName(t, capstone)} titleColor={SPECS.capstone} marginBottom={8} />
            <SpecsPara text={contentText.capstoneDesc(t, capstone)} color={SPECS.ink} alpha={0.75} relaxed={false} />
            {capstone.clarify && (
              <SpecsPara text={contentText.capstoneClarify(t, capstone)} color={SPECS.ink} alpha={0.6} relaxed={false} layout={{ marginTop: 8 }} />
            )}
          </View>
        )}
        {/* Absent when the panel was opened BY this card: it is hoisted to the
            top instead, and showing it twice would read as a bug. */}
        {placement === 'assignment' && mutatorCard}
        {objective && (() => {
          const tone = objState.overBudget ? SPECS.objectiveBad : SPECS.objective;
          const rewardColor = objState.complete ? SPECS.objective : objState.overBudget ? SPECS.objectiveBad : COLOR.foreground;
          return (
            <View layout={cardLayout(accent, tint(tone, 0x55 / 255))}>
              <StatHead icon={Target} title={contentText.objectiveName(t, objective)} titleColor={tone} marginBottom={8} />
              <SpecsPara text={contentText.objectiveDesc(t, objective)} color={SPECS.ink} alpha={0.75} relaxed={false} />
              <View layout={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <SpecsText text={t('topBar.objectiveReward', { hours: objective.reward })} size={TEXT.xs} weight="600" color={rewardColor} />
                {objState.tally !== null && (
                  <SpecsText text={objState.tally} size={TEXT.xs} color={SPECS.ink} alpha={0.7} />
                )}
              </View>
              {objective.clarify && (
                <SpecsPara text={contentText.objectiveClarify(t, objective)} color={SPECS.ink} alpha={0.6} relaxed={false} layout={{ marginTop: 8 }} />
              )}
            </View>
          );
        })()}
      </>
    ),

    status: () => (
      <>
        {/* Lives */}
        <View layout={card}>
          <StatHead
            icon={filledIcon(Heart, accent)} title={t('topBarDetails.livesRemaining')} titleColor={accent} marginBottom={0}
            value={
              <View layout={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon icon={filledIcon(Heart, accent)} size={20} color={accent} />
                {lives > 0
                  ? <SpecsText text={String(lives)} size={TEXT.base} weight="700" color={accent} />
                  : <SpecsText text={t('topBarDetails.livesNone')} size={TEXT.sm} weight="700" color={SPECS.danger} />}
              </View>
            }
          />
          <SpecsPara text={t('topBarDetails.livesDescription')} color={SPECS.ink} alpha={0.6} layout={{ marginTop: 8 }} />
        </View>

        {/* Continues (per-run revives) */}
        <View layout={card}>
          <StatHead icon={RotateCcw} title={t('topBarDetails.continues')} titleColor={accent} marginBottom={0}
            value={String(continuesRemaining)} valueColor={COLOR.foreground} />
          <SpecsPara text={t('topBarDetails.continuesDescription')} color={SPECS.ink} alpha={0.6} layout={{ marginTop: 8 }} />
        </View>

        {/* Certificate-hour progress */}
        {certificateProgress && (
          <View layout={card}>
            <StatHead icon={Hexagon} iconColor={COLOR.white} title={t('topBarDetails.certificatePoints')} titleColor={accent}
              value={`${certificateProgress.progressInCurrentHour} / ${certificateProgress.levelsPerHour}`} valueColor={COLOR.white} />
            <SpecsPara
              text={`${t('topBarDetails.certPointsEarned', { count: certificateProgress.hoursEarned })} ${t('topBarDetails.certPointsToGo', { count: certificateProgress.levelsPerHour - certificateProgress.progressInCurrentHour })}`}
              color={SPECS.ink} alpha={0.6}
            />
          </View>
        )}
      </>
    ),

    upgrades: () => ownedUpgrades.length > 0 ? (
      <>
        {ownedUpgrades.map(upgrade => {
          const UpgradeIcon = getUpgradeIcon(upgrade, ownedUpgrades);
          return (
            <View key={upgrade.id} layout={card}>
              <View layout={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <View layout={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {UpgradeIcon && <Icon icon={UpgradeIcon} size={16} color={accent} strokeWidth={1.5} />}
                  <View layout={{ flex: 1 }}>
                    <SpecsText text={contentText.upgradeName(t, upgrade)} size={TEXT.sm} weight="700" color={accent} lineHeight={18} wrap />
                  </View>
                </View>
                <View layout={{
                  paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, borderRadius: RADIUS.base,
                  backgroundColor: tint(accent, 0x22 / 255), borderColor: tint(accent, 0x55 / 255), borderWidth: 1,
                }}>
                  <SpecsText text={contentText.tier(t, upgrade.tier)} size={TEXT.xs} weight="700" color={accent} />
                </View>
              </View>
              <SpecsPara text={contentText.upgradeDesc(t, upgrade)} color={SPECS.ink} alpha={0.7} />
              {upgrade.id.startsWith('micro_manager_') && microManagerPerLock > 0 && (
                <SpecsText
                  text={t('topBarDetails.currentlyReducingBallSpeed', { percent: microManagerPercent(lockedBalls, microManagerPerLock) })}
                  size={TEXT.xs} weight="700" color={accent} wrap layout={{ marginTop: 8 }}
                />
              )}
            </View>
          );
        })}
      </>
    ) : (
      <View layout={{ ...card, alignItems: 'center' }}>
        <SpecsText text={t('topBarDetails.noUpgrades')} size={TEXT.xs} color={SPECS.empty} align="center" wrap />
      </View>
    ),

    // The merged modifiers and what feeds each.
    attributes: () => activeModifiers ? (
      <ModifierBreakdown
        activeModifiers={activeModifiers}
        modifierSources={modifierSources}
        accentColor={accentColor}
        lockedBalls={lockedBalls}
      />
    ) : null,

    // Mechanics met so far, kept LAST. These used to be one-time modals that
    // interrupted play, fired once and were then unreachable forever; here they
    // stay readable, and the Specs badge announces a new one instead.
    manual: () => (
      <>
        {manualSeen.map(entry => (
          <View key={entry.id} layout={card}>
            <View layout={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View layout={{ width: 6, height: 6, borderRadius: RADIUS.full, backgroundColor: entry.color }} />
              <View layout={{ flex: 1 }}>
                <SpecsText text={t(entry.titleKey)} size={TEXT.sm} weight="600" color={COLOR.foreground} wrap />
              </View>
            </View>
            <SpecsPara text={t(entry.bodyKey)} color={COLOR.mutedForeground} layout={{ marginTop: 4 }} />
          </View>
        ))}
      </>
    ),
  };

  return (
    <View
      label="specs-panel"
      zIndex={80}
      layout={{ position: 'absolute', left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: SPECS.backdrop }}
    >
      {/* Swallows touches: the DOM sheet was an opaque div that took every
          touch, so nothing under it (the board) may react to one. */}
      <Pressable
        pressedAlpha={1}
        layout={{ position: 'absolute', left: 0, top: 0, width: screen.width, height: screen.height }}
      />

      {/* Header */}
      <View layout={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 16 }}>
        <View layout={{ flex: 1 }}>
          <Label text={t('topBarDetails.specsTitle', { level: levelNumber })} font="display" upper size={TEXT.xl}
            weight="900" letterSpacing={2} color={accent} glow={10} />
        </View>
        <Pressable
          onTap={onClose}
          label={t('topBarDetails.closePanel')}
          layout={{
            width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.lg,
            backgroundColor: tint(accent, 0x22 / 255), borderColor: tint(accent, 0x99 / 255), borderWidth: 2,
          }}
        >
          {/* box-shadow 0 0 12px accent44 */}
          <GlowFrame color={accent} radius={RADIUS.lg} spread={10} strength={0x44 / 255} />
          <Icon icon={X} size={24} color={accent} />
        </Pressable>
      </View>
      {/* The header's 2px bottom rule at accent 0x44. */}
      <View layout={{ height: 2, backgroundColor: tint(accent, 0x44 / 255) }} />

      {/* Scrollable content */}
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ width: screen.width, paddingLeft: 20, paddingRight: 20, paddingTop: 20, paddingBottom: 20, gap: 28 }}>
          {sections.map(s => (
            <Section key={s} heading={heading(s)} accent={accent} gap={s === 'attributes' ? 0 : 12}>
              {body[s]()}
            </Section>
          ))}
          {/* Bottom spacer so content clears the safe area */}
          <View layout={{ height: 16 }} />
        </View>
      </ScrollView>
    </View>
  );
}
