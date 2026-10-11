/**
 * The end-of-run screen (canvas port of components/game/ResultScreen.tsx).
 *
 * Two rows, and the split is the whole point: the recap SCROLLS and the
 * run-continuation buttons DO NOT. The screen grew - outcome, ascension, new
 * loadouts, the failure and what was still needed, certificate hours, the
 * ladder with four possible crowns, the build recap - so on a phone Play Again
 * ended up below content that only exists on some runs, and the better the run
 * the deeper it was buried. The middle row owns the overflow; the bar below it
 * never moves.
 *
 * Drawn in the redo's style (UI_REDO_PLAN.md, phase 3): left-aligned on the
 * flat surface, the outcome in its tone, then one big figure (the overtime
 * banked, or the level reached), then the run's facts as a ledger.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Graphics, TextStyleFontWeight } from "pixi.js";
import { Trophy, Skull, Home, Hexagon, ArrowUpCircle, RotateCcw, Backpack, Award, Medal, CalendarDays, Flame, Share2, Check } from "lucide-react";
import type { GameResult } from "@/types/game";
import { failHeadline, failLines } from "@/lib/mapFailure";
import type { RunRecap } from "@/lib/buildRecap";
import type { RunRankInfo } from "@/lib/runLedger";
import { shareRunCard } from "@/lib/shareCard";
import {
  Appear, COLOR, Headline, Icon, Label, Ledger, ROLE, ScrollView, TEXT, View, RADIUS, iconNodeOf, tint, useUiScreen,
  type IconNode, type IconSource, type Layout, type LedgerRow,
} from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { ArcadeButton } from "../kit/ui";
import { RichParagraph, TopRule } from "./draftParts";
import type { FontRole } from "../theme";
import { buildIdentity, detourActions, ladderBlock, pinnedActions, recapBlock, type DetourKind } from "./resultScreenModel";
import { SUCCESS, TW } from "./levelCompleteModel";

interface ResultScreenProps {
  result: GameResult;
  onMainMenu: () => void;
  onPlayAgain?: () => void;
  onRestart?: () => void;
  checkpointLevel?: number;
  accentColor?: string;
  runHoursAwarded?: number;
  runLevelsCompleted?: number;
  /** Names of loadouts that unlocked this run (celebrated below the title). */
  newlyUnlockedLoadouts?: string[];
  /** End-of-run build recap (archetype identity, capstone, personal best). */
  runRecap?: RunRecap | null;
  /**
   * Where this run landed on the all-time ladder (HIGHSCORES.md Phase A),
   * plus the near-miss pace epitaph and the Employee-of-the-Month crown.
   * null = ineligible or nothing banked.
   */
  runRank?: (RunRankInfo & {
    aheadThroughMaps: number | null;
    monthBest?: boolean;
    /** Daily Stand-up: run beat today's daily best / current attendance streak. */
    dayBest?: boolean;
    dailyStreak?: number;
  }) | null;
  /** The run's Daily Stand-up key, for the share card's daily tag. */
  dailyKey?: string | null;
  /** Opens the Performance Review right from the result (back returns here). */
  onRecords?: () => void;
}

/** `text-danger`: the destructive red. */
const DANGER = COLOR.destructive;
const DAILY = 0x4ade80;
/** How far above the pinned bar the recap fades out. */
const BAR_FADE = 40;

/**
 * An icon + text line, left-aligned like the rest of the redo, that
 * wraps: a phone's column is narrower than several of these lines in the
 * display face, and the words then flow onto a second line under the first
 * instead of running off the screen.
 */
function IconLine({ icon, iconColor, iconSize = 16, gap = 6, layout, text, ...look }: {
  icon: IconSource; iconColor: number; iconSize?: number; gap?: number; layout?: Layout;
  text: string; size: number; color?: number; font?: FontRole; weight?: TextStyleFontWeight; upper?: boolean; letterSpacing?: number; glow?: number;
}) {
  return (
    <View layout={{ alignSelf: "stretch", ...(layout ?? {}) }}>
      <RichParagraph {...look} align="left" color={look.color ?? ROLE.ink} runs={[{ text }]}
        lead={<Icon icon={icon} size={iconSize} color={iconColor} />} leadGap={gap} />
    </View>
  );
}

/** `fill-white/20`: the hexagon of certificate hours, outlined and faintly filled. */
const HEXAGON_FILLED: IconNode = iconNodeOf(Hexagon).map(([tag, attrs]) => [tag, { ...attrs, fill: "#ffffff", "fill-opacity": 0.2 }]);

export function ResultScreen({
  result,
  onMainMenu,
  onPlayAgain,
  onRestart,
  checkpointLevel,
  accentColor,
  runHoursAwarded = 0,
  runLevelsCompleted = 0,
  newlyUnlockedLoadouts = [],
  runRecap = null,
  runRank = null,
  dailyKey = null,
  onRecords,
}: ResultScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const { isWin, remainingPercent, levelId, levelNumber, completedAllLevels, ascensionDepth, loadoutNames, failure } = result;
  const [shareState, setShareState] = useState<"idle" | "done">("idle");
  // The tick goes back to the share glyph after a moment; not after unmount.
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (shareTimer.current) clearTimeout(shareTimer.current); }, []);
  const tone = isWin ? SUCCESS : DANGER;
  const columnWidth = Math.min(448, screen.width - 32);

  const { buildName, buildTitle } = buildIdentity(runRecap, t);
  const ladder = ladderBlock(result, runRank, t);
  const recap = recapBlock(runRecap, t);
  const pinned = pinnedActions({ checkpointLevel, hasPlayAgain: !!onPlayAgain, hasRestart: !!onRestart }, t);
  const detours = detourActions({ hasRecords: !!onRecords, totalScore: result.totalScore });
  const lines = !isWin && failure ? failLines(t, failure) : [];

  // Share card (HIGHSCORES.md Phase E): render the run as a PNG and hand it to
  // the Web Share sheet (mobile) or download it. The card IS the leaderboard post.
  const handleShare = async () => {
    const outcome = await shareRunCard(
      {
        score: result.totalScore ?? 0,
        levelNumber,
        ascensionDepth: ascensionDepth ?? 0,
        buildLine: t("buildRecap.buildLine", { name: buildName, title: buildTitle }),
        capstoneName: runRecap?.capstoneName ?? null,
        rank: runRank?.rank ?? null,
        dailyKey,
        dailyStreak: runRank?.dailyStreak ?? 0,
        isWin,
      },
      {
        title: "Dev/End",
        bankedOvertime: t("result.bankedOvertime"),
        reachedLevel: t("result.shareLevel", { level: levelNumber }),
        rankLine: runRank?.rank ? t("result.rankAllTime", { rank: runRank.rank }) : null,
        dailyLine: dailyKey ? t("result.shareDaily", { date: dailyKey }) : null,
        outcome: isWin ? t("result.youWin") : t("result.gameOver"),
      },
      accentColor,
    );
    if (outcome !== "unavailable") {
      setShareState("done");
      if (shareTimer.current) clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setShareState("idle"), 2500);
    }
  };

  const detour = (kind: DetourKind) => {
    if (kind === "records") return <ArcadeButton key={kind} variant="secondary" icon={Medal} text={t("welcome.records")} onTap={onRecords} />;
    if (kind === "share") {
      return (
        <ArcadeButton key={kind} variant="secondary" text={t("result.share")} onTap={() => { void handleShare(); }}
          icon={shareState === "done" ? Check : Share2} iconColor={shareState === "done" ? SUCCESS : undefined} />
      );
    }
    return <ArcadeButton key={kind} variant="secondary" icon={Home} text={t("result.mainMenu")} onTap={onMainMenu} />;
  };

  // The pinned bar's own height (padding + buttons + gaps): the recap scrolls
  // under it, so it also pads the recap's end clear of the buttons.
  const barHeight = pinned.length > 0 ? 16 + 24 + pinned.length * 52 + (pinned.length - 1) * 12 : 0;
  // The gradient is doing work, not decoration: the bar sits OVER the end of
  // the scrolling recap and fades it out just above the buttons, so a screen
  // with more below reads as scrollable rather than finished. Under the
  // buttons themselves the ground is solid: their faces are translucent, and
  // the recap must not show through them.
  const drawFade = useCallback((g: Graphics) => {
    g.clear();
    const steps = BAR_FADE; // 1px bands: coarser ones stripe the text they fade
    for (let i = 0; i < steps; i++) {
      g.rect(0, -BAR_FADE + (BAR_FADE * i) / steps, screen.width, BAR_FADE / steps + 0.5).fill({ color: ROLE.surface, alpha: (i + 0.5) / steps });
    }
    g.rect(0, 0, screen.width, barHeight + 200).fill({ color: ROLE.surface, alpha: 1 });
  }, [barHeight, screen.width]);

  // The run's facts as one ledger: where it ended, how much board was left,
  // how many maps it cleared. Arena remaining is only meaningful on a win; on
  // a loss the number says nothing about the run, so the row is dropped.
  const facts: LedgerRow[] = [
    { label: isWin ? t("result.completedLevel") : t("result.failedAtLevel"), value: String(levelNumber), tone: "note" },
    { label: levelId, tone: "note" },
    ...(isWin ? [{ label: t("result.arenaRemaining"), value: `${remainingPercent}%`, tone: "note" as const }] : []),
    ...(runLevelsCompleted > 0 ? [{ label: t("result.levelsCompleted"), value: String(runLevelsCompleted), tone: "note" as const }] : []),
  ];

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: ROLE.surface }}>
      {/* The recap. Centred with auto margins rather than justify-center: a
          centred column that overflows puts its own top out of reach, and the
          top of this one is the outcome. */}
      <ScrollView layout={{ flex: 1, alignItems: "center", paddingLeft: 16, paddingRight: 16, paddingTop: 24, paddingBottom: 12 + barHeight + (barHeight > 0 ? BAR_FADE : 0) }}>
        <Appear fromY={8} duration={0.3}
          layout={{ width: columnWidth, gap: 20, marginTop: "auto", marginBottom: "auto" }}>
          {/* The outcome, then the one big figure: the overtime the run banked
              when it banked any, otherwise the level it reached. */}
          <View layout={{ gap: 12 }}>
            <IconLine icon={isWin ? Trophy : Skull} iconColor={tone} iconSize={20} gap={8}
              text={isWin ? t("result.youWin") : t("result.gameOver")} size={TEXT.lg} font="display" weight="700" color={tone} />
            {ladder
              ? <Headline value={result.totalScore ?? 0} unit="h" caption={t("result.bankedOvertime")} />
              : <Headline value={String(levelNumber)} caption={isWin ? t("result.completedLevel") : t("result.failedAtLevel")} />}
            {completedAllLevels && (
              <Label text={t("result.completedAllLevels")} size={TEXT.base} font="display" color={COLOR.primary} wrap />
            )}
          </View>

          {/* Ascension summary */}
          {!!ascensionDepth && ascensionDepth > 0 && (
            <Appear fromY={10} delay={0.1} layout={{ alignSelf: "stretch", gap: 4 }}>
              <IconLine icon={ArrowUpCircle} iconColor={TW.peer} iconSize={20} gap={8}
                text={t("result.ascensionDepth", { depth: ascensionDepth })} size={TEXT.base} font="display" weight="700" color={TW.peer} />
              {loadoutNames && loadoutNames.length > 0 && (
                <Label text={t("result.loadoutsBraved", { loadouts: loadoutNames.join(" · ") })} size={TEXT.xs} color={ROLE.muted} wrap />
              )}
            </Appear>
          )}

          {/* New loadout unlocks */}
          {newlyUnlockedLoadouts.length > 0 && (
            <Appear fromY={10} delay={0.15} layout={{ alignSelf: "stretch", gap: 4 }}>
              <IconLine icon={Backpack} iconColor={COLOR.primary} iconSize={18} gap={8}
                text={t("result.newLoadoutsUnlocked")} size={TEXT.sm} font="display" weight="700" color={COLOR.primary} />
              <Label text={newlyUnlockedLoadouts.join(" · ")} size={TEXT.sm} color={ROLE.ink} wrap />
            </Appear>
          )}

          {/* Stats */}
          <Appear fromY={10} delay={0.2} layout={{ alignSelf: "stretch", gap: 12 }}>
            {/* Why. A run that ends on a win condition the player never saw stated
                is the same silent loss the in-map overlay exists to prevent. */}
            {!isWin && failure && (
              <View layout={{ alignSelf: "stretch", borderRadius: RADIUS.sm, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: tint(DANGER, 0.1), borderWidth: 1, borderColor: tint(DANGER, 0.3) }}>
                <Label text={failHeadline(t, failure)} size={TEXT.sm} weight="600" color={DANGER} wrap layout={{ marginBottom: 4 }} />
                {lines.length > 0 && (
                  <>
                    <Label text={t("mapFailure.stillNeeded")} size={TEXT.xs} color={ROLE.muted} upper letterSpacing={0.6} layout={{ marginTop: 8, marginBottom: 4 }} />
                    <View layout={{ gap: 2 }}>
                      {lines.map((line, i) => <Label key={i} text={line} size={TEXT.sm} wrap />)}
                    </View>
                  </>
                )}
              </View>
            )}

            <Ledger accent={tone} rows={facts} />

            {/* Certificate hours earned */}
            {runHoursAwarded > 0 && (
              <IconLine icon={HEXAGON_FILLED} iconColor={ROLE.hours} iconSize={20} gap={8}
                text={t("result.certificateHours", { count: runHoursAwarded })} size={TEXT.lg} font="display" weight="700" color={ROLE.hours} />
            )}
          </Appear>

          {/* Ladder placement (HIGHSCORES.md): the run's banked overtime and where
              it landed on the all-time Top 10, with the near-miss gap printed as
              the next target. */}
          {ladder && (
            <Appear fromY={10} delay={0.45} layout={{ alignSelf: "stretch", gap: 4, paddingTop: 16 }}>
              <TopRule />
              {ladder.newBestText && (
                <IconLine icon={Medal} iconColor={TW.gold} text={ladder.newBestText} size={TEXT.sm} weight="700" color={TW.gold} />
              )}
              {ladder.rankText && <Label text={ladder.rankText} size={TEXT.sm} weight="700" color={TW.gold} wrap />}
              {ladder.gapToNextText && <Label text={ladder.gapToNextText} size={TEXT.xs} color={ROLE.muted} wrap />}
              {ladder.gapToTop10Text && <Label text={ladder.gapToTop10Text} size={TEXT.xs} color={ROLE.muted} wrap />}
              {/* Employee of the Month: the monthly crown can be won even when the
                  all-time Top 10 is out of reach (the comeback ladder). */}
              {ladder.monthBestText && (
                <IconLine icon={Award} iconColor={TW.peer} text={ladder.monthBestText} size={TEXT.sm} weight="700" color={TW.peer} />
              )}
              {/* Daily Stand-up: today's best + the attendance streak. */}
              {ladder.dayBestText && (
                <IconLine icon={CalendarDays} iconColor={DAILY} text={ladder.dayBestText} size={TEXT.sm} weight="700" color={DAILY} />
              )}
              {ladder.streakText && (
                <IconLine icon={Flame} iconColor={TW.peer} iconSize={14} gap={4}
                  text={ladder.streakText} size={TEXT.xs} color={ROLE.muted} />
              )}
              {ladder.epitaphText && <Label text={ladder.epitaphText} size={TEXT.xs} color={ROLE.muted} wrap />}
            </Appear>
          )}

          {/* Build recap: what this run WAS. Name the build from its archetype
              lean, credit the capstone, and celebrate a per-archetype best. */}
          {recap && (
            <Appear fromY={10} delay={0.5} layout={{ alignSelf: "stretch", gap: 8, paddingTop: 16 }}>
              <TopRule />
              <Label text={t("buildRecap.heading")} size={TEXT.xs} color={ROLE.muted} />
              <Label text={recap.buildLine} size={TEXT.xl} font="display" weight="700" color={ROLE.ink} wrap />
              {recap.chips.length > 0 && (
                <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignSelf: "stretch" }}>
                  {recap.chips.map(({ tag, count }) => (
                    <TagChip key={tag} tag={tag} pill sizeClass="text-[10px]" suffix={String(count)} />
                  ))}
                </View>
              )}
              {recap.capstoneText && (
                <IconLine icon={Award} iconColor={COLOR.primary} text={recap.capstoneText} size={TEXT.sm} />
              )}
              {recap.recordText && (
                <IconLine icon={Medal} iconColor={TW.yellow400} text={recap.recordText} size={TEXT.sm} weight="700" color={TW.yellow400} />
              )}
              {recap.bestSoFarText && <Label text={recap.bestSoFarText} size={TEXT.xs} color={ROLE.muted} wrap />}
            </Appear>
          )}

          {/* The DETOURS: the ladder, the share card and the menu are all
              "instead of playing", so they end the recap they belong to and the
              pinned bar below stays one decision deep. */}
          <Appear fromY={20} delay={0.55} layout={{ alignSelf: "stretch", marginTop: 8, gap: 12 }}>
            {detours.map(detour)}
          </Appear>
        </Appear>
      </ScrollView>

      {/* PLAY AGAIN, always on screen. Only the run-continuation choice lives
          here, and at most two buttons of it: a bar deep enough to hold every
          action would take a third of a phone and letterbox the recap. No bar
          at all when there is no way to play on. */}
      {pinned.length > 0 && (
        <Appear fromY={20} delay={0.55}
          layout={{ position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingLeft: 16, paddingRight: 16, paddingBottom: 24, paddingTop: 16 }}>
          <View layout={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
            <pixiGraphics draw={drawFade} />
          </View>
          <View layout={{ width: columnWidth, gap: 12 }}>
            {pinned.map(a => (
              <ArcadeButton key={a.kind} variant={a.variant} icon={RotateCcw} text={a.text}
                onTap={() => (a.kind === "restart" ? onRestart?.() : onPlayAgain?.())} />
            ))}
          </View>
        </Appear>
      )}
    </View>
  );
}
