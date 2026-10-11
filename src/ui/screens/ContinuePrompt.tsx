/**
 * ContinuePrompt: the on-death revive overlay (canvas port of
 * components/game/ContinuePrompt.tsx).
 *
 * Rendered over the game screen when the player runs out of lives but still
 * has a Continue banked. Spending one refills lives and retries the current
 * level with score + upgrades intact; declining ends the run.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Flag, Heart } from "lucide-react";
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, TEXT, View, hex, iconNodeOf, tint, useUiScreen, type IconNode } from "../kit/ui";
import { ArcadeButton } from "../kit/ui";

interface ContinuePromptProps {
  continuesRemaining: number;
  onSpend: () => void;
  onDecline: () => void;
  accentColor?: string;
}

/** The card's own near-black green, and the body text's mint. */
const CARD = 0x0a0f0a;
const MINT = 0xc8ffd8;

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
          width: cardWidth, alignItems: "center", gap: 20, padding: 24, borderRadius: RADIUS.xl,
          backgroundColor: CARD, borderWidth: 2, borderColor: accent,
        }}>
          <View layout={{ width: 64, height: 64, borderRadius: RADIUS.full, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: accent, backgroundColor: tint(accent, 0x22 / 255) }}>
            <Icon icon={heart} size={36} color={accent} />
          </View>

          <View layout={{ alignSelf: "stretch", alignItems: "center" }}>
            <Label text={t("continue.title")} size={TEXT["2xl"]} font="display" weight="900" upper letterSpacing={1.2} color={accent} glow={24} />
            <Label text={t("continue.body", { count: continuesRemaining })} size={TEXT.sm} color={MINT} alpha={0.8} align="center" wrap
              layout={{ marginTop: 8 }} />
          </View>

          <View layout={{ alignSelf: "stretch", flexDirection: wide ? "row" : "column", alignItems: "center", gap: 12 }}>
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
