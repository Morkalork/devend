/**
 * The draft store's own pieces (CARDS_PLAN.md): the bar that says what a visit
 * offers under the draft rules, and the modal that asks which card to give up
 * when the build is full. UpgradeShop.tsx keeps the state; these draw it.
 */
import { useTranslation } from "react-i18next";
import { Dices, Layers, MapPin } from "lucide-react";
import type { UpgradeConfig } from "@/types/upgrade";
import { contentText } from "@/i18n/content";
import {
  Icon, Label, Modal, Pressable, RADIUS, ROLE, ScrollView, TEXT, View, tint, useUiScreen,
} from "../kit/ui";
import { schoolColor } from "./shopModel";

/** The explainer cards' width (max-w-sm), as the store's other modals. */
const MODAL_W = 384;

/** What the next map has on it, in the words the cards use. */
export interface NextMapInfo {
  level: number;
  name: string;
  /** Already translated: "3 balls", "movers", "a gravity well", ... */
  features: string[];
}

interface DraftBarProps {
  /** Slot cards held, after this visit's picks and drops. */
  held: number;
  slots: number;
  /** Has the free card been taken this visit? */
  freeTaken: boolean;
  skipHours: number;
  rerollPrice: number;
  canReroll: boolean;
  onReroll: () => void;
  nextMap: NextMapInfo | null;
  accent: number;
}

/**
 * The draft's rules for this visit, in three lines: the free card (or what
 * skipping it pays), how full the build is, and what the next map will ask of
 * it. The reroll sits beside the first, because it is the other thing to do
 * with a shelf you do not like.
 */
export function DraftBar({ held, slots, freeTaken, skipHours, rerollPrice, canReroll, onReroll, nextMap, accent }: DraftBarProps) {
  const { t } = useTranslation();
  const full = held >= slots;
  return (
    <View layout={{ gap: 8, padding: 12, borderRadius: RADIUS.sm, backgroundColor: ROLE.surface, borderWidth: 1, borderColor: ROLE.edge }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View layout={{ flex: 1 }}>
          <Label
            text={freeTaken ? t("cardDraft.freeTaken") : t("cardDraft.freePick", { hours: skipHours })}
            size={TEXT.sm} weight="600" color={freeTaken ? ROLE.muted : ROLE.ink} wrap
          />
        </View>
        <Pressable
          onTap={canReroll ? onReroll : undefined}
          alpha={canReroll ? 1 : 0.45}
          label={t("cardDraft.reroll", { hours: rerollPrice })}
          layout={{
            flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
            borderRadius: RADIUS.sm, borderWidth: 1, borderColor: canReroll ? tint(ROLE.hours, 0.6) : ROLE.edge,
          }}
        >
          <Icon icon={Dices} size={14} color={canReroll ? ROLE.hours : ROLE.muted} />
          <Label text={t("cardDraft.reroll", { hours: rerollPrice })} size={TEXT.xs} weight="700" color={canReroll ? ROLE.hours : ROLE.muted} />
        </Pressable>
      </View>

      <View layout={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon icon={Layers} size={14} color={full ? ROLE.cost : accent} />
        {/* A wrapping label fills its parent, so it needs a box of its own in a row. */}
        <View layout={{ flex: 1 }}>
          <Label
            text={full ? t("cardDraft.buildFull", { held, slots }) : t("cardDraft.build", { held, slots })}
            size={TEXT.xs} weight="600" color={full ? ROLE.cost : ROLE.muted} wrap
          />
        </View>
      </View>

      {nextMap && (
        <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
          <Icon icon={MapPin} size={14} color={ROLE.muted} />
          <View layout={{ flex: 1 }}>
            <Label
              text={nextMap.features.length > 0
                ? t("cardDraft.nextMap", { level: nextMap.level, name: nextMap.name, features: nextMap.features.join(", ") })
                : t("cardDraft.nextMapPlain", { level: nextMap.level, name: nextMap.name })}
              size={TEXT.xs} color={ROLE.muted} wrap
            />
          </View>
        </View>
      )}
    </View>
  );
}

interface ReplaceProps {
  /** The card being taken. */
  incoming: UpgradeConfig;
  /** The slot cards it could replace. */
  held: UpgradeConfig[];
  /** A held card's "+", when the build has it: it goes with the card. */
  plusOf: Record<string, UpgradeConfig>;
  accent: number;
  onReplace: (dropped: UpgradeConfig) => void;
  onClose: () => void;
}

/**
 * The build is full: taking a card means giving one up. Each held card is a
 * row saying what would be lost; closing the modal keeps the build as it is.
 */
export function ReplaceCardModal({ incoming, held, plusOf, accent, onReplace, onClose }: ReplaceProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  return (
    <Modal
      screen={screen} maxWidth={MODAL_W} onClose={onClose} accent={accent} stripe={schoolColor(incoming)}
      title={t("cardDraft.replaceTitle", { name: contentText.upgradeName(t, incoming) })}
    >
      <ScrollView layout={{ maxHeight: screen.height - 200 }}>
        <Label text={t("cardDraft.replaceHint")} size={TEXT.xs} color={ROLE.muted} wrap layout={{ marginBottom: 12 }} />
        <View layout={{ gap: 8 }}>
          {held.map(card => {
            // An upgraded card reads as what it now does: its "+" says that.
            const shown = plusOf[card.id] ?? card;
            const name = contentText.upgradeName(t, shown);
            return (
              <Pressable
                key={card.id}
                onTap={() => onReplace(card)}
                label={t("cardDraft.replaceRow", { name })}
                layout={{
                  flexDirection: "row", borderRadius: RADIUS.sm, overflow: "hidden",
                  backgroundColor: ROLE.surface, borderWidth: 1, borderColor: ROLE.edge,
                }}
              >
                <View layout={{ width: 4, backgroundColor: schoolColor(card) }} />
                <View layout={{ flex: 1, padding: 10, gap: 4 }}>
                  <Label text={name} size={TEXT.sm} weight="700" font="display" color={ROLE.ink} />
                  <Label text={contentText.upgradeDesc(t, shown)} size={TEXT.xs} lineHeight={18} color={ROLE.muted} wrap />
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Modal>
  );
}
