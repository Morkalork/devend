/**
 * ModifierBreakdown (canvas port of components/game/ModifierBreakdown.tsx):
 * the "attributes" readout, every active GameModifier explained in plain
 * language with the sources that contribute to it. A list of sections with no
 * full-screen wrapper, so it sits inside the Specs panel (TopBarDetailsPanel).
 * The rows themselves are built in specsModel.ts.
 */
import { useTranslation } from 'react-i18next';
import type { GameModifiers, ModifierSource } from '@/hooks/useActiveModifiers';
import { hex } from '../theme';
import { Label, RADIUS, TEXT, View, tint } from '../kit/ui';
import { modifierRows, rowContributors, shipEarlyTopPercent, sourceName, splitRows } from './specsModel';
import { SPECS } from './specsStyle';
import { SpecsPara, SpecsSection, SpecsText, StatHead } from './specsParts';

interface ModifierBreakdownProps {
  activeModifiers: GameModifiers;
  modifierSources?: ModifierSource[];
  accentColor?: string;
  lockedBalls?: number;
}

// The DOM's `text-shadow: 0 0 8px ${accent}88` on a changed row's figures.
const ROW_GLOW = 6;

export function ModifierBreakdown({
  activeModifiers,
  modifierSources = [],
  accentColor = '#00ff88',
  lockedBalls = 0,
}: ModifierBreakdownProps) {
  const { t } = useTranslation();
  const accent = hex(accentColor);

  const topPercent = shipEarlyTopPercent();
  const { active: activeRows, inactive: inactiveRows } = splitRows(modifierRows(t, activeModifiers, lockedBalls));

  // A changed row's card: accent at 0x0d fill, 0x44 border.
  const litCard = {
    borderRadius: RADIUS.lg, padding: 16,
    backgroundColor: tint(accent, 0x0d / 255), borderColor: tint(accent, 0x44 / 255), borderWidth: 1,
  };

  return (
    <View layout={{ gap: 28 }}>
      {/* Ship Early countdown: always shown so the on-board timer bar (with its
          white one-hour tick marks) is explained regardless of modifiers. */}
      {topPercent > 0 && (
        <SpecsSection heading={t('bottomBarDetails.timingHead')} accent={accent}>
          <View layout={litCard}>
            <StatHead
              title={t('bottomBarDetails.shipEarlyCountdown')} titleColor={accent}
              value={t('bottomBarDetails.shipEarlyCountdownValue', { percent: topPercent })} valueColor={accent}
              glow={ROW_GLOW}
            />
            <SpecsPara text={t('bottomBarDetails.shipEarlyCountdownDesc', { percent: topPercent })} color={SPECS.ink} alpha={0.85} />
          </View>
        </SpecsSection>
      )}

      {/* Active (non-default) modifiers */}
      {activeRows.length > 0 && (
        <SpecsSection heading={t('bottomBarDetails.modifiedCount', { count: activeRows.length })} accent={accent}>
          {activeRows.map(row => {
            const contributors = rowContributors(row, modifierSources);
            return (
              <View key={row.label} layout={litCard}>
                <StatHead title={row.label} titleColor={accent} value={row.value} valueColor={accent} glow={ROW_GLOW} />
                <SpecsPara text={row.description} color={SPECS.ink} alpha={0.85} />
                {contributors.length > 0 && (
                  <>
                    {/* The DOM's border-top at accent 0x22. */}
                    <View layout={{ height: 1, marginTop: 10, backgroundColor: tint(accent, 0x22 / 255) }} />
                    <View layout={{ paddingTop: 10, gap: 4 }}>
                      <Label text={t('bottomBarDetails.fromSources')} font="display" upper size={10} letterSpacing={1}
                        color={accent} alpha={0x99 / 0xff} />
                      {contributors.map(c => (
                        <View key={`${c.source.kind}-${c.source.id}`}
                          layout={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <View layout={{ flex: 1 }}>
                            <SpecsText text={sourceName(t, c.source)} size={TEXT.xs} color={SPECS.ink} wrap />
                          </View>
                          <SpecsText text={c.text} size={TEXT.xs} weight="700" color={accent} />
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </View>
            );
          })}
        </SpecsSection>
      )}

      {activeRows.length === 0 && (
        <View layout={{
          borderRadius: RADIUS.lg, padding: 20, alignItems: 'center',
          backgroundColor: tint(0xffffff, 0.04), borderColor: tint(accent, 0x22 / 255), borderWidth: 1,
        }}>
          <SpecsText text={t('bottomBarDetails.noModifiers')} size={TEXT.sm} color={SPECS.empty} align="center" wrap />
        </View>
      )}

      {/* Base / inactive modifiers */}
      {inactiveRows.length > 0 && (
        <SpecsSection heading={t('bottomBarDetails.atDefault')} accent={accent} gap={8}>
          {inactiveRows.map(row => (
            <View key={row.label} layout={{
              borderRadius: RADIUS.lg, padding: 12,
              backgroundColor: tint(0xffffff, 0.03), borderColor: tint(accent, 0x18 / 255), borderWidth: 1,
            }}>
              <View layout={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                <View layout={{ flex: 1 }}>
                  <SpecsText text={row.label} size={TEXT.sm} weight="700" color={accent} alpha={0xbb / 0xff} wrap />
                </View>
                <SpecsText text={row.value} size={TEXT.sm} color={accent} alpha={0xaa / 0xff} />
              </View>
              <SpecsPara text={row.description} color={SPECS.ink} alpha={0.6} />
            </View>
          ))}
        </SpecsSection>
      )}
    </View>
  );
}
