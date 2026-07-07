// Background Music
//
// One looping <audio> element (module singleton, so it survives the per-round
// GameScreen remount and keeps playing seamlessly). Track selection is driven by
// the current level: a shared "main" loop plus one track per 5-level band
// (levels 1-5 -> maps_1-5.mp3, 6-10 -> maps_6-10.mp3, ...). If a band track is
// missing or fails to load, we fall back to main.mp3.
//
// Files live in public/assets/music/ and are served at /assets/music/*.

import { isAudioMuted } from "@/lib/gameAudio";

const MUSIC_DIR = "/assets/music";
const MAIN_TRACK = `${MUSIC_DIR}/main.mp3`;
const DEFAULT_VOLUME = 0.35; // sits under the SFX; tune to taste
const LEVELS_PER_BAND = 5;

/** Path of the band track for a level (levels 1-5 -> maps_1-5.mp3, etc.). */
export function musicFileForLevel(levelNumber: number): string {
  const level = Math.max(1, Math.floor(levelNumber) || 1);
  const band = Math.floor((level - 1) / LEVELS_PER_BAND);
  const lo = band * LEVELS_PER_BAND + 1;
  const hi = lo + LEVELS_PER_BAND - 1;
  return `${MUSIC_DIR}/maps_${lo}-${hi}.mp3`;
}

/** Band key for a level, used to avoid restarting music within the same band. */
function bandKey(levelNumber: number): string {
  const level = Math.max(1, Math.floor(levelNumber) || 1);
  return `band:${Math.floor((level - 1) / LEVELS_PER_BAND)}`;
}

let el: HTMLAudioElement | null = null;
let currentKey: string | null = null; // logical track: bandKey() or 'main'
let musicMuted = false;
let musicVolume = DEFAULT_VOLUME;
let audioUnlocked = false;
let gestureArmed = false;

/**
 * Browsers block audio until the first user gesture. On the menu (the first
 * screen) our .play() is rejected, so arm a one-time capture-phase listener that,
 * on the first interaction anywhere, resumes whatever track we intended to play.
 */
function armGestureUnlock(): void {
  if (audioUnlocked || gestureArmed || typeof window === "undefined") return;
  gestureArmed = true;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const handler = () => {
    audioUnlocked = true;
    for (const ev of events) window.removeEventListener(ev, handler, true);
    if (el && currentKey && el.paused) el.play().catch(() => { /* ignore */ });
  };
  for (const ev of events) window.addEventListener(ev, handler, true);
}

function ensureEl(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null; // non-browser (tests/SSR)
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.volume = musicVolume;
  }
  return el;
}

function applyMute(a: HTMLAudioElement): void {
  // A single global "sound off" (isAudioMuted) also silences music; setMusicMuted
  // is an independent music-only toggle for a future settings UI.
  a.muted = musicMuted || isAudioMuted();
}

/**
 * Point the element at `src` and play. When `withFallback` is set (a band track),
 * a load error routes to main.mp3. `.play()` may reject before the first user
 * gesture; that's swallowed and the next gesture-driven call retries.
 */
function playSrc(src: string, withFallback: boolean): void {
  const a = ensureEl();
  if (!a) return;

  a.onerror = withFallback
    ? () => { a.onerror = null; playSrc(MAIN_TRACK, false); }
    : null;

  a.src = src;
  a.volume = musicVolume;
  applyMute(a);
  const p = a.play();
  if (p && typeof p.catch === "function") {
    // Autoplay blocked before the first gesture: arm a one-time resume.
    p.catch(() => { armGestureUnlock(); });
  }
}

/**
 * Play the track for the given level. Idempotent within a band: calling it every
 * level (including across GameScreen remounts) only switches audio at band
 * boundaries, so music runs continuously through a 5-level stretch. A missing or
 * broken band file falls back to main.mp3, and we stay on the band key so we
 * don't re-attempt the missing file on every level in that band.
 */
export function playMusicForLevel(levelNumber: number): void {
  const key = bandKey(levelNumber);
  if (key === currentKey) return;
  currentKey = key;
  playSrc(musicFileForLevel(levelNumber), true);
}

/** Play the shared main loop (menus, or an explicit default). */
export function playMainMusic(): void {
  if (currentKey === "main") return;
  currentKey = "main";
  playSrc(MAIN_TRACK, false);
}

/** Stop and reset (e.g., returning to a silent screen). */
export function stopMusic(): void {
  currentKey = null;
  if (el) el.pause();
}

/** Music-only mute (independent of the global SFX mute). */
export function setMusicMuted(muted: boolean): void {
  musicMuted = muted;
  if (el) applyMute(el);
}

/** Re-evaluate mute after the global sound toggle changes. */
export function refreshMusicMute(): void {
  if (el) applyMute(el);
}

/** Set music volume (0..1). */
export function setMusicVolume(volume: number): void {
  musicVolume = Math.max(0, Math.min(1, volume));
  if (el) el.volume = musicVolume;
}
