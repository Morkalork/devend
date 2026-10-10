/**
 * The post-map overlay (canvas port of components/game/LevelCompleteOverlay.tsx).
 *
 * What it shows is worked out in levelCompleteModel.ts, where the reasoning
 * for every number lives; this file draws it and keeps the staging: the card
 * springs in, the header, stats, certificates and Continue button arrive in a
 * stagger, both overtime figures count up once the card has landed, and the
 * Continue button stays disabled until the dissolve behind it has finished.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Trophy, ArrowRight, Sparkles, TrendingUp, TrendingDown, Target, Clock, Medal, Info, ChevronDown, ChevronUp, Users, CodeXml,
} from "lucide-react";
import type { LevelScoreData } from "@/types/game";
import type { Certificate } from "@/types/certificate";
import { contentText } from "@/i18n/content";
import type { PressHandlers } from "../kit/ui";
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { PerformanceReviewAxes } from "./PerformanceReviewAxes";
import { ArcadeButton } from "./resultParts";
import { Between, StatInfoModal, StatRow } from "./levelCompleteParts";
import { SUCCESS, TW, levelCompleteModel } from "./levelCompleteModel";
import { useCountUp } from "./resultMotion";

interface LevelCompleteOverlayProps {
  scoreData: LevelScoreData;
  totalScore: number;
  onContinue: () => void;
  accentColor?: string;
  /** ms to wait before enabling the Continue button (lets the dissolve animation finish) */
  buttonDelay?: number;
  /** Certs newly unlocked this level — shown before the Continue button */
  newlyUnlockedCerts?: Certificate[];
  /**
   * Record Pace (HIGHSCORES.md): cumulative-overtime delta vs the best run at
   * the same maps-completed point, plus the once-per-run PB banner flag.
   */
  /** The one-time personal-best banner. Record Pace used to ride in here
   *  too; see useGameSession for why it was taken out. */
  pace?: { newPersonalBest: boolean } | null;
}

export function LevelCompleteOverlay({ scoreData, totalScore, onContinue, accentColor, buttonDelay = 900, newlyUnlockedCerts, pace }: LevelCompleteOverlayProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  // Tailwind's `sm:` breakpoint: the card and its type grow a step on a wide screen.
  const sm = screen.width >= 640;
  const [chosen, setChosen] = useState(false);
  const [buttonReady, setButtonReady] = useState(buttonDelay === 0);
  // Stat row whose info card is open via press-and-hold (450ms hold, moving
  // the finger cancels it so a scroll that starts on a row does not open it).
  const [infoKey, setInfoKey] = useState<string | null>(null);
  // Itemised breakdown, collapsed by default. Every new scoring mechanic adds a
  // row here and none are ever removed, so the screen grew without bound; the
  // totals below it are fixed-size and stay out of the fold.
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [displayLevelScore, displayTotalScore] = useCountUp(scoreData.levelScore, totalScore);

  const hold = useCallback((key: string): PressHandlers => ({ onHold: () => setInfoKey(key) }), []);

  useEffect(() => {
    if (buttonDelay <= 0) return;
    const timer = setTimeout(() => setButtonReady(true), buttonDelay);
    return () => clearTimeout(timer);
  }, [buttonDelay]);

  const m = levelCompleteModel(scoreData, t);
  const { levelNumber, levelId, remainingPercent, performanceMultiplier = 1, axes, lockedBallsCount = 0 } = scoreData;
  const accent = accentColor ? hex(accentColor) : COLOR.primary;
  const fs = sm ? TEXT.base : TEXT.sm;
  const rowY = sm ? 8 : 6;
  const cardWidth = sm ? 420 : screen.width - 32;
  const gold = TW.gold;

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
      {/* Backdrop. A Pressable with no handlers so the board below takes no touches. */}
      <Appear duration={0.25} layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
        <Pressable pressedAlpha={1} layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.3) }} />
      </Appear>

      {/* Modal container: centred on every breakpoint, so the card sits with
          even space above and below instead of pinned to the bottom edge. */}
      <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, padding: 16, alignItems: "center", justifyContent: "center" }}>
        <Appear fromY={55} fromScale={0.96} duration={0.35} layout={{ width: cardWidth, maxHeight: screen.height - 32 }}>
          <ScrollView layout={{ flexShrink: 1 }}>
            <View layout={{
              backgroundColor: tint(COLOR.card, 0.6), borderColor: COLOR.border, borderWidth: 1, borderRadius: RADIUS.xl,
              padding: sm ? 24 : 16,
            }}>
              {/* Header */}
              <Appear fromY={-8} delay={0.12} duration={0.22}
                layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sm ? 12 : 8, marginBottom: sm ? 24 : 16 }}>
                <View layout={{ width: sm ? 48 : 40, height: sm ? 48 : 40, borderRadius: RADIUS.full, backgroundColor: tint(SUCCESS, 0.2), alignItems: "center", justifyContent: "center" }}>
                  <Icon icon={Trophy} size={sm ? 24 : 20} color={SUCCESS} />
                </View>
                <View layout={{ flexShrink: 1 }}>
                  <Label text={t("levelComplete.title")} size={sm ? TEXT["2xl"] : TEXT.xl} font="display" weight="700" />
                  <Label text={levelId} size={sm ? TEXT.sm : TEXT.xs} color={COLOR.mutedForeground} />
                  {/* Which condition actually ended the map. Only a space clear opens
                      the Push Your Luck prompt, so without this its coming and
                      going reads as random. */}
                  {m.winReason && (
                    <View layout={{ flexDirection: "row", gap: 4, marginTop: 2 }}>
                      <Label text={`${m.winReason.label}:`} size={sm ? TEXT.xs : 11} color={SUCCESS} alpha={0.9} />
                      <Label text={m.winReason.reason} size={sm ? TEXT.xs : 11} color={SUCCESS} alpha={0.9} weight="600" />
                      {m.winReason.also && <Label text={m.winReason.also} size={sm ? TEXT.xs : 11} color={COLOR.mutedForeground} />}
                    </View>
                  )}
                </View>
              </Appear>

              {/* Push Failed Warning */}
              {m.pushFailedText && (
                <View layout={{ marginBottom: 16, padding: 12, borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.amber, 0.1), borderColor: tint(COLOR.amber, 0.3), borderWidth: 1 }}>
                  <Label text={m.pushFailedText} size={TEXT.sm} weight="500" color={COLOR.amber} align="center" wrap />
                </View>
              )}

              {/* Stats */}
              <Appear delay={0.2} duration={0.28} layout={{ gap: sm ? 12 : 8, marginBottom: sm ? 24 : 16 }}>
                {/* Breakdown toggle. The bonus subtotal rides on the header so the
                    collapsed state still answers "was this map worth anything?". */}
                <Pressable onTap={() => setBreakdownOpen(open => !open)} label="breakdown"
                  layout={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 8, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLOR.border }}>
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Icon icon={Target} size={14} color={COLOR.mutedForeground} />
                    <Label text={t("levelComplete.breakdownTitle")} size={TEXT.sm} color={COLOR.mutedForeground} />
                  </View>
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {m.subtotalText && <Label text={m.subtotalText} size={TEXT.sm} weight="700" color={SUCCESS} />}
                    <Icon icon={breakdownOpen ? ChevronUp : ChevronDown} size={16} color={COLOR.mutedForeground} />
                  </View>
                </Pressable>

                {breakdownOpen && (
                  <Appear duration={0.22} fromY={-6} layout={{ gap: sm ? 12 : 8 }}>
                    <StatRow handlers={hold("level")} paddingY={rowY}>
                      <Between
                        left={<Label text={t("levelComplete.level")} size={fs} color={COLOR.mutedForeground} />}
                        right={<Label text={String(levelNumber)} size={fs} weight="700" />} />
                    </StatRow>

                    {/* Remaining space is meaningless on an all-balls-locked auto-win:
                        the board fully drains to 0% once no ball is left in play. */}
                    {m.showRemaining && (
                      <StatRow handlers={hold("remaining")} paddingY={rowY}>
                        <Between
                          left={<Label text={t("levelComplete.remaining")} size={fs} color={COLOR.mutedForeground} />}
                          right={<Label text={`${remainingPercent}%`} size={fs} weight="700" />} />
                      </StatRow>
                    )}

                    {/* FLAWLESS. Above the axes because it is a verdict on the run, not
                        a line item in it: the axes say which lanes you took, this says
                        you left nothing behind in the one lane with no trade-off. */}
                    {m.flawless && (
                      <Appear delay={0.35} fromScale={0.9} duration={0.3}
                        layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, marginBottom: 8, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: tint(gold, 0x66 / 255), backgroundColor: tint(gold, 0x14 / 255) }}>
                        <Icon icon={Sparkles} size={16} color={gold} />
                        <Label text={t("levelComplete.flawless")} size={TEXT.sm} font="display" weight="900" upper letterSpacing={1.4} color={gold} glow={12} />
                        <Label text={t("levelComplete.flawlessDetail", { count: lockedBallsCount })} size={TEXT.xs} color={gold} alpha={0.75} />
                      </Appear>
                    )}

                    {/* The Performance Review: which lanes this run committed to. Above
                        the itemised hours because it is the frame they are read in. */}
                    {axes && <PerformanceReviewAxes axes={axes} hold={hold} />}

                    {/* Fence efficiency */}
                    <StatRow handlers={hold("fencesUsed")} paddingY={8}>
                      <Between layout={{ marginBottom: 4 }}
                        left={<>
                          <Icon icon={Target} size={12} color={COLOR.mutedForeground} />
                          <Label text={t("levelComplete.fencesUsed")} size={fs} color={COLOR.mutedForeground} />
                        </>}
                        right={<Label text={m.fencesText} size={fs} weight="700" />} />
                      {m.underPar && (
                        <Between layout={{ marginTop: 4 }}
                          left={<>
                            <Icon icon={TrendingUp} size={12} color={SUCCESS} />
                            <Label text={m.underPar.text} size={TEXT.sm} color={SUCCESS} />
                          </>}
                          right={<Label text={m.underPar.bonusText} size={TEXT.sm} weight="700" color={SUCCESS} />} />
                      )}
                      {m.overPar && (
                        <Between layout={{ marginTop: 4 }}
                          left={<>
                            <Icon icon={TrendingDown} size={12} color={COLOR.destructive} />
                            <Label text={m.overPar.text} size={TEXT.sm} color={COLOR.destructive} />
                          </>}
                          right={<Label text={m.overPar.multiplierText} size={TEXT.xs} color={COLOR.destructive} />} />
                      )}
                    </StatRow>

                    {/* Space optimisation */}
                    {m.space && (
                      <StatRow handlers={hold("spaceBonus")} paddingY={8}>
                        <Between layout={{ marginBottom: 4 }}
                          left={<>
                            <Icon icon={Sparkles} size={12} color={COLOR.mutedForeground} />
                            <Label text={t("levelComplete.extraSpaceRemoved")} size={fs} color={COLOR.mutedForeground} />
                          </>}
                          right={<Label text={m.space.extraText} size={fs} weight="700" />} />
                        <Between
                          left={<Label text={t("levelComplete.spaceBonus")} size={TEXT.sm} color={m.space.disabled ? COLOR.destructive : COLOR.primary} />}
                          right={
                            <View>
                              <Label text={m.space.valueText} size={TEXT.sm} weight="700" color={m.space.disabled ? COLOR.destructive : COLOR.primary} />
                              {/* line-through: the bonus the over-par fences forfeited */}
                              {m.space.disabled && <View layout={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: COLOR.destructive }} />}
                            </View>
                          } />
                      </StatRow>
                    )}

                    {/* One list, one idiom: the base the scorer actually used, the
                        lanes with what each could have paid (above), anything earned
                        OUTSIDE those lanes, then the fraction. The old itemised rows
                        restated the axes' hours in a second vocabulary. */}
                    <StatRow handlers={hold("baseOvertime")} paddingY={rowY}>
                      <Between
                        left={<>
                          <Icon icon={Clock} size={12} color={COLOR.mutedForeground} />
                          <Label text={t("levelComplete.baseOvertime")} size={fs} color={COLOR.mutedForeground} />
                          {m.isOverPar && <Label text={t("levelComplete.multiplierParen", { multiplier: performanceMultiplier })} size={TEXT.xs} color={COLOR.destructive} />}
                        </>}
                        right={<Label text={`${m.paidBase}h`} size={fs} weight="700" color={m.isOverPar ? COLOR.destructive : COLOR.foreground} />} />
                    </StatRow>

                    {/* That a zone was TAKEN. The hours are already in Engagement and
                        deliberately not repeated; what was missing was the
                        acknowledgement. A count, not hours, naming the denominator so
                        "one zone left" is visible while the map is worth replaying. */}
                    {m.zonesSealedText && (
                      <StatRow paddingY={rowY}>
                        <Between
                          left={<>
                            <Icon icon={CodeXml} size={12} color={TW.fuchsia300} />
                            <Label text={t("levelComplete.zonesSealed")} size={fs} color={COLOR.mutedForeground} />
                          </>}
                          right={<Label text={m.zonesSealedText} size={fs} weight="700" color={TW.fuchsia300} />} />
                      </StatRow>
                    )}

                    {/* Who drew what, for a pair. Absent solo. */}
                    {scoreData.fencesByPlayer && (
                      <StatRow paddingY={rowY}>
                        <Between
                          left={<>
                            <Icon icon={Users} size={12} color={COLOR.primary} />
                            <Label text={t("pair.fencesDrawn")} size={fs} color={COLOR.mutedForeground} />
                          </>}
                          right={<>
                            <Label text={String(scoreData.fencesByPlayer[0])} size={fs} weight="700" color={COLOR.primary} />
                            <Label text=" / " size={fs} weight="700" color={COLOR.mutedForeground} />
                            <Label text={String(scoreData.fencesByPlayer[1])} size={fs} weight="700" color={TW.peer} />
                          </>} />
                      </StatRow>
                    )}

                    {/* What skipping the colored areas cost: a share off everything above. */}
                    {m.zonesMissedCost > 0 && (
                      <StatRow paddingY={rowY}>
                        <Between
                          left={<>
                            <Icon icon={CodeXml} size={12} color={COLOR.mutedForeground} />
                            <Label text={t("levelComplete.zonesMissed")} size={fs} color={COLOR.mutedForeground} />
                          </>}
                          right={<Label text={`-${m.zonesMissedCost}h`} size={fs} weight="700" color={COLOR.destructive} />} />
                      </StatRow>
                    )}

                    {/* Score: x / y - what you took of what this map could pay. Both
                        ends come from the scorer. */}
                    <StatRow handlers={hold("totalBonus")} paddingY={sm ? 12 : 8} rule={false}
                      layout={{ backgroundColor: tint(SUCCESS, 0.1), borderRadius: RADIUS.lg, paddingLeft: sm ? 12 : 8, paddingRight: sm ? 12 : 8 }}>
                      <Between
                        left={<Label text={t("levelComplete.scoreOutOf")} size={fs} weight="600" />}
                        right={<>
                          <Label text={m.scoreEarnedText} size={sm ? TEXT.xl : TEXT.lg} weight="700" color={SUCCESS} />
                          <Label text={` ${m.scoreAvailableText}`} size={sm ? TEXT.xl : TEXT.lg} weight="700" color={COLOR.mutedForeground} />
                        </>} />
                    </StatRow>

                    {/* Paid ON TOP of the map's own lanes, so below the Score they are
                        paid on top of. Read down the column and you reach the payout;
                        that was the whole of #79. */}
                    {m.onTopRows.map(row => (
                      <StatRow key={row.key} handlers={hold(row.key)} paddingY={rowY}>
                        <Between
                          left={<>
                            <Icon icon={Clock} size={12} color={row.color} />
                            <Label text={row.label} size={fs} color={row.color} />
                          </>}
                          right={<Label text={`+${row.hours}h`} size={fs} weight="700" color={row.color} />} />
                      </StatRow>
                    ))}

                    {m.capRaise > 0 && (
                      <StatRow handlers={hold("capBonus")} paddingY={rowY}>
                        <Between
                          left={<>
                            <Icon icon={Clock} size={12} color={COLOR.mutedForeground} />
                            <Label text={t("levelComplete.capBonus")} size={fs} color={COLOR.mutedForeground} />
                          </>}
                          right={<Label text={t("levelComplete.capBonusValue", { hours: m.capRaise })} size={fs} weight="700" color={COLOR.primary} />} />
                      </StatRow>
                    )}

                    {/* The backstop, when it actually took something. Silent otherwise. */}
                    {m.clipped > 0 && (
                      <StatRow paddingY={rowY}>
                        <Between
                          left={<>
                            <Icon icon={TrendingDown} size={12} color={COLOR.mutedForeground} />
                            <Label text={t("levelComplete.overCap")} size={fs} color={COLOR.mutedForeground} />
                          </>}
                          right={<Label text={`-${m.clipped}h`} size={fs} weight="700" color={COLOR.destructive} />} />
                      </StatRow>
                    )}
                  </Appear>
                )}

                <StatRow handlers={hold("overtimeEarned")} paddingY={sm ? 12 : 8} rule={false}
                  layout={{ backgroundColor: tint(COLOR.primary, 0.1), borderRadius: RADIUS.lg, paddingLeft: sm ? 12 : 8, paddingRight: sm ? 12 : 8 }}>
                  <Between
                    left={<Label text={t("levelComplete.overtimeEarned")} size={fs} weight="600" />}
                    right={<>
                      <Label text={String(displayLevelScore)} size={sm ? TEXT["2xl"] : TEXT.xl} weight="700" color={COLOR.primary} />
                      {m.overtimeSuffix && (
                        <Label text={` ${m.overtimeSuffix}`} size={sm ? TEXT.lg : TEXT.base} color={COLOR.mutedForeground} layout={{ marginBottom: 2 }} />
                      )}
                      <Label text="h" size={sm ? TEXT["2xl"] : TEXT.xl} weight="700" color={COLOR.primary} />
                    </>} />
                </StatRow>

                {/* Total Overtime: the grand running total and the hero number of
                    this screen, in the live accent with a glow so it reads as the
                    focal point. */}
                <StatRow handlers={hold("totalOvertime")} paddingY={sm ? 16 : 12} rule={false}
                  layout={{
                    borderRadius: RADIUS.lg, paddingLeft: sm ? 16 : 12, paddingRight: sm ? 16 : 12, borderWidth: 1,
                    backgroundColor: tint(accent, accentColor ? 0x22 / 255 : 0.15),
                    borderColor: tint(accent, accentColor ? 0x66 / 255 : 0.4),
                  }}>
                  <Between
                    left={<Label text={t("levelComplete.totalOvertime")} size={sm ? TEXT.lg : TEXT.base} weight="700" />}
                    right={<Label text={`${displayTotalScore}h`} size={sm ? TEXT["3xl"] : TEXT["2xl"]} weight="800" color={accent} glow={16} />} />
                </StatRow>

                {/* Once per run: the moment the total passes the all-time best. */}
                {pace?.newPersonalBest && (
                  <Appear delay={0.35} fromScale={0.92} duration={0.3}
                    layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 10, paddingBottom: 10, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: tint(gold, 0x66 / 255), backgroundColor: tint(gold, 0x1a / 255) }}>
                    <Icon icon={Medal} size={16} color={gold} />
                    <Label text={t("levelComplete.newPersonalBest")} size={TEXT.sm} weight="700" color={gold} glow={12} />
                  </Appear>
                )}

                <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 4 }}>
                  <Icon icon={Info} size={12} color={COLOR.mutedForeground} alpha={0.7} />
                  <Label text={t("levelComplete.holdHint")} size={11} color={COLOR.mutedForeground} alpha={0.7} />
                </View>
              </Appear>

              {/* Newly unlocked certificates */}
              {newlyUnlockedCerts && newlyUnlockedCerts.length > 0 && (
                <Appear delay={0.32} duration={0.22} layout={{ marginBottom: 16, gap: 8 }}>
                  {newlyUnlockedCerts.map(cert => (
                    <View key={cert.id} layout={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: tint(TW.yellow500, 0.4), backgroundColor: tint(TW.yellow500, 0.1) }}>
                      <Icon icon={Medal} size={16} color={TW.yellow400} />
                      <View layout={{ flex: 1 }}>
                        <Label text={t("levelComplete.certificateUnlocked")} size={TEXT.xs} weight="700" color={TW.yellow400} upper letterSpacing={0.6} />
                        <Label text={contentText.certName(t, cert)} size={TEXT.sm} weight="600" wrap />
                      </View>
                    </View>
                  ))}
                </Appear>
              )}

              {/* Continue */}
              <Appear fromY={10} delay={0.38} duration={0.22}>
                <ArcadeButton
                  text={t("levelComplete.nextLevel")}
                  icon={ArrowRight}
                  iconAfter
                  iconSize={sm ? 20 : 16}
                  size={sm ? TEXT.base : TEXT.sm}
                  paddingY={sm ? 12 : 8}
                  disabled={chosen || !buttonReady}
                  onTap={() => { setChosen(true); onContinue(); }}
                />
              </Appear>
            </View>
          </ScrollView>
        </Appear>
      </View>

      <StatInfoModal infoKey={infoKey} accent={accentColor ? accent : undefined} onClose={() => setInfoKey(null)} />
    </View>
  );
}
