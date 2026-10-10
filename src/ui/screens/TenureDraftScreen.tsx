/**
 * TenureDraftScreen - the run-start Tenure pick (issue #75; canvas port of
 * components/game/TenureDraftScreen.tsx).
 *
 * The checkpoint replacement: getting deep in a run pays out at the START of
 * the next one. Shown BEFORE the loadout draft, because a free lock chain
 * should be allowed to steer which loadout you take.
 *
 * Each card is a whole upgrade chain, already resolved: the player earned the
 * chain, not the fork, so any `choiceGroup` or branch was decided for them and
 * the card shows exactly what lands. Mirrors RunDraftScreen's card UI.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUp, Play, Rocket } from "lucide-react";
import { isContinuation, type TenureOffer } from "@/lib/tenure";
import { contentText } from "@/i18n/content";
import { Appear, Icon, Label, TEXT, View, hex } from "../kit/ui";
import { DraftCard } from "./DraftCard";
import { ArcadeButton, DraftFrame, DraftGrid, DraftHeader, IconRow } from "./draftParts";
import { DRAFT_HINT, DRAFT_TEXT, toggleSelection } from "./draftModel";

interface TenureDraftScreenProps {
  /** Resolved offers; the caller rolls them so a retry gets a fresh draw. */
  offers: TenureOffer[];
  /** Levels reached in the previous run, shown as the reason for the reward. */
  earnedAtLevel: number;
  /** Upgrades the previous run owned; one offer is guaranteed to continue them. */
  lastRunUpgradeIds?: string[];
  /** Called with the chosen chain head id. */
  onConfirm: (headId: string) => void;
  accentColor?: string;
}

export function TenureDraftScreen({
  offers,
  earnedAtLevel,
  lastRunUpgradeIds = [],
  onConfirm,
  accentColor = "#00ff88",
}: TenureDraftScreenProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const accent = hex(accentColor);

  return (
    <DraftFrame>
      <DraftHeader
        icon={Rocket}
        accent={accent}
        title={t("tenure.title")}
        lines={[
          { text: t("tenure.subtitle", { level: earnedAtLevel }), alpha: 0.75 },
          { text: t("tenure.pickHint"), size: TEXT.xs, color: DRAFT_HINT },
        ]}
      />

      {/* Offer cards. A thin pool can return fewer than three; two are centred. */}
      <DraftGrid count={offers.length}>
        {offers.map((offer, i) => {
          const selected = selectedId === offer.headId;
          return (
            /* The "continued" flag rides in the header slot the other drafts
               use for their archetype chip, so it sits where the eye already
               looks. Without it the guaranteed slot is invisible. */
            <DraftCard
              key={offer.headId}
              index={i}
              accentColor={accentColor}
              selected={selected}
              onClick={() => setSelectedId(toggleSelection(selectedId, offer.headId))}
              name={contentText.upgradeName(t, offer.upgrades[0])}
              icon={<Icon icon={Rocket} size={40} strokeWidth={1.5} color={accent} />}
              headerExtra={isContinuation(offer, lastRunUpgradeIds) ? (
                <Label text={t("tenure.continued")} size={10} upper letterSpacing={0.25} color={accent} alpha={0.75} />
              ) : undefined}
            >
              {/* Every tier that lands, so a 30-level reward visibly beats a
                  20-level one rather than looking like the same card. */}
              {offer.upgrades.map(u => (
                <IconRow key={u.id} icon={ChevronsUp} color={accent}>
                  <Label text={contentText.tier(t, u.tier)} size={10} upper letterSpacing={0.25} color={accent} alpha={0.8} />
                  {/* One step below the other draft cards, not two: a tenure
                      card STACKS several upgrades, so it is a list. */}
                  <Label text={contentText.upgradeDesc(t, u)} size={TEXT.base} lineHeight={26} color={DRAFT_TEXT} wrap />
                </IconRow>
              ))}
            </DraftCard>
          );
        })}
      </DraftGrid>

      {/* Actions. No skip: this is pure upside, so the only choice is which chain. */}
      <Appear fromY={10} delay={0.5}>
        <View layout={{ alignItems: "center", gap: 12 }}>
          <ArcadeButton
            icon={Play}
            text={selectedId ? t("tenure.confirmButton") : t("tenure.pickToStart")}
            disabled={!selectedId}
            onTap={() => selectedId && onConfirm(selectedId)}
          />
        </View>
      </Appear>
    </DraftFrame>
  );
}
