/**
 * RunDraftScreen - Sprint Planning, the run-start offer (SPRINT_PLANNING_PLAN.md).
 *
 * Three cards, one from each pool, dealt and resolved by the caller
 * (rollSprintDeal): a boon (or the Tenure chain the last run earned), a
 * Specialisation that leans the store toward one archetype, and a gamble that
 * charges a price now for a prize that would take ten maps to reach. Take one
 * or skip. Each card shows exactly what lands; holding one opens the long
 * version (the game's standard gesture).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, ChevronsUp, ClipboardList, Compass, Crown, Dices, Gift, Play, Rocket, SkipForward, Skull, Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { DealtOffer } from "@/lib/sprintOffers";
import { Appear, Icon, Label, Modal, Pressable, RADIUS, ROLE, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { DraftCard } from "./DraftCard";
import { DraftEmpty, DraftFrame, DraftGrid, DraftHeader, IconRow, TopRule } from "./draftParts";
import { ArcadeButton } from "../kit/ui";
import { DRAFT_HINT, DRAFT_RED, DRAFT_TEXT, SM_BREAKPOINT } from "./draftModel";
import { cardAccent, cardKind, cardName, cardPrice, cardUpside, grantRows, type CardKind } from "./sprintModel";

interface RunDraftScreenProps {
  /** The dealt cards, boon first. Rolled by the caller so a retry is a new deal. */
  cards: DealtOffer[];
  /** Called with the chosen card's index, or null when the player skips. */
  onConfirm: (index: number | null) => void;
  /**
   * Leave without starting a run. Sprint Planning happens BEFORE the run
   * begins, so unlike the mid-run drafts there is nothing here to skip past:
   * backing out costs the player nothing and stranding them costs a restart.
   */
  onBack?: () => void;
  accentColor?: string;
}

const KIND_ICON: Record<CardKind, LucideIcon> = {
  boon: Gift, tenure: Rocket, specialisation: Compass, gamble: Dices, jackpot: Crown,
};

export function RunDraftScreen({ cards, onConfirm, onBack, accentColor = "#00ff88" }: RunDraftScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const accent = hex(accentColor);

  // Top-left, where every other screen in the game puts its way out.
  const back = onBack && (
    <Pressable
      onTap={onBack}
      label={t("runDraft.back")}
      layout={{
        position: "absolute", top: 16, left: 16, flexDirection: "row", alignItems: "center", gap: 6,
        paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg,
        backgroundColor: tint(0x000000, 0x99 / 255), borderWidth: 1, borderColor: tint(accent, 0x55 / 255),
      }}
    >
      <Icon icon={ArrowLeft} size={16} color={accent} />
      <Label text={t("runDraft.back")} size={TEXT.sm} weight="600" color={accent} />
    </Pressable>
  );

  const detailCard = detail !== null ? cards[detail] : undefined;
  const modal = detailCard && (
    <CardDetail card={detailCard} accentColor={cardAccent(detailCard, accentColor)} onClose={() => setDetail(null)} />
  );

  return (
    <DraftFrame overlay={<>{back}{modal}</>}>
      {/* Room for the Back button, which floats top-left over a tall page. */}
      {back && <View layout={{ height: 28 }} />}
      <DraftHeader
        icon={ClipboardList}
        accent={accent}
        title={t("runDraft.title")}
        lines={[
          { text: t("runDraft.subtitle"), alpha: 0.75 },
          { text: t("runDraft.pickHint"), size: TEXT.xs, color: DRAFT_HINT },
        ]}
      />

      {cards.length > 0 ? (
        <DraftGrid count={cards.length}>
          {cards.map((card, i) => {
            const kind = cardKind(card);
            const ink = cardAccent(card, accentColor);
            const inkHex = hex(ink);
            const price = cardPrice(t, card.offer);
            // A chain's tiers share one family name, so for a chain each row
            // says what that tier does; mixed families (the jackpot) say names.
            const oneFamily = card.grants.every(u => u.name === card.grants[0]?.name);
            return (
              <DraftCard
                key={`${card.offer.id}:${i}`}
                index={i}
                accentColor={ink}
                selected={selected === i}
                onClick={() => setSelected(prev => (prev === i ? null : i))}
                onLongPress={() => setDetail(i)}
                name={cardName(t, card)}
                icon={<Icon icon={KIND_ICON[kind]} size={40} strokeWidth={1.5} color={inkHex} />}
                headerExtra={
                  <View layout={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                    <Label text={t(`sprint.kind.${kind}`)} size={10} upper letterSpacing={0.25} color={inkHex} alpha={0.8} />
                    {card.offer.tag && <TagChip tag={card.offer.tag} />}
                    {card.tenure?.continued && (
                      <Label text={t("tenure.continued")} size={10} upper letterSpacing={0.25} color={inkHex} alpha={0.6} />
                    )}
                  </View>
                }
              >
                {/* Upside first at the headline size, cost under it: what you
                    gain leads, what it charges you steps down from it. */}
                <IconRow icon={Sparkles} color={inkHex}>
                  <Label text={cardUpside(t, card)} size={TEXT.base} lineHeight={26} color={DRAFT_TEXT} wrap />
                </IconRow>
                {grantRows(t, card.grants).map(row => (
                  <IconRow key={row.id} icon={ChevronsUp} color={inkHex} size={16}>
                    <Label text={row.tier} size={10} upper letterSpacing={0.25} color={inkHex} alpha={0.8} />
                    <Label text={oneFamily ? row.desc : row.name} size={TEXT.sm} weight={oneFamily ? undefined : "600"}
                      lineHeight={22} color={DRAFT_TEXT} wrap />
                  </IconRow>
                ))}
                {card.choices && card.choices.length > 0 && (
                  <Label text={t("sprint.choosesAfter", { count: card.choices.length })} size={TEXT.xs} color={DRAFT_HINT} wrap />
                )}
                {price && (
                  <IconRow icon={Skull} color={DRAFT_RED}>
                    <Label text={price} size={TEXT.sm} lineHeight={22} color={DRAFT_RED} wrap />
                  </IconRow>
                )}
              </DraftCard>
            );
          })}
        </DraftGrid>
      ) : (
        <DraftEmpty text={t("runDraft.noOffers")} accent={accent} />
      )}

      <Label text={t("runDraft.holdHint")} size={11} color={ROLE.muted} wrap />

      {/* Actions */}
      <Appear fromY={10} delay={0.5}>
        <View layout={{ flexDirection: screen.width >= SM_BREAKPOINT ? "row" : "column", alignItems: "center", gap: 12 }}>
          <ArcadeButton
            icon={Play}
            text={selected !== null ? t("runDraft.startButton") : t("runDraft.pickToStart")}
            disabled={selected === null}
            onTap={() => selected !== null && onConfirm(selected)}
          />
          <ArcadeButton variant="secondary" icon={SkipForward} text={t("runDraft.skipButton")} onTap={() => onConfirm(null)} />
        </View>
      </Appear>
    </DraftFrame>
  );
}

/** The long version of a card: every upgrade that lands, and how a Specialisation leans the store. */
function CardDetail({ card, accentColor, onClose }: { card: DealtOffer; accentColor: string; onClose: () => void }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const ink = hex(accentColor);
  const kind = cardKind(card);
  const price = cardPrice(t, card.offer);
  return (
    <Modal screen={screen} maxWidth={420} onClose={onClose} accent={ink}>
      <ScrollView layout={{ maxHeight: screen.height - 160 }}>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Icon icon={KIND_ICON[kind]} size={24} color={ink} />
          <View layout={{ flex: 1 }}>
            <Label text={cardName(t, card)} size={TEXT.base} font="display" weight="700" color={ink} wrap />
          </View>
          {card.offer.tag && <TagChip tag={card.offer.tag} />}
        </View>
        <View layout={{ gap: 10, marginBottom: 12 }}>
          <IconRow icon={Sparkles} color={ink} size={16}>
            <Label text={cardUpside(t, card)} size={TEXT.sm} lineHeight={22} color={DRAFT_TEXT} wrap />
          </IconRow>
          {grantRows(t, card.grants).map(row => (
            <IconRow key={row.id} icon={ChevronsUp} color={ink} size={16}>
              <Label text={`${row.tier} · ${row.name}`} size={TEXT.xs} weight="600" color={ink} wrap />
              <Label text={row.desc} size={TEXT.xs} lineHeight={20} color={DRAFT_TEXT} wrap />
            </IconRow>
          ))}
          {card.choices?.map(choice => (
            <IconRow key={choice.headId} icon={ChevronsUp} color={ink} size={16}>
              <Label text={grantRows(t, choice.upgrades).map(r => r.name).join(" + ")} size={TEXT.xs} color={DRAFT_TEXT} wrap />
            </IconRow>
          ))}
          {price && (
            <IconRow icon={Skull} color={DRAFT_RED} size={16}>
              <Label text={price} size={TEXT.sm} lineHeight={22} color={DRAFT_RED} wrap />
            </IconRow>
          )}
        </View>
        <View layout={{ paddingTop: 10 }}>
          <TopRule color={tint(ink, 0x22 / 255)} />
          <Label text={t(`sprint.explain.${kind}`, { tag: card.offer.tag ? t(`upgradeShop.tags.${card.offer.tag}`) : "" })}
            size={11} lineHeight={18} color={DRAFT_HINT} wrap />
        </View>
      </ScrollView>
    </Modal>
  );
}
