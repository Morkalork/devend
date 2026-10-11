/**
 * AscensionDraftScreen - the finale, shown the moment the last level falls
 * (canvas port of components/game/AscensionDraftScreen.tsx).
 *
 * It is the FIRST thing after the final map, not the fourth: beating the game
 * used to open two admin screens before anything congratulated the player.
 * So this leads with the win, and the pick that needs a screen is offered
 * after the ascend choice, where it can still be spent.
 *
 * The player either retires (banks the run, sees the result screen) or ascends:
 * drafts one of three randomly offered loadouts (curse + blessing bundles from
 * public/loadouts.yml) and loops back to level 1 with every drafted loadout
 * still active.
 *
 * It also says what ASCENDING WOULD DO. The ladder rung a depth imposes used
 * to be announced only on the far side of the decision, so "ascend to depth 4"
 * was a choice made blind. The incoming rung is named here, beside the button.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpCircle, Flag, Package, Skull, Sparkles } from "lucide-react";
import type { AscensionRung, LoadoutConfig } from "@/types/loadout";
import { drawOffers } from "@/lib/loadoutDraft";
import { getRunRng } from "@/lib/runRng";
import { draftableAtAscension } from "@/lib/loadoutUnlock";
import { contentText } from "@/i18n/content";
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { DraftCard } from "./DraftCard";
import { DraftEmpty, DraftFrame, DraftGrid, DraftHeader, IconRow, RichParagraph, TopRule } from "./draftParts";
import { ArcadeButton } from "./betweenArcadeButton";
import { DRAFT_HINT, DRAFT_RED, DRAFT_TEXT, SM_BREAKPOINT, ascensionBriefing, toggleSelection } from "./draftModel";

interface AscensionDraftScreenProps {
  loadouts: LoadoutConfig[];
  draftedLoadoutIds: string[];
  /** Depth completed so far; ascending enters depth + 1. */
  ascensionDepth: number;
  /** The ladder, so the screen can say what the depth being offered imposes. */
  ladder?: AscensionRung[];
  totalScore: number;
  onAscend: (loadoutId: string) => void;
  onRetire: () => void;
  accentColor?: string;
  showTutorial?: boolean;
  onTutorialDismiss?: () => void;
}

const RUNG_GOLD = hex("#ffd76b");
const RESET_PINK = hex("#ffb4b4");
const TUTORIAL_CARD = hex("#0a0f0a");

export function AscensionDraftScreen({
  loadouts,
  draftedLoadoutIds,
  ascensionDepth,
  ladder = [],
  totalScore,
  onAscend,
  onRetire,
  accentColor = "#00ff88",
  showTutorial = false,
  onTutorialDismiss,
}: AscensionDraftScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  // Drawn once per mount so re-renders don't reshuffle the offer. Seeded runs
  // key the roll by depth so each ascension draws fresh but deterministically.
  // draftableAtAscension, not the raw catalogue: the ladder's forced curse has
  // no blessing, so seeing it among three rewards would read as a bug.
  const [offers] = useState(() => drawOffers(
    draftableAtAscension(loadouts), draftedLoadoutIds, 3, getRunRng(`ascDraft:${ascensionDepth}`),
  ));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { nextDepth, incoming, alreadyInForce } = ascensionBriefing(ascensionDepth, ladder);

  // One-time intro overlay. Not dismissable by the backdrop in the DOM either:
  // only its button closes it.
  const tutorial = showTutorial && (
    <View layout={{
      position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height,
      justifyContent: "center", alignItems: "center", padding: 24,
    }} zIndex={1000}>
      <Pressable pressedAlpha={1} layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.8) }} />
      <Appear fromScale={0.9}>
        {/* Bounded and scrollable: a centred card taller than the screen would
            otherwise lose both ends, with no way to reach either. A Pressable
            so a tap on the card does not reach the backdrop below it. */}
        <Pressable pressedAlpha={1} layout={{
          width: Math.min(448, screen.width - 48), maxHeight: screen.height - 48, borderRadius: RADIUS.lg,
          backgroundColor: TUTORIAL_CARD, borderWidth: 2, borderColor: accent,
        }}>
          <ScrollView layout={{ flexShrink: 1, padding: 24, alignItems: "center" }}>
            <Label text={t("ascension.ascensionUnlocked")} size={TEXT.xl} font="display" weight="900" upper letterSpacing={1} color={accent} wrap align="center" layout={{ marginBottom: 12 }} />
            <View layout={{ alignSelf: "stretch", marginBottom: 16 }}>
              <RichParagraph
                size={TEXT.sm}
                color={DRAFT_TEXT}
                runs={[
                  { text: t("ascension.tutorialIntro1") },
                  { text: t("ascension.tutorialLoadoutWord"), bold: true },
                  { text: t("ascension.tutorialIntro2") },
                ]}
              />
            </View>
            <ArcadeButton text={t("ascension.gotIt")} onTap={onTutorialDismiss} />
          </ScrollView>
        </Pressable>
      </Appear>
    </View>
  );

  return (
    <DraftFrame overlay={tutorial}>
      <DraftHeader
        icon={ArrowUpCircle}
        accent={accent}
        title={t("ascension.youWin")}
        lines={[
          {
            text: ascensionDepth > 0 ? t("ascension.congratsAscended", { depth: ascensionDepth }) : t("ascension.congrats"),
            weight: "600",
          },
          { text: t("ascension.retireOrAscend", { depth: nextDepth }), alpha: 0.75 },
          {
            text: t("ascension.ascendedLevelsInfo", { multiplier: nextDepth + 1 }) + t("ascension.bankedOvertime", { score: totalScore }),
            size: TEXT.xs, color: DRAFT_HINT,
          },
        ]}
      />

      {/* What ascending would actually switch on. Beside the choice, not after it. */}
      <View layout={{
        alignSelf: "stretch", borderRadius: RADIUS.lg, padding: 16,
        borderWidth: 1, borderColor: tint(accent, 0x55 / 255), backgroundColor: tint(accent, 0x0d / 255),
      }}>
        <Label text={t("ascension.whatDepthAdds", { depth: nextDepth })} size={TEXT.xs} upper letterSpacing={1.2} color={accent} wrap layout={{ marginBottom: 8 }} />
        {incoming ? (
          <>
            <Label text={contentText.rungName(t, incoming)} size={TEXT.sm} font="display" weight="700" color={RUNG_GOLD} wrap layout={{ marginBottom: 4 }} />
            <Label text={contentText.rungDesc(t, incoming)} size={TEXT.xs} lineHeight={20} color={DRAFT_TEXT} alpha={0.85} wrap />
          </>
        ) : (
          <Label text={t("ascension.noNewRung")} size={TEXT.xs} lineHeight={20} color={DRAFT_TEXT} alpha={0.85} wrap />
        )}
        {alreadyInForce.length > 0 && (
          <Label
            text={t("ascension.alsoInForce", { names: alreadyInForce.map(r => contentText.rungName(t, r)).join(", ") })}
            size={TEXT.xs} color={DRAFT_HINT} wrap layout={{ marginTop: 8 }}
          />
        )}
        {/* The cost, stated where the choice is made: ascending wipes the run. */}
        <View layout={{ marginTop: 12, paddingTop: 12 }}>
          <TopRule color={tint(accent, 0x33 / 255)} />
          <Label text={t("ascension.resetWarning")} size={TEXT.xs} lineHeight={20} color={RESET_PINK} wrap />
        </View>
      </View>

      {/* Loadout cards */}
      {offers.length > 0 ? (
        <DraftGrid count={offers.length} alwaysThree>
          {offers.map((loadout, i) => {
            const selected = selectedId === loadout.id;
            return (
              <DraftCard
                key={loadout.id}
                index={i}
                accentColor={accentColor}
                selected={selected}
                onClick={() => setSelectedId(toggleSelection(selectedId, loadout.id))}
                name={contentText.loadoutName(t, loadout)}
                icon={<Icon icon={Package} size={40} strokeWidth={1.5} color={accent} />}
              >
                {/* Upside first at the headline size, cost under it. */}
                <IconRow icon={Sparkles} color={accent}>
                  <Label text={contentText.loadoutBlessing(t, loadout)} size={TEXT.lg} lineHeight={29} color={DRAFT_TEXT} wrap />
                </IconRow>
                <IconRow icon={Skull} color={DRAFT_RED}>
                  <Label text={contentText.loadoutCurse(t, loadout)} size={TEXT.base} lineHeight={26} color={DRAFT_RED} wrap />
                </IconRow>
              </DraftCard>
            );
          })}
        </DraftGrid>
      ) : (
        <DraftEmpty text={t("ascension.noLoadouts")} accent={accent} />
      )}

      {/* Actions */}
      <Appear fromY={10} delay={0.5}>
        <View layout={{ flexDirection: screen.width >= SM_BREAKPOINT ? "row" : "column", alignItems: "center", gap: 12 }}>
          <ArcadeButton
            icon={ArrowUpCircle}
            text={selectedId ? t("ascension.ascendToDepth", { depth: nextDepth }) : t("ascension.selectLoadout")}
            disabled={!selectedId}
            onTap={() => selectedId && onAscend(selectedId)}
          />
          <ArcadeButton variant="secondary" icon={Flag} text={t("ascension.retireBankRun")} onTap={onRetire} />
        </View>
      </Appear>
    </DraftFrame>
  );
}
