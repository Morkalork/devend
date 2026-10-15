/**
 * HallOfFameScreen: "Performance Review", the records viewer (HIGHSCORES.md
 * Phase B; canvas port of components/game/HallOfFameScreen). Purely
 * presentational: the all-time Top 10 run ladder, the Daily Stand-up,
 * Employee of the Month and lifetime stats. All data lives in useHallOfFame /
 * useMetaProgression and arrives as props.
 *
 * The DOM page sat on CRTBackground, which stays DOM and is drawn once,
 * globally, under the interface canvas; this screen paints only the 90%
 * background wash the DOM put over it. The whole page scrolled, so here the
 * whole page is one scroll view.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { contentText } from "@/i18n/content";
import { Medal, ArrowLeft, Award, CalendarDays, Flame } from "lucide-react";
import type { RunLedgerEntry } from "@/types/hallOfFame";
import type { MetaProgressionStats } from "@/types/metaProgression";
import { Appear, COLOR, Icon, Label, RADIUS, ScrollView, TEXT, View, tint, useUiScreen, type IconSource } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { MenuHeading } from "./welcomeParts";
import { ArcadeButton } from "../kit/ui";
import {
  RANK_COLORS, SM_BREAKPOINT, buildName, capitalizeWords, dayLabel, fmtDate, gridRows,
  hoursText, lifetimeStats, monthLabel, recentDailies, showDaily, sortPlaques,
} from "./hallModel";

interface HallOfFameScreenProps {
  topRuns: RunLedgerEntry[];
  /** Employee of the Month: best run per "YYYY-MM" (HIGHSCORES.md Phase C). */
  monthlyBests?: Record<string, RunLedgerEntry>;
  /** Daily Stand-up: best run per "YYYY-MM-DD" + attendance streak (Phase D). */
  dailyBests?: Record<string, RunLedgerEntry>;
  dailyStreak?: { count: number; lastKey: string };
  metaStats: MetaProgressionStats;
  onBack: () => void;
  accentColor?: string;
}

const GOLD = 0xffd54a;
/** The amber of streaks, depth and plaques (#ffb347). */
const AMBER = COLOR.amberSoft;
const CARD_HALF = tint(COLOR.card, 0.5);

export function HallOfFameScreen({
  topRuns,
  monthlyBests = {},
  dailyBests = {},
  dailyStreak = { count: 0, lastKey: "" },
  metaStats,
  onBack,
}: HallOfFameScreenProps) {
  const { t, i18n } = useTranslation();
  const screen = useUiScreen();
  const wide = screen.width >= SM_BREAKPOINT;
  const pad = wide ? 24 : 16;
  // max-w-2xl inside the page's padding.
  const contentWidth = Math.min(672, screen.width - pad * 2);
  const lang = i18n.language;

  const plaques = sortPlaques(monthlyBests);
  const dailies = recentDailies(dailyBests);

  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9) }}>
      <ScrollView layout={{ flex: 1, paddingLeft: pad, paddingRight: pad, paddingTop: pad, paddingBottom: pad }}>
        <Appear fromY={20} duration={0.5} layout={{ width: contentWidth, alignSelf: "center" }}>
          <View layout={{ alignItems: "center", gap: 24, paddingBottom: 96 }}>
            {/* Header */}
            <MenuHeading icon={Medal} iconColor={GOLD} text={t("hallOfFame.title")} size={wide ? TEXT["4xl"] : TEXT["2xl"]}
              maxWidth={contentWidth} />

            {/* All-time Top 10 */}
            <HallSection title={t("hallOfFame.topRuns")}>
              {topRuns.length === 0 && (
                <Label text={t("hallOfFame.emptyLadder")} size={TEXT.sm} color={COLOR.mutedForeground} wrap />
              )}
              <View layout={{ gap: 8 }}>
                {topRuns.map((run, i) => (
                  <Appear key={`${run.savedAt}-${i}`} delay={0.1 + i * 0.04}>
                    <HallLadderRow run={run} rank={i} lang={lang} />
                  </Appear>
                ))}
              </View>
            </HallSection>

            {/* Daily Stand-up: attendance streak + the last banked days. */}
            {showDaily(dailies, dailyStreak.count) && (
              <HallSection title={t("hallOfFame.daily")} icon={CalendarDays}>
                {dailyStreak.count > 0 && (
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <Icon icon={Flame} size={16} color={AMBER} />
                    <Label text={t("hallOfFame.dailyStreak", { count: dailyStreak.count })} size={TEXT.sm} weight="700" color={AMBER} />
                  </View>
                )}
                <HallGrid cols={wide ? 3 : 2} columnGap={16} rowGap={4} items={dailies.map(([day, run]) => (
                  <HallRecordCell key={day} name={dayLabel(day, lang)} value={hoursText(run.score)} />
                ))} />
              </HallSection>
            )}

            {/* Employee of the Month plaques: one crown per calendar month, so
                there is always a fresh, winnable ladder on the 1st. */}
            {plaques.length > 0 && (
              <HallSection title={t("hallOfFame.employeeOfMonth")}>
                <HallGrid cols={wide ? 2 : 1} columnGap={8} rowGap={8} items={plaques.map(([month, run], i) => (
                  <View key={month} layout={{
                    flexDirection: "row", alignItems: "center", gap: 12,
                    paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg, borderWidth: 1,
                    borderColor: i === 0 ? tint(AMBER, 0x66 / 255) : COLOR.border,
                    backgroundColor: i === 0 ? tint(AMBER, 0x12 / 255) : CARD_HALF,
                  }}>
                    <Icon icon={Award} size={20} color={AMBER} />
                    <View layout={{ flex: 1 }}>
                      <Label text={capitalizeWords(monthLabel(month, lang))} size={TEXT.xs} color={COLOR.mutedForeground} />
                      <View layout={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                        <Label text={hoursText(run.score)} size={TEXT.sm} font="display" weight="700" />
                        <View layout={{ flex: 1 }}>
                          <Label text={buildName(t, run)} size={TEXT.xs} color={COLOR.mutedForeground} wrap />
                        </View>
                      </View>
                    </View>
                  </View>
                ))} />
              </HallSection>
            )}

            {/* Lifetime flavor stats: non-competitive garnish (HIGHSCORES.md
                keeps grind totals OUT of the ladders; they live here only). */}
            <HallSection title={t("hallOfFame.lifetime")}>
              <HallGrid cols={wide ? 4 : 2} columnGap={8} rowGap={8} items={lifetimeStats(metaStats).map(([key, value]) => (
                <View key={key} layout={{
                  alignItems: "center", paddingLeft: 8, paddingRight: 8, paddingTop: 8, paddingBottom: 8,
                  borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLOR.border, backgroundColor: CARD_HALF,
                }}>
                  <Label text={String(value)} size={TEXT.lg} font="display" weight="700" />
                  <Label text={t(`hallOfFame.stats.${key}`)} size={10} upper letterSpacing={0.5} color={COLOR.mutedForeground} wrap align="center" />
                </View>
              ))} />
            </HallSection>

            {/* Back */}
            <ArcadeButton variant="secondary" size="sm" text={t("hallOfFame.back")} icon={ArrowLeft} onTap={onBack} layout={{ marginTop: 8, minWidth: 200 }} />
          </View>
        </Appear>
      </ScrollView>
    </View>
  );
}

function HallSection({ title, icon, children }: { title: string; icon?: IconSource; children?: ReactNode }) {
  return (
    <View layout={{ alignSelf: "stretch" }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {icon && <Icon icon={icon} size={14} color={COLOR.mutedForeground} />}
        <Label text={title} size={TEXT.xs} upper letterSpacing={0.6} color={COLOR.mutedForeground} />
      </View>
      {children}
    </View>
  );
}

/** A CSS grid of equal columns: rows of `flex: 1` cells, the last row padded so its cells keep the width. */
function HallGrid({ cols, columnGap, rowGap, items }: { cols: number; columnGap: number; rowGap: number; items: ReactNode[] }) {
  return (
    <View layout={{ gap: rowGap }}>
      {gridRows(items, cols).map((row, r) => (
        <View key={r} layout={{ flexDirection: "row", gap: columnGap }}>
          {row.map((cell, c) => <View key={c} layout={{ flex: 1 }}>{cell}</View>)}
          {Array.from({ length: cols - row.length }, (_, k) => <View key={`pad-${k}`} layout={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

/** A day's best: name left, hours right, a hairline under it. */
function HallRecordCell({ name, value }: { name: string; value: string }) {
  return (
    <View>
      <View layout={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 4, paddingBottom: 4 }}>
        <Label text={name} size={TEXT.xs} color={COLOR.mutedForeground} />
        <Label text={value} size={TEXT.xs} weight="700" />
      </View>
      <View layout={{ height: 1, backgroundColor: tint(COLOR.border, 0.5) }} />
    </View>
  );
}

function HallLadderRow({ run, rank, lang }: { run: RunLedgerEntry; rank: number; lang: string }) {
  const { t } = useTranslation();
  const top = rank === 0;
  return (
    <View layout={{
      paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg, borderWidth: 1,
      borderColor: top ? tint(GOLD, 0x66 / 255) : COLOR.border,
      backgroundColor: top ? tint(GOLD, 0x12 / 255) : CARD_HALF,
    }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View layout={{ width: 32 }}>
          <Label text={`#${rank + 1}`} size={TEXT.lg} font="display" weight="900" color={RANK_COLORS[rank] ?? COLOR.mutedForeground} />
        </View>
        <Label text={hoursText(run.score)} size={TEXT.xl} font="display" weight="700" color={top ? GOLD : COLOR.foreground} />
        <View layout={{ flex: 1 }} />
        <Label text={fmtDate(run.savedAt, lang)} size={11} color={COLOR.mutedForeground} />
      </View>
      <View layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4, marginTop: 4, paddingLeft: 44 }}>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {!!run.primaryTag && <TagChip tag={run.primaryTag} pill sizeClass="text-[9px]" />}
          {!!run.secondaryTag && <TagChip tag={run.secondaryTag} pill sizeClass="text-[9px]" />}
          <Label text={buildName(t, run)} size={TEXT.xs} color={COLOR.mutedForeground} />
        </View>
        <Label text={t("hallOfFame.mapsLabel", { count: run.levelsCompleted })} size={TEXT.xs} color={COLOR.mutedForeground} />
        {!!run.capstoneName && (
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Icon icon={Award} size={12} color={COLOR.primary} />
            <Label text={run.capstoneId ? contentText.capstoneName(t, { id: run.capstoneId, name: run.capstoneName }) : run.capstoneName} size={TEXT.xs} color={COLOR.mutedForeground} />
          </View>
        )}
      </View>
    </View>
  );
}
