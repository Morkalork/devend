/**
 * LockExplainerModal: a one-time modal shown the FIRST time the player finishes
 * a map having locked ZERO balls, right before the bank / push-your-luck choice
 * (canvas port of components/game/LockExplainerModal.tsx). Just a picture of a
 * locked ball + one line: locking is worth points and opens the store. Dismiss
 * with the button or a backdrop tap.
 */
import { useTranslation } from 'react-i18next';
import type { Graphics } from "pixi.js";
import { Appear, COLOR, Label, Pressable, RADIUS, TEXT, View, tint, useUiScreen } from "../kit/ui";
import { CardShield } from "./modalParts";
import { ART_ACCENT, LOCKED_BALL_H, LOCKED_BALL_W, drawLockedBallArt } from "./TutorialArtDraw";

const ACCENT = ART_ACCENT;

/** Module-level, so the Graphics sees the same callback on every render. */
const drawArt = (g: Graphics) => drawLockedBallArt(g);

/**
 * The actual in-game lock: a ball sealed into a small captured pocket in the
 * corner of the board by two fences (the other two sides are board walls). Dark
 * board + dot grid, bright accent fences, a tinted captured pocket, snug ball.
 */
function LockedBallArt() {
  return (
    <View layout={{ width: LOCKED_BALL_W, height: LOCKED_BALL_H }}>
      <pixiGraphics draw={drawArt} />
    </View>
  );
}

interface LockExplainerModalProps {
  onClose: () => void;
}

export function LockExplainerModal({ onClose }: LockExplainerModalProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  return (
    <View
      layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, justifyContent: "center", alignItems: "center" }}
      zIndex={95}
    >
      <Pressable
        onTap={onClose}
        pressedAlpha={1}
        label="backdrop"
        layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.72) }}
      />
      <Appear fromScale={0.96} duration={0.18}>
        <CardShield layout={{
          width: Math.min(288, screen.width - 32), borderRadius: RADIUS.xl, overflow: "hidden",
          backgroundColor: 0x0b0f14, borderColor: ACCENT, borderWidth: 1,
        }}>
          <View layout={{ alignItems: "center", paddingTop: 24, paddingBottom: 4 }}>
            <LockedBallArt />
          </View>
          <View layout={{ paddingLeft: 24, paddingRight: 24, paddingTop: 4, paddingBottom: 16 }}>
            <Label text={t('game.lockExplainer.line')} size={TEXT.sm} lineHeight={Math.round(TEXT.sm * 1.375)}
              color={COLOR.foreground} align="center" wrap />
          </View>
          <View layout={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>
            <Pressable
              onTap={onClose}
              label={t('game.lockExplainer.dismiss')}
              layout={{
                alignItems: "center", paddingTop: 10, paddingBottom: 10, borderRadius: RADIUS.lg,
                backgroundColor: tint(ACCENT, 0x22 / 255), borderColor: ACCENT, borderWidth: 1,
              }}
            >
              <Label text={t('game.lockExplainer.dismiss')} size={TEXT.sm} weight="700" font="display" color={ACCENT} />
            </Pressable>
          </View>
        </CardShield>
      </Appear>
    </View>
  );
}
