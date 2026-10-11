/**
 * FeatureUnlockedModal: the general "Feature Unlocked" announcement (canvas
 * port of components/game/FeatureUnlockedModal.tsx). Shown once, mid-run, when
 * the player earns a new game feature (see features.ts). The header is always
 * "Feature Unlocked"; the icon, name and body come from the feature
 * (icon/colour from the catalogue, strings from i18n `features.<id>.*`).
 * Dismiss with a tap or the button. No exit animation: it simply goes.
 */
import { useTranslation } from 'react-i18next';
import { Appear, COLOR, Icon, Label, Pressable, RADIUS, TEXT, View, hex, tint, useUiScreen, ArcadeButton } from "../kit/ui";
import type { GameFeature } from '@/lib/features';
import { CardShield, GlowFrame } from "./modalParts";
import { featureAccent, featureIcon } from "./FeatureUnlockedModalModel";

interface FeatureUnlockedModalProps {
  /** The feature to announce, or null when nothing is pending. */
  feature: GameFeature | null;
  onDismiss: () => void;
}

export function FeatureUnlockedModal({ feature, onDismiss }: FeatureUnlockedModalProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  if (!feature) return null;
  const accent = hex(featureAccent(feature));
  const FeatureIcon = featureIcon(feature);

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height }} zIndex={70}>
      <Appear duration={0.25} layout={{
        width: screen.width, height: screen.height, justifyContent: "center", alignItems: "center", padding: 24,
      }}>
        <Pressable
          onTap={onDismiss}
          pressedAlpha={1}
          label="backdrop"
          layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.8) }}
        />
        <Appear fromScale={0.9} fromY={12} duration={0.3}>
          <CardShield layout={{
            width: Math.min(448, screen.width - 48), padding: 24, gap: 12, alignItems: "center",
            borderRadius: RADIUS.xl, backgroundColor: 0x0a0f0a, borderColor: accent, borderWidth: 2,
          }}>
            {/* box-shadow 0 0 40px accent44 */}
            <GlowFrame color={accent} radius={RADIUS.xl} spread={28} strength={0x44 / 255} />
            <Label text={t('features.unlockedHeader')} size={TEXT.xs} weight="600" upper letterSpacing={TEXT.xs * 0.3}
              color={accent} alpha={0xaa / 255} />
            <View layout={{
              width: 56, height: 56, borderRadius: RADIUS.full, alignItems: "center", justifyContent: "center",
              borderWidth: 2, borderColor: accent, backgroundColor: tint(accent, 0x22 / 255),
            }}>
              <Icon icon={FeatureIcon} size={32} color={accent} />
            </View>
            <Label text={t(`features.${feature.id}.name`)} size={TEXT.xl} weight="900" font="display" upper
              letterSpacing={TEXT.xl * 0.05} color={accent} align="center" wrap />
            <Label text={t(`features.${feature.id}.body`)} size={TEXT.sm} lineHeight={Math.round(TEXT.sm * 1.625)}
              color={0xc8ffd8} align="center" wrap />
            <ArcadeButton text={t('features.dismiss')} onTap={onDismiss} layout={{ marginTop: 4 }} />
          </CardShield>
        </Appear>
      </Appear>
    </View>
  );
}
