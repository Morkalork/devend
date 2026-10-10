/**
 * The Jukebox's playback and its text rules, out of the view (canvas port of
 * components/game/JukeboxScreen.tsx), so they can be tested without a canvas.
 *
 * Playback is its own single <audio> element, deliberately NOT the crossfade
 * deck in gameMusic.ts: that deck is driven by which level you are on, and
 * borrowing it would mean a player scrubbing the jukebox could leave the
 * game's own music pointing somewhere strange. Opening the screen stops the
 * menu loop; leaving it hands the menu loop back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { MusicCatalogue, MusicTrack } from "@/types/music";
import { getMusicVolume } from "@/lib/gameMusic";

/** m:ss, and a dash while the browser still has no duration for the file. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "-:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "Main menu", "Levels 1-5", "End credits". */
export function usedForLabel(track: MusicCatalogue["tracks"][number], t: TFunction): string {
  return track.usedFor === "band" && track.bandFrom && track.bandTo
    ? t("music.usedFor.band", { from: track.bandFrom, to: track.bandTo })
    : t(`music.usedFor.${track.usedFor}`);
}

/** "by Artist · via Source"; an unrecorded artist is said out loud, never left blank. */
export function trackCredit(track: MusicTrack, t: TFunction): string {
  const by = track.artist ? t("music.byArtist", { artist: track.artist }) : t("music.artistUnknown");
  return track.source ? `${by} · ${t("music.viaSource", { source: track.source })}` : by;
}

/** The right-hand readout: position / duration while playing, where it is used otherwise. */
export function trackReadout(track: MusicTrack, isPlaying: boolean, position: number, duration: number, t: TFunction): string {
  return isPlaying ? `${clock(position)} / ${clock(duration)}` : usedForLabel(track, t);
}

/** The links the screen offers: each track's source page (only when it has one) and the licence. */
export function jukeboxLinks(catalogue: MusicCatalogue): string[] {
  return [...catalogue.tracks.flatMap(tr => (tr.url ? [tr.url] : [])), catalogue.license.url];
}

/** Opens an external page in a new tab/browser, like the DOM's target="_blank" rel="noopener noreferrer". */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export interface JukeboxPlayer {
  /** File of the track playing (or starting), null when silent. */
  playing: string | null;
  /** File of the track still buffering before its first timeupdate. */
  loading: string | null;
  position: number;
  duration: number;
  toggle: (file: string, src: string) => void;
  stop: () => void;
  /** Jump to a fraction (0..1) of the current track. */
  seek: (fraction: number) => void;
}

/**
 * The jukebox's one <audio> element, and the screen's hold on the speakers.
 * `onEnter` runs on mount and `onExit` on unmount, exactly once each.
 */
export function useJukeboxPlayer(onEnter?: () => void, onExit?: () => void): JukeboxPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  // Own the speakers for as long as this screen is mounted. The exit half runs
  // from the same effect's cleanup rather than from the Back button, so a back
  // GESTURE (or any other unmount) restores the menu loop too.
  useEffect(() => {
    onEnter?.();
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      onExit?.();
    };
    // Deliberately mount/unmount only: re-running this on a changed callback
    // identity would stop and restart the menu music on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(null);
    setLoading(null);
    setPosition(0);
    setDuration(0);
  }, []);

  const toggle = useCallback((file: string, src: string) => {
    if (playing === file) { stop(); return; }

    // One element, re-pointed: a fresh Audio per track would leave the previous
    // one buffering a multi-megabyte mp3 nobody is listening to.
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }
    audio.pause();
    audio.src = src;
    audio.currentTime = 0;
    // Match whatever the player set in Options, but never silent: arriving at
    // the jukebox to hear nothing reads as a broken screen, not a low slider.
    audio.volume = Math.max(0.25, getMusicVolume());
    setPosition(0);
    setDuration(0);
    setLoading(file);
    setPlaying(file);
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => { setPlaying(null); setLoading(null); });
    }
  }, [playing, stop]);

  // Progress, duration and end-of-track, on whichever element is current.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return;
    const onTime = () => { setPosition(audio.currentTime); setLoading(null); };
    const onMeta = () => setDuration(audio.duration);
    const onEnded = () => stop();
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, [playing, stop]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
    setPosition(audio.currentTime);
  }, []);

  return { playing, loading, position, duration, toggle, stop, seek };
}
