/**
 * FenceSlotBar - the five slots beneath the board (canvas port of
 * components/game/FenceSlotBar.tsx; FENCE_TYPES_PLAN.md).
 *
 * Which KIND of fence the next cut draws. A MODE, not a consumable: the
 * selected slot stays selected until it is changed, and there is no charge
 * count anywhere on it. That is why it is a separate bar from AbilityBar - an
 * ability button says "press me now", this says "this is what you are drawing
 * with".
 *
 *  - Tap a slot: select it. Every cut from then on is that type.
 *  - Long-press (450ms): open the explainer. The house gesture (CLAUDE.md).
 *  - The explainer also auto-opens ONCE the first time a type is acquired.
 *
 * Always at least five, and exactly HUD.fenceRow tall. Empty slots are DRAWN,
 * not hidden, so the bar never changes size as types are added. The bar as a
 * whole is only drawn once a special type is owned (GameScreen): Standard alone
 * is no choice, and the row is better spent on the board. Ownership changes
 * between maps, so it never moves a board in play.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield, ShieldOff } from "lucide-react";
import { getFenceType, type FenceTypeDef } from "@/lib/fences";
import { hasSeenFenceType, markFenceTypeSeen } from "@/lib/fenceSeen";
import { fileManualEntry } from "@/lib/manual";
import { HoldHint, Icon, Label, Pressable, RADIUS, ScrollView, View, hex, tint, COLOR } from "../kit/ui";
import { HUD } from "./hudMetrics";
import { FenceTypeInfoModal } from "./FenceTypeInfoModal";
import { ScreenOverlay } from "./bottomOverlay";
import { GlowRing } from "./bottomParts";
import {
  fenceSlotLook, fenceSlotPress, fenceSlotRoster, fenceSlotViews, firstUnseenFence, shouldFileFenceManual, TOUCH_TARGET,
} from "./bottomModel";
import { contentText } from "@/i18n/content";

interface FenceSlotBarProps {
  /**
   * The four swappable slots, standard excluded.
   *
   * Standard is not in here because it cannot be unequipped: keeping it in the
   * list would mean every caller had to remember not to remove it, and one that
   * forgot would take the ordinary fence away mid-run.
   */
  slotIds: string[];
  selectedId: string;
  accentColor: string;
  onSelect: (fenceTypeId: string) => void;
  /**
   * The map's Guardrail shield is gone. A type with `shieldsPerMap` shows a lit
   * shield on its slot until then, and a struck-out one after, so the player
   * can see before a risky cut whether it is still covered.
   */
  shieldSpent?: boolean;
  /** Signals when the explainer opens/closes, so the shell can pause the game. */
  onInfoOpenChange?: (open: boolean) => void;
  /**
   * Hold the first-acquire explainer back for now.
   *
   * GameScreen shows a one-time "this bar is a chooser" overlay the first time
   * the player owns any special, and without this the card lands on top of the
   * thing explaining the bar it belongs to. The card is not dropped, only
   * queued: it opens the moment this goes false.
   */
  deferAutoInfo?: boolean;
}

/** The slots' face: the DOM bar set JetBrains Mono on its row. */
const SLOT_TEXT = 11;

export function FenceSlotBar({
  slotIds, selectedId, accentColor, onSelect, shieldSpent = false, onInfoOpenChange, deferAutoInfo = false,
}: FenceSlotBarProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<FenceTypeDef | null>(null);
  // A type whose card is owed but not yet shown; see deferAutoInfo.
  const [pendingInfoId, setPendingInfoId] = useState<string | null>(null);
  const accent = hex(accentColor);

  // Slot 1 is standard and never swappable; the rest are the player's, padded
  // with empties so the bar never changes size (fenceSlotRoster).
  const { owned, empties } = fenceSlotRoster(slotIds);
  const views = fenceSlotViews(owned, selectedId, accentColor, shieldSpent);

  // First-acquire: show the explainer once per owned type not yet shown. Keyed
  // on the owned set so a new grant fires it.
  const ownedKey = owned.map(f => f.id).join(",");
  useEffect(() => {
    const fresh = firstUnseenFence(owned, hasSeenFenceType);
    // Marked seen HERE rather than when the card opens, so a card held back by
    // deferAutoInfo cannot be re-armed by a remount in between and shown twice.
    if (fresh) { markFenceTypeSeen(fresh.id); setPendingInfoId(fresh.id); }
    // Owning one is meeting the system. GameScreen files it at level 3, but a
    // Head Start certificate can start a run past level 3 entirely.
    if (shouldFileFenceManual(owned.length)) fileManualEntry("fenceSlots");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedKey]);

  // Release the owed card once nothing is in front of it.
  useEffect(() => {
    if (!pendingInfoId || deferAutoInfo) return;
    setInfo(getFenceType(pendingInfoId));
    setPendingInfoId(null);
  }, [pendingInfoId, deferAutoInfo]);

  useEffect(() => {
    onInfoOpenChange?.(!!info);
    return () => onInfoOpenChange?.(false);
  }, [info, onInfoOpenChange]);

  return (
    <>
      {/* Scrolls sideways when the slots are wider than the screen, which they
          are on a phone the moment there are six (the Playground hands over the
          whole catalogue); a clipped row leaves the end types unreachable.
          Auto margins rather than centring: they resolve to zero on a row wider
          than the view, so the row centres while it fits and starts at the left
          edge once it does not. A centred row that overflows puts its first
          slot off-screen with no way to scroll back to it. A sideways drag that
          starts on a slot cancels its press (Pressable's slop). */}
      <ScrollView direction="horizontal" layout={{ height: HUD.fenceRow, alignSelf: "stretch", backgroundColor: tint(COLOR.black, 0.55) }}>
        <View layout={{
          flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto", marginRight: "auto",
          paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4,
        }}>
          {views.map(({ fence: f, color, selected, shield }) => {
            const look = fenceSlotLook(selected);
            const press = fenceSlotPress(f, onSelect, setInfo);
            return (
              <Pressable
                key={f.id}
                label={contentText.fenceName(t, f)}
                onTap={press.onTap}
                onHold={press.onHold}
                pressedAlpha={0.8}
                alpha={look.alpha}
                layout={{
                  flexDirection: "row", alignItems: "center", gap: 4, height: TOUCH_TARGET,
                  paddingLeft: 10, paddingRight: 10, borderRadius: RADIUS.md,
                  borderWidth: 1, borderColor: color, backgroundColor: tint(color, look.fillAlpha),
                }}
              >
                {/* The selected slot is filled and lit; the rest are outlines. */}
                {look.ring && <GlowRing color={color} />}
                {/* The stripe IS the fence: the slot shows the colour that will
                    appear on the board, so the bar and the cut agree without the
                    player having to remember a name. */}
                <View layout={{ width: 3, height: 18, borderRadius: 1.5, backgroundColor: color }} />
                <Label text={contentText.fenceName(t, f)} size={SLOT_TEXT} weight="700" font="mono" color={color} />
                {shield === "spent" && <Icon icon={ShieldOff} size={14} color={color} alpha={0.5} />}
                {shield === "ready" && <Icon icon={Shield} size={14} color={color} />}
                {/* The hold hint, per CLAUDE.md: a holdable element has to look holdable. */}
                <HoldHint color={color} size={12} />
              </Pressable>
            );
          })}

          {Array.from({ length: empties }, (_, i) => (
            // The DOM's dashed outline is a faint solid one: Yoga borders are solid.
            <View
              key={`empty-${i}`}
              label={t("fenceTypes.emptySlot")}
              layout={{
                alignItems: "center", justifyContent: "center", height: TOUCH_TARGET, minWidth: TOUCH_TARGET,
                paddingLeft: 10, paddingRight: 10, borderRadius: RADIUS.md,
                borderWidth: 1, borderColor: tint(accent, 0x33 / 255),
              }}
            >
              <Label text="+" size={SLOT_TEXT} font="mono" color={accent} alpha={0x55 / 255} />
            </View>
          ))}
        </View>
      </ScrollView>
      {info && (
        <ScreenOverlay>
          <FenceTypeInfoModal fence={info} onClose={() => setInfo(null)} />
        </ScreenOverlay>
      )}
    </>
  );
}
