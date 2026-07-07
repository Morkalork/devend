// Background Music
//
// Two looping <audio> elements (module singletons, so they survive the per-round
// GameScreen remount and keep playing). Track selection is driven by the current
// level: a shared "main" loop plus one track per 5-level band (levels 1-5 ->
// maps_1-5.mp3, 6-10 -> maps_6-10.mp3, ...). Switching crossfades between the two
// elements so track changes are smooth, not abrupt. A missing/broken band track
// falls back to main.mp3.
//
// Files live in public/assets/music/ and are served at /assets/music/*.

import { isAudioMuted } from "@/lib/gameAudio";

const MUSIC_DIR = "/assets/music";
const MAIN_TRACK = `${MUSIC_DIR}/main.mp3`;
const DEFAULT_VOLUME = 0.35; // sits under the SFX; tune to taste
const LEVELS_PER_BAND = 5;
const CROSSFADE_MS = 900;

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

// Two-element crossfade deck. `activeIndex` is the element holding the current
// (foreground) track; the other is used for the incoming track on a switch.
let deck: [HTMLAudioElement, HTMLAudioElement] | null = null;
let activeIndex: 0 | 1 = 0;
let currentKey: string | null = null; // logical track: bandKey() or 'main'
let musicMuted = false;
let musicVolume = DEFAULT_VOLUME;
let fadeGen = 0; // bumped on each switch so stale fades cancel themselves
let audioUnlocked = false;
let gestureArmed = false;

function ensureDeck(): [HTMLAudioElement, HTMLAudioElement] | null {
  if (typeof Audio === "undefined") return null; // non-browser (tests/SSR)
  if (!deck) {
    const make = () => {
      const a = new Audio();
      a.loop = true;
      a.preload = "auto";
      a.volume = 0;
      return a;
    };
    deck = [make(), make()];
  }
  return deck;
}

function applyMute(a: HTMLAudioElement): void {
  // A single global "sound off" (isAudioMuted) also silences music; setMusicMuted
  // is an independent music-only toggle for a future settings UI.
  a.muted = musicMuted || isAudioMuted();
}

/**
 * Browsers block audio until the first user gesture. On the menu (the first
 * screen) our .play() is rejected, so arm a one-time capture-phase listener that,
 * on the first interaction anywhere, resumes the active track.
 */
function armGestureUnlock(): void {
  if (audioUnlocked || gestureArmed || typeof window === "undefined") return;
  gestureArmed = true;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const handler = () => {
    audioUnlocked = true;
    for (const ev of events) window.removeEventListener(ev, handler, true);
    if (deck && currentKey) {
      const a = deck[activeIndex];
      if (a.paused) a.play().catch(() => { /* ignore */ });
    }
  };
  for (const ev of events) window.addEventListener(ev, handler, true);
}

/**
 * Ramp an element's volume to `target` over `durationMs`. Tagged with the switch
 * generation so a newer switch cancels this fade mid-flight. Muted elements still
 * ramp (inaudible) so unmuting mid-fade lands at the right level.
 */
function fadeTo(a: HTMLAudioElement, target: number, durationMs: number, gen: number, onDone?: () => void): void {
  if (typeof requestAnimationFrame === "undefined") { a.volume = target; onDone?.(); return; }
  const start = a.volume;
  const t0 = performance.now();
  const step = (now: number) => {
    if (gen !== fadeGen) return; // superseded by a newer switch
    const p = Math.min(1, (now - t0) / durationMs);
    a.volume = Math.max(0, Math.min(1, start + (target - start) * p));
    if (p < 1) requestAnimationFrame(step);
    else onDone?.();
  };
  requestAnimationFrame(step);
}

/**
 * Crossfade to `src` (logical `key`). No-op if that track is already current, so
 * calling it every level only switches at band boundaries. When `withFallback`,
 * a load error swaps the incoming element to main.mp3 without changing the key
 * (so a missing band file isn't re-attempted on every level in the band).
 */
function switchTo(src: string, key: string, withFallback: boolean): void {
  if (key === currentKey) return;
  const pair = ensureDeck();
  if (!pair) return;
  currentKey = key;
  const gen = ++fadeGen;

  const outgoing = pair[activeIndex];
  const incoming = pair[(1 - activeIndex) as 0 | 1];
  const crossfade = !outgoing.paused;

  incoming.onerror = withFallback
    ? () => {
        incoming.onerror = null;
        incoming.src = MAIN_TRACK; // fall back, keep the in-flight crossfade + key
        incoming.currentTime = 0;
        const pf = incoming.play();
        if (pf && typeof pf.catch === "function") pf.catch(() => armGestureUnlock());
      }
    : null;

  incoming.src = src;
  incoming.currentTime = 0;
  incoming.volume = 0;
  applyMute(incoming);
  const p = incoming.play();
  if (p && typeof p.catch === "function") p.catch(() => armGestureUnlock());

  activeIndex = (1 - activeIndex) as 0 | 1;

  fadeTo(incoming, musicVolume, CROSSFADE_MS, gen);
  if (crossfade) {
    fadeTo(outgoing, 0, CROSSFADE_MS, gen, () => outgoing.pause());
  } else {
    outgoing.pause();
  }
}

/**
 * Play the track for the given level. Idempotent within a band, so calling it
 * every level (including across GameScreen remounts) crossfades only at band
 * boundaries and runs continuously through a 5-level stretch. Missing/broken band
 * files fall back to main.mp3.
 */
export function playMusicForLevel(levelNumber: number): void {
  switchTo(musicFileForLevel(levelNumber), bandKey(levelNumber), true);
}

/** Crossfade to the shared main loop (menus, or an explicit default). */
export function playMainMusic(): void {
  switchTo(MAIN_TRACK, "main", false);
}

/** Stop and reset (e.g., returning to a silent screen). */
export function stopMusic(): void {
  currentKey = null;
  fadeGen++; // cancel any in-flight fades
  if (deck) for (const a of deck) a.pause();
}

/** Music-only mute (independent of the global SFX mute). */
export function setMusicMuted(muted: boolean): void {
  musicMuted = muted;
  if (deck) for (const a of deck) applyMute(a);
}

/** Re-evaluate mute after the global sound toggle changes. */
export function refreshMusicMute(): void {
  if (deck) for (const a of deck) applyMute(a);
}

/** Set music volume (0..1). */
export function setMusicVolume(volume: number): void {
  musicVolume = Math.max(0, Math.min(1, volume));
  if (deck) deck[activeIndex].volume = musicVolume;
}
