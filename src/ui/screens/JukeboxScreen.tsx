/**
 * JukeboxScreen - the music room (canvas port of
 * components/game/JukeboxScreen.tsx). Every track the game ships, who wrote
 * it, where it was acquired, and a play button on each one.
 *
 * Two jobs in one screen on purpose. The credits are an obligation (Pixabay
 * makes attribution optional, which is exactly why it needs somewhere
 * deliberate to live), and a playlist is the only reason anyone would open a
 * credits page twice. Both read the same catalogue, so a track cannot appear in
 * one and be missing from the other.
 *
 * Playback, and the hold on the speakers (onEnter on mount, onExit on unmount),
 * live in useJukeboxPlayer (jukeboxPlayer.ts). The CRT backdrop is not drawn
 * here: it is rendered once, globally, underneath the interface canvas.
 */
import { useTranslation } from "react-i18next";
import { Music, ArrowLeft, Play, Pause, ExternalLink } from "lucide-react";
import type { MusicCatalogue } from "@/types/music";
import {
  Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, View, hex, tint, useUiScreen,
} from "../kit/ui";
import { MenuHeading, Spinner } from "./welcomeParts";
import { ArcadeButton } from "../kit/ui";
import { SeekBar } from "./jukeboxParts";
import { openExternal, trackCredit, trackReadout, useJukeboxPlayer } from "./jukeboxPlayer";

interface JukeboxScreenProps {
  catalogue: MusicCatalogue;
  onBack: () => void;
  accentColor?: string;
  /** Silences the menu loop while the jukebox owns the speakers. */
  onEnter?: () => void;
  /** Hands the menu loop back on the way out. */
  onExit?: () => void;
}

export function JukeboxScreen({
  catalogue,
  onBack,
  accentColor = "#00ff88",
  onEnter,
  onExit,
}: JukeboxScreenProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const { playing, loading, position, duration, toggle, seek } = useJukeboxPlayer(onEnter, onExit);
  const accent = hex(accentColor);
  const width = Math.min(672, screen.width - 32);

  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.background, 0.9) }}>
      <ScrollView layout={{ flex: 1 }}>
        <View layout={{ padding: 16, alignItems: "center" }}>
          <Appear fromY={20} duration={0.5} layout={{ width, alignItems: "center", gap: 24, paddingBottom: 96 }}>
            {/* Header */}
            <MenuHeading icon={Music} iconColor={accent} text={t("music.title")} size={TEXT["2xl"]} maxWidth={width} />
            <Label text={t("music.subtitle")} size={TEXT.sm} color={COLOR.mutedForeground} align="center" wrap layout={{ marginTop: -12 }} />

            {/* Playlist */}
            <View layout={{ alignSelf: "stretch", gap: 8 }}>
              {catalogue.tracks.map((track, i) => {
                const isPlaying = playing === track.file;
                const isLoading = loading === track.file;
                const progress = isPlaying && duration > 0 ? position / duration : 0;
                return (
                  <Appear key={track.file} delay={0.08 + i * 0.03}>
                    <View layout={{
                      borderRadius: RADIUS.lg, borderWidth: 1, paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                      borderColor: isPlaying ? tint(accent, 0x66 / 255) : COLOR.border,
                      backgroundColor: isPlaying ? tint(accent, 0x12 / 255) : tint(COLOR.card, 0.5),
                    }}>
                      <View layout={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Pressable
                          onTap={() => toggle(track.file, track.src)}
                          label={t(isPlaying ? "music.pause" : "music.play", { title: track.title })}
                          layout={{
                            width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: tint(accent, 0x88 / 255),
                            alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {isLoading ? <Spinner size={20} color={accent} />
                            : isPlaying ? <Icon icon={Pause} size={20} color={accent} />
                            : <Icon icon={Play} size={20} color={accent} layout={{ marginLeft: 2 }} />}
                        </Pressable>
                        <View layout={{ flex: 1, gap: 2 }}>
                          <Label text={track.title} size={TEXT.base} font="display" weight="700" truncate />
                          <Label text={trackCredit(track, t)} size={TEXT.xs} color={COLOR.mutedForeground} truncate />
                        </View>
                        <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Label text={trackReadout(track, isPlaying, position, duration, t)} size={11} color={COLOR.mutedForeground} />
                          {/* Only a track with a page gets a link: no dead links. */}
                          {track.url && (
                            <Pressable onTap={() => openExternal(track.url!)} label={t("music.openSource", { title: track.title })} alpha={0.6}>
                              <Icon icon={ExternalLink} size={16} color={COLOR.foreground} />
                            </Pressable>
                          )}
                        </View>
                      </View>
                      {isPlaying && <SeekBar progress={progress} color={accent} onSeek={seek} />}
                    </View>
                  </Appear>
                );
              })}
            </View>

            {/* Licence: the note, then its link (the DOM ran them inline). */}
            <View layout={{ alignSelf: "stretch", alignItems: "center", gap: 2 }}>
              <Label text={t("music.licenseNote", { license: catalogue.license.name })} size={11} color={COLOR.mutedForeground} align="center" wrap />
              <Pressable onTap={() => openExternal(catalogue.license.url)} label={t("music.licenseLink")} alpha={0.8} layout={{ alignItems: "stretch" }}>
                <Label text={t("music.licenseLink")} size={11} color={COLOR.mutedForeground} />
                <View layout={{ height: 1, backgroundColor: COLOR.mutedForeground }} />
              </Pressable>
            </View>

            {/* Back */}
            <ArcadeButton size="sm" variant="secondary" icon={ArrowLeft} text={t("music.back")} onTap={onBack} layout={{ marginTop: 8, minWidth: 200 }} />
          </Appear>
        </View>
      </ScrollView>
    </View>
  );
}
