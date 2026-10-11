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
 * The CRT backdrop the DOM screen drew behind itself is rendered once,
 * globally, under the interface canvas; this screen keeps the DOM's 90% wash
 * over it.
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
import { Appear, COLOR, Icon, Label, ScrollView, TEXT, View, RADIUS, iconNodeOf, tint, useUiScreen, type IconNode, type IconSource, type Layout } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { ArcadeButton } from "./betweenArcadeButton";
import { RichParagraph } from "./draftParts";
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

/** A border-t rule across the top of a block. */
function TopRule() {
  return <View layout={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: COLOR.border }} />;
}

/**
 * A centred icon + text line (`flex items-center justify-center gap-*`) that
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
      <RichParagraph {...look} color={look.color ?? COLOR.foreground} runs={[{ text }]}
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
  const columnWidth = Math.min(448, screen.width - 48);

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

  // The soft glow behind the outcome (a 600px blurred disc in the DOM): rings
  // of the tone that thicken toward the middle stand in for the blur.
  const drawGlow = useCallback((g: Graphics) => {
    g.clear();
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      g.circle(300, 300, 330 - i * 10).fill({ color: tone, alpha: 0.1 / steps });
    }
  }, [tone]);

  // The pinned bar's own height (padding + buttons + gaps): the recap scrolls
  // under it, so it also pads the recap's end clear of the buttons.
  const barHeight = pinned.length > 0 ? 16 + 24 + pinned.length * 52 + (pinned.length - 1) * 12 : 0;
  // The gradient is doing work, not decoration: the bar sits OVER the end of
  // the scrolling recap and fades it out, so a screen with more below reads as
  // scrollable rather than finished. Clear for its top 45%, solid below.
  const drawFade = useCallback((g: Graphics) => {
    g.clear();
    const fadeTo = barHeight * 0.45;
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      g.rect(0, (fadeTo * i) / steps, screen.width, fadeTo / steps + 0.5).fill({ color: COLOR.background, alpha: (i + 0.5) / steps });
    }
    g.rect(0, fadeTo, screen.width, barHeight - fadeTo + 200).fill({ color: COLOR.background, alpha: 1 });
  }, [barHeight, screen.width]);

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9) }}>
      {/* Background effect */}
      <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, overflow: "hidden" }}>
        <Appear fromScale={0} duration={1}
          layout={{ position: "absolute", left: screen.width / 2 - 300, top: screen.height / 2 - 300, width: 600, height: 600 }}>
          <pixiGraphics draw={drawGlow} />
        </Appear>
      </View>

      {/* The recap. Centred with auto margins rather than justify-center: a
          centred column that overflows puts its own top out of reach, and the
          top of this one is the word GAME OVER. */}
      <ScrollView layout={{ flex: 1, alignItems: "center", paddingLeft: 24, paddingRight: 24, paddingTop: 24, paddingBottom: 12 + barHeight }}>
        <Appear fromScale={0.9} duration={0.5}
          layout={{ width: columnWidth, alignItems: "center", gap: 20, marginTop: "auto", marginBottom: "auto" }}>
          {/* Icon */}
          <Appear fromScale={0} delay={0.2} duration={0.5}
            layout={{ width: 80, height: 80, borderRadius: RADIUS.full, alignItems: "center", justifyContent: "center", backgroundColor: tint(tone, 0.2), borderWidth: 2, borderColor: tone }}>
            <Icon icon={isWin ? Trophy : Skull} size={40} color={tone} />
          </Appear>

          {/* Title */}
          <Appear fromY={20} delay={0.3} layout={{ alignSelf: "stretch" }}>
            <Label text={isWin ? t("result.youWin") : t("result.gameOver")} size={screen.width >= 768 ? TEXT["4xl"] : TEXT["3xl"]}
              font="display" weight="900" letterSpacing={screen.width >= 768 ? 1.8 : 1.5} color={tone} glow={30} wrap align="center" />
          </Appear>

          {/* Completed all levels message */}
          {completedAllLevels && (
            <Appear fromY={10} delay={0.35} layout={{ alignSelf: "stretch" }}>
              <Label text={t("result.completedAllLevels")} size={TEXT["2xl"]} font="display" color={COLOR.primary} align="center" wrap />
            </Appear>
          )}

          {/* Ascension summary */}
          {!!ascensionDepth && ascensionDepth > 0 && (
            <Appear fromY={10} delay={0.4} layout={{ alignSelf: "stretch", alignItems: "center" }}>
              <IconLine icon={ArrowUpCircle} iconColor={TW.peer} iconSize={24} gap={8} layout={{ marginBottom: 4 }}
                text={t("result.ascensionDepth", { depth: ascensionDepth })} size={TEXT.xl} font="display" weight="700" color={TW.peer} glow={16} />
              {loadoutNames && loadoutNames.length > 0 && (
                <Label text={t("result.loadoutsBraved", { loadouts: loadoutNames.join(" · ") })} size={TEXT.xs} color={COLOR.mutedForeground} align="center" wrap />
              )}
            </Appear>
          )}

          {/* New loadout unlocks */}
          {newlyUnlockedLoadouts.length > 0 && (
            <Appear fromY={10} delay={0.45} layout={{ alignSelf: "stretch", alignItems: "center", gap: 4 }}>
              <IconLine icon={Backpack} iconColor={COLOR.primary} iconSize={20} gap={8}
                text={t("result.newLoadoutsUnlocked")} size={TEXT.sm} font="display" weight="700" color={COLOR.primary} upper letterSpacing={0.7} />
              <Label text={newlyUnlockedLoadouts.join(" · ")} size={TEXT.sm} align="center" wrap />
            </Appear>
          )}

          {/* Stats */}
          <Appear fromY={20} delay={0.4} layout={{ alignSelf: "stretch", alignItems: "center", gap: 16 }}>
            <View layout={{ alignItems: "center" }}>
              <Label text={isWin ? t("result.completedLevel") : t("result.failedAtLevel")} size={TEXT.sm} color={COLOR.mutedForeground} upper letterSpacing={0.7}
                layout={{ marginBottom: 4 }} />
              <Label text={String(levelNumber)} size={TEXT["3xl"]} font="display" weight="700" />
              <Label text={levelId} size={TEXT.xs} color={COLOR.mutedForeground} layout={{ marginTop: 4 }} />
            </View>

            {/* Why. A run that ends on a win condition the player never saw stated
                is the same silent loss the in-map overlay exists to prevent. */}
            {!isWin && failure && (
              <View layout={{ alignSelf: "stretch", borderRadius: RADIUS.lg, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: tint(DANGER, 0.1), borderWidth: 1, borderColor: tint(DANGER, 0.3) }}>
                <Label text={failHeadline(t, failure)} size={TEXT.sm} weight="600" color={DANGER} wrap layout={{ marginBottom: 4 }} />
                {lines.length > 0 && (
                  <>
                    <Label text={t("mapFailure.stillNeeded")} size={TEXT.xs} color={COLOR.mutedForeground} upper letterSpacing={0.6} layout={{ marginTop: 8, marginBottom: 4 }} />
                    <View layout={{ gap: 2 }}>
                      {lines.map((line, i) => <Label key={i} text={line} size={TEXT.sm} wrap />)}
                    </View>
                  </>
                )}
              </View>
            )}

            {/* Arena remaining is only meaningful on a win; on a loss the number
                says nothing about the run, so the row is dropped. */}
            {isWin && (
              <View layout={{ alignItems: "center" }}>
                <Label text={t("result.arenaRemaining")} size={TEXT.sm} color={COLOR.mutedForeground} upper letterSpacing={0.7} layout={{ marginBottom: 4 }} />
                <Label text={`${remainingPercent}%`} size={48} font="display" weight="700" />
              </View>
            )}

            {/* Certificate hours earned */}
            {runLevelsCompleted > 0 && (
              <Appear fromScale={0.9} delay={0.45} layout={{ alignSelf: "stretch", alignItems: "center", marginTop: 16, paddingTop: 16 }}>
                <TopRule />
                <Label text={t("result.levelsCompleted")} size={TEXT.sm} color={COLOR.mutedForeground} upper letterSpacing={0.7} layout={{ marginBottom: 4 }} />
                <Label text={String(runLevelsCompleted)} size={TEXT["3xl"]} font="display" weight="700" layout={{ marginBottom: 8 }} />
                {runHoursAwarded > 0 && (
                  <IconLine icon={HEXAGON_FILLED} iconColor={COLOR.white} iconSize={24} gap={8}
                    text={t("result.certificateHours", { count: runHoursAwarded })} size={TEXT["2xl"]} font="display" weight="700" color={COLOR.white} />
                )}
              </Appear>
            )}
          </Appear>

          {/* Ladder placement (HIGHSCORES.md): the run's banked overtime and where
              it landed on the all-time Top 10, with the near-miss gap printed as
              the next target. */}
          {ladder && (
            <Appear fromY={10} delay={0.45} layout={{ alignSelf: "stretch", alignItems: "center", gap: 4, paddingTop: 16 }}>
              <TopRule />
              <Label text={t("result.bankedOvertime")} size={TEXT.sm} color={COLOR.mutedForeground} upper letterSpacing={0.7} />
              <Label text={ladder.bankedText} size={TEXT["4xl"]} font="display" weight="700" />
              {ladder.newBestText && (
                <IconLine icon={Medal} iconColor={TW.gold} text={ladder.newBestText} size={TEXT.sm} weight="700" color={TW.gold} glow={12} />
              )}
              {ladder.rankText && <Label text={ladder.rankText} size={TEXT.sm} weight="700" color={TW.gold} align="center" wrap />}
              {ladder.gapToNextText && <Label text={ladder.gapToNextText} size={TEXT.xs} color={COLOR.mutedForeground} align="center" wrap />}
              {ladder.gapToTop10Text && <Label text={ladder.gapToTop10Text} size={TEXT.xs} color={COLOR.mutedForeground} align="center" wrap />}
              {/* Employee of the Month: the monthly crown can be won even when the
                  all-time Top 10 is out of reach (the comeback ladder). */}
              {ladder.monthBestText && (
                <IconLine icon={Award} iconColor={TW.peer} text={ladder.monthBestText} size={TEXT.sm} weight="700" color={TW.peer} glow={12} />
              )}
              {/* Daily Stand-up: today's best + the attendance streak. */}
              {ladder.dayBestText && (
                <IconLine icon={CalendarDays} iconColor={DAILY} text={ladder.dayBestText} size={TEXT.sm} weight="700" color={DAILY} glow={12} />
              )}
              {ladder.streakText && (
                <IconLine icon={Flame} iconColor={TW.peer} iconSize={14} gap={4}
                  text={ladder.streakText} size={TEXT.xs} color={COLOR.mutedForeground} />
              )}
              {ladder.epitaphText && <Label text={ladder.epitaphText} size={TEXT.xs} color={COLOR.mutedForeground} align="center" wrap />}
            </Appear>
          )}

          {/* Build recap: what this run WAS. Name the build from its archetype
              lean, credit the capstone, and celebrate a per-archetype best. */}
          {recap && (
            <Appear fromY={10} delay={0.5} layout={{ alignSelf: "stretch", alignItems: "center", gap: 8, paddingTop: 16 }}>
              <TopRule />
              <Label text={t("buildRecap.heading")} size={TEXT.sm} color={COLOR.mutedForeground} upper letterSpacing={0.7} />
              <Label text={recap.buildLine} size={TEXT["2xl"]} font="display" weight="700" align="center" wrap />
              {recap.chips.length > 0 && (
                <View layout={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, alignSelf: "stretch" }}>
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
              {recap.bestSoFarText && <Label text={recap.bestSoFarText} size={TEXT.xs} color={COLOR.mutedForeground} align="center" wrap />}
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
          layout={{ position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingLeft: 24, paddingRight: 24, paddingBottom: 24, paddingTop: 16 }}>
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
