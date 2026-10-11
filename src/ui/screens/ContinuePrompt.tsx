/**
 * ContinuePrompt: the on-death revive overlay (canvas port of
 * components/game/ContinuePrompt.tsx).
 *
 * Rendered over the game screen when the player runs out of lives but still
 * has a Continue banked. Spending one refills lives and retries the current
 * level with score + upgrades intact; declining ends the run.
 *
 * Drawn in the redo's flat style (UI_REDO_PLAN.md): a raised panel with a 1px
 * edge, left-aligned, the heart beside the title instead of in a glowing ring.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Flag, Heart } from "lucide-react";
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, ROLE, TEXT, View, hex, iconNodeOf, tint, useUiScreen, type IconNode } from "../kit/ui";
import { ArcadeButton } from "../kit/ui";

interface ContinuePromptProps {
  continuesRemaining: number;
  onSpend: () => void;
  onDecline: () => void;
  accentColor?: string;
}

/** The heart filled with the accent, as the DOM drew it (`fill: accentColor`). */
function filledHeart(color: number): IconNode {
  const fill = `#${color.toString(16).padStart(6, "0")}`;
  return iconNodeOf(Heart).map(([tag, attrs]) => [tag, { ...attrs, fill }]);
}

export function ContinuePrompt({
  continuesRemaining,
  onSpend,
  onDecline,
  accentColor = "#00ff88",
}: ContinuePromptProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const heart = useMemo(() => filledHeart(accent), [accent]);
  // flex-col, sm:flex-row: the two buttons sit side by side on a wide screen.
  const wide = screen.width >= 640;
  const cardWidth = Math.min(384, screen.width - 48);

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, alignItems: "center", justifyContent: "center", padding: 24 }} zIndex={90}>
      {/* Backdrop: fades in, and as a Pressable with no handlers it keeps the
          board underneath from taking touches while the choice is open. */}
      <Appear duration={0.25} layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }}>
        <Pressable pressedAlpha={1} layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.8) }} />
      </Appear>

      <Appear fromScale={0.9} fromY={12} duration={0.35}>
        <View layout={{
          width: cardWidth, gap: 16, padding: 20, borderRadius: RADIUS.sm,
          backgroundColor: ROLE.raised, borderWidth: 1, borderColor: ROLE.edge,
        }}>
          <View layout={{ alignSelf: "stretch", gap: 6 }}>
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Icon icon={heart} size={24} color={accent} />
              <Label text={t("continue.title")} size={TEXT["2xl"]} font="display" weight="700" color={ROLE.ink} />
            </View>
            <Label text={t("continue.body", { count: continuesRemaining })} size={TEXT.sm} color={ROLE.muted} wrap />
          </View>

          <View layout={{ alignSelf: "stretch", flexDirection: wide ? "row" : "column", gap: 12 }}>
            <ArcadeButton variant="primary" icon={RotateCcw} text={t("continue.spendButton")} onTap={onSpend}
              layout={wide ? { flex: 1 } : { alignSelf: "stretch" }} />
            <ArcadeButton variant="secondary" icon={Flag} text={t("continue.declineButton")} onTap={onDecline}
              layout={wide ? { flex: 1 } : { alignSelf: "stretch" }} />
          </View>
        </View>
      </Appear>
    </View>
  );
}
