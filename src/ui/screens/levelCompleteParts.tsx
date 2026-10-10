/**
 * Pieces of the post-map overlay (LevelCompleteOverlay.tsx): the itemised row
 * with its bottom rule, and the press-and-hold info card.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { Layout, PressHandlers } from "../kit/ui";
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, tint, useUiScreen } from "../kit/ui";
import { statInfoFor } from "./levelCompleteModel";

/**
 * One itemised row: label on the left, value on the right, a rule under it
 * (`flex justify-between border-b`). Holdable when given handlers; it never
 * dims, because the DOM rows had no pressed state and a scroll starts on them.
 */
export function StatRow({ handlers, children, paddingY, layout, rule = true }: {
  handlers?: PressHandlers;
  children: ReactNode;
  paddingY: number;
  layout?: Layout;
  /** The bottom rule (off for the tinted total rows). */
  rule?: boolean;
}) {
  return (
    <Pressable {...handlers} pressedAlpha={1} layout={{ paddingTop: paddingY, paddingBottom: paddingY, ...(layout ?? {}) }}>
      {children}
      {rule && <View layout={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: COLOR.border }} />}
    </Pressable>
  );
}

/** A justify-between line: left content and right content on one row. */
export function Between({ left, right, layout }: { left: ReactNode; right: ReactNode; layout?: Layout }) {
  return (
    <View layout={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, ...(layout ?? {}) }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>{left}</View>
      <View layout={{ flexDirection: "row", alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

/**
 * Press-and-hold stat info card: what the row means and how to earn more.
 * Tapping the backdrop or the X closes it. Bounded and scrollable: a card
 * taller than the screen would otherwise lose both ends; the X stays outside
 * the scroller.
 */
export function StatInfoModal({ infoKey, accent, onClose }: { infoKey: string | null; accent?: number; onClose: () => void }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const info = statInfoFor(infoKey);
  if (!info || !infoKey) return null;
  const width = Math.min(384, screen.width - 48);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, justifyContent: "center", alignItems: "center" }} zIndex={60}>
      <Appear duration={0.2} layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
        <Pressable onTap={onClose} pressedAlpha={1}
          layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.7) }} />
      </Appear>
      <Appear fromScale={0.92} fromY={8} duration={0.2}>
        {/* A Pressable with no handlers: a tap on the card must not fall through to the backdrop. */}
        <Pressable pressedAlpha={1} layout={{
          width, maxHeight: screen.height - 48, borderRadius: RADIUS.xl, borderWidth: 2,
          borderColor: accent !== undefined ? tint(accent, 0x66 / 255) : COLOR.border, backgroundColor: COLOR.card,
        }}>
          <ScrollView layout={{ flexShrink: 1, padding: 20 }}>
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, paddingRight: 24 }}>
              <Icon icon={info.icon} size={28} color={info.color} strokeWidth={1.5} />
              <View layout={{ flex: 1 }}>
                <Label text={t(`levelComplete.info.${infoKey}.title`)} size={TEXT.base} weight="700" wrap />
              </View>
            </View>
            <Label text={t(`levelComplete.info.${infoKey}.body`)} size={TEXT.sm} color={COLOR.mutedForeground} wrap layout={{ marginBottom: 16 }} />
            <Label text={t("levelComplete.infoTipLabel")} size={11} weight="600" upper letterSpacing={0.6}
              color={COLOR.mutedForeground} alpha={0.8} layout={{ marginBottom: 6 }} />
            <Label text={t(`levelComplete.info.${infoKey}.tip`)} size={TEXT.sm} wrap />
          </ScrollView>
          <Pressable onTap={onClose} label="close" layout={{ position: "absolute", top: 8, right: 8, padding: 2 }}>
            <Icon icon={X} size={16} color={COLOR.mutedForeground} />
          </Pressable>
        </Pressable>
      </Appear>
    </View>
  );
}
