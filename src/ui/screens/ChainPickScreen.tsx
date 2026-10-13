/**
 * ChainPickScreen - the pick that follows a Sprint Planning offer whose prize
 * is a choice (Pick a Junior, Headhunted). Grew out of the Tenure draft
 * (issue #75), which is now the boon card on Sprint Planning itself.
 *
 * Each card is a whole upgrade chain, already resolved: the player earned the
 * chain, not the fork, so any `choiceGroup` or branch was decided for them and
 * the card shows exactly what lands.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUp, Play, Rocket } from "lucide-react";
import type { TenureOffer } from "@/lib/tenure";
import type { RunOffer } from "@/types/offer";
import { contentText } from "@/i18n/content";
import { Appear, Icon, Label, TEXT, View, hex } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { DraftCard } from "./DraftCard";
import { DraftFrame, DraftGrid, DraftHeader, IconRow } from "./draftParts";
import { ArcadeButton } from "../kit/ui";
import { DRAFT_HINT, DRAFT_TEXT, toggleSelection } from "./draftModel";

interface ChainPickScreenProps {
  /** The offer that was taken, named in the header. */
  offer: Pick<RunOffer, "id" | "name">;
  /** The resolved chains to choose from. */
  choices: TenureOffer[];
  /** Called with the chosen chain's head id. */
  onConfirm: (headId: string) => void;
  accentColor?: string;
}

export function ChainPickScreen({ offer, choices, onConfirm, accentColor = "#00ff88" }: ChainPickScreenProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const accent = hex(accentColor);

  return (
    <DraftFrame>
      <DraftHeader
        icon={Rocket}
        accent={accent}
        title={contentText.offerName(t, offer)}
        lines={[
          { text: t("chainPick.subtitle"), alpha: 0.75 },
          { text: t("chainPick.pickHint"), size: TEXT.xs, color: DRAFT_HINT },
        ]}
      />

      {/* A thin pool can return fewer than asked for; two are centred. */}
      <DraftGrid count={choices.length}>
        {choices.map((choice, i) => {
          const tag = choice.upgrades[0].tags?.[0];
          return (
            <DraftCard
              key={choice.headId}
              index={i}
              accentColor={accentColor}
              selected={selectedId === choice.headId}
              onClick={() => setSelectedId(toggleSelection(selectedId, choice.headId))}
              name={contentText.upgradeName(t, choice.upgrades[0])}
              icon={<Icon icon={Rocket} size={40} strokeWidth={1.5} color={accent} />}
              headerExtra={tag ? <TagChip tag={tag} /> : undefined}
            >
              {/* Every tier that lands, so a three-tier chain visibly beats a
                  one-tier one rather than looking like the same card. */}
              {choice.upgrades.map(u => (
                <IconRow key={u.id} icon={ChevronsUp} color={accent}>
                  <Label text={contentText.tier(t, u.tier)} size={10} upper letterSpacing={0.25} color={accent} alpha={0.8} />
                  <Label text={contentText.upgradeDesc(t, u)} size={TEXT.base} lineHeight={26} color={DRAFT_TEXT} wrap />
                </IconRow>
              ))}
            </DraftCard>
          );
        })}
      </DraftGrid>

      {/* No skip: the offer is already taken, so the only choice is which chain. */}
      <Appear fromY={10} delay={0.5}>
        <View layout={{ alignItems: "center", gap: 12 }}>
          <ArcadeButton
            icon={Play}
            text={selectedId ? t("chainPick.confirmButton") : t("chainPick.pickToStart")}
            disabled={!selectedId}
            onTap={() => selectedId && onConfirm(selectedId)}
          />
        </View>
      </Appear>
    </DraftFrame>
  );
}
