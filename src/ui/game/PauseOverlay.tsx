/**
 * The pause screen (canvas port of the overlay written inline in
 * components/game/GameScreen.tsx): a big PAUSED in the board's accent, why the
 * game paused when the player did not ask for it, and Resume. It covers the
 * whole screen, so nothing under it can be touched while paused.
 */
import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import { COLOR, Label, TEXT, View, hex, tint, useUiScreen } from "../kit/ui";
import { ArcadeButton, TouchBlocker, WrapText } from "./modalParts";

interface PauseOverlayProps {
  accentColor: string;
  /** The view is zoomed: the game paused itself and must say why. */
  zoomStuck: boolean;
  onResume: () => void;
}

export function PauseOverlay({ accentColor, zoomStuck, onResume }: PauseOverlayProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={65}>
      {/* The DOM's backdrop blur is dropped; the dim stays. */}
      <TouchBlocker
        screen={screen}
        color={tint(COLOR.black, 0.65)}
        layout={{ alignItems: "center", justifyContent: "center", gap: 24 }}
      >
        <Label text={t('game.paused')} size={TEXT["4xl"]} weight="700" font="display"
          letterSpacing={TEXT["4xl"] * 0.1} color={accent} glow={24} />
        {/* Why, when the player did not ask for this. A pause nobody chose is
            a bug unless it says what it is: the view is zoomed, the game is
            waiting, pinch back and carry on. */}
        {zoomStuck && (
          <View layout={{ width: Math.min(320, screen.width), paddingLeft: 24, paddingRight: 24 }}>
            <WrapText text={t('game.pausedZoom')} size={TEXT.sm} color={accent} alpha={0.8} align="center" />
          </View>
        )}
        <ArcadeButton text={t('game.resume')} icon={Play} onTap={onResume}
          size={TEXT.base} weight="700" paddingX={32} paddingY={12} />
      </TouchBlocker>
    </View>
  );
}
