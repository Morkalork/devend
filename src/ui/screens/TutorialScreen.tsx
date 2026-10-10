/**
 * How to Play (canvas port of components/game/TutorialScreen.tsx): the board
 * steps, the ball roster, the bug roster, the life cycle, and the controls.
 * What it lists is in tutorialScreenModel.ts; the swatches are in
 * tutorialScreenParts.tsx. The CRT backdrop is not drawn here: it is rendered
 * once, globally, underneath the interface canvas.
 */
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { getImplementedBallTypes } from "@/lib/ballTypes";
import { getAllBugs } from "@/lib/bugs";
import {
  Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen,
} from "../kit/ui";
import { ArcadeButton } from "./welcomeParts";
import { BallSwatch, BugSwatch } from "./tutorialScreenParts";
import { ballRoster, bugRoster, controlRows, lifeCycleSteps, tutorialSteps, type TutorialStep } from "./tutorialScreenModel";

interface TutorialScreenProps {
  onBack: () => void;
  accentColor?: string;
  /** Ball type ids the player has locked at least once (persisted). Types not
   *  in this set show "Not encountered yet." instead of their ability - except
   *  red and green, which are always shown (the base/common types). */
  encounteredBallTypeIds?: string[];
}

/** `leading-relaxed` at text-sm. */
const RELAXED = Math.round(TEXT.sm * 1.625);

// accentColor only tinted the CRT backdrop, which is no longer drawn here.
export function TutorialScreen({ onBack, encounteredBallTypeIds = [] }: TutorialScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const width = Math.min(672, screen.width - 48);

  const card = { flexDirection: "row", gap: 16, padding: 16, borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.card, 0.5), borderWidth: 1, borderColor: COLOR.border } as const;
  const heading = (text: string, marginBottom: number, delay: number) => (
    <Appear fromY={-10} delay={delay} layout={{ alignSelf: "stretch", marginTop: 40, marginBottom }}>
      <Label text={text} size={TEXT.xl} font="display" weight="700" color={COLOR.primary} align="center" wrap />
    </Appear>
  );
  const intro = (text: string) => (
    <View layout={{ alignSelf: "center", width: Math.min(576, width), marginBottom: 24 }}>
      <Label text={text} size={TEXT.sm} color={COLOR.mutedForeground} align="center" wrap />
    </View>
  );
  const stepCard = (step: TutorialStep, delay: number) => (
    <Appear key={step.key} delay={delay}>
      <View layout={card}>
        <View layout={{
          width: 48, height: 48, borderRadius: RADIUS.lg, alignItems: "center", justifyContent: "center",
          backgroundColor: tint(COLOR.primary, 0.1), borderWidth: 1, borderColor: tint(COLOR.primary, 0.3),
        }}>
          <Icon icon={step.icon} size={24} color={COLOR.primary} />
        </View>
        <View layout={{ flex: 1, gap: 4 }}>
          <Label text={t(`tutorial.steps.${step.key}.title`)} size={TEXT.base} font="display" weight="600" wrap />
          <Label text={t(`tutorial.steps.${step.key}.description`)} size={TEXT.sm} color={COLOR.mutedForeground} lineHeight={RELAXED} wrap />
        </View>
      </View>
    </Appear>
  );
  const statChip = (text: string) => (
    <View key={text} layout={{
      paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, borderRadius: RADIUS.base,
      backgroundColor: tint(COLOR.secondary, 0.5), borderWidth: 1, borderColor: COLOR.border,
    }}>
      <Label text={text} size={TEXT.xs} color={COLOR.mutedForeground} />
    </View>
  );
  const noteBox = { marginTop: 32, padding: 16, gap: 8, borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.secondary, 0.3), borderWidth: 1, borderColor: COLOR.border } as const;

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9) }}>
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ padding: 24 }}>
          {/* Header */}
          <Appear layout={{ marginBottom: 32, alignItems: "flex-start" }}>
            <Pressable onTap={onBack} layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon icon={ArrowLeft} size={20} color={COLOR.mutedForeground} />
              <Label text={t("tutorial.back")} size={TEXT.sm} font="display" upper letterSpacing={TEXT.sm * 0.05} color={COLOR.mutedForeground} />
            </Pressable>
          </Appear>

          {/* Title */}
          <Appear fromY={-20} delay={0.1} layout={{ marginBottom: 48 }}>
            <Label text={t("tutorial.howToPlay")} size={TEXT["3xl"]} font="display" weight="700" color={COLOR.primary} align="center" wrap />
          </Appear>

          <View layout={{ width, alignSelf: "center" }}>
            {/* Tutorial steps */}
            <View layout={{ gap: 24 }}>
              {tutorialSteps.map((step, index) => stepCard(step, 0.2 + index * 0.1))}
            </View>

            {/* Ball types */}
            {heading(t("tutorial.ballTypes.title"), 12, 0.6)}
            {intro(t("tutorial.ballTypes.intro"))}
            <View layout={{ gap: 16 }}>
              {ballRoster(getImplementedBallTypes(), encounteredBallTypeIds).map(({ ball, revealed }, index) => (
                <Appear key={ball.id} delay={0.65 + index * 0.06}>
                  <View layout={card}>
                    {/* The swatch carries the ability mark the board draws, so
                        this roster is where a player learns to read it. */}
                    <View layout={{ alignSelf: "center" }}>
                      <BallSwatch color={ball.color} ability={ball.ability} size={48} />
                    </View>
                    <View layout={{ flex: 1, gap: 4 }}>
                      <Label text={ball.name} size={TEXT.base} font="display" weight="600" wrap />
                      <Label
                        text={revealed ? ball.description : t("tutorial.ballTypes.notEncounteredYet")}
                        size={TEXT.sm} color={COLOR.mutedForeground} lineHeight={RELAXED} wrap
                        alpha={revealed ? 1 : 0.5}
                        layout={{ marginBottom: 4 }}
                      />
                      <View layout={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {statChip(t("tutorial.ballTypes.speed", { speed: ball.baseSpeed }))}
                        {statChip(t("tutorial.ballTypes.unlocks", { level: ball.unlockLevel }))}
                        {statChip(t("tutorial.ballTypes.lock", { mult: ball.lockMultiplier }))}
                      </View>
                    </View>
                  </View>
                </Appear>
              ))}
            </View>

            {/* Bugs: every entry shown, always, nothing hidden behind having
                met it - deliberately unlike the ball roster above (see
                bugRoster for why). */}
            {heading(t("tutorial.bugs.title"), 8, 0.65)}
            {intro(t("tutorial.bugs.intro"))}
            <View layout={{ gap: 16 }}>
              {bugRoster(getAllBugs()).map((bug, index) => {
                const color = hex(bug.color);
                return (
                  <Appear key={bug.id} delay={0.65 + index * 0.05}>
                    <View layout={{ ...card, borderColor: bug.danger ? tint(color, 0x66 / 255) : COLOR.border }}>
                      <View layout={{ alignSelf: "flex-start" }}>
                        <BugSwatch color={bug.color} size={40} />
                      </View>
                      <View layout={{ flex: 1, gap: 4 }}>
                        <Label text={bug.name} size={TEXT.base} font="display" weight="600" color={color} wrap />
                        <Label text={bug.description} size={TEXT.sm} color={COLOR.mutedForeground} lineHeight={RELAXED} wrap />
                        {/* The cost gets its own line and its own label, for the
                            reason the explainer card splits them: run the two
                            together and a pool of trade-offs reads as a pool of
                            gifts. */}
                        <View layout={{ flexDirection: "row", gap: 4 }}>
                          <Label text={t("tutorial.bugs.cost")} size={TEXT.sm} weight="600" color={COLOR.foreground} alpha={0.7} lineHeight={RELAXED} />
                          <View layout={{ flex: 1 }}>
                            <Label text={bug.cost} size={TEXT.sm} color={COLOR.mutedForeground} alpha={0.8} lineHeight={RELAXED} wrap />
                          </View>
                        </View>
                        {bug.danger && (
                          <Label text={t("tutorial.bugs.danger")} size={TEXT.xs} weight="600" color={color} wrap layout={{ marginTop: 4 }} />
                        )}
                      </View>
                    </View>
                  </Appear>
                );
              })}
            </View>

            {/* Life cycle */}
            {heading(t("tutorial.lifeCycle"), 24, 0.65)}
            <View layout={{ gap: 24 }}>
              {lifeCycleSteps.map((step, index) => stepCard(step, 0.7 + index * 0.1))}
            </View>

            {/* Progression note */}
            <Appear fromY={20} delay={1.0} layout={noteBox}>
              <Label text={t("tutorial.achievementsCertificatesTitle")} size={TEXT.sm} font="display" weight="600" wrap />
              <Label text={t("tutorial.achievementsCertificatesBody")} size={TEXT.sm} color={COLOR.mutedForeground} lineHeight={RELAXED} wrap />
            </Appear>

            {/* Controls */}
            <Appear fromY={20} delay={0.6} layout={noteBox}>
              <Label text={t("tutorial.controlsTitle")} size={TEXT.sm} font="display" weight="600" wrap />
              <View layout={{ gap: 12 }}>
                {controlRows("ontouchstart" in window).map(row => (
                  <View key={row.textKey} layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View layout={{
                      paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: RADIUS.base,
                      backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.border,
                    }}>
                      <Label text={t(row.labelKey)} size={TEXT.xs} font="display" color={COLOR.mutedForeground} />
                    </View>
                    <View layout={{ flex: 1 }}>
                      <Label text={t(row.textKey)} size={TEXT.sm} color={COLOR.mutedForeground} wrap />
                    </View>
                  </View>
                ))}
              </View>
            </Appear>
          </View>

          {/* Back button */}
          <Appear delay={0.7} layout={{ marginTop: 32, marginBottom: 48, alignItems: "center" }}>
            <ArcadeButton variant="secondary" text={t("tutorial.gotIt")} onTap={onBack} />
          </Appear>
        </View>
      </ScrollView>
    </View>
  );
}
