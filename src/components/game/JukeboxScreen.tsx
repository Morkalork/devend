/**
 * JukeboxScreen — the music room. Every track the game ships, who wrote it,
 * where it was acquired, and a play button on each one.
 *
 * Two jobs in one screen on purpose. The credits are an obligation (Pixabay
 * makes attribution optional, which is exactly why it needs somewhere
 * deliberate to live), and a playlist is the only reason anyone would open a
 * credits page twice. Both read the same catalogue, so a track cannot appear in
 * one and be missing from the other.
 *
 * Playback here is its own single <audio> element, deliberately NOT the
 * crossfade deck in gameMusic.ts: that deck is driven by which level you are
 * on, and borrowing it would mean a player scrubbing the jukebox could leave
 * the game's own music pointing somewhere strange. Opening the screen stops the
 * menu loop; leaving it hands the menu loop back.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Music, ArrowLeft, Play, Pause, ExternalLink, Loader2 } from 'lucide-react';
import type { MusicCatalogue } from '@/types/music';
import { getMusicVolume } from '@/lib/gameMusic';
import { CRTBackground } from './CRTBackground';

interface JukeboxScreenProps {
  catalogue: MusicCatalogue;
  onBack: () => void;
  accentColor?: string;
  /** Silences the menu loop while the jukebox owns the speakers. */
  onEnter?: () => void;
  /** Hands the menu loop back on the way out. */
  onExit?: () => void;
}

/** m:ss, and a dash while the browser still has no duration for the file. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function JukeboxScreen({
  catalogue,
  onBack,
  accentColor = '#00ff88',
  onEnter,
  onExit,
}: JukeboxScreenProps) {
  const { t } = useTranslation();
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
      audio.preload = 'auto';
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
    if (p && typeof p.catch === 'function') {
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
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
    };
  }, [playing, stop]);

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
    setPosition(audio.currentTime);
  };

  /** "Main menu", "Levels 1-5", "End credits". */
  const usedForLabel = (track: MusicCatalogue['tracks'][number]) =>
    track.usedFor === 'band' && track.bandFrom && track.bandTo
      ? t('music.usedFor.band', { from: track.bandFrom, to: track.bandTo })
      : t(`music.usedFor.${track.usedFor}`);

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center bg-background/90 p-4 sm:p-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex flex-col items-center gap-6 w-full max-w-2xl pb-24"
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <Music className="w-8 h-8" style={{ color: accentColor }} />
            <h1 className="text-2xl sm:text-4xl font-display font-black tracking-wider text-foreground">
              {t('music.title')}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground text-center -mt-3">
            {t('music.subtitle')}
          </p>

          {/* Playlist */}
          <section className="w-full flex flex-col gap-2">
            {catalogue.tracks.map((track, i) => {
              const isPlaying = playing === track.file;
              const isLoading = loading === track.file;
              const progress = isPlaying && duration > 0 ? position / duration : 0;
              return (
                <motion.div
                  key={track.file}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 + i * 0.03 }}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: isPlaying ? `${accentColor}66` : 'hsl(var(--border))',
                    background: isPlaying ? `${accentColor}12` : 'hsl(var(--card) / 0.5)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <button
                      className="w-10 h-10 shrink-0 rounded-full border flex items-center justify-center"
                      style={{ borderColor: `${accentColor}88`, color: accentColor }}
                      onClick={() => toggle(track.file, track.src)}
                      aria-label={t(isPlaying ? 'music.pause' : 'music.play', { title: track.title })}
                    >
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="w-5 h-5" />
                      ) : (
                        <Play className="w-5 h-5 ml-0.5" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="font-display font-bold truncate text-foreground">
                        {track.title}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {track.artist
                          ? t('music.byArtist', { artist: track.artist })
                          : t('music.artistUnknown')}
                        {track.source && ` · ${t('music.viaSource', { source: track.source })}`}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {isPlaying ? `${clock(position)} / ${clock(duration)}` : usedForLabel(track)}
                      </span>
                      {track.url && (
                        <a
                          href={track.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="opacity-60 hover:opacity-100"
                          aria-label={t('music.openSource', { title: track.title })}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                  {isPlaying && (
                    <div
                      className="mt-2 h-1.5 rounded-full cursor-pointer"
                      style={{ background: 'hsl(var(--muted) / 0.5)' }}
                      onClick={(e) => {
                        const box = e.currentTarget.getBoundingClientRect();
                        seek((e.clientX - box.left) / box.width);
                      }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${progress * 100}%`, background: accentColor }}
                      />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </section>

          {/* Licence */}
          <p className="text-[11px] text-muted-foreground text-center">
            {t('music.licenseNote', { license: catalogue.license.name })}{' '}
            <a
              href={catalogue.license.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline opacity-80 hover:opacity-100"
            >
              {t('music.licenseLink')}
            </a>
          </p>

          {/* Back */}
          <motion.button
            className="arcade-button-secondary arcade-button-sm rounded-lg flex items-center justify-center gap-2 mt-2 min-w-[200px]"
            onClick={onBack}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <ArrowLeft className="w-5 h-5" />
            {t('music.back')}
          </motion.button>
        </motion.div>
      </div>
    </>
  );
}
