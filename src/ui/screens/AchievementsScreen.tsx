/**
 * The achievements screen (canvas port of components/game/AchievementsScreen).
 *
 * Three sections: completed achievements waiting to be switched on (amber,
 * with a pulsing Activate button), the active ones, and the rest, closest to
 * done first, each with its progress toward the threshold.
 *
 * The DOM screen sat on CRTBackground; that stays DOM and is drawn once,
 * globally, under the interface canvas, so this screen only paints the
 * translucent black wash the DOM put over it.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Zap, ChevronLeft, Check } from "lucide-react";
import { type Achievement, ACHIEVEMENT_STAT_LABELS } from "@/types/achievement";
import type { MetaProgressionStats } from "@/types/metaProgression";
import { contentText } from "@/i18n/content";
import {
  Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, usePulse, useTween, useUiScreen,
} from "../kit/ui";
import { achievementProgress, splitAchievements } from "./achievementsModel";

interface AchievementsScreenProps {
  achievements: Achievement[];
  completedIds: string[];
  activatedIds: string[];
  metaStats: MetaProgressionStats;
  onActivate: (id: string) => void;
  onBack: () => void;
  accentColor?: string;
}

/** The "ready to activate" amber (#f59e0b). */
const AMBER = 0xf59e0b;
/** The cards' near-black (rgba(10,15,10,0.9)). */
const CARD_BG = tint(0x0a0f0a, 0.9);
/** text-xs leading-relaxed. */
const RELAXED = Math.round(TEXT.xs * 1.625);

export function AchievementsScreen({
  achievements,
  completedIds,
  activatedIds,
  metaStats,
  onActivate,
  onBack,
  accentColor = "#00ff88",
}: AchievementsScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const { available, active, remaining } = useMemo(
    () => splitAchievements(achievements, completedIds, activatedIds, metaStats),
    [achievements, completedIds, activatedIds, metaStats],
  );
  const statLabels: Record<string, string> = ACHIEVEMENT_STAT_LABELS;
  const isEmpty = achievements.length === 0;
  // max-w-xl, inside the list's 16px gutters.
  const listWidth = Math.min(576, screen.width - 32);

  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.92) }}>
      {/* Header. It wraps: on a phone the title leaves no room beside it for
          the count, which then drops to its own line, right-aligned, instead
          of being squeezed into a column of single letters. */}
      <View layout={{
        flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4,
        paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: tint(0x000a05, 0.95),
      }}>
        <Pressable onTap={onBack} label={t("achievements.back")} layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon icon={ChevronLeft} size={20} color={accent} />
          <Label text={t("achievements.back")} size={TEXT.sm} weight="600" color={accent} />
        </Pressable>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <Icon icon={Trophy} size={20} color={accent} />
          <Label text={t("achievements.title")} size={TEXT.lg} weight="900" font="display" upper letterSpacing={1.8} color={accent} />
        </View>
        <View layout={{ flexGrow: 1, alignItems: "flex-end" }}>
          <Label
            text={t("achievements.activeUnlocked", { active: activatedIds.length, unlocked: completedIds.length })}
            size={TEXT.xs} font="mono" color={accent} alpha={0x99 / 255}
          />
        </View>
      </View>
      <View layout={{ height: 1, backgroundColor: tint(accent, 0x44 / 255) }} />

      {/* Current stats */}
      <View layout={{
        flexDirection: "row", flexWrap: "wrap", columnGap: 24, rowGap: 4,
        paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, backgroundColor: tint(0x000804, 0.9),
      }}>
        {Object.entries(statLabels).map(([key, label]) => (
          <View key={key} layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Label text={`${t(`achievements.stat.${key}`, { defaultValue: label })}:`} size={TEXT.xs} font="mono" color={accent} alpha={0x88 / 255} />
            <Label text={String(metaStats[key as keyof MetaProgressionStats])} size={TEXT.xs} font="mono" weight="700" color={accent} />
          </View>
        ))}
      </View>
      <View layout={{ height: 1, backgroundColor: tint(accent, 0x22 / 255) }} />

      {/* Achievement list */}
      <ScrollView layout={{ flex: 1, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 }}>
        {isEmpty ? (
          <View layout={{ marginTop: 64, alignItems: "center" }}>
            <Label text={t("achievements.noneLoaded")} size={TEXT.sm} font="mono" color={accent} alpha={0x66 / 255} wrap align="center" />
          </View>
        ) : (
          <View layout={{ width: listWidth, alignSelf: "center", gap: 12 }}>
            {/* Available to activate */}
            {available.length > 0 && (
              <>
                <AchSectionHeader label={t("achievements.sectionAvailable")} count={available.length} accent={accent} />
                {available.map((a, i) => <AchAvailableCard key={a.id} achievement={a} index={i} onActivate={onActivate} />)}
              </>
            )}

            {/* Active */}
            {active.length > 0 && (
              <>
                <AchSectionHeader label={t("achievements.sectionActive")} count={active.length} accent={accent} />
                {active.map((a, i) => <AchActiveCard key={a.id} achievement={a} index={i} accent={accent} />)}
              </>
            )}

            {/* In progress */}
            {remaining.length > 0 && (
              <>
                <AchSectionHeader label={t("achievements.sectionInProgress")} count={remaining.length} accent={accent} />
                {remaining.map((a, i) => (
                  <AchRemainingCard key={a.id} achievement={a} index={i} accent={accent} metaStats={metaStats} statLabels={statLabels} />
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function AchSectionHeader({ label, count, accent }: { label: string; count: number; accent: number }) {
  return (
    <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 4, paddingRight: 4, marginTop: 4 }}>
      <Label text={label} size={10} weight="700" font="display" upper letterSpacing={1} color={accent} alpha={0x88 / 255} />
      <View layout={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: RADIUS.base, backgroundColor: tint(accent, 0x18 / 255) }}>
        <Label text={String(count)} size={10} weight="700" font="display" color={accent} alpha={0x99 / 255} />
      </View>
      <View layout={{ flex: 1, height: 1, backgroundColor: tint(accent, 0x22 / 255) }} />
    </View>
  );
}

/** Name, description and bonus: the text column every card shares. */
function AchText({ achievement, nameColor, descColor, descAlpha = 1, bonusColor, bonusAlpha, gapBelowDesc }: {
  achievement: Achievement; nameColor: number; descColor: number; descAlpha?: number;
  bonusColor: number; bonusAlpha: number; gapBelowDesc: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Label text={contentText.achName(t, achievement)} size={TEXT.sm} weight="700" font="display" color={nameColor} wrap />
      <Label text={contentText.achDesc(t, achievement)} size={TEXT.xs} font="mono" lineHeight={RELAXED} color={descColor}
        alpha={descAlpha} wrap layout={{ marginTop: 2, marginBottom: gapBelowDesc }} />
      <AchBonus achievement={achievement} color={bonusColor} alpha={bonusAlpha} />
    </>
  );
}

function AchBonus({ achievement, color, alpha }: { achievement: Achievement; color: number; alpha: number }) {
  const { t } = useTranslation();
  return (
    <Label text={`${t("achievements.bonusLabel")} ${contentText.achBonus(t, achievement)}`}
      size={10} weight="600" font="mono" color={color} alpha={alpha} wrap />
  );
}

function AchAvailableCard({ achievement, index, onActivate }: { achievement: Achievement; index: number; onActivate: (id: string) => void }) {
  return (
    <Appear fromY={10} delay={index * 0.05}>
      <View layout={{ padding: 16, borderRadius: RADIUS.lg, backgroundColor: CARD_BG, borderWidth: 1, borderColor: tint(AMBER, 0x88 / 255) }}>
        <View layout={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View layout={{ flex: 1 }}>
            <AchText achievement={achievement} nameColor={AMBER} descColor={COLOR.mutedForeground}
              bonusColor={AMBER} bonusAlpha={0x99 / 255} gapBelowDesc={8} />
          </View>
          <AchActivateButton onTap={() => onActivate(achievement.id)} />
        </View>
      </View>
    </Appear>
  );
}

/** The Activate button, breathing so a ready reward is not missed (the DOM's pulsing glow). */
function AchActivateButton({ onTap }: { onTap: () => void }) {
  const { t } = useTranslation();
  const pulse = usePulse(1400);
  return (
    <Pressable onTap={onTap} label={t("achievements.activate")} layout={{
      flexDirection: "row", alignItems: "center", gap: 6,
      paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: RADIUS.md,
      backgroundColor: tint(AMBER, 0x22 / 255 + 0.18 * pulse), borderWidth: 1, borderColor: AMBER,
    }}>
      <Icon icon={Zap} size={14} color={AMBER} />
      <Label text={t("achievements.activate")} size={TEXT.xs} weight="700" font="display" upper letterSpacing={0.6} color={AMBER} />
    </Pressable>
  );
}

function AchActiveCard({ achievement, index, accent }: { achievement: Achievement; index: number; accent: number }) {
  return (
    <Appear fromY={10} delay={index * 0.04}>
      <View layout={{ padding: 16, borderRadius: RADIUS.lg, backgroundColor: tint(accent, 0x0d / 255), borderWidth: 1, borderColor: accent }}>
        <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Icon icon={Check} size={16} color={accent} layout={{ marginTop: 2 }} />
          <View layout={{ flex: 1 }}>
            <AchText achievement={achievement} nameColor={accent} descColor={accent} descAlpha={0xcc / 255}
              bonusColor={accent} bonusAlpha={1} gapBelowDesc={4} />
          </View>
        </View>
      </View>
    </Appear>
  );
}

function AchRemainingCard({ achievement, index, accent, metaStats, statLabels }: {
  achievement: Achievement; index: number; accent: number;
  metaStats: MetaProgressionStats; statLabels: Record<string, string>;
}) {
  const { t } = useTranslation();
  const { current, target, ratio, pct } = achievementProgress(achievement, metaStats);
  const stat = achievement.requirement.stat;
  return (
    <Appear fromY={10} delay={index * 0.03}>
      <View layout={{ padding: 16, borderRadius: RADIUS.lg, backgroundColor: CARD_BG, borderWidth: 1, borderColor: tint(accent, 0x33 / 255) }}>
        <View layout={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View layout={{ flex: 1 }}>
            <Label text={contentText.achName(t, achievement)} size={TEXT.sm} weight="700" font="display" color={COLOR.foreground} wrap />
            <Label text={contentText.achDesc(t, achievement)} size={TEXT.xs} font="mono" lineHeight={RELAXED}
              color={COLOR.mutedForeground} wrap layout={{ marginTop: 2, marginBottom: 8 }} />
            <AchProgressBar ratio={ratio} delay={index * 0.03 + 0.1} accent={accent} />
            <Label
              text={`${current} / ${target} ${t(`achievements.stat.${stat}`, { defaultValue: statLabels[stat] })}`}
              size={10} font="mono" color={accent} alpha={0x88 / 255} wrap
            />
            <View layout={{ marginTop: 4 }}>
              <AchBonus achievement={achievement} color={accent} alpha={0x77 / 255} />
            </View>
          </View>
          <Label text={`${pct}%`} size={TEXT.lg} weight="700" font="mono" color={accent} alpha={0x99 / 255} lineHeight={TEXT.lg} />
        </View>
      </View>
    </Appear>
  );
}

/** The progress bar fills from empty after its card has appeared, like the DOM's width animation. */
function AchProgressBar({ ratio, delay, accent }: { ratio: number; delay: number; accent: number }) {
  const [goal, setGoal] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setGoal(ratio), delay * 1000);
    return () => window.clearTimeout(id);
  }, [ratio, delay]);
  const value = useTween(goal, 0.6);
  return (
    <View layout={{ height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 4, flexDirection: "row", backgroundColor: tint(accent, 0x22 / 255) }}>
      <View layout={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: 6, borderRadius: 3, backgroundColor: accent }} />
    </View>
  );
}
