/**
 * SuperiorLockInfoModal: the explainer opened by pressing-and-holding a
 * superior-lock's gold star on the board (canvas port of
 * components/game/SuperiorLockInfoModal.tsx). Spells out the difference
 * between a standard lock and a superior lock. Dismiss on backdrop tap or the X.
 */
import { useTranslation } from 'react-i18next';
import { COLOR, Label, Modal, TEXT, View, useUiScreen } from "../kit/ui";
import { FilledStar, WrapText } from "./modalParts";

const GOLD = 0xffd54a;

interface SuperiorLockInfoModalProps {
  onClose: () => void;
}

export function SuperiorLockInfoModal({ onClose }: SuperiorLockInfoModalProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const bodyLine = Math.round(TEXT.sm * 1.375);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={80}>
      <Modal screen={screen} onClose={onClose} accent={GOLD} title={t('game.lockInfo.title')} maxWidth={384}>
        <View layout={{ gap: 16 }}>
          <View layout={{ gap: 4 }}>
            <Label text={t('game.lockInfo.normalTitle')} size={10} weight="700" letterSpacing={0.5} color={COLOR.mutedForeground} />
            <WrapText text={t('game.lockInfo.normalBody')} size={TEXT.sm} lineHeight={bodyLine} color={COLOR.foreground} />
          </View>
          <View layout={{ gap: 4 }}>
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <FilledStar size={12} color={GOLD} />
              <Label text={t('game.lockInfo.superiorTitle')} size={10} weight="700" letterSpacing={0.5} color={GOLD} />
            </View>
            <WrapText text={t('game.lockInfo.superiorBody')} size={TEXT.sm} lineHeight={bodyLine} color={COLOR.foreground} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
