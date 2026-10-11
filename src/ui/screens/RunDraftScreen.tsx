/**
 * RunDraftScreen - the run-start loadout draft ("Sprint Planning"; canvas
 * port of components/game/RunDraftScreen.tsx).
 *
 * Shown once at the start of every fresh run. The player either picks one of
 * the randomly offered curse + blessing loadouts (from public/loadouts.yml,
 * filtered to the unlocked set by the caller) to shape the run from level 1, or
 * skips and plays vanilla. The chosen loadout rides the same modifier pipeline
 * (draftedLoadoutIds) at depth 0.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ClipboardList, Package, Play, SkipForward, Skull, Sparkles } from "lucide-react";
import type { LoadoutConfig } from "@/types/loadout";
import { drawOffers } from "@/lib/loadoutDraft";
import { getRunRng } from "@/lib/runRng";
import { contentText } from "@/i18n/content";
import { Appear, Icon, Label, Pressable, RADIUS, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { DraftCard } from "./DraftCard";
import { DraftEmpty, DraftFrame, DraftGrid, DraftHeader, IconRow } from "./draftParts";
import { ArcadeButton } from "../kit/ui";
import { DRAFT_HINT, DRAFT_RED, DRAFT_TEXT, SM_BREAKPOINT, toggleSelection } from "./draftModel";

interface RunDraftScreenProps {
  /** Already filtered to the player's unlocked loadouts by the caller. */
  loadouts: LoadoutConfig[];
  draftedLoadoutIds: string[];
  /** Called with the chosen loadout id, or null when the player skips. */
  onConfirm: (loadoutId: string | null) => void;
  /**
   * Leave without starting a run. Sprint Planning happens BEFORE the run
   * begins, so unlike the mid-run drafts there is nothing here to skip past:
   * backing out costs the player nothing and stranding them costs a restart.
   */
  onBack?: () => void;
  accentColor?: string;
}

export function RunDraftScreen({
  loadouts,
  draftedLoadoutIds,
  onConfirm,
  onBack,
  accentColor = "#00ff88",
}: RunDraftScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  // Drawn once per mount so re-renders don't reshuffle the offer. Seeded runs
  // (Daily Stand-up) get the same offers via the run-rng context.
  const [offers] = useState(() => drawOffers(loadouts, draftedLoadoutIds, 3, getRunRng("runDraft")));
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  return (
    <DraftFrame overlay={back}>
      <DraftHeader
        icon={ClipboardList}
        accent={accent}
        title={t("runDraft.title")}
        lines={[
          { text: t("runDraft.subtitle"), alpha: 0.75 },
          { text: t("runDraft.pickHint"), size: TEXT.xs, color: DRAFT_HINT },
        ]}
      />

      {/* Loadout cards. With only two unlocked loadouts the draw returns two;
          they are centred rather than leaving a gap in a three-wide grid. */}
      {offers.length > 0 ? (
        <DraftGrid count={offers.length}>
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
                {/* Upside first at the headline size, cost under it: what you
                    gain leads, what it charges you steps down from it. */}
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
        <DraftEmpty text={t("runDraft.noLoadouts")} accent={accent} />
      )}

      {/* Actions */}
      <Appear fromY={10} delay={0.5}>
        <View layout={{ flexDirection: screen.width >= SM_BREAKPOINT ? "row" : "column", alignItems: "center", gap: 12 }}>
          <ArcadeButton
            icon={Play}
            text={selectedId ? t("runDraft.startButton") : t("runDraft.pickToStart")}
            disabled={!selectedId}
            onTap={() => selectedId && onConfirm(selectedId)}
          />
          <ArcadeButton variant="secondary" icon={SkipForward} text={t("runDraft.skipButton")} onTap={() => onConfirm(null)} />
        </View>
      </Appear>
    </DraftFrame>
  );
}
