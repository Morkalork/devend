/**
 * The map is cleared: bank the score, or push on for overtime (canvas port of
 * components/game/PushYourLuckOverlay.tsx). Each choice can be made once; both
 * buttons go dead the moment either is pressed, so a double tap cannot bank
 * AND push.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Zap, Coins } from 'lucide-react';
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, TEXT, View, tint, useUiScreen } from "../kit/ui";
import { GlowFrame, TouchBlocker } from "./modalParts";
import { pushChunkPercent, pushLuckBox } from "./PushYourLuckOverlayModel";

interface PushYourLuckOverlayProps {
  remainingPercent: number;
  thresholdPercent: number;
  basePoints: number;
  onBank: () => void;
  onPush: () => void;
}

/** Tailwind's `success` (hsl 145 100% 53%), the same green as primary. */
const SUCCESS = COLOR.primary;

export function PushYourLuckOverlay({
  remainingPercent,
  thresholdPercent,
  onBank,
  onPush,
}: PushYourLuckOverlayProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const [chosen, setChosen] = useState(false);
  // Each 25% of remaining area cleared = +1 OT
  const chunk = pushChunkPercent(remainingPercent);
  const box = pushLuckBox(screen);
  const wide = screen.width >= 640;

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={40}>
      <Appear duration={0.5} layout={{ width: screen.width, height: screen.height }}>
        {/* Backdrop: dims the cleared board and keeps fingers off it. */}
        <TouchBlocker screen={screen} color={tint(COLOR.background, 0.5)} />

        <View layout={{
          position: "absolute", left: box.left, width: box.width,
          ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }),
        }}>
          <View layout={{
            padding: wide ? 24 : 16, borderRadius: RADIUS.xl, borderWidth: 2, borderColor: SUCCESS,
            backgroundColor: tint(COLOR.black, 0.6),
          }}>
            {/* Header */}
            <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 }}>
              <View layout={{
                width: 40, height: 40, borderRadius: RADIUS.full, alignItems: "center", justifyContent: "center",
                backgroundColor: tint(SUCCESS, 0.2),
              }}>
                <Icon icon={Trophy} size={20} color={SUCCESS} />
              </View>
              <Label text={t('pushYourLuck.levelCleared')} size={TEXT.xl} weight="700" font="display" color={SUCCESS} />
            </View>

            {/* Info: runs of differently styled words, wrapping as a sentence would. */}
            <View layout={{ alignItems: "center", marginBottom: 16 }}>
              <View layout={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginBottom: 8 }}>
                <Label text={`${t('pushYourLuck.remainingLabel')} `} size={TEXT.sm} color={COLOR.mutedForeground} />
                <Label text={`${remainingPercent}%`} size={TEXT.sm} weight="600" color={COLOR.foreground} />
                <Label text={` ${t('pushYourLuck.targetSuffix', { threshold: thresholdPercent })}`} size={TEXT.sm} color={COLOR.mutedForeground} />
              </View>
              <View layout={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
                <Label text={`${t('pushYourLuck.keepCuttingPrefix')} `} size={TEXT.xs} color={COLOR.mutedForeground} />
                <Label text={t('pushYourLuck.bonusPerRemoved', { percent: chunk })} size={TEXT.xs} weight="500" color={COLOR.primary} />
                <Label text="." size={TEXT.xs} color={COLOR.mutedForeground} />
              </View>
              <Label text={t('pushYourLuck.noRisk')} size={TEXT.xs} color={SUCCESS} align="center" wrap />
            </View>

            {/* Buttons */}
            <View layout={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                disabled={chosen}
                onTap={() => { setChosen(true); onBank(); }}
                label={t('pushYourLuck.bankAndContinue')}
                layout={{
                  flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.lg,
                  backgroundColor: 0x22c55e, borderColor: 0x16a34a, borderWidth: 1,
                }}
              >
                <Icon icon={Coins} size={16} color={COLOR.black} />
                <Label text={t('pushYourLuck.bankAndContinue')} size={TEXT.base} weight="500" color={COLOR.black} layout={{ flexShrink: 1 }} />
              </Pressable>
              <Pressable
                disabled={chosen}
                onTap={() => { setChosen(true); onPush(); }}
                label={t('pushYourLuck.pushYourLuck')}
                layout={{
                  flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.lg,
                  backgroundColor: 0xf97316,
                }}
              >
                {/* box-shadow 0 0 20px rgba(249,115,22,0.6) */}
                <GlowFrame color={0xf97316} radius={RADIUS.lg} spread={16} strength={0.6} />
                <Icon icon={Zap} size={16} color={COLOR.black} />
                <Label text={t('pushYourLuck.pushYourLuck')} size={TEXT.base} weight="700" color={COLOR.black} layout={{ flexShrink: 1 }} />
              </Pressable>
            </View>
          </View>
        </View>
      </Appear>
    </View>
  );
}
