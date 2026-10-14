/**
 * The achievements screen (canvas port of components/game/AchievementsScreen).
 *
 * Three sections: completed achievements waiting to be switched on, the
 * active ones, and the rest, closest to done first, each with its progress
 * toward the threshold.
 *
 * Drawn as the store's tickets are (UI_REDO_PLAN.md): flat panels with a
 * stripe down the left (gold for ready, the accent for active, the edge grey
 * for in progress), a status lozenge, the name in the display face and the
 * description in the body face. It used to be the one screen left in the old
 * look: monospace throughout, thick outlines and a breathing Activate button.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Zap, ChevronLeft, Check } from "lucide-react";
import { type Achievement, ACHIEVEMENT_STAT_LABELS } from "@/types/achievement";
import type { MetaProgressionStats } from "@/types/metaProgression";
import { contentText } from "@/i18n/content";
import {
  Appear, ArcadeButton, Icon, Label, Pressable, RADIUS, ROLE, ScrollView, TEXT, View, hex, tint, useTween, useUiScreen,
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
  const listWidth = Math.min(560, screen.width - 32);

  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: tint(ROLE.surface, 0.96) }}>
      {/* Header. It wraps: on a phone the title leaves no room beside it for
          the count, which then drops to its own line instead of being
          squeezed into a column of single letters. */}
      <View layout={{
        flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4,
        paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: ROLE.raised,
      }}>
        <Pressable onTap={onBack} label={t("achievements.back")} layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon icon={ChevronLeft} size={20} color={ROLE.muted} />
          <Label text={t("achievements.back")} size={TEXT.sm} weight="600" color={ROLE.muted} />
        </Pressable>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <Icon icon={Trophy} size={20} color={accent} />
          <Label text={t("achievements.title")} size={TEXT.lg} weight="700" font="display" color={ROLE.ink} />
        </View>
        <View layout={{ flexGrow: 1, alignItems: "flex-end" }}>
          <Label text={t("achievements.activeUnlocked", { active: activatedIds.length, unlocked: completedIds.length })}
            size={TEXT.xs} color={ROLE.muted} />
        </View>
      </View>
      <View layout={{ height: 1, backgroundColor: ROLE.edge }} />

      {/* Lifetime stats: what the thresholds below are counted against. */}
      <View layout={{
        flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4,
        paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10,
      }}>
        {Object.entries(statLabels).map(([key, label]) => (
          <View key={key} layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Label text={t(`achievements.stat.${key}`, { defaultValue: label })} size={TEXT.xs} color={ROLE.muted} />
            <Label text={String(metaStats[key as keyof MetaProgressionStats])} size={TEXT.xs} weight="700" font="display" color={ROLE.ink} />
          </View>
        ))}
      </View>
      <View layout={{ height: 1, backgroundColor: ROLE.edge }} />

      {/* Achievement list */}
      <ScrollView layout={{ flex: 1, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 }}>
        {isEmpty ? (
          <View layout={{ marginTop: 64, alignItems: "center" }}>
            <Label text={t("achievements.noneLoaded")} size={TEXT.sm} color={ROLE.muted} wrap align="center" />
          </View>
        ) : (
          <View layout={{ width: listWidth, alignSelf: "center", gap: 10 }}>
            {available.length > 0 && (
              <>
                <AchSectionHeader label={t("achievements.sectionAvailable")} count={available.length} />
                {available.map((a, i) => (
                  <AchCard key={a.id} achievement={a} index={i} stripe={ROLE.hours} status={t("achievements.sectionAvailable")} statusColor={ROLE.hours}
                    action={<ArcadeButton size="sm" icon={Zap} text={t("achievements.activate")} onTap={() => onActivate(a.id)} />} />
                ))}
              </>
            )}

            {active.length > 0 && (
              <>
                <AchSectionHeader label={t("achievements.sectionActive")} count={active.length} />
                {active.map((a, i) => (
                  <AchCard key={a.id} achievement={a} index={i} stripe={accent} status={t("achievements.sectionActive")} statusColor={accent} active />
                ))}
              </>
            )}

            {remaining.length > 0 && (
              <>
                <AchSectionHeader label={t("achievements.sectionInProgress")} count={remaining.length} />
                {remaining.map((a, i) => {
                  const { current, target, ratio, pct } = achievementProgress(a, metaStats);
                  const stat = a.requirement.stat;
                  return (
                    <AchCard key={a.id} achievement={a} index={i} stripe={ROLE.edge} status={`${pct}%`} statusColor={ROLE.muted}
                      progress={{
                        ratio, delay: i * 0.03 + 0.1, accent,
                        text: `${current} / ${target} ${t(`achievements.stat.${stat}`, { defaultValue: statLabels[stat] })}`,
                      }} />
                  );
                })}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function AchSectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
      <Label text={label} size={TEXT.xs} weight="700" upper letterSpacing={1} color={ROLE.muted} />
      <View layout={{ borderRadius: RADIUS.full, paddingLeft: 6, paddingRight: 6, backgroundColor: ROLE.edge }}>
        <Label text={String(count)} size={TEXT.xs} weight="700" color={ROLE.ink} />
      </View>
      <View layout={{ flex: 1, height: 1, backgroundColor: ROLE.edge }} />
    </View>
  );
}

/**
 * One achievement as a ticket: the stripe and the status lozenge say where it
 * stands, the action (Activate) sits beside the name, and an in-progress one
 * carries its progress bar and count.
 */
function AchCard({ achievement, index, stripe, status, statusColor, active = false, action, progress }: {
  achievement: Achievement; index: number; stripe: number; status: string; statusColor: number; active?: boolean;
  action?: React.ReactNode;
  progress?: { ratio: number; delay: number; accent: number; text: string };
}) {
  const { t } = useTranslation();
  return (
    <Appear fromY={10} delay={index * 0.04}>
      <View layout={{
        flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
        backgroundColor: active ? tint(stripe, 0.06) : ROLE.raised, borderWidth: 1, borderColor: active ? tint(stripe, 0.5) : ROLE.edge,
      }}>
        <View layout={{ width: 4, backgroundColor: stripe }} />
        <View layout={{ flex: 1, padding: 14, gap: 6 }}>
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: tint(statusColor, 0.14) }}>
              {active && <Icon icon={Check} size={12} strokeWidth={3} color={statusColor} />}
              <Label text={status} size={11} weight="700" upper letterSpacing={0.6} color={statusColor} />
            </View>
            <View layout={{ flex: 1 }} />
            {action}
          </View>
          <Label text={contentText.achName(t, achievement)} size={TEXT.base} weight="600" font="display" color={ROLE.ink} wrap />
          <Label text={contentText.achDesc(t, achievement)} size={TEXT.sm} lineHeight={20} color={ROLE.muted} wrap />
          {progress && (
            <View layout={{ gap: 4, marginTop: 2 }}>
              <AchProgressBar ratio={progress.ratio} delay={progress.delay} accent={progress.accent} />
              <Label text={progress.text} size={TEXT.xs} color={ROLE.muted} wrap />
            </View>
          )}
          <Label text={`${t("achievements.bonusLabel")} ${contentText.achBonus(t, achievement)}`}
            size={TEXT.xs} weight="600" color={active ? stripe : ROLE.hours} wrap />
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
    <View layout={{ height: 4, borderRadius: 2, overflow: "hidden", flexDirection: "row", backgroundColor: ROLE.edge }}>
      <View layout={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: 4, borderRadius: 2, backgroundColor: accent }} />
    </View>
  );
}
