/**
 * The Debrief: the first stage of the between-map pipeline (UI_REDO_PLAN.md),
 * once the post-map overlay.
 *
 * What it shows is worked out in levelCompleteModel.ts, where the reasoning
 * for every number lives; this file draws it inside the PipelineFrame: the
 * map's hours are the headline, the rows arrive in a stagger, both overtime
 * figures count up, and the Continue button, named for the next stage, stays
 * disabled until the dissolve behind the frame has finished.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight, Sparkles, TrendingUp, TrendingDown, Target, Clock, Medal, Info, ChevronDown, ChevronUp, Users, CodeXml,
} from "lucide-react";
import type { LevelScoreData } from "@/types/game";
import type { Certificate } from "@/types/certificate";
import { contentText } from "@/i18n/content";
import type { PressHandlers } from "../kit/ui";
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, ROLE, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { PerformanceReviewAxes } from "./PerformanceReviewAxes";
import { ArcadeButton } from "../kit/ui";
import { Between, StatInfoModal, StatRow } from "./levelCompleteParts";
import { RichParagraph } from "./draftParts";
import { SUCCESS, TW, levelCompleteModel } from "./levelCompleteModel";
import { useCountUp } from "./resultMotion";
import { PipelineFrame } from "./PipelineFrame";
import { continueLabel, samplePlan, type BetweenMapPlan } from "./pipelineModel";
import { AcceptanceTicket } from "../game/AcceptanceTicket";
import { useFillIn } from "../game/fillIn";
import { tutorialCardWidth } from "../game/TutorialOverlayModel";
import { isFullDebrief } from "./debriefMode";

interface LevelCompleteOverlayProps {
  scoreData: LevelScoreData;
  totalScore: number;
  onContinue: () => void;
  accentColor?: string;
  /** ms to wait before enabling the Continue button (lets the dissolve animation finish) */
  buttonDelay?: number;
  /** Certs newly unlocked this level — shown before the Continue button */
  newlyUnlockedCerts?: Certificate[];
  /** The one-time personal-best banner. Record Pace used to ride in here
   *  too; see useGameSession for why it was taken out. */
  pace?: { newPersonalBest: boolean } | null;
  /** The stages between this map and the next; a sample one in the gallery. */
  pipeline?: BetweenMapPlan;
  /** Force the full Debrief (breakdown, axes, totals) or the ticket; default: Admin's choice. */
  full?: boolean;
}

export function LevelCompleteOverlay({ scoreData, totalScore, onContinue, accentColor, buttonDelay = 900, newlyUnlockedCerts, pace, pipeline, full }: LevelCompleteOverlayProps) {
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
  const ticket = !(full ?? isFullDebrief()) && !!scoreData.acceptance;
  // Called whichever card is up (a hook cannot be conditional); only the ticket reads it.
  const fill = useFillIn(ticket ? scoreData.acceptance?.length ?? 0 : 0);

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
  const plan = pipeline ?? samplePlan(levelNumber);
  const gold = TW.gold;

  // `waiting` holds the button disabled while something above it still plays out.
  const renderContinueButton = (waiting: boolean) => (
    <Appear fromY={10} delay={0.38} duration={0.22}>
      <ArcadeButton
        text={continueLabel(plan, "debrief", t)}
        iconAfter={ArrowRight}
        iconSize={sm ? 20 : 16}
        textSize={sm ? TEXT.base : TEXT.sm}
        contentLayout={{ paddingTop: sm ? 12 : 8, paddingBottom: sm ? 12 : 8 }}
        disabled={chosen || !buttonReady || waiting}
        onTap={() => {
          setChosen(true);
          onContinue();
        }}
      />
    </Appear>
  );
  const continueButton = renderContinueButton(false);
  const certificates = newlyUnlockedCerts && newlyUnlockedCerts.length > 0 && (
    <Appear delay={0.32} duration={0.22} layout={{ gap: 8 }}>
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
  );
  const personalBest = pace?.newPersonalBest && (
    <Appear delay={0.35} fromScale={0.92} duration={0.3}
      layout={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 8, paddingRight: 8, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: tint(gold, 0x66 / 255), backgroundColor: tint(gold, 0x1a / 255) }}>
      <RichParagraph runs={[{ text: t("levelComplete.newPersonalBest") }]} size={TEXT.sm} weight="700" color={gold}
        lead={<Icon icon={Medal} size={16} color={gold} />} leadGap={8} />
    </Appear>
  );
  const pushFailed = m.pushFailedText && (
    <View layout={{ padding: 12, borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.amber, 0.1), borderColor: tint(COLOR.amber, 0.3), borderWidth: 1 }}>
      <Label text={m.pushFailedText} size={TEXT.sm} weight="500" color={COLOR.amber} align="center" wrap />
    </View>
  );

  // The ticket: the card the player read before the map, filled in, and only
  // the rare notices beside it. Trying it without the rest (breakdown, axes,
  // totals), which stays below for Admin's "Full debrief" and for a score
  // that predates the marks.
  // The ticket: the card the player read before the map, over the finished
  // board with its overlays still up, filling in a row at a time; then the
  // hours and the way on. The full Debrief (breakdown, axes, totals) stays
  // below for Admin's "Full debrief" and for a score that predates the marks.
  if (ticket && scoreData.acceptance) {
    const cardWidth = tutorialCardWidth(screen.width);
    return (
      <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
        <Appear duration={0.2} layout={{ width: screen.width, height: screen.height }}>
          {/* A light scrim: the board is the backdrop. A tap finishes the fill. */}
          <Pressable onTap={fill.finish} pressedAlpha={1} label="ticket-scrim" layout={{
            width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center",
            padding: 24, backgroundColor: tint(0x000000, 0.5),
          }}>
            <View label="map-ticket" layout={{ width: cardWidth, gap: 12 }}>
              {pushFailed}
              <Appear fromY={12} duration={0.25}>
                <AcceptanceTicket rows={scoreData.acceptance} levelNumber={levelNumber} levelId={levelId}
                  accent={accent} width={cardWidth} filled={fill.filled}
                  estimate={fill.done ? `+${displayLevelScore}h` : undefined} />
              </Appear>
              {fill.done && personalBest}
              {fill.done && certificates}
              {/* Always shown, so the way on is in view from the start; live once the card is filled in. */}
              {renderContinueButton(!fill.done)}
            </View>
          </Pressable>
        </Appear>
      </View>
    );
  }

  return (
    <PipelineFrame
      plan={plan}
      at="debrief"
      accent={accent}
      headline={{
        value: `+${displayLevelScore}`,
        unit: "h",
        caption: m.overtimeIsFull ? t("pipeline.fullPay") : t("pipeline.ofPossible", { hours: m.overtimeCeiling }),
      }}
      overlay={<StatInfoModal infoKey={infoKey} accent={accentColor ? accent : undefined} onClose={() => setInfoKey(null)} />}
    >
      {/* Which map, and which condition actually ended it. Only a space clear
          opens the Push Your Luck prompt, so without this its coming and going
          reads as random. */}
      <View layout={{ gap: 2 }}>
        <Label text={levelId} size={TEXT.xs} color={ROLE.muted} />
        {m.winReason && (
          <RichParagraph align="left" size={TEXT.xs} color={SUCCESS} runs={[
            { text: `${m.winReason.label}: `, alpha: 0.9 },
            { text: m.winReason.reason, bold: true, weight: "600", alpha: 0.9 },
            ...(m.winReason.also ? [{ text: ` ${m.winReason.also}`, color: ROLE.muted }] : []),
          ]} />
        )}
      </View>

        {/* Push Failed Warning */}
        {pushFailed}

        {/* Stats */}
        <Appear delay={0.2} duration={0.28} layout={{ gap: sm ? 12 : 8 }}>
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
                  layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 8, rowGap: 2, marginTop: 8, marginBottom: 8, padding: 8, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: tint(gold, 0x66 / 255), backgroundColor: tint(gold, 0x14 / 255) }}>
                  <Icon icon={Sparkles} size={16} color={gold} />
                  <Label text={t("levelComplete.flawless")} size={TEXT.sm} font="display" weight="900" upper letterSpacing={1.4} color={gold} />
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
            layout={{ backgroundColor: ROLE.raised, borderRadius: RADIUS.sm, paddingLeft: sm ? 12 : 8, paddingRight: sm ? 12 : 8 }}>
            <Between
              left={<Label text={t("levelComplete.overtimeEarned")} size={fs} weight="600" />}
              right={<>
                <Label text={String(displayLevelScore)} size={sm ? TEXT["2xl"] : TEXT.xl} weight="700" color={ROLE.hours} />
                {m.overtimeSuffix && (
                  <Label text={` ${m.overtimeSuffix}`} size={sm ? TEXT.lg : TEXT.base} color={COLOR.mutedForeground} layout={{ marginBottom: 2 }} />
                )}
                <Label text="h" size={sm ? TEXT["2xl"] : TEXT.xl} weight="700" color={ROLE.hours} />
              </>} />
          </StatRow>

          {/* Total Overtime: the grand running total of the run, in
              gold like every figure in hours, framed in the band's accent. */}
          <StatRow handlers={hold("totalOvertime")} paddingY={sm ? 16 : 12} rule={false}
            layout={{
              borderRadius: RADIUS.sm, paddingLeft: sm ? 16 : 12, paddingRight: sm ? 16 : 12, borderWidth: 1,
              backgroundColor: ROLE.raised, borderColor: accent,
            }}>
            <Between
              left={<Label text={t("levelComplete.totalOvertime")} size={sm ? TEXT.lg : TEXT.base} weight="700" />}
              right={<Label text={`${displayTotalScore}h`} size={sm ? TEXT["3xl"] : TEXT["2xl"]} weight="800" color={ROLE.hours} />} />
          </StatRow>

          {/* Once per run: the moment the total passes the all-time best. */}
          {personalBest}

          <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 4 }}>
            <Icon icon={Info} size={12} color={COLOR.mutedForeground} alpha={0.7} />
            <Label text={t("levelComplete.holdHint")} size={11} color={COLOR.mutedForeground} alpha={0.7} />
          </View>
        </Appear>

        {/* Newly unlocked certificates */}
        {certificates}

      {/* Continue: names where it goes, so the next stage is never a surprise. */}
      {continueButton}
    </PipelineFrame>
  );
}
