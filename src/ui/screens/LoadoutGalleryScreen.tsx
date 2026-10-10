/**
 * LoadoutGalleryScreen: the between-runs loadout collection (canvas port of
 * components/game/LoadoutGalleryScreen).
 *
 * Lists every loadout (public/loadouts.yml) split into unlocked and locked.
 * Locked loadouts show how many UNIQUE wins (runs beaten with distinct
 * run-start loadouts) are still needed, with a progress bar. This is the
 * long-term goal surface: purely presentational, unlock state lives in
 * useMetaProgression (wonLoadoutIds).
 *
 * The DOM page sat on CRTBackground, which stays DOM and is drawn once,
 * globally, under the interface canvas; this screen paints only the 90%
 * background wash the DOM put over it.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Backpack, ArrowLeft, Lock, Skull, Sparkles } from "lucide-react";
import type { LoadoutConfig } from "@/types/loadout";
import { contentText } from "@/i18n/content";
import {
  Appear, COLOR, Icon, Label, ProgressBar, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen,
} from "../kit/ui";
import { ArcadeButton } from "./hallArcadeButton";
import { lockedLoadoutProgress, loadoutGallery } from "./loadoutModel";

interface LoadoutGalleryScreenProps {
  loadouts: LoadoutConfig[];
  wonLoadoutIds: string[];
  onBack: () => void;
  accentColor?: string;
}

/** The curse's red (#ff6b6b) and the blessing's pale green (#c8ffd8). */
const CURSE = 0xff6b6b;
const PALE = 0xc8ffd8;
/** text-xs leading-relaxed. */
const RELAXED = Math.round(TEXT.xs * 1.625);

export function LoadoutGalleryScreen({
  loadouts,
  wonLoadoutIds,
  onBack,
  accentColor = "#00ff88",
}: LoadoutGalleryScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const accent = hex(accentColor);
  const { uniqueWins, totalGated, unlocked, locked } = loadoutGallery(loadouts, wonLoadoutIds);

  const wide = screen.width >= 640;
  const pad = wide ? 24 : 16;
  // max-w-2xl inside the page's padding.
  const contentWidth = Math.min(672, screen.width - pad * 2);

  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9), padding: pad }}>
      <Appear fromY={20} duration={0.5} layout={{ flex: 1, width: contentWidth, alignSelf: "center" }}>
        <View layout={{ flex: 1, alignItems: "center", gap: 24 }}>
          {/* Header */}
          <View layout={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Icon icon={Backpack} size={32} color={accent} />
            <Label text={t("loadouts.title")} size={wide ? TEXT["4xl"] : TEXT["3xl"]} font="display" weight="900" letterSpacing={1.2} />
          </View>

          {/* Unique-win counter */}
          <View layout={{
            alignItems: "center", paddingLeft: 24, paddingRight: 24, paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.xl,
            borderWidth: 1, borderColor: tint(accent, 0x55 / 255), backgroundColor: tint(accent, 0x11 / 255),
          }}>
            <Label text={t("loadouts.uniqueWins")} size={TEXT.xs} upper letterSpacing={0.6} color={PALE} alpha={0.75} layout={{ marginBottom: 4 }} />
            <Label text={`${uniqueWins} / ${totalGated}`} size={TEXT["3xl"]} font="display" weight="700" color={accent} />
          </View>

          <ScrollView layout={{ flex: 1, alignSelf: "stretch", gap: 24, paddingRight: 4 }}>
            {/* Unlocked */}
            {unlocked.length > 0 && (
              <LoadoutSection title={t("loadouts.sectionUnlocked")}>
                {unlocked.map((loadout, i) => (
                  <Appear key={loadout.id} delay={0.15 + i * 0.04}>
                    <View layout={{ padding: 16, borderRadius: RADIUS.lg, borderWidth: 2, borderColor: tint(accent, 0x44 / 255), backgroundColor: tint(COLOR.white, 0.04) }}>
                      <Label text={contentText.loadoutName(t, loadout)} size={TEXT.base} font="display" weight="700" color={accent} wrap layout={{ marginBottom: 12 }} />
                      <LoadoutLine icon={Skull} iconColor={CURSE} text={contentText.loadoutCurse(t, loadout)} textColor={CURSE} />
                      <View layout={{ height: 8 }} />
                      <LoadoutLine icon={Sparkles} iconColor={accent} text={contentText.loadoutBlessing(t, loadout)} textColor={PALE} />
                    </View>
                  </Appear>
                ))}
              </LoadoutSection>
            )}

            {/* Locked */}
            {locked.length > 0 && (
              <LoadoutSection title={t("loadouts.sectionLocked")}>
                {locked.map((loadout, i) => {
                  const { required, remaining, current, value } = lockedLoadoutProgress(loadout, uniqueWins);
                  return (
                    <Appear key={loadout.id} delay={0.2 + i * 0.03}>
                      <View alpha={0.7} layout={{
                        padding: 16, borderRadius: RADIUS.lg, borderWidth: 1,
                        borderColor: tint(COLOR.muted, 0.3), backgroundColor: tint(COLOR.muted, 0.05),
                      }}>
                        <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                          <Icon icon={Lock} size={16} color={COLOR.mutedForeground} layout={{ marginTop: 2 }} />
                          <View layout={{ flex: 1 }}>
                            <Label text={contentText.loadoutName(t, loadout)} size={TEXT.sm} font="display" weight="700" color={COLOR.mutedForeground} wrap />
                            <Label text={t("loadouts.unlockRequirement", { count: remaining })} size={TEXT.xs} color={COLOR.foreground} alpha={0.8} wrap layout={{ marginTop: 4 }} />
                            <ProgressBar value={value} height={6} track={tint(COLOR.muted, 0.4)} layout={{ marginTop: 8 }} />
                            <Label text={t("loadouts.progress", { current, required })} size={TEXT.xs} weight="700" color={COLOR.mutedForeground} layout={{ marginTop: 4 }} />
                          </View>
                        </View>
                      </View>
                    </Appear>
                  );
                })}
              </LoadoutSection>
            )}

            {loadouts.length === 0 && (
              <View layout={{ paddingTop: 32, paddingBottom: 32 }}>
                <Label text={t("loadouts.loading")} size={TEXT.sm} color={COLOR.mutedForeground} align="center" wrap />
              </View>
            )}
          </ScrollView>

          {/* Back */}
          <Appear fromY={20} delay={0.4}>
            <ArcadeButton text={t("loadouts.back")} icon={ArrowLeft} onTap={onBack} />
          </Appear>
        </View>
      </Appear>
    </View>
  );
}

function LoadoutSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View>
      <Label text={title} size={TEXT.xs} font="display" weight="700" upper letterSpacing={1.2} color={COLOR.mutedForeground}
        layout={{ marginBottom: 8, marginLeft: 4 }} />
      <View layout={{ gap: 12 }}>{children}</View>
    </View>
  );
}

/** A curse or blessing: its icon, then the wrapped sentence. */
function LoadoutLine({ icon, iconColor, text, textColor }: { icon: typeof Skull; iconColor: number; text: string; textColor: number }) {
  return (
    <View layout={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Icon icon={icon} size={16} color={iconColor} layout={{ marginTop: 2 }} />
      <View layout={{ flex: 1 }}>
        <Label text={text} size={TEXT.xs} lineHeight={RELAXED} color={textColor} wrap />
      </View>
    </View>
  );
}
