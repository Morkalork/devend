/**
 * CapstoneDraftScreen - the once-per-run perk draft ("Promotion"; canvas port
 * of components/game/CapstoneDraftScreen.tsx).
 *
 * Offered at the first shop exit at/past the trigger level (capstones.yml).
 * The pick is mandatory (it's a pure gift) and permanent for the rest of the
 * run; the two passed-over capstones are gone for good, which is what makes
 * the choice a run-defining moment.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Award, Play, Sparkles } from "lucide-react";
import type { CapstoneConfig } from "@/types/capstone";
import { contentText } from "@/i18n/content";
import { Appear, Icon, Label, Modal, ScrollView, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { TagChip } from "../game/TagChip";
import { DraftCard } from "./DraftCard";
import { DraftFrame, DraftGrid, DraftHeader, IconRow, TopRule } from "./draftParts";
import { ArcadeButton } from "../kit/ui";
import { DRAFT_HINT, DRAFT_TEXT, toggleSelection } from "./draftModel";

interface CapstoneDraftScreenProps {
  offers: CapstoneConfig[];
  onSelect: (capstone: CapstoneConfig) => void;
  accentColor?: string;
}

export function CapstoneDraftScreen({
  offers,
  onSelect,
  accentColor = "#00ff88",
}: CapstoneDraftScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Capstone whose press-and-hold detail overlay is open.
  const [detailId, setDetailId] = useState<string | null>(null);

  const confirm = () => {
    const pick = offers.find(c => c.id === selectedId);
    if (pick) onSelect(pick);
  };

  // Press-and-hold detail: the fuller briefing for one capstone. Backdrop or X closes it.
  const detailCap = detailId ? offers.find(c => c.id === detailId) : undefined;
  const detail = detailCap && (() => {
    const clarify = contentText.capstoneClarify(t, detailCap);
    return (
      <Modal screen={screen} maxWidth={384} onClose={() => setDetailId(null)} accent={accent}>
        {/* Bounded and scrollable, so a long entry is never clipped out of
            both ends of a centred card. */}
        <ScrollView layout={{ maxHeight: screen.height - 160 }}>
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Icon icon={Award} size={24} color={accent} />
            <View layout={{ flex: 1 }}>
              <Label text={contentText.capstoneName(t, detailCap)} size={TEXT.base} font="display" weight="700" color={accent} wrap />
            </View>
            {detailCap.tag && <TagChip tag={detailCap.tag} />}
          </View>
          {/* Effect recap */}
          <View layout={{ marginBottom: 12 }}>
            <IconRow icon={Sparkles} color={accent} size={16}>
              <Label text={contentText.capstoneDesc(t, detailCap)} size={TEXT.xs} lineHeight={20} color={DRAFT_TEXT} wrap />
            </IconRow>
          </View>
          {/* Clarification */}
          {clarify && (
            <Label text={clarify} size={TEXT.sm} lineHeight={23} color={DRAFT_TEXT} alpha={0.9} wrap layout={{ marginBottom: 12 }} />
          )}
          {/* Scope note */}
          <View layout={{ paddingTop: 10 }}>
            <TopRule color={tint(accent, 0x22 / 255)} />
            <Label text={t("capstoneDraft.scopeNote")} size={11} lineHeight={18} color={DRAFT_HINT} wrap />
          </View>
        </ScrollView>
      </Modal>
    );
  })();

  return (
    <DraftFrame overlay={detail}>
      <DraftHeader
        icon={Award}
        accent={accent}
        title={t("capstoneDraft.title")}
        lines={[
          { text: t("capstoneDraft.subtitle"), alpha: 0.75 },
          { text: t("capstoneDraft.exclusiveHint"), size: TEXT.xs, color: DRAFT_HINT },
        ]}
      />

      <DraftGrid count={offers.length}>
        {offers.map((cap, i) => (
          <DraftCard
            key={cap.id}
            index={i}
            accentColor={accentColor}
            selected={selectedId === cap.id}
            onClick={() => setSelectedId(prev => toggleSelection(prev, cap.id))}
            onLongPress={() => setDetailId(cap.id)}
            name={contentText.capstoneName(t, cap)}
            headerExtra={cap.tag ? <TagChip tag={cap.tag} /> : undefined}
            icon={<Icon icon={Award} size={40} strokeWidth={1.5} color={accent} />}
          >
            <Label text={contentText.capstoneDesc(t, cap)} size={TEXT.lg} lineHeight={29} color={DRAFT_TEXT} wrap />
          </DraftCard>
        ))}
      </DraftGrid>

      {/* Press-and-hold discovery hint */}
      <Label text={t("capstoneDraft.holdHint")} size={11} color={DRAFT_HINT} wrap align="center" />

      {/* Confirm. No skip: a capstone is a pure gift, but an exclusive one. */}
      <Appear fromY={10} delay={0.5}>
        <ArcadeButton
          icon={Play}
          text={selectedId ? t("capstoneDraft.confirmButton") : t("capstoneDraft.pickHint")}
          disabled={!selectedId}
          onTap={confirm}
        />
      </Appear>
    </DraftFrame>
  );
}
