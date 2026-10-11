/**
 * Options (canvas port of components/game/OptionsScreen.tsx): language,
 * music and effects volumes, re-enable tutorials, and the total reset behind
 * its confirmation. The volume ranges are canvas sliders (optionsParts.tsx);
 * the language dropdown is drawn here. The CRT backdrop is not drawn here: it
 * is rendered once, globally, underneath the interface canvas.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FederatedPointerEvent, Container } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { ArrowLeft, Settings, RefreshCw, Trash2, Languages, ChevronDown, ChevronUp, Check, Music, Volume2 } from "lucide-react";
import { changeLanguage, languageNames, supportedLanguages, type SupportedLanguage } from "@/i18n";
import {
  getMusicVolumeSetting,
  getSfxVolumeSetting,
  setMusicVolumeSetting,
  setSfxVolumeSetting,
} from "@/lib/soundSettings";
import { playWallHitSound } from "@/lib/gameAudio";
import {
  Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen,
} from "../kit/ui";
import { MenuHeading } from "./welcomeParts";
import { ArcadeButton } from "../kit/ui";
import { fitTextWidth } from "../kit/ui";
import { ConfirmDialog, VolumeSlider } from "./optionsParts";
import { activeLanguageOf, volumePercent } from "./optionsModel";

interface OptionsScreenProps {
  onBack: () => void;
  onReEnableTutorials: () => void;
  onTotalReset: () => void;
  accentColor?: string;
}

/** True when `node` is `ancestor` or sits somewhere inside it. */
function isInside(node: Container | null, ancestor: Container | null): boolean {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

export function OptionsScreen({
  onBack,
  onReEnableTutorials,
  onTotalReset,
  accentColor,
}: OptionsScreenProps) {
  const { t, i18n } = useTranslation();
  const screen = useUiScreen();
  const [showConfirm, setShowConfirm] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<LayoutContainer | null>(null);
  const [musicVol, setMusicVol] = useState(getMusicVolumeSetting());
  const [sfxVol, setSfxVol] = useState(getSfxVolumeSetting());

  const handleMusicVol = (v: number) => { setMusicVol(v); setMusicVolumeSetting(v); };
  const handleSfxVol = (v: number) => { setSfxVol(v); setSfxVolumeSetting(v); };

  const activeLanguage = activeLanguageOf(i18n.resolvedLanguage, i18n.language);

  // Close the language dropdown when a press lands outside it. While it is
  // open the screen's root catches every press (they bubble up to it) and
  // checks where it started; a press on another control still works.
  const handleRootPointerDown = (e: FederatedPointerEvent) => {
    if (!langOpen) return;
    if (!isInside(e.target as Container | null, langRef.current)) setLangOpen(false);
  };

  const handleSelectLanguage = (lang: SupportedLanguage) => {
    changeLanguage(lang);
    setLangOpen(false);
  };

  const handleResetClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmReset = () => {
    onTotalReset();
    setShowConfirm(false);
  };

  const handleCancelReset = () => {
    setShowConfirm(false);
  };

  const accent = accentColor ? hex(accentColor) : COLOR.primary;
  const width = Math.min(384, screen.width - 48);
  const sectionHeading = (icon: typeof Languages, text: string) => (
    <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon icon={icon} size={16} color={COLOR.mutedForeground} />
      <Label text={text} size={TEXT.sm} font="display" letterSpacing={0.35} color={COLOR.mutedForeground} />
    </View>
  );
  // The DOM's w-9 fits "100%" in tabular digits; Michroma's are wider, so the
  // column is as wide as "100%" itself and never runs into the slider.
  const percentWidth = useMemo(() => Math.max(36, fitTextWidth(volumePercent(1), { size: TEXT.xs, font: "display" })), []);
  const volumeRow = (
    icon: typeof Languages, name: string, value: number, onChange: (v: number) => void, onRelease?: () => void,
  ) => (
    <View layout={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Icon icon={icon} size={16} color={accent} />
      <View layout={{ width: 56 }}>
        <Label text={name} size={TEXT.xs} font="display" letterSpacing={0.3} />
      </View>
      <VolumeSlider value={value} onChange={onChange} onRelease={onRelease} color={accent} layout={{ flex: 1 }} />
      <View layout={{ width: percentWidth, alignItems: "flex-end" }}>
        <Label text={volumePercent(value)} size={TEXT.xs} font="display" color={COLOR.mutedForeground} />
      </View>
    </View>
  );

  return (
    <layoutContainer
      layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9) }}
      eventMode={langOpen ? "static" : "passive"}
      onPointerDown={handleRootPointerDown}
    >
      {/* The two drifting blurred blobs (bg-primary/5 blur-3xl) are dropped:
          at 5% opacity under a blur they were all but invisible. */}
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ minHeight: screen.height, padding: 24, alignItems: "center", justifyContent: "center" }}>
          <Appear fromY={20} duration={0.5} layout={{ width, alignItems: "center", gap: 32 }}>
            {/* Header */}
            <MenuHeading icon={Settings} iconColor={COLOR.primary} text={t("options.title")} size={TEXT["3xl"]} maxWidth={width} />

            {/* Options list */}
            <Appear fromY={20} delay={0.2} layout={{ alignSelf: "stretch", gap: 16 }}>
              {/* Language selector. Drawn above the rows below it, so the open
                  list covers them rather than pushing them down. */}
              <layoutContainer ref={langRef} layout={{ gap: 8 }} zIndex={10}>
                {sectionHeading(Languages, t("options.language"))}
                <View>
                  <Pressable
                    onTap={() => setLangOpen(o => !o)}
                    pressedAlpha={0.85}
                    label={t("options.language")}
                    layout={{
                      flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
                      paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, borderRadius: RADIUS.lg,
                      backgroundColor: tint(COLOR.card, 0.6), borderWidth: 2, borderColor: tint(COLOR.primary, 0.4),
                    }}
                  >
                    <Label text={languageNames[activeLanguage]} size={TEXT.base} font="display" letterSpacing={0.4} />
                    <Icon icon={langOpen ? ChevronUp : ChevronDown} size={20} color={COLOR.primary} />
                  </Pressable>

                  {langOpen && (
                    <View layout={{
                      position: "absolute", left: 0, right: 0, top: "100%", marginTop: 8,
                      borderRadius: RADIUS.lg, overflow: "hidden", borderWidth: 2, borderColor: tint(COLOR.primary, 0.4),
                      backgroundColor: COLOR.card,
                    }}>
                      <Appear fromY={-8} duration={0.15}>
                        {supportedLanguages.map(lang => {
                          const isActive = activeLanguage === lang;
                          return (
                            <Pressable
                              key={lang}
                              onTap={() => handleSelectLanguage(lang)}
                              pressedAlpha={0.8}
                              label={languageNames[lang]}
                              layout={{
                                flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
                                paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12,
                                backgroundColor: isActive ? tint(COLOR.primary, 0.15) : tint(COLOR.card, 0),
                              }}
                            >
                              <Label text={languageNames[lang]} size={TEXT.base} font="display" letterSpacing={0.4}
                                color={isActive ? COLOR.primary : COLOR.foreground} />
                              {isActive && <Icon icon={Check} size={16} color={COLOR.primary} />}
                            </Pressable>
                          );
                        })}
                      </Appear>
                    </View>
                  )}
                </View>
              </layoutContainer>

              {/* Sound volumes (music + effects, independent) */}
              <View layout={{ gap: 12 }}>
                {sectionHeading(Volume2, t("options.sound"))}
                {volumeRow(Music, t("options.music"), musicVol, handleMusicVol)}
                {/* Effects play a test blip on release so the level is audible. */}
                {volumeRow(Volume2, t("options.effects"), sfxVol, handleSfxVol, () => playWallHitSound(1))}
              </View>

              {/* Re-enable All Tutorials */}
              <ArcadeButton icon={RefreshCw} text={t("options.reEnableTutorials")} onTap={onReEnableTutorials} />

              {/* Total Reset: complete deletion of all game state */}
              <ArcadeButton variant="danger" icon={Trash2} text={t("options.totalReset")} onTap={handleResetClick} />

              {/* Back Button */}
              <ArcadeButton variant="secondary" icon={ArrowLeft} text={t("options.back")} onTap={onBack} layout={{ marginTop: 16 }} />
            </Appear>
          </Appear>
        </View>
      </ScrollView>

      {/* Confirmation dialog */}
      {showConfirm && (
        <ConfirmDialog
          title={t("options.resetConfirmTitle")}
          body={t("options.resetConfirmBody")}
          cancelText={t("options.cancel")}
          confirmText={t("options.reset")}
          onCancel={handleCancelReset}
          onConfirm={handleConfirmReset}
        />
      )}
    </layoutContainer>
  );
}
